import { createContext, use, useContext, type ReactNode } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openAppDatabase } from './database';

const DatabaseContext = createContext<SQLiteDatabase | null>(null);

/**
 * Suspends until the app database is open and migrated. The promise is a process-wide singleton,
 * so re-renders and remounts never open a second connection. Errors reach the nearest error
 * boundary.
 */
export function DatabaseProvider({ children }: { children: ReactNode }) {
  const database = use(openAppDatabase());
  return <DatabaseContext value={database}>{children}</DatabaseContext>;
}

export function useDatabase(): SQLiteDatabase {
  const database = useContext(DatabaseContext);
  if (!database) throw new Error('useDatabase must be used inside <DatabaseProvider>');
  return database;
}
