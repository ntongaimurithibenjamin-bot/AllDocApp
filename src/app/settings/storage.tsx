import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ListRow } from '@/components/ListRow';
import { Section } from '@/components/Section';
import { countDocuments } from '@/db/repositories/documents';
import { toAppError } from '@/domain/errors';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDbQuery } from '@/hooks/useDbQuery';
import { formatBytes, pluralize } from '@/lib/format';
import { clearRenderCache, getStorageUsage, type StorageUsage } from '@/services/filesystem/storage';

function readUsage(): StorageUsage | null {
  try {
    return getStorageUsage();
  } catch (error) {
    if (__DEV__) console.warn(toAppError(error, 'storage_failure'));
    return null;
  }
}

export default function StorageScreen() {
  const [usage, setUsage] = useState(readUsage);
  const documentCount = useDbQuery((db) => countDocuments(db), [], ['documents']);
  const refreshUsage = useCallback(() => setUsage(readUsage()), []);

  const clearCache = useAsyncAction(async () => {
    clearRenderCache();
    refreshUsage();
  });

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      <View className="px-4 pt-4">
        <Text className="text-base text-muted">
          Everything is stored on this phone. Nothing is uploaded unless you choose to share or export it.
        </Text>
      </View>

      <Section title="Usage" card>
        <ListRow
          icon="file-document-multiple-outline"
          title={usage ? formatBytes(usage.documentsBytes) : 'Unavailable'}
          subtitle={documentCount.data !== undefined ? pluralize(documentCount.data, 'document') : undefined}
        />
        <ListRow icon="cached" title={usage ? formatBytes(usage.cacheBytes) : 'Unavailable'} subtitle="Previews cache (safe to clear)" />
        <ListRow
          icon="cellphone"
          title={usage ? `${formatBytes(usage.freeBytes)} free` : 'Unavailable'}
          subtitle={usage ? `of ${formatBytes(usage.totalBytes)} on this phone` : undefined}
        />
      </Section>

      <Section title="Free up space" card>
        <ListRow icon="broom" title="Clear previews cache" onPress={() => clearCache.run()} disabled={clearCache.pending} accessory={null} />
        <ListRow icon="delete-outline" title="Trash" subtitle="Permanently delete trashed documents" onPress={() => router.push('/trash')} />
      </Section>
    </ScrollView>
  );
}
