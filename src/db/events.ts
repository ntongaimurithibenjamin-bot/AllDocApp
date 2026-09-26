/** 'ocr' = recognised text changed (search results, text screen, progress); kept apart from 'pages' so the reader doesn't reload while OCR runs. */
export type DataTopic = 'documents' | 'folders' | 'pages' | 'settings' | 'ocr';

type Listener = (topics: ReadonlySet<DataTopic>) => void;

const listeners = new Set<Listener>();

/** Repositories call this after a successful write so mounted queries can refresh. */
export function notifyChanged(...topics: DataTopic[]): void {
  const set = new Set(topics);
  for (const listener of listeners) listener(set);
}

export function subscribeToChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
