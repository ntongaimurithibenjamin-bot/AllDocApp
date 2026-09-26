import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { DocumentRow } from '@/components/DocumentRow';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { listDocuments } from '@/db/repositories/documents';
import type { Document } from '@/domain/models';
import { isPdfCapable } from '@/domain/pdfTools';
import { useDbQuery } from '@/hooks/useDbQuery';

type Tool = 'extract' | 'compress' | 'rotate';

const TITLES: Record<Tool, string> = { extract: 'Extract pages', compress: 'Compress', rotate: 'Rotate pages' };

/** Choose the document a PDF tool should work on. */
export default function PickDocumentScreen() {
  const { tool = 'extract' } = useLocalSearchParams<{ tool?: Tool }>();
  const { data, error, refresh } = useDbQuery(
    async (db) =>
      (await listDocuments(db)).filter((d) => (tool === 'rotate' ? d.kind === 'pdf' : isPdfCapable(d))),
    [tool],
    ['documents'],
  );

  if (error) return <ErrorView error={error} onRetry={refresh} />;

  const choose = (document: Document) => {
    if (tool === 'compress') router.replace({ pathname: '/tools/compress', params: { documentId: document.id } });
    else router.replace({ pathname: '/tools/pages', params: { documentId: document.id, mode: tool } });
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: TITLES[tool] ?? 'Choose a document' }} />
      <FlashList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DocumentRow document={item} onPress={choose} />}
        ListHeaderComponent={
          <Text className="px-4 pb-2 pt-4 text-sm text-muted">
            {tool === 'rotate' ? 'Choose a PDF.' : 'Choose a scan or PDF.'}
          </Text>
        }
        ListEmptyComponent={
          data ? (
            <EmptyState
              icon="file-search-outline"
              title={tool === 'rotate' ? 'No PDFs yet' : 'No scans or PDFs yet'}
              body="Scan a document or open a PDF first."
            />
          ) : null
        }
      />
    </View>
  );
}
