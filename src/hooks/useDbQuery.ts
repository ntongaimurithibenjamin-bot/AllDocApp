import { useEffect, useEffectEvent, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { subscribeToChanges, type DataTopic } from '@/db/events';
import type { SqlDb } from '@/db/types';
import { toAppError, type AppError } from '@/domain/errors';

type QueryDep = string | number | boolean | null | undefined;

export interface DbQueryState<T> {
  /** Latest result; kept while a refresh is in flight so lists don't flash empty. */
  data: T | undefined;
  error: AppError | null;
  loading: boolean;
  refresh: () => void;
}

interface Result<T> {
  key: string;
  data: T | undefined;
  error: AppError | null;
}

/**
 * Runs `query` against the app database and re-runs it when `deps` change or when one of
 * `topics` is written to. `deps` are the query's inputs and must be primitives.
 */
export function useDbQuery<T>(
  query: (db: SqlDb) => Promise<T>,
  deps: readonly QueryDep[],
  topics: readonly DataTopic[],
): DbQueryState<T> {
  const db = useSQLiteContext();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result<T>>({ key: '', data: undefined, error: null });

  const requestKey = `${JSON.stringify(deps)}#${version}`;
  const topicsKey = topics.join(',');

  const runQuery = useEffectEvent(() => query(db));

  useEffect(() => {
    let cancelled = false;
    runQuery().then(
      (data) => {
        if (!cancelled) setResult({ key: requestKey, data, error: null });
      },
      (error: unknown) => {
        if (!cancelled) {
          setResult((previous) => ({
            key: requestKey,
            data: previous.data,
            error: toAppError(error, 'database_failure'),
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, requestKey]);

  useEffect(() => {
    const watched = new Set(topicsKey.split(','));
    return subscribeToChanges((changed) => {
      for (const topic of changed) {
        if (watched.has(topic)) {
          setVersion((v) => v + 1);
          return;
        }
      }
    });
  }, [topicsKey]);

  return {
    data: result.data,
    error: result.error,
    loading: result.key !== requestKey,
    refresh: () => setVersion((v) => v + 1),
  };
}

/** The app database, typed as the repository interface. */
export function useDb(): SqlDb {
  return useSQLiteContext();
}
