import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { BottomBar } from '@/components/BottomBar';
import { Button } from '@/components/Button';
import { describeContent, kindIcon } from '@/components/documentKind';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { useOverlay } from '@/components/overlay/OverlayProvider';
import { listDocuments } from '@/db/repositories/documents';
import type { Document } from '@/domain/models';
import { isPdfCapable } from '@/domain/pdfTools';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { mergeDocuments } from '@/services/pdf/engine';
import { useTheme } from '@/theme';

function defaultTitle(): string {
  const now = new Date();
  return `Merged ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Merge: tap documents in the order they should appear; the numbers show that order. */
export default function MergeScreen() {
  const { preselect } = useLocalSearchParams<{ preselect?: string }>();
  const db = useDb();
  const { colors } = useTheme();
  const { showToast } = useOverlay();
  const [order, setOrder] = useState<string[]>(preselect ? [preselect] : []);
  const [title, setTitle] = useState(defaultTitle);

  const { data, error, refresh } = useDbQuery(async (d) => (await listDocuments(d)).filter(isPdfCapable), [], ['documents']);

  const merge = useAsyncAction(async () => {
    const byId = new Map((data ?? []).map((document) => [document.id, document]));
    const chosen = order.map((id) => byId.get(id)).filter((d): d is Document => Boolean(d));
    const merged = await mergeDocuments(db, chosen, title.trim() || defaultTitle());
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    showToast({ message: `Merged ${chosen.length} documents into “${merged.title}”` });
    router.replace(`/document/${merged.id}/read`);
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;

  const toggle = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    setOrder((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: 'Merge' }} />
      <FlashList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        extraData={order}
        ListHeaderComponent={
          <View className="px-4 pb-2 pt-4">
            <Text className="text-sm text-muted">Tap documents in the order they should appear in the merged PDF.</Text>
            <Text className="mb-1 mt-4 text-sm font-semibold uppercase tracking-wide text-muted">Name</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              placeholderTextColor={colors.muted}
              accessibilityLabel="Name of the merged PDF"
              className="rounded-xl bg-surface px-4 py-3 text-base text-text"
            />
          </View>
        }
        renderItem={({ item }) => {
          const position = order.indexOf(item.id);
          const selected = position >= 0;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${item.title}${selected ? `, number ${position + 1}` : ''}`}
              onPress={() => toggle(item.id)}
              android_ripple={{ color: colors.border }}
              className="flex-row items-center gap-4 px-4 py-3"
            >
              <View className="h-12 w-10 items-center justify-center rounded-md bg-surface-muted">
                <Icon name={kindIcon(item.kind)} color="muted" />
              </View>
              <View className="flex-1">
                <Text numberOfLines={1} className="text-base text-text">
                  {item.title}
                </Text>
                <Text className="text-sm text-muted">{describeContent(item)}</Text>
              </View>
              <View
                className={`h-8 w-8 items-center justify-center rounded-full border-2 ${selected ? 'border-primary bg-primary' : 'border-border'}`}
              >
                {selected ? <Text className="text-sm font-bold text-on-primary">{position + 1}</Text> : null}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          data ? <EmptyState icon="file-multiple-outline" title="Nothing to merge yet" body="Scan documents or open PDFs first." /> : null
        }
      />
      <BottomBar>
        <Button
          label={order.length < 2 ? 'Choose at least 2' : `Merge ${order.length} documents`}
          icon="file-multiple-outline"
          onPress={() => merge.run()}
          disabled={order.length < 2}
          loading={merge.pending}
          className="flex-1"
        />
      </BottomBar>
    </View>
  );
}
