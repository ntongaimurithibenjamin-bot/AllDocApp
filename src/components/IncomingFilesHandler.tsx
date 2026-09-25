import { DocunaNative, type IncomingFile } from 'docuna-native';
import { router } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { Alert } from 'react-native';

import { useOverlay } from '@/components/overlay/OverlayProvider';
import { toAppError } from '@/domain/errors';
import { useDb } from '@/hooks/useDbQuery';
import { importIncomingFiles } from '@/services/files/incoming';

/**
 * Imports files other apps send to Docuna ("Open with" / "Share"): the ones Docuna was launched
 * with, and any that arrive while it is running. One file opens straight in the reader; several
 * are added together with a toast.
 */
export function IncomingFilesHandler() {
  const db = useDb();
  const { showToast } = useOverlay();

  const handle = useEffectEvent(async (files: IncomingFile[]) => {
    if (files.length === 0) return;
    const { imported, errors } = await importIncomingFiles(db, files);

    if (imported.length === 1) {
      router.push(`/document/${imported[0]!.id}/read`);
    } else if (imported.length > 1) {
      router.push('/documents');
      showToast({ message: `${imported.length} files added to Docuna` });
    }
    if (errors.length > 0) {
      const first = toAppError(errors[0]);
      if (__DEV__) console.warn('Incoming file failed', errors);
      Alert.alert(
        errors.length === 1 ? 'Couldn’t add this file' : `Couldn’t add ${errors.length} files`,
        first.userMessage,
      );
    }
  });

  useEffect(() => {
    if (!DocunaNative) return;
    DocunaNative.consumeIncomingFilesAsync()
      .then(handle)
      .catch((error: unknown) => {
        if (__DEV__) console.warn('Reading launch intent failed', error);
      });
    const subscription = DocunaNative.addListener('onIncomingFiles', ({ files }) => {
      void handle(files);
    });
    return () => subscription.remove();
  }, []);

  return null;
}
