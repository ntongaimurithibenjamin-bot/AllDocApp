import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { DocumentRow } from '@/components/DocumentRow';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { SuggestionCard } from '@/components/SuggestionCard';
import { listDocuments } from '@/db/repositories/documents';
import { listFolders } from '@/db/repositories/folders';
import type { Document } from '@/domain/models';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useDocumentActions } from '@/hooks/useDocumentActions';

const openDocument = (document: Document) => router.push(`/document/${document.id}/read`);

export default function InboxScreen() {
  const { openActions } = useDocumentActions();
  const { data, error, refresh } = useDbQuery(
    async (db) => {
      const [documents, folders] = await Promise.all([listDocuments(db, { inboxOnly: true }), listFolders(db)]);
      return { documents, folderNames: new Map(folders.map((folder) => [folder.id, folder.name])) };
    },
    [],
    ['documents', 'folders'],
  );

  if (error) return <ErrorView error={error} onRetry={refresh} />;

  return (
    <View className="flex-1 bg-background">
      <FlashList
        data={data?.documents ?? []}
        keyExtractor={(item) => item.id}
        extraData={data?.folderNames}
        renderItem={({ item }) => (
          <View>
            <DocumentRow document={item} onPress={openDocument} onLongPress={openActions} />
            {item.suggestion ? (
              <SuggestionCard
                document={item}
                folderName={item.suggestion.folderId ? (data?.folderNames.get(item.suggestion.folderId) ?? null) : null}
              />
            ) : null}
          </View>
        )}
        ListHeaderComponent={
          <Text className="px-4 pb-2 pt-4 text-sm text-muted">
            New scans wait here until you move them into a folder or mark them as filed. Docuna reads each page and
            suggests a name and folder.
          </Text>
        }
        ListEmptyComponent={data ? <EmptyState icon="inbox-outline" title="Inbox is empty" body="You're all caught up." /> : null}
      />
    </View>
  );
}
