import type { SqlDb } from './types';

interface Migration {
  version: number;
  sql: string;
  /**
   * Table rebuilds (SQLite's 12-step ALTER procedure) must run with foreign keys off, otherwise
   * dropping the old table would cascade-delete child rows.
   */
  rebuildsTables?: boolean;
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
  {
    // Reader: file-backed documents (PDF, text), resume position, page-number bookmarks.
    version: 2,
    rebuildsTables: true,
    sql: `
CREATE TABLE documents_v2 (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL,
  source         TEXT NOT NULL CHECK (source IN ('scan','import_pdf','import_image','import_file')),
  kind           TEXT NOT NULL DEFAULT 'pages' CHECK (kind IN ('pages','pdf','text')),
  file_uri       TEXT,
  mime_type      TEXT,
  original_name  TEXT,
  page_count     INTEGER NOT NULL DEFAULT 0,
  thumbnail_uri  TEXT,
  pdf_uri        TEXT,
  pdf_stale      INTEGER NOT NULL DEFAULT 1,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  is_archived    INTEGER NOT NULL DEFAULT 0,
  in_inbox       INTEGER NOT NULL DEFAULT 1,
  suggested_json TEXT,
  last_read_page INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
-- rowid is copied so the title_fts external-content index stays aligned.
INSERT INTO documents_v2 (rowid, id, title, folder_id, source, page_count, thumbnail_uri, pdf_uri, pdf_stale,
  size_bytes, is_favorite, is_archived, in_inbox, suggested_json, created_at, updated_at, deleted_at)
SELECT rowid, id, title, folder_id, source, page_count, thumbnail_uri, pdf_uri, pdf_stale,
  size_bytes, is_favorite, is_archived, in_inbox, suggested_json, created_at, updated_at, deleted_at
FROM documents;
DROP TABLE documents;
ALTER TABLE documents_v2 RENAME TO documents;
CREATE INDEX idx_documents_folder ON documents(folder_id, updated_at DESC);
CREATE INDEX idx_documents_recent ON documents(updated_at DESC) WHERE deleted_at IS NULL;
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

-- Bookmarks address a page number (works for PDFs); page_id follows a scanned page if reordered.
DROP TABLE bookmarks;
CREATE TABLE bookmarks (
  id          TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id     TEXT REFERENCES pages(id) ON DELETE CASCADE,
  page_index  INTEGER NOT NULL,
  label       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_bookmarks_doc ON bookmarks(document_id, page_index);
`,
  },
  {
    // "Continue reading" on Home.
    version: 3,
    sql: `
ALTER TABLE documents ADD COLUMN last_opened_at INTEGER;
CREATE INDEX idx_documents_opened ON documents(last_opened_at DESC) WHERE last_opened_at IS NOT NULL;
`,
  },
  {
    // Files opened from the phone ("Open a file") are not scans: take them out of the inbox.
    // Until now, image documents came from Open a file unless the scanner was unavailable.
    version: 4,
    sql: `UPDATE documents SET in_inbox = 0 WHERE source IN ('import_pdf', 'import_file', 'import_image');`,
  },
  {
    // Office documents: kinds are validated by the app (DocumentKind), not a CHECK, so adding a
    // format never needs another table rebuild.
    version: 5,
    rebuildsTables: true,
    sql: `
CREATE TABLE documents_v5 (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL,
  source         TEXT NOT NULL CHECK (source IN ('scan','import_pdf','import_image','import_file')),
  kind           TEXT NOT NULL DEFAULT 'pages',
  file_uri       TEXT,
  mime_type      TEXT,
  original_name  TEXT,
  page_count     INTEGER NOT NULL DEFAULT 0,
  thumbnail_uri  TEXT,
  pdf_uri        TEXT,
  pdf_stale      INTEGER NOT NULL DEFAULT 1,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  is_archived    INTEGER NOT NULL DEFAULT 0,
  in_inbox       INTEGER NOT NULL DEFAULT 1,
  suggested_json TEXT,
  last_read_page INTEGER NOT NULL DEFAULT 0,
  last_opened_at INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
INSERT INTO documents_v5 (rowid, id, title, folder_id, source, kind, file_uri, mime_type, original_name,
  page_count, thumbnail_uri, pdf_uri, pdf_stale, size_bytes, is_favorite, is_archived, in_inbox,
  suggested_json, last_read_page, last_opened_at, created_at, updated_at, deleted_at)
SELECT rowid, id, title, folder_id, source, kind, file_uri, mime_type, original_name,
  page_count, thumbnail_uri, pdf_uri, pdf_stale, size_bytes, is_favorite, is_archived, in_inbox,
  suggested_json, last_read_page, last_opened_at, created_at, updated_at, deleted_at
FROM documents;
DROP TABLE documents;
ALTER TABLE documents_v5 RENAME TO documents;
CREATE INDEX idx_documents_folder ON documents(folder_id, updated_at DESC);
CREATE INDEX idx_documents_recent ON documents(updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_opened ON documents(last_opened_at DESC) WHERE last_opened_at IS NOT NULL;
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
`,
  },
  {
    // OCR: text rows address either a scanned page (page_id, follows reordering) or a page number
    // of a file (page_index, PDFs and text files). Documents track file OCR progress so the queue
    // resumes where it stopped.
    version: 6,
    rebuildsTables: true,
    sql: `
CREATE TABLE ocr_pages_v6 (
  id            INTEGER PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id       TEXT UNIQUE REFERENCES pages(id) ON DELETE CASCADE,
  page_index    INTEGER,
  text          TEXT NOT NULL,
  blocks_json   TEXT,
  language      TEXT,
  engine        TEXT NOT NULL,
  confidence    REAL,
  processed_at  INTEGER NOT NULL,
  UNIQUE (document_id, page_index),
  CHECK ((page_id IS NULL) <> (page_index IS NULL))
);
INSERT INTO ocr_pages_v6 (id, document_id, page_id, text, blocks_json, language, engine, processed_at)
SELECT rowid, document_id, page_id, text, blocks_json, language, engine, processed_at FROM ocr_pages;
DROP TABLE ocr_pages;
ALTER TABLE ocr_pages_v6 RENAME TO ocr_pages;
CREATE INDEX idx_ocr_doc ON ocr_pages(document_id);
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
INSERT INTO ocr_fts(ocr_fts) VALUES ('rebuild');

ALTER TABLE documents ADD COLUMN ocr_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE documents ADD COLUMN ocr_next_page INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_documents_ocr ON documents(ocr_state) WHERE ocr_state = 'pending';
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/**
 * Brings the database to the latest schema (or `upTo`, for tests). Safe to call on every start.
 */
export async function migrate(db: SqlDb, upTo: number = LATEST_SCHEMA_VERSION): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current || migration.version > upTo) continue;
    // PRAGMA foreign_keys is a no-op inside a transaction, so toggle it around it.
    if (migration.rebuildsTables) await db.execAsync('PRAGMA foreign_keys = OFF;');
    try {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.execAsync(migration.sql);
        if (migration.rebuildsTables) {
          const violations = await txn.getAllAsync('PRAGMA foreign_key_check');
          if (violations.length > 0) throw new Error(`Migration ${migration.version} broke ${violations.length} foreign keys`);
        }
        await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
      });
    } finally {
      if (migration.rebuildsTables) await db.execAsync('PRAGMA foreign_keys = ON;');
    }
  }
}
