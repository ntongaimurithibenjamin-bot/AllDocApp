import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { kindIcon } from '@/components/documentKind';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { PageThumb } from '@/components/PageThumb';
import { PromptDialog } from '@/components/PromptDialog';
import { Section } from '@/components/Section';
import {
  getDocument,
  markFiled,
  renameDocument,
  setArchived,
  setFavorite,
} from '@/db/repositories/documents';
import { getFolder } from '@/db/repositories/folders';
import { listPages } from '@/db/repositories/pages';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { useDocumentActions } from '@/hooks/useDocumentActions';
import { formatBytes, formatRelativeTime, pluralize } from '@/lib/format';

export default function DocumentScreen() {
  const { trashWithUndo } = useDocumentActions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const [renameVisible, setRenameVisible] = useState(false);

  const { data, error, loading, refresh } = useDbQuery(
    async (d) => {
      const document = await getDocument(d, id);
      if (!document) return null;
      const [pages, folder] = await Promise.all([
        listPages(d, id),
        document.folderId ? getFolder(d, document.folderId) : Promise.resolve(null),
      ]);
      return { document, pages, folder };
    },
    [id],
    ['documents', 'pages', 'folders'],
  );

  const rename = useAsyncAction((title: string) => renameDocument(db, id, title));
  const toggleFavorite = useAsyncAction((value: boolean) => setFavorite(db, id, value));
  const toggleArchived = useAsyncAction((value: boolean) => setArchived(db, id, value));
  const file = useAsyncAction(() => markFiled(db, id));

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (loading && !data) return null;
  if (!data) {
    return (
      <EmptyState
        icon="file-hidden"
        title="Document not found"
        body="It may have been deleted."
        actionLabel="Go back"
        onAction={() => router.back()}
      />
    );
  }

  const { document, pages, folder } = data;

  const moveToTrash = () => {
    router.back();
    void trashWithUndo(document);
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      <Stack.Screen options={{ title: document.title }} />

      <View className="px-4 pt-4">
        <Text accessibilityRole="header" className="text-2xl font-bold text-text">
          {document.title}
        </Text>
        <Text className="mt-1 text-sm text-muted">
          {pluralize(document.pageCount, 'page')} · Edited {formatRelativeTime(document.updatedAt)}
          {folder ? ` · ${folder.name}` : ''}
        </Text>
      </View>

      <View className="px-4 pt-4">
        <Button label="Read" icon="book-open-page-variant-outline" size="lg" onPress={() => router.push(`/document/${id}/read`)} />
      </View>

      {document.kind === 'pages' ? (
        <Section
          title="Pages"
          actionLabel={pages.length > 1 ? 'Arrange' : undefined}
          onAction={() => router.push(`/document/${id}/pages`)}
        >
          <View className="flex-row flex-wrap px-2.5">
            {pages.map((page, index) => (
              <Pressable
                key={page.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit page ${index + 1}`}
                onPress={() => router.push(`/document/${id}/page/${page.id}`)}
                className="w-1/3 p-1.5"
              >
                <PageThumb page={page} index={index} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add pages"
              onPress={() => router.push({ pathname: '/scan', params: { documentId: id } })}
              className="w-1/3 p-1.5"
            >
              <View className="aspect-[3/4] items-center justify-center rounded-lg border border-dashed border-border">
                <Icon name="plus" size={28} color="muted" />
                <Text className="mt-1 text-sm text-muted">Add pages</Text>
              </View>
            </Pressable>
          </View>
        </Section>
      ) : (
        <Section title="File" card>
          <ListRow icon={kindIcon(document.kind)} title={document.originalName ?? document.title} subtitle={formatBytes(document.sizeBytes)} />
        </Section>
      )}

      <Section title="Document" card>
        <ListRow icon="pencil-outline" title="Rename" onPress={() => setRenameVisible(true)} />
        <ListRow
          icon={document.isFavorite ? 'star' : 'star-outline'}
          iconColor={document.isFavorite ? 'warning' : undefined}
          title={document.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
          onPress={() => toggleFavorite.run(!document.isFavorite)}
          accessory={null}
        />
        <ListRow
          icon="folder-move-outline"
          title="Move to folder"
          subtitle={folder ? folder.name : 'Not in a folder'}
          onPress={() => router.push(`/document/${id}/move`)}
        />
        {document.inInbox ? (
          <ListRow
            icon="inbox-arrow-down-outline"
            title="Mark as filed"
            subtitle="Remove from Recently scanned"
            onPress={() => file.run()}
            accessory={null}
          />
        ) : null}
        <ListRow
          icon={document.isArchived ? 'archive-arrow-up-outline' : 'archive-outline'}
          title={document.isArchived ? 'Unarchive' : 'Archive'}
          onPress={() => toggleArchived.run(!document.isArchived)}
          accessory={null}
        />
        <ListRow icon="delete-outline" title="Move to trash" destructive onPress={moveToTrash} accessory={null} />
      </Section>

      <View className="mt-6 flex-row items-center gap-2 px-4">
        <Icon name="cellphone-lock" size={16} color="muted" />
        <Text className="flex-1 text-sm text-muted">Stored only on this phone.</Text>
      </View>

      <PromptDialog
        visible={renameVisible}
        title="Rename document"
        initialValue={document.title}
        onCancel={() => setRenameVisible(false)}
        onConfirm={async (title) => {
          if (await rename.run(title)) setRenameVisible(false);
        }}
      />
    </ScrollView>
  );
}
