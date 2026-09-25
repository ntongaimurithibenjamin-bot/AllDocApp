export type DataTopic = 'documents' | 'folders' | 'pages' | 'settings';

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
