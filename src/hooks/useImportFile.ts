import { router } from 'expo-router';

import { pickAndImportFile } from '@/services/files/importFile';

import { useAsyncAction } from './useAsyncAction';
import { useDb } from './useDbQuery';

/** "Import file" action: pick a PDF / image / text file, import it, and open it in the reader. */
export function useImportFile() {
  const db = useDb();
  return useAsyncAction(async () => {
    const document = await pickAndImportFile(db);
    if (document) router.push(`/document/${document.id}/read`);
  });
}
