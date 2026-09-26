import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import { useOverlay, type OverlayAction } from '@/components/overlay/OverlayProvider';
import { renameDocument, restoreDocument, setFavorite, trashDocument } from '@/db/repositories/documents';
import { toAppError } from '@/domain/errors';
import type { Document } from '@/domain/models';
import { isPdfCapable } from '@/domain/pdfTools';
import { saveToDownloads, shareDocument } from '@/services/files/exportFile';

import { useDb } from './useDbQuery';

function report(error: unknown) {
  const appError = toAppError(error);
  if (__DEV__) console.warn(appError);
  Alert.alert('Something went wrong', appError.userMessage);
}

/** Shared document actions: the long-press sheet, plus trash-with-undo for other screens. */
export function useDocumentActions() {
  const db = useDb();
  const { showActions, showToast, showPrompt } = useOverlay();

  /** Moves to trash immediately and offers Undo, instead of an "Are you sure?" dialog. */
  const trashWithUndo = useCallback(
    async (document: Document) => {
      try {
        await trashDocument(db, document.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        showToast({
          message: `“${document.title}” moved to trash`,
          actionLabel: 'Undo',
          onAction: () => restoreDocument(db, document.id).catch(report),
        });
      } catch (error) {
        report(error);
      }
    },
    [db, showToast],
  );

  const openActions = useCallback(
    (document: Document) => {
      const actions: OverlayAction[] = [
        { key: 'open', label: 'Open', icon: 'book-open-page-variant-outline', onPress: () => router.push(`/document/${document.id}/read`) },
        {
          key: 'rename',
          label: 'Rename',
          icon: 'pencil-outline',
          onPress: () =>
            showPrompt({
              title: 'Rename document',
              initialValue: document.title,
              onConfirm: (title) => renameDocument(db, document.id, title).catch(report),
            }),
        },
        {
          key: 'favorite',
          label: document.isFavorite ? 'Remove from favourites' : 'Add to favourites',
          icon: document.isFavorite ? 'star-off-outline' : 'star-outline',
          onPress: () => {
            Haptics.selectionAsync().catch(() => {});
            setFavorite(db, document.id, !document.isFavorite).catch(report);
          },
        },
        { key: 'move', label: 'Move to folder', icon: 'folder-move-outline', onPress: () => router.push(`/document/${document.id}/move`) },
      ];
      const exportable = document.fileUri !== null || (document.kind === 'pages' && document.pageCount > 0);
      if (exportable) {
        actions.push(
          { key: 'share', label: 'Share', icon: 'share-variant-outline', onPress: () => shareDocument(db, document).catch(report) },
          {
            key: 'download',
            label: 'Save to Downloads',
            icon: 'download-outline',
            onPress: () =>
              saveToDownloads(db, document)
                .then((result) => {
                  if (result.saved) showToast({ message: `Saved to ${result.location}` });
                })
                .catch(report),
          },
        );
      }
      if (isPdfCapable(document)) {
        actions.push({
          key: 'tools',
          label: 'PDF tools',
          icon: 'file-cog-outline',
          onPress: () => router.push({ pathname: '/tools', params: { documentId: document.id } }),
        });
      }
      if (document.kind === 'pages' || document.kind === 'pdf' || document.kind === 'text') {
        actions.push({
          key: 'text',
          label: 'Text',
          icon: 'text-recognition',
          onPress: () => router.push(`/document/${document.id}/text`),
        });
      }
      actions.push(
        { key: 'details', label: 'Details', icon: 'information-outline', onPress: () => router.push(`/document/${document.id}`) },
        { key: 'trash', label: 'Move to trash', icon: 'delete-outline', destructive: true, onPress: () => void trashWithUndo(document) },
      );
      showActions({ title: document.title, actions });
    },
    [db, showActions, showPrompt, showToast, trashWithUndo],
  );

  return { openActions, trashWithUndo };
}
