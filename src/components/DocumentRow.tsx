import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Document } from '@/domain/models';
import { formatRelativeTime, pluralize } from '@/lib/format';
import { useTheme } from '@/theme';

import { Icon } from './Icon';

interface DocumentRowProps {
  document: Document;
  onPress: (document: Document) => void;
  onLongPress?: (document: Document) => void;
}

export const DocumentRow = memo(function DocumentRow({ document, onPress, onLongPress }: DocumentRowProps) {
  const { colors } = useTheme();
  const meta = `${pluralize(document.pageCount, 'page')} · ${formatRelativeTime(document.updatedAt)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${document.title}, ${meta}`}
      onPress={() => onPress(document)}
      onLongPress={onLongPress ? () => onLongPress(document) : undefined}
      android_ripple={{ color: colors.border }}
      className="flex-row items-center gap-4 px-4 py-3"
    >
      <View className="h-16 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
        {document.thumbnailUri ? (
          // Thumbnails are small files on disk; expo-image downsamples and caches them.
          <Image source={{ uri: document.thumbnailUri }} style={{ width: 48, height: 64 }} contentFit="cover" recyclingKey={document.id} />
        ) : (
          <Icon name="file-document-outline" color="muted" />
        )}
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="text-base font-medium text-text">
          {document.title}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-sm text-muted">
          {meta}
        </Text>
      </View>
      {document.isFavorite ? <Icon name="star" size={18} color="warning" /> : null}
    </Pressable>
  );
});
