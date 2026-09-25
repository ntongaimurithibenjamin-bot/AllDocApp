import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { migrate } from '../migrations';
import type { SqlDb, SqlParam } from '../types';

function toNodeParams(params: SqlParam[]): SQLInputValue[] {
  return params.map((param) => (typeof param === 'boolean' ? (param ? 1 : 0) : param));
}

/** SqlDb backed by Node's built-in SQLite (FTS5 included), for repository tests. */
export function createNodeSqlDb(): SqlDb {
  const raw = new DatabaseSync(':memory:');

  const db: SqlDb = {
    async execAsync(source) {
      raw.exec(source);
    },
    async runAsync(source, ...params) {
      const result = raw.prepare(source).run(...toNodeParams(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync<T>(source: string, ...params: SqlParam[]) {
      return (raw.prepare(source).get(...toNodeParams(params)) as T | undefined) ?? null;
    },
    async getAllAsync<T>(source: string, ...params: SqlParam[]) {
      return raw.prepare(source).all(...toNodeParams(params)) as T[];
    },
    async withExclusiveTransactionAsync(task) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        await task(db);
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return db;
}

export async function createMigratedDb(): Promise<SqlDb> {
  const db = createNodeSqlDb();
  await migrate(db);
  return db;
}
