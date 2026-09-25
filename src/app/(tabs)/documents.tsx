import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { DocumentRow } from '@/components/DocumentRow';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NewFolderDialog } from '@/components/NewFolderDialog';
import { listDocuments } from '@/db/repositories/documents';
import { listFolders } from '@/db/repositories/folders';
import type { Document, DocumentSort } from '@/domain/models';
import { useDbQuery } from '@/hooks/useDbQuery';
import { pluralize } from '@/lib/format';

type Filter = 'all' | 'favorites' | 'archived';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: 'Favourites' },
  { key: 'archived', label: 'Archived' },
];

const SORTS: { key: DocumentSort; label: string }[] = [
  { key: 'updated', label: 'Last modified' },
  { key: 'created', label: 'Date created' },
  { key: 'title', label: 'Name' },
];

const openDocument = (document: Document) => router.push(`/document/${document.id}`);

export default function DocumentsScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const [sortIndex, setSortIndex] = useState(0);
  const [newFolderVisible, setNewFolderVisible] = useState(false);
  const sort = SORTS[sortIndex]!;

  const folders = useDbQuery((db) => listFolders(db), [], ['folders', 'documents']);
  const documents = useDbQuery(
    (db) =>
      listDocuments(db, {
        // "All" shows unfiled documents; filed ones are reached through their folder.
        folderId: filter === 'all' ? null : undefined,
        favoritesOnly: filter === 'favorites',
        archived: filter === 'archived',
        sort: sort.key,
      }),
    [filter, sort.key],
    ['documents'],
  );

  const showFolders = filter === 'all';

  const header = (
    <View>
      <View className="flex-row gap-2 px-4 pb-2 pt-3">
        {FILTERS.map(({ key, label }) => {
          const selected = key === filter;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setFilter(key)}
              className={`rounded-full px-4 py-2 ${selected ? 'bg-primary' : 'bg-surface'}`}
            >
              <Text className={`text-sm font-medium ${selected ? 'text-on-primary' : 'text-text'}`}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {showFolders && folders.data && folders.data.length > 0 ? (
        <View className="mx-4 mt-2 overflow-hidden rounded-2xl bg-surface">
          {folders.data.map((folder) => (
            <ListRow
              key={folder.id}
              icon="folder"
              iconColor="primary"
              title={folder.name}
              subtitle={pluralize(folder.documentCount, 'document')}
              onPress={() => router.push(`/folders/${folder.id}`)}
            />
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${sort.label}. Tap to change.`}
        onPress={() => setSortIndex((i) => (i + 1) % SORTS.length)}
        className="mt-4 flex-row items-center gap-1 px-4 pb-1"
      >
        <Icon name="sort" size={16} color="muted" />
        <Text className="text-sm text-muted">{sort.label}</Text>
      </Pressable>
    </View>
  );

  const error = documents.error ?? folders.error;

  return (
    <View className="flex-1 bg-background">
      <Tabs.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New folder"
              hitSlop={12}
              onPress={() => setNewFolderVisible(true)}
              className="mr-4"
            >
              <Icon name="folder-plus-outline" />
            </Pressable>
          ),
        }}
      />
      {error ? (
        <ErrorView
          error={error}
          onRetry={() => {
            documents.refresh();
            folders.refresh();
          }}
        />
      ) : (
        <FlashList
          data={documents.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <DocumentRow document={item} onPress={openDocument} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            documents.loading ? null : (
              <EmptyState
                icon={filter === 'favorites' ? 'star-outline' : filter === 'archived' ? 'archive-outline' : 'file-document-outline'}
                title={
                  filter === 'favorites'
                    ? 'No favourites'
                    : filter === 'archived'
                      ? 'Nothing archived'
                      : 'No unfiled documents'
                }
                body={
                  filter === 'favorites'
                    ? 'Star a document to find it here quickly.'
                    : filter === 'archived'
                      ? 'Archived documents are kept but hidden from your lists.'
                      : 'New scans appear here until you move them into a folder.'
                }
              />
            )
          }
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
      <NewFolderDialog visible={newFolderVisible} onClose={() => setNewFolderVisible(false)} />
    </View>
  );
}
