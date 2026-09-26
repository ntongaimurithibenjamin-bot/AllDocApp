import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { DocumentRow } from '@/components/DocumentRow';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { PromptDialog } from '@/components/PromptDialog';
import { listDocuments } from '@/db/repositories/documents';
import { deleteFolder, getFolder, renameFolder } from '@/db/repositories/folders';
import type { Document } from '@/domain/models';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { useDocumentActions } from '@/hooks/useDocumentActions';
import { goBack } from '@/lib/navigation';

const openDocument = (document: Document) => router.push(`/document/${document.id}/read`);

export default function FolderScreen() {
  const { openActions } = useDocumentActions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const [renameVisible, setRenameVisible] = useState(false);

  const { data, error, loading, refresh } = useDbQuery(
    async (d) => {
      const folder = await getFolder(d, id);
      return folder ? { folder, documents: await listDocuments(d, { folderId: id }) } : null;
    },
    [id],
    ['folders', 'documents'],
  );

  const rename = useAsyncAction((name: string) => renameFolder(db, id, name));
  const remove = useAsyncAction(async () => {
    await deleteFolder(db, id);
    goBack();
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (loading && !data) return null;
  if (!data) {
    return <EmptyState icon="folder-remove-outline" title="Folder not found" actionLabel="Go back" onAction={() => goBack()} />;
  }

  const { folder, documents } = data;

  const confirmDelete = () =>
    Alert.alert(
      `Delete "${folder.name}"?`,
      'The folder is removed. Documents inside it are kept and become unfiled.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete folder', style: 'destructive', onPress: () => remove.run() },
      ],
    );

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: folder.name,
          headerRight: () => (
            <View className="flex-row gap-5">
              <Pressable accessibilityRole="button" accessibilityLabel="Rename folder" hitSlop={10} onPress={() => setRenameVisible(true)}>
                <Icon name="pencil-outline" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Delete folder" hitSlop={10} onPress={confirmDelete}>
                <Icon name="delete-outline" />
              </Pressable>
            </View>
          ),
        }}
      />
      <FlashList
        data={documents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DocumentRow document={item} onPress={openDocument} onLongPress={openActions} />}
        ListEmptyComponent={
          <EmptyState
            icon="folder-open-outline"
            title="This folder is empty"
            body="Open a document and choose Move to folder to add it here."
          />
        }
        contentContainerStyle={{ paddingVertical: 8 }}
      />
      <PromptDialog
        visible={renameVisible}
        title="Rename folder"
        initialValue={folder.name}
        onCancel={() => setRenameVisible(false)}
        onConfirm={async (name) => {
          if (await rename.run(name)) setRenameVisible(false);
        }}
      />
    </View>
  );
}
