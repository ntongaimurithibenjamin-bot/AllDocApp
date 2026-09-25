import { Image } from 'expo-image';
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { Page } from '@/domain/models';

interface PageThumbProps {
  page: Page;
  index: number;
  selected?: boolean;
}

/** A page tile. Thumbnails already include crop/rotation/filter, so no transforms are needed. */
export const PageThumb = memo(function PageThumb({ page, index, selected = false }: PageThumbProps) {
  return (
    <View>
      <View
        className={`aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border-2 bg-surface-muted ${
          selected ? 'border-primary' : 'border-transparent'
        }`}
      >
        <Image
          source={{ uri: page.thumbnailUri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          recyclingKey={page.id}
          accessibilityLabel={`Page ${index + 1}`}
        />
      </View>
      <Text className={`mt-1 text-center text-xs ${selected ? 'font-semibold text-primary' : 'text-muted'}`}>{index + 1}</Text>
    </View>
  );
});
