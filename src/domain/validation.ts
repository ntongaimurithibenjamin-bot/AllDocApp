import { AppError } from './errors';

const MAX_NAME_LENGTH = 120;
// Characters that are invalid in Android/SAF file names; titles become export file names.
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001F]/g;

/** Normalises a user-entered document or folder name, throwing if nothing usable remains. */
export function normalizeName(input: string): string {
  const name = input.replace(INVALID_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (name.length === 0) {
    throw new AppError('invalid_input', 'Name is empty', { userMessage: 'Please enter a name.' });
  }
  return name.slice(0, MAX_NAME_LENGTH);
}

/** Default title for a new scan, e.g. "Scan 2026-09-25 14.32". */
export function defaultScanTitle(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Scan ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
}
