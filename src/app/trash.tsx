import { FlashList } from '@shopify/flash-list';
import { Alert, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { DocumentRow } from '@/components/DocumentRow';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { listTrashedDocuments, restoreDocument } from '@/db/repositories/documents';
import type { Document } from '@/domain/models';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { emptyTrash, TRASH_RETENTION_DAYS } from '@/services/documents/lifecycle';

export default function TrashScreen() {
  const db = useDb();
  const { data, error, refresh } = useDbQuery((d) => listTrashedDocuments(d), [], ['documents']);
  const restore = useAsyncAction((document: Document) => restoreDocument(db, document.id));
  const empty = useAsyncAction(() => emptyTrash(db));

  if (error) return <ErrorView error={error} onRetry={refresh} />;

  const confirmEmpty = () =>
    Alert.alert('Empty trash?', 'All documents in the trash will be permanently deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete permanently', style: 'destructive', onPress: () => empty.run() },
    ]);

  const askRestore = (document: Document) =>
    Alert.alert(`Restore "${document.title}"?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', onPress: () => restore.run(document) },
    ]);

  return (
    <View className="flex-1 bg-background">
      <FlashList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DocumentRow document={item} onPress={askRestore} />}
        ListHeaderComponent={
          data && data.length > 0 ? (
            <View className="px-4 pb-2 pt-4">
              <Text className="text-sm text-muted">
                Documents are permanently deleted {TRASH_RETENTION_DAYS} days after being moved here. Tap one to restore it.
              </Text>
              <Button label="Empty trash" variant="danger" icon="delete-forever-outline" onPress={confirmEmpty} loading={empty.pending} className="mt-4" />
            </View>
          ) : null
        }
        ListEmptyComponent={data ? <EmptyState icon="delete-empty-outline" title="Trash is empty" /> : null}
      />
    </View>
  );
}
