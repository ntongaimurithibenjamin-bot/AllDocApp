/**
 * Rule-based filing suggestions from a document's recognised text: what it is, who issued it,
 * when, a title, and which of the user's folders fits. Runs on the device; no AI, no network.
 */

export type DocumentType =
  | 'receipt'
  | 'invoice'
  | 'statement'
  | 'payslip'
  | 'certificate'
  | 'contract'
  | 'letter'
  | 'id'
  | 'medical'
  | 'school';

export interface DocumentSuggestion {
  type: DocumentType | null;
  /** Suggested title, or null when the text gave nothing better than the current name. */
  title: string | null;
  /** ISO date (YYYY-MM-DD) found in the text. */
  date: string | null;
  folderId: string | null;
}

interface TypeRule {
  label: string;
  /** Phrases found in the text (lowercase, whole words). Two points each. */
  strong: string[];
  /** Supporting words. One point each. */
  weak: string[];
  /** Folder names that mean this type (singular, lowercase). */
  folders: string[];
}

const TYPES: Record<DocumentType, TypeRule> = {
  receipt: {
    label: 'Receipt',
    strong: ['receipt', 'cash sale', 'thank you for shopping', 'served by', 'till no', 'till number'],
    weak: ['total', 'change', 'cash', 'm-pesa', 'mpesa', 'paybill', 'vat', 'qty', 'paid', 'subtotal'],
    folders: ['receipt', 'expense', 'purchase', 'shopping'],
  },
  invoice: {
    label: 'Invoice',
    strong: ['invoice', 'bill to', 'amount due', 'pro forma', 'proforma', 'invoice no'],
    weak: ['due date', 'balance due', 'terms', 'vat', 'subtotal', 'total'],
    folders: ['invoice', 'bill'],
  },
  statement: {
    label: 'Statement',
    strong: ['statement of account', 'account statement', 'bank statement', 'opening balance', 'closing balance'],
    weak: ['statement', 'balance', 'transaction', 'debit', 'credit', 'account number', 'bank'],
    folders: ['statement', 'bank', 'banking', 'finance'],
  },
  payslip: {
    label: 'Payslip',
    strong: ['payslip', 'pay slip', 'gross pay', 'net pay', 'salary advice'],
    weak: ['paye', 'nhif', 'nssf', 'shif', 'housing levy', 'deductions', 'earnings', 'basic salary', 'employee'],
    folders: ['payslip', 'salary', 'pay', 'work'],
  },
  certificate: {
    label: 'Certificate',
    strong: ['certificate', 'this is to certify', 'hereby certify', 'certificate of'],
    weak: ['awarded', 'completion', 'successfully completed', 'registrar'],
    folders: ['certificate', 'award'],
  },
  contract: {
    label: 'Agreement',
    strong: ['agreement', 'tenancy', 'contract', 'hereby agree', 'terms and conditions', 'lease'],
    weak: ['landlord', 'tenant', 'party', 'parties', 'witness', 'signed', 'clause', 'rent'],
    folders: ['contract', 'agreement', 'lease', 'legal', 'house', 'rent'],
  },
  letter: {
    label: 'Letter',
    strong: ['yours sincerely', 'yours faithfully', 'dear sir', 'dear madam'],
    weak: ['dear', 'regards', 're:', 'ref:'],
    folders: ['letter', 'correspondence'],
  },
  id: {
    label: 'ID document',
    strong: ['national identity', 'identity card', 'passport', 'date of birth', 'id number', 'huduma'],
    weak: ['nationality', 'sex', 'place of birth', 'date of issue', 'district'],
    folders: ['id', 'identity', 'personal'],
  },
  medical: {
    label: 'Medical record',
    strong: ['patient', 'prescription', 'diagnosis', 'discharge summary', 'lab results'],
    weak: ['hospital', 'clinic', 'doctor', 'dr.', 'medical', 'pharmacy', 'dose', 'tablets'],
    folders: ['medical', 'health', 'hospital'],
  },
  school: {
    label: 'School document',
    strong: ['fee structure', 'report form', 'transcript', 'admission letter', 'result slip', 'exam results'],
    weak: ['school', 'student', 'term', 'grade', 'teacher', 'fees', 'university', 'college', 'semester'],
    folders: ['school', 'education', 'university', 'college', 'academic', 'fees'],
  },
};

const MIN_TYPE_SCORE = 3;

function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(haystack);
}

export function detectType(text: string): DocumentType | null {
  const haystack = text.toLowerCase();
  let best: DocumentType | null = null;
  let bestScore = 0;
  for (const [type, rule] of Object.entries(TYPES) as [DocumentType, TypeRule][]) {
    const score =
      rule.strong.filter((phrase) => containsPhrase(haystack, phrase)).length * 2 +
      rule.weak.filter((phrase) => containsPhrase(haystack, phrase)).length;
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return bestScore >= MIN_TYPE_SCORE ? best : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoDate(year: number, month: number, day: number, now: Date): string | null {
  if (year < 100) year += year > (now.getFullYear() % 100) + 1 ? 1900 : 2000;
  if (year < 1950 || year > now.getFullYear() + 1 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null; // e.g. 31/02
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/**
 * First plausible date in the text. Numeric dates are read day-first (Kenya, UK, most of the world)
 * unless the first number can only be a month-less-than-day US form (e.g. 12/25/2026).
 */
export function detectDate(text: string, now: Date = new Date()): string | null {
  const patterns: { regex: RegExp; parse: (m: RegExpMatchArray) => string | null }[] = [
    { regex: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, parse: (m) => isoDate(+m[1]!, +m[2]!, +m[3]!, now) },
    {
      regex: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/,
      parse: (m) => isoDate(+m[3]!, +m[2]!, +m[1]!, now) ?? isoDate(+m[3]!, +m[1]!, +m[2]!, now),
    },
    {
      regex: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i,
      parse: (m) => isoDate(+m[3]!, monthIndex(m[2]!), +m[1]!, now),
    },
    {
      regex: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
      parse: (m) => isoDate(+m[3]!, monthIndex(m[1]!), +m[2]!, now),
    },
  ];
  let found: { index: number; date: string } | null = null;
  for (const { regex, parse } of patterns) {
    const match = text.match(regex);
    if (!match || match.index === undefined) continue;
    const date = parse(match);
    if (date && (!found || match.index < found.index)) found = { index: match.index, date };
  }
  return found?.date ?? null;
}

const ISSUER_WORDS = /^[\p{L}][\p{L}&.'’ -]*$/u;
const NOT_ISSUER = new Set([
  'receipt', 'invoice', 'tax invoice', 'cash sale', 'statement', 'payslip', 'certificate', 'agreement',
  'republic of kenya', 'original', 'copy', 'customer copy', 'welcome', 'thank you',
]);

function titleCase(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/(^|[\s&.'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** The issuer is usually the first clean line of the page (a shop, company or school name). */
export function detectIssuer(text: string): string | null {
  const lines = text.split('\n').map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 5);
  for (const line of lines) {
    if (line.length < 3 || line.length > 40 || !ISSUER_WORDS.test(line)) continue;
    if ((line.match(/\p{L}/gu) ?? []).length < 3) continue;
    if (NOT_ISSUER.has(line.toLowerCase())) continue;
    return titleCase(line);
  }
  return null;
}

function singular(name: string): string {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith('ies')) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith('s') && !lower.endsWith('ss')) return lower.slice(0, -1);
  return lower;
}

export function matchFolder(
  type: DocumentType | null,
  text: string,
  folders: readonly { id: string; name: string }[],
): string | null {
  if (type) {
    const names = TYPES[type].folders;
    const byType = folders.find((folder) => names.includes(singular(folder.name)));
    if (byType) return byType.id;
  }
  // A folder named after something the page mentions, e.g. "KRA" or "Equity Bank".
  const haystack = text.toLowerCase();
  const byName = folders.find((folder) => folder.name.trim().length >= 3 && containsPhrase(haystack, folder.name.trim().toLowerCase()));
  return byName?.id ?? null;
}

export function suggestFiling(
  text: string,
  folders: readonly { id: string; name: string }[],
  now: Date = new Date(),
): DocumentSuggestion | null {
  const sample = text.slice(0, 4000);
  if (sample.trim().length < 12) return null;

  const type = detectType(sample);
  const date = detectDate(sample, now);
  const issuer = detectIssuer(sample);
  const label = type ? TYPES[type].label : null;

  const head = label && issuer ? `${label} – ${issuer}` : (label ?? issuer);
  const title = head ? (date ? `${head} ${date}` : head).slice(0, 120) : null;
  const folderId = matchFolder(type, sample, folders);

  if (!title && !folderId) return null;
  return { type, title, date, folderId };
}

export function describeType(type: DocumentType): string {
  return TYPES[type].label;
}
