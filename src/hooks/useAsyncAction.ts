import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { toAppError } from '@/domain/errors';

/**
 * Wraps a user-triggered async action: tracks `pending` and shows the error's user-facing message
 * instead of failing silently.
 */
export function useAsyncAction<Args extends unknown[]>(action: (...args: Args) => Promise<unknown>) {
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (...args: Args): Promise<boolean> => {
      setPending(true);
      try {
        await action(...args);
        return true;
      } catch (error) {
        const appError = toAppError(error);
        if (__DEV__) console.warn(appError);
        Alert.alert('Something went wrong', appError.userMessage);
        return false;
      } finally {
        setPending(false);
      }
    },
    [action],
  );

  return { run, pending };
}
