import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { ContinueReadingCard } from '@/components/ContinueReadingCard';
import { DocumentRow } from '@/components/DocumentRow';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NewFolderDialog } from '@/components/NewFolderDialog';
import { Section } from '@/components/Section';
import { getContinueReading, listDocuments } from '@/db/repositories/documents';
import { listFolders } from '@/db/repositories/folders';
import type { Document } from '@/domain/models';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useDocumentActions } from '@/hooks/useDocumentActions';
import { useImportFile } from '@/hooks/useImportFile';
import { formatBytes, greeting, pluralize } from '@/lib/format';
import { getStorageUsage } from '@/services/filesystem/storage';
import { useTheme } from '@/theme';

const INBOX_PREVIEW = 3;
const RECENT_LIMIT = 5;

async function loadHome(db: Parameters<typeof listDocuments>[0]) {
  const [inbox, recent, folders, continueReading] = await Promise.all([
    listDocuments(db, { inboxOnly: true, limit: INBOX_PREVIEW + 1 }),
    listDocuments(db, { limit: RECENT_LIMIT }),
    listFolders(db),
    getContinueReading(db),
  ]);
  return { inbox, recent, folders, continueReading, storage: getStorageUsage() };
}

const openDocument = (document: Document) => router.push(`/document/${document.id}/read`);

export default function HomeScreen() {
  const { openActions } = useDocumentActions();
  const { colors } = useTheme();
  const [newFolderVisible, setNewFolderVisible] = useState(false);
  const importFile = useImportFile();
  const { data, error, refresh } = useDbQuery(loadHome, [], ['documents', 'folders']);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="pb-10">
        <View className="px-4 pt-6">
          <Text accessibilityRole="header" className="text-3xl font-bold text-text">
            {greeting()}
          </Text>
          <Text className="mt-1 text-base text-muted">Your documents stay on this phone.</Text>
        </View>

        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search documents"
          onPress={() => router.push('/search')}
          android_ripple={{ color: colors.border }}
          className="mx-4 mt-5 flex-row items-center gap-3 rounded-xl bg-surface px-4 py-3"
        >
          <Icon name="magnify" color="muted" />
          <Text className="text-base text-muted">Search documents</Text>
        </Pressable>

        <View className="mx-4 mt-4">
          <Button label="Scan document" icon="scan-helper" size="lg" onPress={() => router.push('/scan')} />
          <Button
            label="Open a file"
            icon="file-import-outline"
            variant="secondary"
            onPress={() => importFile.run()}
            loading={importFile.pending}
            className="mt-3"
          />
        </View>

        {data?.continueReading ? (
          <ContinueReadingCard document={data.continueReading} onPress={() => openDocument(data.continueReading!)} />
        ) : null}

        {error ? <ErrorView error={error} onRetry={refresh} /> : null}

        {data && data.inbox.length > 0 ? (
          <Section
            title="Recently scanned"
            actionLabel={data.inbox.length > INBOX_PREVIEW ? 'See all' : undefined}
            onAction={() => router.push('/inbox')}
            card
          >
            {data.inbox.slice(0, INBOX_PREVIEW).map((document) => (
              <DocumentRow key={document.id} document={document} onPress={openDocument} onLongPress={openActions} />
            ))}
          </Section>
        ) : null}

        {data ? (
          <Section title="Recent" actionLabel="All documents" onAction={() => router.push('/documents')} card>
            {data.recent.length > 0 ? (
              data.recent.map((document) => (
                <DocumentRow key={document.id} document={document} onPress={openDocument} onLongPress={openActions} />
              ))
            ) : (
              <EmptyState
                icon="file-document-multiple-outline"
                title="No documents yet"
                body="Scan a document and it will appear here."
              />
            )}
          </Section>
        ) : null}

        {data ? (
          <Section title="Folders" actionLabel="New folder" onAction={() => setNewFolderVisible(true)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-4">
              {data.folders.map((folder) => (
                <Pressable
                  key={folder.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${folder.name}, ${pluralize(folder.documentCount, 'document')}`}
                  onPress={() => router.push(`/folders/${folder.id}`)}
                  className="w-36 rounded-2xl bg-surface p-4"
                >
                  <Icon name="folder" color="primary" size={26} />
                  <Text numberOfLines={1} className="mt-3 text-base font-medium text-text">
                    {folder.name}
                  </Text>
                  <Text className="mt-0.5 text-sm text-muted">{pluralize(folder.documentCount, 'doc')}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New folder"
                onPress={() => setNewFolderVisible(true)}
                className="w-36 items-center justify-center rounded-2xl border border-dashed border-border p-4"
              >
                <Icon name="folder-plus-outline" color="muted" size={26} />
                <Text className="mt-2 text-sm text-muted">New folder</Text>
              </Pressable>
            </ScrollView>
          </Section>
        ) : null}

        {data ? (
          <Section title="Storage" card>
            <ListRow
              icon="harddisk"
              title={`${formatBytes(data.storage.documentsBytes)} used by documents`}
              subtitle={`${formatBytes(data.storage.freeBytes)} free on this phone`}
              onPress={() => router.push('/settings/storage')}
            />
          </Section>
        ) : null}
      </ScrollView>

      <NewFolderDialog visible={newFolderVisible} onClose={() => setNewFolderVisible(false)} />
    </SafeAreaView>
  );
}
