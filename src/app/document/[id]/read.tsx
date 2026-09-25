import { File, Paths } from 'expo-file-system';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon, type IconName } from '@/components/Icon';
import { PromptDialog } from '@/components/PromptDialog';
import { SheetList, type SheetItem } from '@/components/SheetList';
import { listBookmarks, toggleBookmark } from '@/db/repositories/bookmarks';
import { getDocument, setLastReadPage, setPageCount } from '@/db/repositories/documents';
import { listPages } from '@/db/repositories/pages';
import { getSetting, setSetting } from '@/db/repositories/settings';
import { AppError, toAppError } from '@/domain/errors';
import { fileExtension } from '@/domain/fileTypes';
import type { Document, Page } from '@/domain/models';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { buildPagesHtml, buildTextHtml, MAX_TEXT_BYTES } from '@/services/reader/html';
import { useTheme } from '@/theme';

const PDF_VIEWER = 'file:///android_asset/pdfjs/web/viewer.html';
const CODE_EXTENSIONS = new Set(['json', 'xml', 'csv', 'tsv', 'log', 'yaml', 'yml', 'ini', 'toml', 'js', 'ts', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'sql', 'html', 'htm', 'css']);
const SAVE_POSITION_DELAY_MS = 800;

type ZoomMode = 'page-width' | 'page-fit';

type ReaderMessage =
  | { type: 'loaded'; pageCount: number }
  | { type: 'page'; page: number; pageCount: number }
  | { type: 'progress'; percent: number }
  | { type: 'find'; current: number; total: number; pending: boolean }
  | { type: 'outline'; items: { index: number; title: string; depth: number }[] }
  | { type: 'error'; message: string };

interface ReaderData {
  document: Document;
  pages: Page[];
  night: boolean;
}

/** Everything the WebView needs, computed once per open (changing it would reload the page). */
type ReaderSource = { uri: string } | { html: string; baseUrl: string };

async function buildSource(data: ReaderData, startPage: number): Promise<ReaderSource> {
  const { document, pages, night } = data;
  if (document.kind === 'pdf') {
    if (!document.fileUri) throw new AppError('not_found', 'PDF file missing');
    // lowmem caps canvas size (~4 MP per page): sharp at phone zoom levels, safe on 1–2 GB phones.
    const query = `file=${encodeURIComponent(document.fileUri)}&lowmem=1&night=${night ? 1 : 0}`;
    return { uri: `${PDF_VIEWER}?${query}#page=${startPage}` };
  }
  if (document.kind === 'text') {
    if (!document.fileUri) throw new AppError('not_found', 'Text file missing');
    const file = new File(document.fileUri);
    if (!file.exists) throw new AppError('not_found', 'Text file missing');
    const truncated = (file.size ?? 0) > MAX_TEXT_BYTES;
    const text = truncated ? (await file.text()).slice(0, MAX_TEXT_BYTES) : await file.text();
    const monospace = CODE_EXTENSIONS.has(fileExtension(document.originalName ?? ''));
    return { html: buildTextHtml(text, { night, truncated, monospace }), baseUrl: Paths.document.uri };
  }
  const readerPages = pages.map((page) => ({ uri: page.processedUri ?? page.originalUri, width: page.width, height: page.height }));
  return { html: buildPagesHtml(readerPages, { night, startPage }), baseUrl: Paths.document.uri };
}

function HeaderButton({ icon, label, onPress, active = false }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress} className="px-2">
      <Icon name={icon} color={active ? 'primary' : 'text'} />
    </Pressable>
  );
}

export default function ReaderScreen() {
  const { id, page: pageParam } = useLocalSearchParams<{ id: string; page?: string }>();
  const db = useDb();
  const { colors } = useTheme();
  const webview = useRef<WebView>(null);

  const { data, error, refresh } = useDbQuery(
    async (d): Promise<ReaderData | null> => {
      const document = await getDocument(d, id);
      if (!document) return null;
      const [pages, night] = await Promise.all([
        document.kind === 'pages' ? listPages(d, id) : Promise.resolve([]),
        getSetting(d, 'readerNightMode'),
      ]);
      return { document, pages, night };
    },
    [id],
    // Pages are re-read when edited; document-level changes (rename, page count) don't reload.
    ['pages'],
  );
  const bookmarks = useDbQuery((d) => listBookmarks(d, id), [id], ['documents']);

  const [source, setSource] = useState<ReaderSource | null>(null);
  const [sourceError, setSourceError] = useState<AppError | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCountState] = useState(0);
  const [percent, setPercent] = useState<number | null>(null);
  const [night, setNight] = useState(false);
  const [zoom, setZoom] = useState<ZoomMode>('page-width');
  const [outline, setOutline] = useState<SheetItem[]>([]);
  const [search, setSearch] = useState<{ open: boolean; query: string; current: number; total: number; pending: boolean }>({
    open: false,
    query: '',
    current: 0,
    total: 0,
    pending: false,
  });
  const [sheet, setSheet] = useState<'menu' | 'outline' | 'bookmarks' | null>(null);
  const [goToVisible, setGoToVisible] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the WebView source once the data is in; rebuild only if the page images change.
  const pagesKey = data?.pages.map((p) => `${p.id}:${p.processedUri ?? p.originalUri}`).join('|') ?? '';
  const dataReady = data !== undefined && data !== null;
  useEffect(() => {
    if (!dataReady || !data) return;
    let cancelled = false;
    const start = Number(pageParam) || data.document.lastReadPage || 1;
    buildSource(data, start).then(
      (built) => {
        if (cancelled) return;
        setNight(data.night);
        setSource(built);
        setPage(start);
      },
      (err: unknown) => !cancelled && setSourceError(toAppError(err)),
    );
    return () => {
      cancelled = true;
    };
    // Rebuild only when the document or its page images change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady, pagesKey, id]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const run = (script: string) => webview.current?.injectJavaScript(`try { ${script} } catch (e) {} true;`);

  const document = data?.document;
  const kind = document?.kind;
  const paged = kind === 'pdf' || kind === 'pages';
  const searchable = kind === 'pdf' || kind === 'text';
  const bookmarked = (bookmarks.data ?? []).some((b) => b.pageIndex === page - 1);

  const onMessage = (event: WebViewMessageEvent) => {
    let message: ReaderMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as ReaderMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'loaded':
        setLoaded(true);
        if (message.pageCount > 0) {
          setPageCountState(message.pageCount);
          if (document && message.pageCount !== document.pageCount && kind === 'pdf') {
            setPageCount(db, id, message.pageCount).catch(() => {});
          }
        }
        break;
      case 'page':
        setPage(message.page);
        setPageCountState(message.pageCount);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          setLastReadPage(db, id, message.page).catch(() => {});
        }, SAVE_POSITION_DELAY_MS);
        break;
      case 'progress':
        setPercent(message.percent);
        break;
      case 'find':
        setSearch((s) => ({ ...s, current: message.current, total: message.total, pending: message.pending }));
        break;
      case 'outline':
        setOutline(
          message.items.map((item) => ({
            key: String(item.index),
            label: item.title,
            depth: Math.min(item.depth, 4),
            onPress: () => run(`window.docuna.goToOutline(${item.index})`),
          })),
        );
        break;
      case 'error':
        if (__DEV__) console.warn('Reader error:', message.message);
        break;
    }
  };

  // Only local reader content loads inside the WebView; web links open in the browser, if confirmed.
  const onShouldStartLoad = (request: ShouldStartLoadRequest) => {
    const { url } = request;
    if (/^(file|about|data|blob):/i.test(url)) return true;
    if (/^(https?|mailto|tel):/i.test(url)) {
      Alert.alert('Open link?', url, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open', onPress: () => Linking.openURL(url).catch(() => {}) },
      ]);
    }
    return false;
  };

  const toggleNight = useAsyncAction(async () => {
    const next = !night;
    setNight(next);
    run(`window.docuna.setNight(${next})`);
    await setSetting(db, 'readerNightMode', next);
  });

  const toggleCurrentBookmark = useAsyncAction(async () => {
    const pageId = kind === 'pages' ? (data?.pages[page - 1]?.id ?? null) : null;
    await toggleBookmark(db, id, page - 1, pageId);
  });

  const share = useAsyncAction(async () => {
    if (!document?.fileUri) return;
    if (!(await Sharing.isAvailableAsync())) throw new AppError('unknown', 'Sharing unavailable');
    await Sharing.shareAsync(document.fileUri, {
      mimeType: document.mimeType ?? (kind === 'pdf' ? 'application/pdf' : 'text/plain'),
      dialogTitle: document.title,
    });
  });

  const applyZoom = (mode: ZoomMode) => {
    setZoom(mode);
    run(`window.docuna.setZoom(${JSON.stringify(mode)})`);
  };

  const goToPage = (target: number) => run(`window.docuna.goToPage(${Math.round(target)})`);

  const submitSearch = (previous = false) => {
    const query = search.query.trim();
    if (query) run(`window.docuna.find(${JSON.stringify(query)}, ${previous})`);
  };

  const closeSearch = () => {
    setSearch({ open: false, query: '', current: 0, total: 0, pending: false });
    run('window.docuna.clearFind()');
  };

  const buildMenu = (): SheetItem[] => {
    if (!document) return [];
    const items: SheetItem[] = [];
    if (paged) items.push({ key: 'goto', label: 'Go to page…', icon: 'numeric', onPress: () => setGoToVisible(true) });
    if (outline.length > 0) items.push({ key: 'outline', label: 'Contents', icon: 'format-list-bulleted', onPress: () => setSheet('outline') });
    if (paged) items.push({ key: 'bookmarks', label: 'Bookmarks', icon: 'bookmark-multiple-outline', detail: String(bookmarks.data?.length ?? 0), onPress: () => setSheet('bookmarks') });
    if (paged) {
      items.push(
        zoom === 'page-width'
          ? { key: 'fit', label: 'Fit whole page', icon: 'fit-to-page-outline', onPress: () => applyZoom('page-fit') }
          : { key: 'fit', label: 'Fit page width', icon: 'arrow-expand-horizontal', onPress: () => applyZoom('page-width') },
      );
    }
    items.push({ key: 'night', label: night ? 'Night mode: on' : 'Night mode: off', icon: night ? 'weather-night' : 'white-balance-sunny', onPress: () => toggleNight.run() });
    if (document.fileUri) items.push({ key: 'share', label: 'Share file', icon: 'share-variant-outline', onPress: () => share.run() });
    if (kind === 'pages') items.push({ key: 'edit', label: 'Edit pages', icon: 'file-edit-outline', onPress: () => router.push(`/document/${id}/pages`) });
    items.push({ key: 'details', label: 'Document details', icon: 'information-outline', onPress: () => router.push(`/document/${id}`) });
    return items;
  };

  const bookmarkItems: SheetItem[] = (bookmarks.data ?? []).map((bookmark) => ({
    key: bookmark.id,
    label: bookmark.label ?? `Page ${bookmark.pageIndex + 1}`,
    icon: 'bookmark',
    onPress: () => goToPage(bookmark.pageIndex + 1),
  }));

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (sourceError) return <ErrorView error={sourceError} onRetry={() => router.replace(`/document/${id}/read`)} />;
  if (data === null) {
    return <EmptyState icon="file-hidden" title="Document not found" actionLabel="Go back" onAction={() => router.back()} />;
  }
  if (document && kind === 'pages' && data && data.pages.length === 0) {
    return (
      <EmptyState
        icon="file-outline"
        title="No pages yet"
        body="Scan or add photos to this document to read it."
        actionLabel="Add pages"
        onAction={() => router.replace({ pathname: '/scan', params: { documentId: id } })}
      />
    );
  }

  const indicator = paged && pageCount > 0 ? `${page} / ${pageCount}` : percent !== null ? `${percent}%` : null;

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: document?.title ?? '',
          headerRight: () => (
            <View className="flex-row items-center">
              {searchable ? <HeaderButton icon="magnify" label="Search in document" onPress={() => setSearch((s) => ({ ...s, open: true }))} /> : null}
              {paged ? (
                <HeaderButton
                  icon={bookmarked ? 'bookmark' : 'bookmark-outline'}
                  label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
                  active={bookmarked}
                  onPress={() => toggleCurrentBookmark.run()}
                />
              ) : null}
              <HeaderButton icon="dots-vertical" label="More options" onPress={() => setSheet('menu')} />
            </View>
          ),
        }}
      />

      {search.open ? (
        <View className="flex-row items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <TextInput
            autoFocus
            value={search.query}
            onChangeText={(query) => setSearch((s) => ({ ...s, query }))}
            onSubmitEditing={() => submitSearch(false)}
            placeholder="Find in document"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            accessibilityLabel="Find in document"
            className="flex-1 rounded-lg bg-background px-3 py-2 text-base text-text"
          />
          <Text accessibilityLiveRegion="polite" className="min-w-12 text-center text-sm text-muted">
            {search.pending ? '…' : search.total > 0 ? `${search.current}/${search.total}` : search.query ? '0' : ''}
          </Text>
          <HeaderButton icon="chevron-up" label="Previous match" onPress={() => submitSearch(true)} />
          <HeaderButton icon="chevron-down" label="Next match" onPress={() => submitSearch(false)} />
          <HeaderButton icon="close" label="Close search" onPress={closeSearch} />
        </View>
      ) : null}

      <View className="flex-1">
        {source && !crashed ? (
          <WebView
            ref={webview}
            source={source}
            originWhitelist={['*']}
            allowFileAccess
            allowFileAccessFromFileURLs
            javaScriptEnabled
            domStorageEnabled={kind === 'pdf'}
            // PDF.js handles pinch-zoom itself (re-rendering sharply); other content uses WebView zoom.
            setBuiltInZoomControls={kind !== 'pdf'}
            setDisplayZoomControls={false}
            overScrollMode="never"
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStartLoad}
            onRenderProcessGone={() => setCrashed(true)}
            webviewDebuggingEnabled={__DEV__}
            style={{ backgroundColor: night ? '#111418' : '#e9ecef' }}
          />
        ) : null}

        {crashed ? (
          <ErrorView
            error={{ userMessage: 'The reader ran out of memory on this document. Close other apps and try again.' }}
            onRetry={() => {
              setCrashed(false);
              setLoaded(false);
            }}
          />
        ) : null}

        {!loaded && !crashed ? (
          <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
            <ActivityIndicator size="large" />
          </View>
        ) : null}

        {indicator && loaded && !crashed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={paged ? `Page ${page} of ${pageCount}. Tap to go to a page.` : `${percent}% read`}
            disabled={!paged}
            onPress={() => setGoToVisible(true)}
            className="absolute bottom-4 self-center rounded-full bg-black/70 px-4 py-1.5"
          >
            <Text className="text-sm font-medium text-white">{indicator}</Text>
          </Pressable>
        ) : null}
      </View>

      <SheetList visible={sheet === 'menu'} items={sheet === 'menu' ? buildMenu() : []} onClose={() => setSheet(null)} />
      <SheetList visible={sheet === 'outline'} title="Contents" items={outline} onClose={() => setSheet(null)} />
      <SheetList
        visible={sheet === 'bookmarks'}
        title="Bookmarks"
        items={bookmarkItems}
        emptyText="Tap the bookmark icon at the top to bookmark the page you're on."
        onClose={() => setSheet(null)}
      />
      <PromptDialog
        visible={goToVisible}
        title={`Go to page (1–${pageCount || 1})`}
        initialValue={String(page)}
        keyboardType="number-pad"
        confirmLabel="Go"
        onCancel={() => setGoToVisible(false)}
        onConfirm={(value) => {
          const target = Number.parseInt(value, 10);
          if (Number.isFinite(target)) goToPage(target);
          setGoToVisible(false);
        }}
      />
    </SafeAreaView>
  );
}
