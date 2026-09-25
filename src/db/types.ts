export type SqlParam = string | number | null | boolean | Uint8Array;

/**
 * The subset of expo-sqlite's SQLiteDatabase that repositories use. Keeping repositories on this
 * interface lets unit tests run them against Node's built-in SQLite.
 */
export interface SqlDb {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: SqlParam[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(source: string, ...params: SqlParam[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: SqlParam[]): Promise<T[]>;
  withExclusiveTransactionAsync(task: (txn: SqlDb) => Promise<void>): Promise<void>;
}
