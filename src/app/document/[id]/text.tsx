import { FlashList } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { BottomBar } from '@/components/BottomBar';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { useOverlay } from '@/components/overlay/OverlayProvider';
import { getDocument } from '@/db/repositories/documents';
import { getDocumentOcrProgress, getDocumentText, resetDocumentOcr, type PageText } from '@/db/repositories/ocr';
import { getSetting, setSetting } from '@/db/repositories/settings';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { goBack } from '@/lib/navigation';
import { shareText } from '@/services/files/exportFile';
import { useTheme } from '@/theme';

const LOW_CONFIDENCE = 0.6;

function joinPages(pages: PageText[]): string {
  return pages
    .filter((page) => page.text)
    .map((page) => (pages.length > 1 ? `— Page ${page.pageNumber} —\n${page.text}` : page.text))
    .join('\n\n');
}

function PageBlock({ page, onCopy }: { page: PageText; onCopy: (page: PageText) => void }) {
  const { colors } = useTheme();
  const unsure = page.confidence !== null && page.confidence > 0 && page.confidence < LOW_CONFIDENCE;
  return (
    <View className="mx-4 mb-3 rounded-2xl bg-surface px-4 pb-4 pt-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold uppercase tracking-wide text-muted">Page {page.pageNumber}</Text>
        {page.text ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy page ${page.pageNumber}`}
            onPress={() => onCopy(page)}
            android_ripple={{ color: colors.border, borderless: true }}
            hitSlop={8}
            className="p-2"
          >
            <Icon name="content-copy" size={18} color="muted" />
          </Pressable>
        ) : null}
      </View>
      {page.text ? (
        <Text selectable className="text-base leading-6 text-text">
          {page.text}
        </Text>
      ) : (
        <Text className="py-2 text-base italic text-muted">No text found on this page.</Text>
      )}
      {unsure ? (
        <Text className="mt-2 text-sm text-warning">Some words may be wrong: the page was hard to read.</Text>
      ) : null}
    </View>
  );
}

/** A document's recognised text: read, select, copy, share or re-run. */
export default function DocumentTextScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const { showToast } = useOverlay();

  const { data, error, refresh } = useDbQuery(
    async (d) => {
      const document = await getDocument(d, id);
      if (!document) return null;
      const [pages, progress, enabled] = await Promise.all([getDocumentText(d, id), getDocumentOcrProgress(d, id), getSetting(d, 'ocrEnabled')]);
      return { document, pages, progress, enabled };
    },
    [id],
    ['ocr', 'documents', 'pages', 'settings'],
  );

  const copy = async (text: string, message: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.selectionAsync().catch(() => {});
    showToast({ message });
  };

  const share = useAsyncAction(async () => {
    if (data) await shareText(data.document.title, joinPages(data.pages));
  });

  const rerun = useAsyncAction(async () => {
    await resetDocumentOcr(db, id);
  });
  const confirmRerun = () =>
    Alert.alert('Recognise text again?', 'The current text is replaced. Use this after improving a page or if the text looks wrong.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Recognise', onPress: () => rerun.run() },
    ]);

  const enable = useAsyncAction(() => setSetting(db, 'ocrEnabled', true));

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (data === null) return <EmptyState icon="file-hidden" title="Document not found" actionLabel="Go back" onAction={() => goBack()} />;
  if (!data) return null;

  const { document, pages, progress, enabled } = data;
  if (!progress || progress.state === 'skipped') {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Text' }} />
        <EmptyState
          icon="text-recognition"
          title="No text recognition for this file"
          body="Docuna recognises text in scans, PDFs and text files. Open this file to read it."
          actionLabel="Open"
          onAction={() => router.replace(`/document/${id}/read`)}
        />
      </View>
    );
  }

  const running = progress.state === 'pending';
  const hasText = pages.some((page) => page.text);

  const status = !enabled && running ? (
    <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl bg-surface-muted px-4 py-3">
      <Icon name="pause-circle-outline" color="muted" />
      <Text className="flex-1 text-sm text-text">Text recognition is turned off.</Text>
      <Button label="Turn on" size="md" variant="ghost" onPress={() => enable.run()} />
    </View>
  ) : running ? (
    <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl bg-surface-muted px-4 py-3">
      <ActivityIndicator />
      <Text className="flex-1 text-sm text-text">
        Recognising text… {progress.done} of {progress.total} {progress.total === 1 ? 'page' : 'pages'}. It runs on this phone while Docuna is open.
      </Text>
    </View>
  ) : progress.state === 'failed' ? (
    <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl bg-surface-muted px-4 py-3">
      <Icon name="alert-circle-outline" color="danger" />
      <Text className="flex-1 text-sm text-text">
        {document.kind === 'pdf' ? 'This PDF couldn’t be read for text (it may be password protected).' : 'Text couldn’t be recognised.'}
      </Text>
    </View>
  ) : null;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: 'Text',
          headerRight: () =>
            running ? null : (
              <Pressable accessibilityRole="button" accessibilityLabel="Recognise text again" onPress={confirmRerun} hitSlop={12} className="p-1">
                <Icon name="refresh" />
              </Pressable>
            ),
        }}
      />
      <FlashList
        data={pages}
        keyExtractor={(page) => String(page.pageNumber)}
        renderItem={({ item }) => <PageBlock page={item} onCopy={(page) => copy(page.text, `Copied page ${page.pageNumber}`)} />}
        ListHeaderComponent={<View className="pt-3">{status}</View>}
        ListEmptyComponent={
          running ? null : (
            <EmptyState icon="text-recognition" title="No text found" body="This document doesn’t seem to contain readable text." />
          )
        }
        contentContainerStyle={{ paddingBottom: 16 }}
      />
      {hasText ? (
        <BottomBar>
          <Button
            label="Copy all"
            icon="content-copy"
            variant="secondary"
            onPress={() => copy(joinPages(pages), 'Copied all text')}
            className="flex-1"
          />
          <Button label="Share" icon="share-variant-outline" onPress={() => share.run()} loading={share.pending} className="flex-1" />
        </BottomBar>
      ) : null}
    </View>
  );
}
