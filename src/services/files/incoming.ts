import { DocunaNative, type IncomingFile } from 'docuna-native';

import type { SqlDb } from '@/db/types';
import type { Document } from '@/domain/models';

import { importFile } from './importFile';

export interface IncomingResult {
  imported: Document[];
  errors: unknown[];
}

/**
 * Imports files handed over by other apps ("Open with" / "Share"). Each file is inspected for its
 * real name and type, copied into Docuna, and becomes a document. One failure doesn't stop the rest.
 */
export async function importIncomingFiles(db: SqlDb, files: readonly IncomingFile[]): Promise<IncomingResult> {
  const result: IncomingResult = { imported: [], errors: [] };
  for (const file of files) {
    try {
      const info = DocunaNative ? await DocunaNative.getContentInfoAsync(file.uri) : null;
      const document = await importFile(db, {
        uri: file.uri,
        name: info?.name ?? 'Shared file',
        mimeType: info?.mimeType ?? file.mimeType,
        size: info?.size ?? null,
      });
      result.imported.push(document);
    } catch (error) {
      result.errors.push(error);
    }
  }
  return result;
}
