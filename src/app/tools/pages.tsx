import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { BottomBar } from '@/components/BottomBar';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { useOverlay } from '@/components/overlay/OverlayProvider';
import { PageThumb } from '@/components/PageThumb';
import { getDocument } from '@/db/repositories/documents';
import { listPages } from '@/db/repositories/pages';
import { formatPageRanges, isPdfCapable, parsePageRanges } from '@/domain/pdfTools';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { goBack } from '@/lib/navigation';
import { countPdfPages, extractPages, rotatePdfPages } from '@/services/pdf/engine';
import { useTheme } from '@/theme';

type Mode = 'extract' | 'rotate';

/**
 * Page picker for Extract (→ new PDF) and Rotate (PDFs, in place). Tap pages or type ranges such as
 * "1-3, 5"; both stay in sync. Scans show page thumbnails; PDFs show page numbers.
 */
export default function PagesToolScreen() {
  const { documentId, mode = 'extract' } = useLocalSearchParams<{ documentId: string; mode?: Mode }>();
  const db = useDb();
  const { colors } = useTheme();
  const { showToast } = useOverlay();
  const [selected, setSelected] = useState<number[]>([]);
  const [rangeText, setRangeText] = useState('');

  const { data, error, refresh } = useDbQuery(
    async (d) => {
      const document = await getDocument(d, documentId);
      if (!document) return null;
      const pages = document.kind === 'pages' ? await listPages(d, documentId) : [];
      const pageCount = document.kind === 'pages' ? pages.length : document.pageCount || (document.fileUri ? await countPdfPages(document.fileUri) : 0);
      return { document, pages, pageCount };
    },
    [documentId],
    ['documents', 'pages'],
  );

  const extract = useAsyncAction(async () => {
    if (!data) return;
    const extracted = await extractPages(db, data.document, selected, `${data.document.title} (pages ${formatPageRanges(selected)})`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    showToast({ message: `Created “${extracted.title}”` });
    router.replace(`/document/${extracted.id}/read`);
  });

  const rotate = useAsyncAction(async (quarterTurns: number) => {
    if (!data) return;
    await rotatePdfPages(db, data.document, selected, quarterTurns);
    Haptics.selectionAsync().catch(() => {});
    showToast({ message: `Rotated ${selected.length === 1 ? 'page' : 'pages'} ${formatPageRanges(selected)}` });
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (data === null) return <EmptyState icon="file-hidden" title="Document not found" actionLabel="Go back" onAction={() => goBack()} />;
  if (!data) return null;

  const { document, pages, pageCount } = data;
  if (!isPdfCapable(document) || (mode === 'rotate' && document.kind !== 'pdf')) {
    return (
      <EmptyState
        icon="file-alert-outline"
        title={mode === 'rotate' ? 'Rotate works on PDFs' : 'This tool works on scans and PDFs'}
        body={mode === 'rotate' && document.kind === 'pages' ? 'To rotate a scanned page, open it in the page editor.' : undefined}
        actionLabel="Go back"
        onAction={() => goBack()}
      />
    );
  }

  const selectedSet = new Set(selected);
  const setSelection = (indices: number[]) => {
    setSelected(indices);
    setRangeText(formatPageRanges(indices).replace(/–/g, '-'));
  };
  const toggle = (index: number) => {
    Haptics.selectionAsync().catch(() => {});
    setSelection(selectedSet.has(index) ? selected.filter((i) => i !== index) : [...selected, index].sort((a, b) => a - b));
  };
  const onRangeText = (text: string) => {
    setRangeText(text);
    const parsed = parsePageRanges(text, pageCount);
    if (parsed) setSelected(parsed);
    else if (!text.trim()) setSelected([]);
  };
  const rangeInvalid = rangeText.trim() !== '' && parsePageRanges(rangeText, pageCount) === null;
  const busy = extract.pending || rotate.pending;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: mode === 'rotate' ? 'Rotate pages' : 'Extract pages' }} />
      <ScrollView contentContainerClassName="pb-6" keyboardShouldPersistTaps="handled">
        <View className="px-4 pt-4">
          <Text numberOfLines={1} className="text-base font-semibold text-text">
            {document.title}
          </Text>
          <Text className="mt-0.5 text-sm text-muted">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'} · {selected.length} selected
          </Text>
          <TextInput
            value={rangeText}
            onChangeText={onRangeText}
            placeholder="Pages, e.g. 1-3, 5"
            placeholderTextColor={colors.muted}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Page ranges"
            className={`mt-3 rounded-xl border bg-surface px-4 py-3 text-base text-text ${rangeInvalid ? 'border-danger' : 'border-transparent'}`}
          />
          {rangeInvalid ? <Text className="mt-1 text-sm text-danger">Use page numbers from 1 to {pageCount}, like 1-3, 5.</Text> : null}
          <View className="mt-3 flex-row gap-2">
            <Button label="All" variant="secondary" onPress={() => setSelection(Array.from({ length: pageCount }, (_, i) => i))} />
            <Button label="None" variant="secondary" onPress={() => setSelection([])} />
          </View>
        </View>

        <View className="mt-4 flex-row flex-wrap px-2.5">
          {Array.from({ length: pageCount }, (_, index) => {
            const isSelected = selectedSet.has(index);
            const page = pages[index];
            return (
              <Pressable
                key={index}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`Page ${index + 1}`}
                onPress={() => toggle(index)}
                className={page ? 'w-1/3 p-1.5' : 'w-1/5 p-1.5'}
              >
                {page ? (
                  <PageThumb page={page} index={index} selected={isSelected} />
                ) : (
                  <View
                    className={`aspect-[3/4] items-center justify-center rounded-lg border-2 ${
                      isSelected ? 'border-primary bg-primary/15' : 'border-border bg-surface'
                    }`}
                  >
                    <Text className={`text-lg font-semibold ${isSelected ? 'text-primary' : 'text-text'}`}>{index + 1}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <BottomBar>
        {mode === 'rotate' ? (
          <>
            <Button label="Left" icon="rotate-left" variant="secondary" onPress={() => rotate.run(-1)} disabled={!selected.length || busy} className="flex-1" />
            <Button label="Right" icon="rotate-right" onPress={() => rotate.run(1)} disabled={!selected.length || busy} loading={rotate.pending} className="flex-1" />
          </>
        ) : (
          <Button
            label={selected.length ? `Extract ${selected.length} ${selected.length === 1 ? 'page' : 'pages'}` : 'Choose pages'}
            icon="file-export-outline"
            onPress={() => extract.run()}
            disabled={!selected.length || busy}
            loading={extract.pending}
            className="flex-1"
          />
        )}
      </BottomBar>
    </View>
  );
}
