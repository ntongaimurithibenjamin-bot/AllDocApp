import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { DocumentRow } from '@/components/DocumentRow';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { listDocuments } from '@/db/repositories/documents';
import type { Document } from '@/domain/models';
import { useDbQuery } from '@/hooks/useDbQuery';

const openDocument = (document: Document) => router.push(`/document/${document.id}`);

export default function InboxScreen() {
  const { data, error, refresh } = useDbQuery((db) => listDocuments(db, { inboxOnly: true }), [], ['documents']);

  if (error) return <ErrorView error={error} onRetry={refresh} />;

  return (
    <View className="flex-1 bg-background">
      <FlashList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DocumentRow document={item} onPress={openDocument} />}
        ListHeaderComponent={
          <Text className="px-4 pb-2 pt-4 text-sm text-muted">
            New scans wait here until you move them into a folder or mark them as filed.
          </Text>
        }
        ListEmptyComponent={data ? <EmptyState icon="inbox-outline" title="Inbox is empty" body="You're all caught up." /> : null}
      />
    </View>
  );
}
