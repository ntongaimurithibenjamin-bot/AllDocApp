import { DocunaNative } from 'docuna-native';
import { File } from 'expo-file-system';
import { AppState } from 'react-native';

import { subscribeToChanges } from '@/db/events';
import { setPageCount } from '@/db/repositories/documents';
import {
  markScanPageFailed,
  nextOcrJob,
  savePdfPageText,
  saveScanPageText,
  saveTextFileText,
  setFileOcrState,
  type RecognizedText,
} from '@/db/repositories/ocr';
import { getSetting } from '@/db/repositories/settings';
import type { SqlDb } from '@/db/types';

import { refreshSuggestion } from './suggestions';

/** What the queue needs from the device; swapped for a fake in tests. */
export interface OcrEngine {
  recognizeImage(uri: string): Promise<RecognizedText>;
  recognizePdfPage(uri: string, pageIndex: number): Promise<RecognizedText>;
  pdfPageCount(uri: string): Promise<number>;
  readText(uri: string): Promise<string>;
}

export const nativeOcrEngine: OcrEngine | null = DocunaNative
  ? {
      recognizeImage: (uri) => DocunaNative!.recognizeTextAsync(uri),
      recognizePdfPage: (uri, pageIndex) => DocunaNative!.recognizePdfPageTextAsync(uri, pageIndex),
      pdfPageCount: async (uri) => (await DocunaNative!.getPdfInfoAsync(uri)).pageCount,
      readText: (uri) => new File(uri).text(),
    }
  : null;

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

const UNREADABLE_PDF = new Set(['ERR_PDF_ENCRYPTED', 'ERR_PDF_OPEN']);

/**
 * 'worked'      a page was processed (or skipped); call again
 * 'idle'        nothing left to do
 * 'unavailable' the OCR model isn't ready (Play services is downloading it); retry later
 */
export type OcrStepResult = 'worked' | 'idle' | 'unavailable';

/** Processes one unit of OCR work. Never throws for a bad page: it is marked and the queue moves on. */
export async function runOcrStep(db: SqlDb, engine: OcrEngine): Promise<OcrStepResult> {
  const job = await nextOcrJob(db);
  if (!job) return 'idle';

  switch (job.kind) {
    case 'scan-page': {
      try {
        const result = await engine.recognizeImage(job.imageUri);
        if (await saveScanPageText(db, job, result)) await refreshSuggestion(db, job.documentId);
      } catch (error) {
        if (errorCode(error) === 'ERR_OCR_UNAVAILABLE') return 'unavailable';
        if (__DEV__) console.warn('OCR failed for page', job.pageId, error);
        await markScanPageFailed(db, job);
      }
      return 'worked';
    }

    case 'pdf-page': {
      if (job.pageCount === 0) {
        // Imported without a known page count; learn it (or give up on unreadable files).
        try {
          const count = await engine.pdfPageCount(job.fileUri);
          if (count > 0) await setPageCount(db, job.documentId, count);
          else await setFileOcrState(db, job.documentId, 'skipped');
        } catch {
          await setFileOcrState(db, job.documentId, 'failed');
        }
        return 'worked';
      }
      if (job.pageIndex >= job.pageCount) {
        await setFileOcrState(db, job.documentId, 'done');
        return 'worked';
      }
      let result: RecognizedText | null = null;
      try {
        result = await engine.recognizePdfPage(job.fileUri, job.pageIndex);
      } catch (error) {
        const code = errorCode(error);
        if (code === 'ERR_OCR_UNAVAILABLE') return 'unavailable';
        if (code && UNREADABLE_PDF.has(code)) {
          await setFileOcrState(db, job.documentId, 'failed');
          return 'worked';
        }
        if (__DEV__) console.warn('OCR failed for PDF page', job.documentId, job.pageIndex, error);
        // One bad page must not stall the rest of the document: skip it.
      }
      if ((await savePdfPageText(db, job, result)) && job.pageIndex === 0) await refreshSuggestion(db, job.documentId);
      return 'worked';
    }

    case 'text-file': {
      try {
        await saveTextFileText(db, job.documentId, await engine.readText(job.fileUri));
      } catch (error) {
        if (__DEV__) console.warn('Could not index text file', job.documentId, error);
        await setFileOcrState(db, job.documentId, 'failed');
      }
      return 'worked';
    }
  }
}

/** Breathing room between pages so scrolling and taps stay smooth on low-end phones. */
const PAUSE_BETWEEN_PAGES_MS = 250;
/** How long to wait before retrying while Play services downloads the OCR model. */
const MODEL_RETRY_MS = 60_000;

/**
 * Runs OCR in the background, one page at a time, while the app is in the foreground. Wakes up
 * when documents or pages change, pauses when the app is backgrounded or OCR is turned off in
 * Settings, and resumes where it stopped (progress is stored per page). Returns a stop function.
 */
export function startOcrQueue(db: SqlDb, engine: OcrEngine | null = nativeOcrEngine): () => void {
  if (!engine) return () => {};

  let stopped = false;
  let running = false;
  // Set when work may have arrived while a pass was running, so it is not missed.
  let again = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const loop = async () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    again = false;
    try {
      while (!stopped && AppState.currentState === 'active' && (await getSetting(db, 'ocrEnabled'))) {
        const result = await runOcrStep(db, engine);
        if (result === 'idle') break;
        if (result === 'unavailable') {
          retryTimer ??= setTimeout(() => {
            retryTimer = null;
            void loop();
          }, MODEL_RETRY_MS);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_PAGES_MS));
      }
    } catch (error) {
      if (__DEV__) console.warn('OCR queue stopped', error);
    } finally {
      running = false;
      if (again && !retryTimer) void loop();
    }
  };

  const unsubscribe = subscribeToChanges((topics) => {
    if (topics.has('pages') || topics.has('documents') || topics.has('settings') || topics.has('ocr')) void loop();
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') void loop();
  });
  void loop();

  return () => {
    stopped = true;
    unsubscribe();
    appState.remove();
    if (retryTimer) clearTimeout(retryTimer);
  };
}
