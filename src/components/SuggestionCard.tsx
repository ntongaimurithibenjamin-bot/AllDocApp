import * as Haptics from 'expo-haptics';
import { Pressable, Text, View } from 'react-native';

import { moveDocument, renameDocument, setDocumentSuggestion } from '@/db/repositories/documents';
import type { Document } from '@/domain/models';
import { describeType } from '@/domain/suggestions';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb } from '@/hooks/useDbQuery';
import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { useOverlay } from './overlay/OverlayProvider';

function Chip({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: colors.border }}
      className="max-w-full flex-row items-center gap-1.5 overflow-hidden rounded-full bg-primary/15 px-3 py-2"
    >
      <Icon name={icon} size={16} color="primary" />
      <Text numberOfLines={1} className="shrink text-sm font-medium text-primary">
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One-tap filing for an inbox document, from what its text looks like: rename to the suggested
 * title, move to the matching folder, or dismiss.
 */
export function SuggestionCard({ document, folderName }: { document: Document; folderName: string | null }) {
  const db = useDb();
  const { showToast } = useOverlay();
  const suggestion = document.suggestion;

  const title = suggestion?.title && suggestion.title !== document.title ? suggestion.title : null;
  const folderId = suggestion?.folderId && folderName ? suggestion.folderId : null;

  const rename = useAsyncAction(async () => {
    if (!suggestion || !title) return;
    await renameDocument(db, document.id, title);
    await setDocumentSuggestion(db, document.id, folderId ? { ...suggestion, title: null } : null);
    Haptics.selectionAsync().catch(() => {});
  });
  const move = useAsyncAction(async () => {
    if (!folderId) return;
    await moveDocument(db, document.id, folderId);
    await setDocumentSuggestion(db, document.id, null);
    Haptics.selectionAsync().catch(() => {});
    showToast({ message: `Moved to ${folderName}` });
  });
  const dismiss = useAsyncAction(() => setDocumentSuggestion(db, document.id, null));

  if (!suggestion || (!title && !folderId)) return null;
  const busy = rename.pending || move.pending || dismiss.pending;

  return (
    <View className="mx-4 mb-2 -mt-1 rounded-2xl bg-surface px-3 pb-3 pt-2">
      <View className="flex-row items-center gap-2">
        <Icon name="lightbulb-on-outline" size={18} color="primary" />
        <Text className="flex-1 text-sm text-muted">
          {suggestion.type ? `Looks like a ${describeType(suggestion.type).toLowerCase()}` : 'Suggested filing'}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss suggestion" onPress={() => dismiss.run()} hitSlop={10} className="p-1">
          <Icon name="close" size={18} color="muted" />
        </Pressable>
      </View>
      <View className="mt-2 flex-row flex-wrap gap-2">
        {title ? <Chip icon="pencil-outline" label={`Rename to “${title}”`} onPress={() => rename.run()} disabled={busy} /> : null}
        {folderId ? <Chip icon="folder-move-outline" label={`Move to ${folderName}`} onPress={() => move.run()} disabled={busy} /> : null}
      </View>
    </View>
  );
}
