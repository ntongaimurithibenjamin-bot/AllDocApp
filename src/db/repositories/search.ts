import type { DocumentKind, SearchHit } from '@/domain/models';

import type { SqlDb } from '../types';

const MAX_TERMS = 8;

/**
 * Turns free text into a safe FTS5 MATCH expression. Every token is quoted (so user input can't
 * inject FTS syntax) and the last one becomes a prefix match for search-as-you-type.
 * Tokens are split the same way the unicode61 tokenizer does, so "KSh 25,000" → "ksh" "25" "000"*.
 * Returns null when the input has no searchable characters.
 */
export function buildFtsQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TERMS);
  if (tokens.length === 0) return null;
  return tokens.map((token, i) => (i === tokens.length - 1 ? `"${token}"*` : `"${token}"`)).join(' ');
}

interface HitRow {
  document_id: string;
  title: string;
  kind: DocumentKind;
  page_number: number | null;
  snippet: string | null;
  page_matches: number;
}

/**
 * Searches document titles and recognised page text (scans, PDFs, text files). Results are grouped
 * to the best hit per document, title matches first, then page-text matches ranked by bm25;
 * `pageMatches` counts the document's matching pages.
 */
export async function searchDocuments(db: SqlDb, input: string, limit = 50): Promise<SearchHit[]> {
  const query = buildFtsQuery(input);
  if (!query) return [];

  const rows = await db.getAllAsync<HitRow>(
    `WITH title_hits AS (
       SELECT d.id AS document_id, d.title, d.kind, NULL AS page_number, NULL AS snippet,
              0 AS source, bm25(title_fts) AS rank
       FROM title_fts JOIN documents d ON d.rowid = title_fts.rowid
       WHERE title_fts MATCH ?1 AND d.deleted_at IS NULL
     ),
     text_hits AS (
       SELECT d.id AS document_id, d.title, d.kind, COALESCE(p.position, o.page_index) + 1 AS page_number,
              snippet(ocr_fts, 0, '[', ']', '…', 12) AS snippet,
              1 AS source, bm25(ocr_fts) AS rank
       FROM ocr_fts
       JOIN ocr_pages o ON o.rowid = ocr_fts.rowid
       LEFT JOIN pages p ON p.id = o.page_id
       JOIN documents d ON d.id = o.document_id
       WHERE ocr_fts MATCH ?1 AND d.deleted_at IS NULL
     ),
     ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY source, rank) AS rn,
              SUM(source) OVER (PARTITION BY document_id) AS page_matches
       FROM (SELECT * FROM title_hits UNION ALL SELECT * FROM text_hits)
     )
     SELECT document_id, title, kind, page_number, snippet, page_matches FROM ranked
     WHERE rn = 1
     ORDER BY source, rank
     LIMIT ?2`,
    query,
    limit,
  );

  return rows.map((row) => ({
    documentId: row.document_id,
    title: row.title,
    kind: row.kind,
    pageNumber: row.page_number,
    snippet: row.snippet,
    pageMatches: row.page_matches,
  }));
}
