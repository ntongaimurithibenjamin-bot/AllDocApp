import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { NewFolderDialog } from '@/components/NewFolderDialog';
import { Section } from '@/components/Section';
import { getDocument, moveDocument } from '@/db/repositories/documents';
import { listFolders } from '@/db/repositories/folders';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { goBack } from '@/lib/navigation';

export default function MoveDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const [newFolderVisible, setNewFolderVisible] = useState(false);

  const { data, error, refresh } = useDbQuery(
    async (d) => ({ document: await getDocument(d, id), folders: await listFolders(d) }),
    [id],
    ['folders', 'documents'],
  );

  const move = useAsyncAction(async (folderId: string | null) => {
    await moveDocument(db, id, folderId);
    goBack();
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (!data) return null;

  const currentFolderId = data.document?.folderId ?? null;
  const check = (selected: boolean) => (selected ? <Icon name="check" color="primary" /> : null);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      <Section card>
        <ListRow
          icon="folder-off-outline"
          title="No folder"
          onPress={() => move.run(null)}
          accessory={check(currentFolderId === null)}
        />
        {data.folders.map((folder) => (
          <ListRow
            key={folder.id}
            icon="folder"
            iconColor="primary"
            title={folder.name}
            onPress={() => move.run(folder.id)}
            accessory={check(currentFolderId === folder.id)}
          />
        ))}
        <ListRow icon="folder-plus-outline" title="New folder…" onPress={() => setNewFolderVisible(true)} accessory={null} />
      </Section>

      <NewFolderDialog
        visible={newFolderVisible}
        onClose={() => setNewFolderVisible(false)}
        onCreated={(folder) => move.run(folder.id)}
      />
    </ScrollView>
  );
}
