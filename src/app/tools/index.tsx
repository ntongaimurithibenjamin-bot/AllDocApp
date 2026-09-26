import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { ErrorView } from '@/components/ErrorView';
import { Icon, type IconName } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { useOverlay } from '@/components/overlay/OverlayProvider';
import { Section } from '@/components/Section';
import { getDocument } from '@/db/repositories/documents';
import { isPdfCapable } from '@/domain/pdfTools';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { saveToDownloads, saveToFolder } from '@/services/files/exportFile';

interface Tool {
  key: 'merge' | 'extract' | 'compress' | 'rotate';
  icon: IconName;
  title: string;
  body: string;
}

const TOOLS: Tool[] = [
  { key: 'merge', icon: 'file-multiple-outline', title: 'Merge', body: 'Combine scans and PDFs into one PDF' },
  { key: 'extract', icon: 'file-export-outline', title: 'Extract pages', body: 'Copy chosen pages into a new PDF' },
  { key: 'compress', icon: 'arrow-collapse', title: 'Compress', body: 'Make a smaller copy to send or store' },
  { key: 'rotate', icon: 'file-rotate-right-outline', title: 'Rotate pages', body: 'Fix sideways pages in a PDF' },
];

/** PDF tools: for one document (?documentId=…) or all tools, each asking which document to use. */
export default function ToolsScreen() {
  const { documentId } = useLocalSearchParams<{ documentId?: string }>();
  const db = useDb();
  const { showToast } = useOverlay();
  const { data: document, error, refresh } = useDbQuery((d) => (documentId ? getDocument(d, documentId) : Promise.resolve(null)), [documentId ?? null], ['documents']);

  const download = useAsyncAction(async () => {
    if (!document) return;
    const result = await saveToDownloads(db, document);
    if (result.saved) showToast({ message: `Saved to ${result.location}` });
  });
  const saveAs = useAsyncAction(async () => {
    if (!document) return;
    const result = await saveToFolder(db, document);
    if (result.saved) showToast({ message: `Saved to ${result.location}` });
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;

  const open = (tool: Tool['key']) => {
    if (tool === 'merge') {
      router.push({ pathname: '/tools/merge', params: documentId ? { preselect: documentId } : {} });
    } else if (!documentId) {
      router.push({ pathname: '/tools/pick', params: { tool } });
    } else if (tool === 'compress') {
      router.push({ pathname: '/tools/compress', params: { documentId } });
    } else {
      router.push({ pathname: '/tools/pages', params: { documentId, mode: tool } });
    }
  };

  const visibleTools = TOOLS.filter((tool) => tool.key !== 'rotate' || !document || document.kind === 'pdf');
  const usable = !document || isPdfCapable(document);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      <Stack.Screen options={{ title: document ? document.title : 'PDF tools' }} />
      {document && !usable ? (
        <View className="items-center px-8 pt-10">
          <Icon name="file-alert-outline" size={36} color="muted" />
          <Text className="mt-3 text-center text-base text-muted">
            PDF tools work with scans and PDFs. This document is a {document.kind === 'pages' ? 'scan without pages' : 'different kind of file'}.
          </Text>
        </View>
      ) : (
        <Section card>
          {visibleTools.map((tool) => (
            <ListRow key={tool.key} icon={tool.icon} iconColor="primary" title={tool.title} subtitle={tool.body} onPress={() => open(tool.key)} />
          ))}
        </Section>
      )}

      {document && usable ? (
        <Section title="Save a copy" card>
          <ListRow
            icon="download-outline"
            title="Save to Downloads"
            subtitle={document.kind === 'pages' ? 'As a PDF, in Downloads › Docuna' : 'In Downloads › Docuna'}
            onPress={() => download.run()}
            disabled={download.pending}
            accessory={null}
          />
          <ListRow
            icon="folder-download-outline"
            title="Save to…"
            subtitle="Any folder, SD card or cloud drive"
            onPress={() => saveAs.run()}
            disabled={saveAs.pending}
            accessory={null}
          />
        </Section>
      ) : null}
    </ScrollView>
  );
}
