import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon, type IconName } from '@/components/Icon';
import { PageThumb } from '@/components/PageThumb';
import { listPages } from '@/db/repositories/pages';
import type { PageFilter } from '@/domain/models';
import { PAGE_FILTERS, rotateBy } from '@/domain/pageEdits';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { deletePagesWithFiles, duplicatePage, editPage } from '@/services/pages/pageService';
import { useTheme } from '@/theme';

function ToolButton({ icon, label, onPress, active = false }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      android_ripple={{ color: colors.border, borderless: true }}
      className="min-w-14 flex-1 items-center py-2"
    >
      <Icon name={icon} color={active ? 'primary' : 'text'} />
      <Text textBreakStrategy="simple" className={`mt-1 text-xs ${active ? 'text-primary' : 'text-text'}`}>{label}</Text>
    </Pressable>
  );
}

export default function PageEditorScreen() {
  const { id, pageId } = useLocalSearchParams<{ id: string; pageId: string }>();
  const db = useDb();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: pages, error, refresh } = useDbQuery((d) => listPages(d, id), [id], ['pages']);

  const edit = useAsyncAction((changes: Parameters<typeof editPage>[2]) => editPage(db, pageId, changes));
  const duplicate = useAsyncAction(async () => {
    const copy = await duplicatePage(db, pageId);
    router.setParams({ pageId: copy.id });
  });
  const remove = useAsyncAction(async (nextPageId: string | null) => {
    await deletePagesWithFiles(db, id, [pageId]);
    if (nextPageId) router.setParams({ pageId: nextPageId });
    else router.back();
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (!pages) return null;

  const index = pages.findIndex((page) => page.id === pageId);
  const page = pages[index];
  if (!page) {
    return <EmptyState icon="file-hidden" title="Page not found" actionLabel="Go back" onAction={() => router.back()} />;
  }

  const busy = edit.pending || duplicate.pending || remove.pending;

  const confirmDelete = () => {
    const next = pages[index + 1] ?? pages[index - 1] ?? null;
    Alert.alert(`Delete page ${index + 1}?`, 'This page will be removed from the document.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.run(next?.id ?? null) },
    ]);
  };

  const chooseReplacement = () =>
    router.push({ pathname: '/scan', params: { replacePageId: page.id } });

  const applyFilter = (filter: PageFilter) => {
    if (filter !== page.filter) edit.run({ filter });
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: `Page ${index + 1} of ${pages.length}`,
          headerRight: () => (
            <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
              {busy ? 'Saving…' : 'Saved'}
            </Text>
          ),
        }}
      />

      <View className="flex-1 items-center justify-center p-4">
        <Image
          source={{ uri: page.processedUri ?? page.originalUri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          transition={150}
          accessibilityLabel={`Page ${index + 1}`}
        />
        {busy ? (
          <View className="absolute inset-0 items-center justify-center bg-background/60">
            <ActivityIndicator size="large" />
          </View>
        ) : null}
      </View>

      {filtersOpen ? (
        <View className="flex-row gap-2 px-4 pb-2">
          {PAGE_FILTERS.map(({ value, label }) => {
            const selected = page.filter === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={busy}
                onPress={() => applyFilter(value)}
                className={`flex-1 items-center rounded-full py-2 ${selected ? 'bg-primary' : 'bg-surface'}`}
              >
                <Text className={`text-sm font-medium ${selected ? 'text-on-primary' : 'text-text'}`}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View className="h-24">
        <FlashList
          horizontal
          data={pages}
          keyExtractor={(item) => item.id}
          initialScrollIndex={index}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12 }}
          renderItem={({ item, index: i }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Go to page ${i + 1}`}
              onPress={() => router.setParams({ pageId: item.id })}
              className="w-14 px-1"
            >
              <PageThumb page={item} index={i} selected={item.id === page.id} />
            </Pressable>
          )}
        />
      </View>

      <View className="flex-row border-t border-border bg-surface px-1">
        <ToolButton icon="crop" label="Crop" onPress={() => router.push(`/document/${id}/page/${page.id}/crop`)} />
        <ToolButton icon="rotate-right" label="Rotate" onPress={() => !busy && edit.run({ rotation: rotateBy(page.rotation, 1) })} />
        <ToolButton icon="tune-variant" label="Filter" active={filtersOpen} onPress={() => setFiltersOpen((open) => !open)} />
        <ToolButton icon="content-copy" label="Duplicate" onPress={() => !busy && duplicate.run()} />
        <ToolButton icon="camera-retake-outline" label="Replace" onPress={chooseReplacement} />
        <ToolButton icon="delete-outline" label="Delete" onPress={confirmDelete} />
      </View>
    </SafeAreaView>
  );
}
