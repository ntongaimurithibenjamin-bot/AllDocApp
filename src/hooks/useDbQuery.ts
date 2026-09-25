import { useCallback, useEffect, useRef, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { subscribeToChanges, type DataTopic } from '@/db/events';
import type { SqlDb } from '@/db/types';
import { toAppError, type AppError } from '@/domain/errors';

export interface DbQueryState<T> {
  data: T | undefined;
  error: AppError | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Runs `query` against the app database and re-runs it whenever one of `topics` changes.
 * `deps` are the query's inputs (like useEffect deps).
 */
export function useDbQuery<T>(
  query: (db: SqlDb) => Promise<T>,
  deps: readonly unknown[],
  topics: readonly DataTopic[],
): DbQueryState<T> {
  const db = useSQLiteContext();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const queryRef = useRef(query);
  queryRef.current = query;
  const runId = useRef(0);

  const run = useCallback(() => {
    const id = ++runId.current;
    setLoading(true);
    queryRef
      .current(db)
      .then((result) => {
        if (id !== runId.current) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (id !== runId.current) return;
        setError(toAppError(err, 'database_failure'));
      })
      .finally(() => {
        if (id === runId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  }, [db, ...deps]);

  useEffect(() => {
    run();
    const topicSet = new Set(topics);
    return subscribeToChanges((changed) => {
      for (const topic of changed) {
        if (topicSet.has(topic)) {
          run();
          return;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topics are static per call site
  }, [run]);

  return { data, error, loading, refresh: run };
}

/** The app database, typed as the repository interface. */
export function useDb(): SqlDb {
  return useSQLiteContext();
}
