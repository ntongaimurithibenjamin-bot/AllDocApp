export type AppErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'storage_full'
  | 'storage_failure'
  | 'database_failure'
  | 'permission_denied'
  | 'invalid_image'
  | 'scanner_unavailable'
  | 'native_unavailable'
  | 'unsupported_file'
  | 'pdf_encrypted'
  | 'pdf_invalid'
  | 'file_too_large'
  | 'unknown';

const USER_MESSAGES: Record<AppErrorCode, string> = {
  not_found: 'That item no longer exists. It may have been deleted.',
  invalid_input: 'Please check what you entered and try again.',
  storage_full: 'Your phone is out of storage space. Free up some space and try again.',
  storage_failure: 'Docuna could not read or write a file. Please try again.',
  database_failure: 'Something went wrong saving your changes. Please try again.',
  permission_denied: 'Docuna needs permission to do that. You can grant it in Android settings.',
  invalid_image: 'That image could not be opened. It may be damaged or in an unsupported format.',
  scanner_unavailable: 'The scanner could not start. Make sure Google Play services is up to date, or add pages from your photos instead.',
  native_unavailable: 'This feature needs the full Docuna app and is not available in this preview.',
  unsupported_file: 'Docuna can’t open this type of file yet.',
  pdf_encrypted: 'This PDF is password-protected, so it can’t be changed. Open it, remove the password, and try again.',
  pdf_invalid: 'This PDF looks damaged, so it can’t be changed.',
  file_too_large: 'This file is too large to edit on this phone.',
  unknown: 'Something went wrong. Please try again.',
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;

  constructor(code: AppErrorCode, message?: string, options?: { cause?: unknown; userMessage?: string }) {
    super(message ?? USER_MESSAGES[code], { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.userMessage = options?.userMessage ?? USER_MESSAGES[code];
  }
}

export function toAppError(error: unknown, fallback: AppErrorCode = 'unknown'): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOSPC|SQLITE_FULL|no space left|disk is full/i.test(message)) {
    return new AppError('storage_full', message, { cause: error });
  }
  return new AppError(fallback, message, { cause: error });
}
