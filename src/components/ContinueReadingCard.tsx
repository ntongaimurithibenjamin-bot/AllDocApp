import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import type { Document } from '@/domain/models';
import { useTheme } from '@/theme';

import { kindIcon } from './documentKind';
import { Icon } from './Icon';

/** Home card that resumes the last document read, where the reader left off. */
export function ContinueReadingCard({ document, onPress }: { document: Document; onPress: () => void }) {
  const { colors } = useTheme();
  const knownPages = document.pageCount > 0 && (document.kind === 'pages' || document.kind === 'pdf' || document.kind === 'slides');
  const page = Math.max(1, Math.min(document.lastReadPage || 1, document.pageCount || 1));
  const progress = knownPages ? page / document.pageCount : 0;
  const status = knownPages ? `Page ${page} of ${document.pageCount}` : 'Pick up where you left off';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Continue reading ${document.title}. ${status}`}
      onPress={onPress}
      android_ripple={{ color: colors.border }}
      className="mx-4 mt-4 flex-row items-center gap-4 overflow-hidden rounded-2xl bg-surface p-3"
    >
      <View className="h-20 w-15 items-center justify-center overflow-hidden rounded-lg bg-surface-muted" style={{ width: 60 }}>
        {document.thumbnailUri ? (
          <Image source={{ uri: document.thumbnailUri }} style={{ width: 60, height: 80 }} contentFit="cover" recyclingKey={document.id} />
        ) : (
          <Icon name={kindIcon(document.kind)} color="muted" size={28} />
        )}
      </View>
      <View className="flex-1">
        <Text className="text-xs font-semibold uppercase tracking-wide text-primary">Continue reading</Text>
        <Text numberOfLines={1} className="mt-1 text-base font-semibold text-text">
          {document.title}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-sm text-muted">
          {status}
        </Text>
        {knownPages ? (
          <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <View className="h-full rounded-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
          </View>
        ) : null}
      </View>
      <View className="h-11 w-11 items-center justify-center rounded-full bg-primary">
        <Icon name="play" color="on-primary" />
      </View>
    </Pressable>
  );
}
