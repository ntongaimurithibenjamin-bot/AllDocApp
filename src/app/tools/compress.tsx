import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { BottomBar } from '@/components/BottomBar';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { getDocument } from '@/db/repositories/documents';
import type { Document } from '@/domain/models';
import { isPdfCapable } from '@/domain/pdfTools';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { formatBytes } from '@/lib/format';
import { goBack } from '@/lib/navigation';
import { compressDocument, type CompressionLevel } from '@/services/pdf/engine';
import { discardDocument } from '@/services/pages/pageService';

const LEVELS: { level: CompressionLevel; title: string; body: string }[] = [
  { level: 'balanced', title: 'Balanced', body: 'Clear for reading and printing. Good for email and school portals.' },
  { level: 'small', title: 'Smallest', body: 'Best for WhatsApp and slow data. Fine on a phone screen.' },
];

type Outcome =
  | { kind: 'smaller'; document: Document; before: number; after: number }
  | { kind: 'not-smaller'; before: number };

/** Makes a smaller copy of a scan or PDF; the original is kept. */
export default function CompressScreen() {
  const { documentId } = useLocalSearchParams<{ documentId: string }>();
  const db = useDb();
  const [level, setLevel] = useState<CompressionLevel>('balanced');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const { data: document, error, refresh } = useDbQuery((d) => getDocument(d, documentId), [documentId], ['documents']);

  const compress = useAsyncAction(async () => {
    if (!document) return;
    const result = await compressDocument(db, document, level);
    if (result.compressedBytes >= result.originalBytes) {
      // No gain: don't leave a useless copy behind.
      await discardDocument(db, result.document.id);
      setOutcome({ kind: 'not-smaller', before: result.originalBytes });
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setOutcome({ kind: 'smaller', document: result.document, before: result.originalBytes, after: result.compressedBytes });
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (document === null) return <EmptyState icon="file-hidden" title="Document not found" actionLabel="Go back" onAction={() => goBack()} />;
  if (!document) return null;
  if (!isPdfCapable(document)) {
    return <EmptyState icon="file-alert-outline" title="Compress works on scans and PDFs" actionLabel="Go back" onAction={() => goBack()} />;
  }

  if (outcome) {
    const saved = outcome.kind === 'smaller' ? Math.round((1 - outcome.after / outcome.before) * 100) : 0;
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Compress' }} />
        <View className="flex-1 items-center justify-center px-8">
          <View className="mb-5 h-20 w-20 items-center justify-center rounded-full bg-surface-muted">
            <Icon name={outcome.kind === 'smaller' ? 'check-circle-outline' : 'information-outline'} size={40} color={outcome.kind === 'smaller' ? 'success' : 'muted'} />
          </View>
          {outcome.kind === 'smaller' ? (
            <>
              <Text className="text-center text-2xl font-bold text-text">{saved}% smaller</Text>
              <Text className="mt-2 text-center text-base text-muted">
                {formatBytes(outcome.before)} → {formatBytes(outcome.after)}
              </Text>
              <Text className="mt-3 text-center text-sm text-muted">Saved as “{outcome.document.title}”. Your original is unchanged.</Text>
            </>
          ) : (
            <>
              <Text className="text-center text-xl font-semibold text-text">Already as small as it gets</Text>
              <Text className="mt-2 text-center text-base text-muted">
                At {formatBytes(outcome.before)}, this document can’t be made smaller at this level, so no copy was made.
              </Text>
            </>
          )}
        </View>
        <BottomBar>
          {outcome.kind === 'smaller' ? (
            <>
              <Button label="Done" variant="secondary" onPress={() => goBack()} className="flex-1" />
              <Button
                label="Open"
                icon="book-open-page-variant-outline"
                onPress={() => router.replace(`/document/${outcome.document.id}/read`)}
                className="flex-1"
              />
            </>
          ) : (
            <Button label="Done" onPress={() => goBack()} className="flex-1" />
          )}
        </BottomBar>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: 'Compress' }} />
      <ScrollView contentContainerClassName="px-4 pb-6 pt-4">
        <Text numberOfLines={1} className="text-base font-semibold text-text">
          {document.title}
        </Text>
        <Text className="mt-0.5 text-sm text-muted">
          {document.kind === 'pages' ? 'Scan' : `PDF · ${formatBytes(document.sizeBytes)}`}
        </Text>

        <View className="mt-5 gap-3">
          {LEVELS.map((option) => {
            const active = option.level === level;
            return (
              <Pressable
                key={option.level}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setLevel(option.level)}
                className={`flex-row gap-4 rounded-2xl border-2 bg-surface p-4 ${active ? 'border-primary' : 'border-transparent'}`}
              >
                <Icon name={active ? 'radiobox-marked' : 'radiobox-blank'} color={active ? 'primary' : 'muted'} />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-text">{option.title}</Text>
                  <Text className="mt-0.5 text-sm text-muted">{option.body}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text className="mt-5 text-sm text-muted">
          Compressing makes a new copy and keeps your original.
          {document.kind === 'pdf' ? ' Pages are saved as images, so text in the copy can’t be selected or searched.' : ''}
        </Text>
        {compress.pending ? (
          <View className="mt-6 flex-row items-center justify-center gap-3">
            <ActivityIndicator />
            <Text className="text-base text-muted">Compressing page by page…</Text>
          </View>
        ) : null}
      </ScrollView>
      <BottomBar>
        <Button label="Compress" icon="arrow-collapse" onPress={() => compress.run()} loading={compress.pending} className="flex-1" />
      </BottomBar>
    </View>
  );
}
