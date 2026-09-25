import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable, { type SortableGridRenderItem } from 'react-native-sortables';

import { BottomBar } from '@/components/BottomBar';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { PageThumb } from '@/components/PageThumb';
import { getDocument } from '@/db/repositories/documents';
import { listPages, reorderPages } from '@/db/repositories/pages';
import type { Page } from '@/domain/models';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { pluralize } from '@/lib/format';

/** Page workspace: drag to reorder, tap to edit, add pages at the end. */
export default function PagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const scrollableRef = useAnimatedRef<Animated.ScrollView>();

  const { data, error, refresh } = useDbQuery(
    async (d) => ({ document: await getDocument(d, id), pages: await listPages(d, id) }),
    [id],
    ['pages', 'documents'],
  );

  const reorder = useAsyncAction((ordered: Page[]) => reorderPages(db, id, ordered.map((page) => page.id)));

  const renderItem = useCallback<SortableGridRenderItem<Page>>(
    ({ item, index }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Page ${index + 1}. Tap to edit, hold and drag to move.`}
        onPress={() => router.push(`/document/${id}/page/${item.id}`)}
      >
        <PageThumb page={item} index={index} />
      </Pressable>
    ),
    [id],
  );

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (!data) return null;
  const { pages } = data;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: pluralize(pages.length, 'page') }} />
      {pages.length === 0 ? (
        <EmptyState icon="file-outline" title="No pages yet" body="Scan or add photos to build this document." />
      ) : (
        <Animated.ScrollView ref={scrollableRef} contentContainerClassName="p-3 pb-6">
          <Text className="mb-3 px-1 text-sm text-muted">Hold a page and drag to reorder. Tap to edit.</Text>
          <Sortable.Grid
            data={pages}
            columns={3}
            rowGap={12}
            columnGap={12}
            keyExtractor={(page) => page.id}
            renderItem={renderItem}
            scrollableRef={scrollableRef}
            onDragStart={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            }}
            onDragEnd={({ data: ordered }) => {
              Haptics.selectionAsync().catch(() => {});
              if (ordered.some((page, i) => page.id !== pages[i]?.id)) reorder.run(ordered);
            }}
          />
        </Animated.ScrollView>
      )}
      <BottomBar>
        <Button
          label="Add pages"
          icon="plus"
          onPress={() => router.push({ pathname: '/scan', params: { documentId: id } })}
          className="flex-1"
        />
      </BottomBar>
    </View>
  );
}
