import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { migrate } from './migrations';

export const DATABASE_NAME = 'docuna.db';

type Holder = { __docunaDatabase?: Promise<SQLiteDatabase> };
const holder = globalThis as Holder;

/**
 * The app's single database connection: opened and migrated once, never closed while the app runs.
 *
 * We deliberately don't use SQLiteProvider's suspense mode: it re-opens the database when its
 * props' identities change and closes the previous connection without awaiting it. On slow
 * devices that close raced with running statements and crashed natively (double free in
 * sqlite3_close). The promise lives on globalThis so re-evaluated modules share it.
 */
export function openAppDatabase(): Promise<SQLiteDatabase> {
  holder.__docunaDatabase ??= (async () => {
    const db = await openDatabaseAsync(DATABASE_NAME);
    await migrate(db);
    return db;
  })().catch((error: unknown) => {
    // Allow a retry (e.g. from the error screen) after a failed open.
    holder.__docunaDatabase = undefined;
    throw error;
  });
  return holder.__docunaDatabase;
}
