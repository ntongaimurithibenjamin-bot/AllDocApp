import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { PromptDialog } from '@/components/PromptDialog';
import { Section } from '@/components/Section';
import {
  getDocument,
  markFiled,
  renameDocument,
  setArchived,
  setFavorite,
  trashDocument,
} from '@/db/repositories/documents';
import { getFolder } from '@/db/repositories/folders';
import { listPages } from '@/db/repositories/pages';
import type { Page } from '@/domain/models';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { formatRelativeTime, pluralize } from '@/lib/format';
import { TRASH_RETENTION_DAYS } from '@/services/documents/lifecycle';

function PageThumbnail({ page, index }: { page: Page; index: number }) {
  return (
    <View className="w-1/3 p-1.5">
      <View className="aspect-[3/4] overflow-hidden rounded-lg border border-border bg-surface-muted">
        <Image
          source={{ uri: page.thumbnailUri }}
          style={{ flex: 1, transform: [{ rotate: `${page.rotation}deg` }] }}
          contentFit="contain"
          recyclingKey={page.id}
          accessibilityLabel={`Page ${index + 1}`}
        />
      </View>
      <Text className="mt-1 text-center text-xs text-muted">{index + 1}</Text>
    </View>
  );
}

export default function DocumentScreen() {
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
  const trash = useAsyncAction(async () => {
    await trashDocument(db, id);
    router.back();
  });

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

  const confirmTrash = () =>
    Alert.alert(
      'Move to trash?',
      `"${document.title}" will be permanently deleted after ${TRASH_RETENTION_DAYS} days. You can restore it from Trash until then.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Move to trash', style: 'destructive', onPress: () => trash.run() },
      ],
    );

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

      <Section title="Pages">
        {pages.length > 0 ? (
          <View className="flex-row flex-wrap px-2.5">
            {pages.map((page, index) => (
              <PageThumbnail key={page.id} page={page} index={index} />
            ))}
          </View>
        ) : (
          <EmptyState
            icon="file-outline"
            title="No pages yet"
            body="Pages you scan into this document will appear here."
          />
        )}
      </Section>

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
        <ListRow icon="delete-outline" title="Move to trash" destructive onPress={confirmTrash} accessory={null} />
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
