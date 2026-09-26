import { BlurTargetView } from 'expo-blur';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon, type IconName } from '@/components/Icon';
import { useOverlay } from '@/components/overlay/OverlayProvider';
import { PromptDialog } from '@/components/PromptDialog';
import { GlassSheet } from '@/components/glass/GlassSheet';
import { GlassDivider, GlassList, GlassRow, GlassTile, GlassTileRow } from '@/components/glass/GlassItems';
import { listBookmarks, toggleBookmark } from '@/db/repositories/bookmarks';
import { getDocument, markOpened, setLastReadPage, setPageCount } from '@/db/repositories/documents';
import { listPages } from '@/db/repositories/pages';
import { getSetting, setSetting } from '@/db/repositories/settings';
import { AppError, toAppError } from '@/domain/errors';
import { fileExtension } from '@/domain/fileTypes';
import { OFFICE_KINDS, type Document, type Page } from '@/domain/models';
import { isPdfCapable } from '@/domain/pdfTools';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { goBack } from '@/lib/navigation';
import { openInAnotherApp, saveToDownloads, saveToFolder, shareDocument, type SaveResult } from '@/services/files/exportFile';
import { buildPagesHtml, buildTextHtml, MAX_TEXT_BYTES } from '@/services/reader/html';
import { useTheme } from '@/theme';

const PDF_VIEWER = 'file:///android_asset/pdfjs/web/viewer.html';
const OFFICE_VIEWER = 'file:///android_asset/office/office.html';
const CODE_EXTENSIONS = new Set(['json', 'xml', 'csv', 'tsv', 'log', 'yaml', 'yml', 'ini', 'toml', 'js', 'ts', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'sql', 'html', 'htm', 'css']);
const SAVE_POSITION_DELAY_MS = 800;
/** Controls hide after this long without interaction (full-screen reading). */
const CHROME_AUTO_HIDE_MS = 3000;
const ZOOM_BADGE_MS = 1200;
const KEEP_AWAKE_TAG = 'docuna-reader';

type ZoomMode = 'page-width' | 'page-fit';

type ReaderMessage =
  | { type: 'loaded'; pageCount: number }
  | { type: 'page'; page: number; pageCount: number }
  | { type: 'progress'; percent: number }
  | { type: 'zoom'; percent: number }
  | { type: 'tap' }
  | { type: 'find'; current: number; total: number; pending: boolean }
  | { type: 'outline'; items: { index: number; title: string; depth: number }[] }
  | { type: 'error'; message: string }
  | { type: 'failed'; message: string };

interface ReaderData {
  document: Document;
  pages: Page[];
  night: boolean;
  keepAwake: boolean;
}

/** Everything the WebView needs, computed once per open (changing it would reload the page). */
type ReaderSource = { uri: string } | { html: string; baseUrl: string };

async function buildSource(data: ReaderData, startPage: number): Promise<ReaderSource | null> {
  const { document, pages, night } = data;
  if (document.kind === 'other') return null;
  if (OFFICE_KINDS.includes(document.kind)) {
    if (!document.fileUri) throw new AppError('not_found', 'File missing');
    const query = `file=${encodeURIComponent(document.fileUri)}&type=${document.kind}&night=${night ? 1 : 0}`;
    return { uri: `${OFFICE_VIEWER}?${query}` };
  }
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
  // `q`: opened from a search result; the match is highlighted where the reader has a text layer.
  const { id, page: pageParam, q: queryParam } = useLocalSearchParams<{ id: string; page?: string; q?: string }>();
  const db = useDb();
  const { colors } = useTheme();
  const { showToast } = useOverlay();
  const webview = useRef<WebView>(null);
  // The document area; glass sheets blur whatever it shows.
  const blurTarget = useRef<View>(null);

  const { data, error, refresh } = useDbQuery(
    async (d): Promise<ReaderData | null> => {
      const document = await getDocument(d, id);
      if (!document) return null;
      const [pages, night, keepAwake] = await Promise.all([
        document.kind === 'pages' ? listPages(d, id) : Promise.resolve([]),
        getSetting(d, 'readerNightMode'),
        getSetting(d, 'readerKeepAwake'),
      ]);
      return { document, pages, night, keepAwake };
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
  const [renderFailed, setRenderFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCountState] = useState(0);
  const [percent, setPercent] = useState<number | null>(null);
  const [night, setNight] = useState(false);
  const [zoom, setZoom] = useState<ZoomMode>('page-width');
  const [outline, setOutline] = useState<{ index: number; title: string; depth: number }[]>([]);
  const [search, setSearch] = useState<{ open: boolean; query: string; current: number; total: number; pending: boolean }>({
    open: false,
    query: '',
    current: 0,
    total: 0,
    pending: false,
  });
  const [sheet, setSheet] = useState<'menu' | 'outline' | 'bookmarks' | null>(null);
  const [goToVisible, setGoToVisible] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [chromeVersion, setChromeVersion] = useState(0);
  const [zoomPercent, setZoomPercent] = useState<number | null>(null);
  const [keepAwake, setKeepAwake] = useState<boolean | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  /** Shows the controls and restarts the auto-hide countdown. */
  const showChrome = () => {
    setChromeVisible(true);
    setChromeVersion((v) => v + 1);
  };

  // Full-screen reading: controls hide after a few seconds unless a panel needs them.
  const chromePinned = search.open || sheet !== null || goToVisible || !loaded;
  useEffect(() => {
    if (!chromeVisible || chromePinned) return;
    const timer = setTimeout(() => setChromeVisible(false), CHROME_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [chromeVisible, chromePinned, chromeVersion]);

  // Keep the screen on while reading (user setting, on by default).
  const keepAwakeOn = keepAwake ?? data?.keepAwake ?? false;
  useEffect(() => {
    if (!keepAwakeOn) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [keepAwakeOn]);

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
        // Only documents with something to read count for "Continue reading".
        if (data.document.kind !== 'pages' || data.pages.length > 0) markOpened(db, id).catch(() => {});
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
      if (zoomTimer.current) clearTimeout(zoomTimer.current);
    },
    [],
  );

  const run = (script: string) => webview.current?.injectJavaScript(`try { ${script} } catch (e) {} true;`);

  const document = data?.document;
  const kind = document?.kind;
  const exportable = Boolean(document?.fileUri) || (kind === 'pages' && (data?.pages.length ?? 0) > 0);
  const paged = kind === 'pdf' || kind === 'pages' || kind === 'slides';
  const searchable = kind === 'pdf' || kind === 'text' || kind === 'word' || kind === 'sheet' || kind === 'slides';
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
        if (queryParam && searchable) {
          setSearch({ open: true, query: queryParam, current: 0, total: 0, pending: true });
          run(`window.docuna.find(${JSON.stringify(queryParam)}, false)`);
        }
        if (message.pageCount > 0) {
          setPageCountState(message.pageCount);
          if (document && message.pageCount !== document.pageCount && (kind === 'pdf' || kind === 'slides')) {
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
      case 'zoom':
        // The initial fit on open also reports a scale; only show changes once the document is up.
        if (!loaded) break;
        setZoomPercent(message.percent);
        if (zoomTimer.current) clearTimeout(zoomTimer.current);
        zoomTimer.current = setTimeout(() => setZoomPercent(null), ZOOM_BADGE_MS);
        break;
      case 'tap':
        if (chromeVisible && !chromePinned) setChromeVisible(false);
        else showChrome();
        break;
      case 'find':
        setSearch((s) => ({ ...s, current: message.current, total: message.total, pending: message.pending }));
        break;
      case 'outline':
        setOutline(message.items.map((item) => ({ ...item, depth: Math.min(item.depth, 4) })));
        break;
      case 'error':
        if (__DEV__) console.warn('Reader error:', message.message);
        break;
      case 'failed':
        if (__DEV__) console.warn('Could not render:', message.message);
        setRenderFailed(true);
        setLoaded(true);
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
    const added = await toggleBookmark(db, id, page - 1, pageId);
    Haptics.impactAsync(added ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  });

  const share = useAsyncAction(async () => {
    if (document) await shareDocument(db, document);
  });

  const openExternally = useAsyncAction(async () => {
    if (document) await openInAnotherApp(db, document);
  });

  const reportSaved = (result: SaveResult) => {
    if (result.saved) showToast({ message: 'Saved to ' + result.location });
  };
  const download = useAsyncAction(async () => {
    if (document) reportSaved(await saveToDownloads(db, document));
  });
  const saveAs = useAsyncAction(async () => {
    if (document) reportSaved(await saveToFolder(db, document));
  });

  const toggleKeepAwake = useAsyncAction(async () => {
    const next = !keepAwakeOn;
    setKeepAwake(next);
    await setSetting(db, 'readerKeepAwake', next);
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

  const closeSheet = () => setSheet(null);
  /** Closes the sheet, then runs the action (e.g. navigating) once it is out of the way. */
  const closeThen = (action: () => void) => {
    setSheet(null);
    action();
  };

  const menuSheet = document ? (
    <>
      <GlassTileRow>
        <GlassTile
          icon={night ? 'weather-night' : 'white-balance-sunny'}
          label="Night mode"
          active={night}
          onPress={() => toggleNight.run()}
        />
        <GlassTile
          icon={keepAwakeOn ? 'cellphone-screenshot' : 'cellphone-off'}
          label="Keep screen on"
          active={keepAwakeOn}
          onPress={() => toggleKeepAwake.run()}
        />
        {paged ? (
          <GlassTile
            icon={zoom === 'page-fit' ? 'fit-to-page-outline' : 'arrow-expand-horizontal'}
            label={zoom === 'page-fit' ? 'Whole page' : 'Fit width'}
            onPress={() => applyZoom(zoom === 'page-fit' ? 'page-width' : 'page-fit')}
          />
        ) : null}
        {exportable ? (
          <GlassTile icon="share-variant-outline" label="Share" onPress={() => closeThen(() => share.run())} />
        ) : null}
      </GlassTileRow>
      <GlassDivider />
      {paged ? <GlassRow icon="numeric" label="Go to page" detail={pageCount ? `${page} of ${pageCount}` : undefined} onPress={() => closeThen(() => setGoToVisible(true))} /> : null}
      {outline.length > 0 ? <GlassRow icon="format-list-bulleted" label="Contents" onPress={() => setSheet('outline')} /> : null}
      {paged ? (
        <GlassRow
          icon="bookmark-multiple-outline"
          label="Bookmarks"
          detail={String(bookmarks.data?.length ?? 0)}
          onPress={() => setSheet('bookmarks')}
        />
      ) : null}
      {exportable ? (
        <>
          <GlassRow icon="download-outline" label="Save to Downloads" onPress={() => closeThen(() => download.run())} />
          <GlassRow icon="folder-download-outline" label="Save to…" onPress={() => closeThen(() => saveAs.run())} />
          <GlassRow icon="open-in-app" label="Open in another app" onPress={() => closeThen(() => openExternally.run())} />
        </>
      ) : null}
      {isPdfCapable(document) ? (
        <GlassRow
          icon="file-cog-outline"
          label="PDF tools"
          detail="Merge, extract, compress"
          onPress={() => closeThen(() => router.push({ pathname: '/tools', params: { documentId: id } }))}
        />
      ) : null}
      {kind === 'pages' || kind === 'pdf' || kind === 'text' ? (
        <GlassRow
          icon="text-recognition"
          label="Text"
          detail="Copy or share the words on the pages"
          onPress={() => closeThen(() => router.push(`/document/${id}/text`))}
        />
      ) : null}
      {kind === 'pages' ? <GlassRow icon="file-edit-outline" label="Edit pages" onPress={() => closeThen(() => router.push(`/document/${id}/pages`))} /> : null}
      <GlassRow icon="information-outline" label="Document details" onPress={() => closeThen(() => router.push(`/document/${id}`))} />
    </>
  ) : null;

  // States without the reader keep a normal header, so there is always a way back.
  const plainHeader = <Stack.Screen options={{ headerShown: true, title: document?.title ?? '' }} />;
  if (error) return <>{plainHeader}<ErrorView error={error} onRetry={refresh} /></>;
  if (sourceError) {
    return <>{plainHeader}<ErrorView error={sourceError} onRetry={() => router.replace(`/document/${id}/read`)} /></>;
  }
  if (data === null) {
    return <>{plainHeader}<EmptyState icon="file-hidden" title="Document not found" actionLabel="Go back" onAction={() => goBack()} /></>;
  }
  if (document && (kind === 'other' || renderFailed)) {
    const extension = fileExtension(document.originalName ?? '').toUpperCase();
    return (
      <>
        {plainHeader}
        <View className="flex-1 items-center justify-center bg-background px-8">
          <View className="mb-5 h-20 w-20 items-center justify-center rounded-full bg-surface-muted">
            <Icon name="file-document-outline" size={40} color="muted" />
          </View>
          <Text className="text-center text-lg font-semibold text-text">
            {renderFailed ? 'This file couldn’t be displayed' : `${extension || 'This'} files open in another app`}
          </Text>
          <Text className="mt-2 text-center text-base text-muted">
            {renderFailed
              ? 'It may be damaged or use features Docuna can’t show yet. It’s saved in Docuna, and another app may open it.'
              : 'It’s saved in Docuna with your other documents. Reading it here isn’t supported yet.'}
          </Text>
          <View className="mt-8 gap-3 self-stretch">
            <Button label="Open in another app" icon="open-in-app" size="lg" onPress={() => openExternally.run()} loading={openExternally.pending} />
            <Button label="Share" icon="share-variant-outline" variant="secondary" onPress={() => share.run()} />
          </View>
        </View>
      </>
    );
  }
  if (document && kind === 'pages' && data && data.pages.length === 0) {
    return (
      <>
      {plainHeader}
      <EmptyState
        icon="file-outline"
        title="No pages yet"
        body="Scan or add photos to this document to read it."
        actionLabel="Add pages"
        onAction={() => router.replace({ pathname: '/scan', params: { documentId: id } })}
      />
      </>
    );
  }

  const indicator = paged && pageCount > 0 ? `${page} / ${pageCount}` : percent !== null ? `${percent}%` : null;

  const searchBar = search.open ? (
    <View className="flex-row items-center gap-2 px-3 pb-2">
      <TextInput
        autoFocus
        value={search.query}
        onChangeText={(query) => setSearch((st) => ({ ...st, query }))}
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
  ) : null;

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-background">
      {/* Full-screen reading: the stack header is replaced by an overlay that hides on tap. */}
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar hidden={!chromeVisible} />

      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
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

        {zoomPercent !== null ? (
          <View
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            className="absolute self-center rounded-full bg-black/70 px-4 py-2"
            style={{ top: '45%' }}
          >
            <Text className="text-lg font-semibold text-white">{zoomPercent}%</Text>
          </View>
        ) : null}

        {chromeVisible ? (
          <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(200)}
            className="absolute left-0 right-0 top-0 border-b border-border bg-surface"
            style={{ paddingTop: insets.top }}
          >
            <View className="h-14 flex-row items-center pl-2 pr-1">
              <HeaderButton icon="arrow-left" label="Back" onPress={() => goBack()} />
              <Text numberOfLines={1} className="ml-2 flex-1 text-lg font-semibold text-text">
                {document?.title ?? ''}
              </Text>
              {searchable ? (
                <HeaderButton icon="magnify" label="Search in document" onPress={() => setSearch((st) => ({ ...st, open: true }))} />
              ) : null}
              {paged ? (
                <HeaderButton
                  icon={bookmarked ? 'bookmark' : 'bookmark-outline'}
                  label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
                  active={bookmarked}
                  onPress={() => {
                    showChrome();
                    toggleCurrentBookmark.run();
                  }}
                />
              ) : null}
              <HeaderButton icon="dots-vertical" label="More options" onPress={() => setSheet('menu')} />
            </View>
            {searchBar}
          </Animated.View>
        ) : null}

        {indicator && loaded && !crashed && chromeVisible ? (
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
      </BlurTargetView>

      <GlassSheet visible={sheet === 'menu'} onClose={closeSheet} blurTarget={blurTarget} title={document?.title} subtitle={indicator ?? undefined}>
        {menuSheet}
      </GlassSheet>
      <GlassSheet visible={sheet === 'outline'} onClose={closeSheet} blurTarget={blurTarget} title="Contents" scrollable>
        <GlassList>
          {outline.map((entry) => (
            <GlassRow
              key={entry.index}
              label={entry.title}
              indent={entry.depth}
              onPress={() => closeThen(() => run(`window.docuna.goToOutline(${entry.index})`))}
            />
          ))}
        </GlassList>
      </GlassSheet>
      <GlassSheet visible={sheet === 'bookmarks'} onClose={closeSheet} blurTarget={blurTarget} title="Bookmarks" scrollable>
        <GlassList empty="Tap the bookmark icon at the top to bookmark the page you're on.">
          {(bookmarks.data ?? []).map((bookmark) => (
            <GlassRow
              key={bookmark.id}
              icon="bookmark"
              label={bookmark.label ?? `Page ${bookmark.pageIndex + 1}`}
              onPress={() => closeThen(() => goToPage(bookmark.pageIndex + 1))}
            />
          ))}
        </GlassList>
      </GlassSheet>
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
