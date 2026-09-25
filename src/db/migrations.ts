import type { SqlDb } from './types';

interface Migration {
  version: number;
  sql: string;
}

// Append-only. Never edit a migration that has shipped; add a new one instead.
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE folders (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_folders_parent ON folders(parent_id, sort_order);

CREATE TABLE documents (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL,
  source         TEXT NOT NULL CHECK (source IN ('scan','import_pdf','import_image')),
  page_count     INTEGER NOT NULL DEFAULT 0,
  thumbnail_uri  TEXT,
  pdf_uri        TEXT,
  pdf_stale      INTEGER NOT NULL DEFAULT 1,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  is_archived    INTEGER NOT NULL DEFAULT 0,
  in_inbox       INTEGER NOT NULL DEFAULT 1,
  suggested_json TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
CREATE INDEX idx_documents_folder ON documents(folder_id, updated_at DESC);
CREATE INDEX idx_documents_recent ON documents(updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE pages (
  id             TEXT PRIMARY KEY NOT NULL,
  document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  original_uri   TEXT NOT NULL,
  processed_uri  TEXT,
  thumbnail_uri  TEXT NOT NULL,
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  rotation       INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0,90,180,270)),
  crop_json      TEXT,
  filter         TEXT NOT NULL DEFAULT 'original',
  adjust_json    TEXT,
  ocr_status     TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed','skipped')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_pages_doc ON pages(document_id, position);
CREATE INDEX idx_pages_ocr_pending ON pages(ocr_status) WHERE ocr_status = 'pending';

CREATE TABLE ocr_pages (
  page_id       TEXT PRIMARY KEY NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  blocks_json   TEXT,
  language      TEXT,
  engine        TEXT NOT NULL,
  processed_at  INTEGER NOT NULL
);
CREATE INDEX idx_ocr_doc ON ocr_pages(document_id);

CREATE VIRTUAL TABLE ocr_fts USING fts5(
  text, content='ocr_pages', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER ocr_pages_ai AFTER INSERT ON ocr_pages BEGIN
  INSERT INTO ocr_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER ocr_pages_ad AFTER DELETE ON ocr_pages BEGIN
  INSERT INTO ocr_fts(ocr_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER ocr_pages_au AFTER UPDATE OF text ON ocr_pages BEGIN
  INSERT INTO ocr_fts(ocr_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO ocr_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE VIRTUAL TABLE title_fts USING fts5(
  title, content='documents', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO title_fts(rowid, title) VALUES (new.rowid, new.title);
END;
CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO title_fts(title_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
END;
CREATE TRIGGER documents_au AFTER UPDATE OF title ON documents BEGIN
  INSERT INTO title_fts(title_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
  INSERT INTO title_fts(rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TABLE bookmarks (
  id          TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  label       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_bookmarks_doc ON bookmarks(document_id);

CREATE TABLE annotations (
  id          TEXT PRIMARY KEY NOT NULL,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('ink','highlight','text','signature')),
  data_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_annotations_page ON annotations(page_id);

CREATE TABLE ai_results (
  id          TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  input_hash  TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(document_id, action, input_hash)
);

CREATE TABLE ai_usage (
  id           TEXT PRIMARY KEY NOT NULL,
  action       TEXT NOT NULL,
  document_id  TEXT,
  credits_used INTEGER NOT NULL,
  status       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Brings the database to the latest schema. Safe to call on every app start. */
export async function migrate(db: SqlDb): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(migration.sql);
      await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
