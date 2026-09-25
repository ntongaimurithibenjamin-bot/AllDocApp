export type AppErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'storage_full'
  | 'storage_failure'
  | 'database_failure'
  | 'permission_denied'
  | 'unknown';

const USER_MESSAGES: Record<AppErrorCode, string> = {
  not_found: 'That item no longer exists. It may have been deleted.',
  invalid_input: 'Please check what you entered and try again.',
  storage_full: 'Your phone is out of storage space. Free up some space and try again.',
  storage_failure: 'Docuna could not read or write a file. Please try again.',
  database_failure: 'Something went wrong saving your changes. Please try again.',
  permission_denied: 'Docuna needs permission to do that. You can grant it in Android settings.',
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
