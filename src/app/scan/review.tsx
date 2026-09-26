import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { BottomBar } from '@/components/BottomBar';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { NewFolderDialog } from '@/components/NewFolderDialog';
import { PageThumb } from '@/components/PageThumb';
import { getDocument, moveDocument, renameDocument } from '@/db/repositories/documents';
import { listFolders } from '@/db/repositories/folders';
import { listPages } from '@/db/repositories/pages';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { pluralize } from '@/lib/format';
import { goBack } from '@/lib/navigation';
import { discardDocument } from '@/services/pages/pageService';
import { useTheme } from '@/theme';

/**
 * Shown after a scan. The document is already saved (in the inbox), so leaving this screen never
 * loses pages; Done just applies the name and folder.
 */
export default function ScanReviewScreen() {
  const { documentId } = useLocalSearchParams<{ documentId: string }>();
  const db = useDb();
  const { colors } = useTheme();
  const [title, setTitle] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [newFolderVisible, setNewFolderVisible] = useState(false);

  const { data, error, loading, refresh } = useDbQuery(
    async (d) => {
      const document = await getDocument(d, documentId);
      if (!document) return null;
      const [pages, folders] = await Promise.all([listPages(d, documentId), listFolders(d)]);
      return { document, pages, folders };
    },
    [documentId],
    ['documents', 'pages', 'folders'],
  );

  const done = useAsyncAction(async () => {
    if (!data) return;
    const name = (title ?? data.document.title).trim();
    if (name && name !== data.document.title) await renameDocument(db, documentId, name);
    if (folderId) await moveDocument(db, documentId, folderId);
    router.replace(`/document/${documentId}/read`);
  });

  const discard = useAsyncAction(async () => {
    await discardDocument(db, documentId);
    goBack();
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (loading && !data) return null;
  if (!data) return <EmptyState icon="file-hidden" title="Scan not found" actionLabel="Close" onAction={() => goBack()} />;

  const { document, pages, folders } = data;

  const confirmDiscard = () =>
    Alert.alert('Discard this scan?', `All ${pluralize(pages.length, 'page')} will be deleted.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => discard.run() },
    ]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: pluralize(pages.length, 'page') }} />
      <ScrollView contentContainerClassName="pb-6" keyboardShouldPersistTaps="handled">
        <View className="px-4 pt-4">
          <Text className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Name</Text>
          <TextInput
            value={title ?? document.title}
            onChangeText={setTitle}
            selectTextOnFocus
            maxLength={120}
            placeholderTextColor={colors.muted}
            accessibilityLabel="Document name"
            className="rounded-xl bg-surface px-4 py-3 text-base text-text"
          />
        </View>

        <Text className="mb-2 mt-6 px-4 text-sm font-semibold uppercase tracking-wide text-muted">Folder</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4">
          {[{ id: null, name: 'None' }, ...folders].map((folder) => {
            const selected = folderId === folder.id;
            return (
              <Pressable
                key={folder.id ?? 'none'}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFolderId(folder.id)}
                className={`rounded-full px-4 py-2 ${selected ? 'bg-primary' : 'bg-surface'}`}
              >
                <Text className={`text-sm font-medium ${selected ? 'text-on-primary' : 'text-text'}`}>{folder.name}</Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New folder"
            onPress={() => setNewFolderVisible(true)}
            className="flex-row items-center gap-1 rounded-full border border-dashed border-border px-4 py-2"
          >
            <Icon name="plus" size={16} color="muted" />
            <Text className="text-sm text-muted">New</Text>
          </Pressable>
        </ScrollView>

        <View className="mt-6 flex-row items-center justify-between px-4">
          <Text className="text-sm font-semibold uppercase tracking-wide text-muted">Pages</Text>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.push(`/document/${documentId}/pages`)}>
            <Text className="text-sm font-semibold text-primary">Arrange</Text>
          </Pressable>
        </View>
        <View className="mt-2 flex-row flex-wrap px-2.5">
          {pages.map((page, index) => (
            <Pressable
              key={page.id}
              accessibilityRole="button"
              accessibilityLabel={`Edit page ${index + 1}`}
              onPress={() => router.push(`/document/${documentId}/page/${page.id}`)}
              className="w-1/3 p-1.5"
            >
              <PageThumb page={page} index={index} />
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add pages"
            onPress={() => router.push({ pathname: '/scan', params: { documentId } })}
            className="w-1/3 p-1.5"
          >
            <View className="aspect-[3/4] items-center justify-center rounded-lg border border-dashed border-border">
              <Icon name="plus" size={28} color="muted" />
              <Text className="mt-1 text-sm text-muted">Add pages</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>

      <BottomBar>
        <Button label="Discard" variant="secondary" icon="delete-outline" onPress={confirmDiscard} disabled={discard.pending} />
        <Button label="Done" icon="check" onPress={() => done.run()} loading={done.pending} className="flex-1" />
      </BottomBar>

      <NewFolderDialog
        visible={newFolderVisible}
        onClose={() => setNewFolderVisible(false)}
        onCreated={(folder) => setFolderId(folder.id)}
      />
    </View>
  );
}
