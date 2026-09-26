import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { getPage } from '@/db/repositories/pages';
import type { CropQuad } from '@/domain/models';
import { FULL_PAGE_QUAD, isValidQuad } from '@/domain/pageEdits';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { goBack } from '@/lib/navigation';
import { getImageSize } from '@/services/image';
import { editPage } from '@/services/pages/pageService';
import { useTheme } from '@/theme';

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);
const HANDLE_SIZE = 44;
const PADDING = 24;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a `contentFit="contain"` image lands inside its container. */
function containRect(container: { width: number; height: number }, image: { width: number; height: number }): Rect {
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height };
}

function Handle({ quad, index, rect, label }: { quad: SharedValue<CropQuad>; index: number; rect: Rect; label: string }) {
  const start = useSharedValue({ x: 0, y: 0 });

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      start.set(quad.get()[index]!);
    })
    .onUpdate((event) => {
      const origin = start.get();
      const next = [...quad.get()] as CropQuad;
      next[index] = {
        x: Math.min(1, Math.max(0, origin.x + event.translationX / rect.width)),
        y: Math.min(1, Math.max(0, origin.y + event.translationY / rect.height)),
      };
      quad.set(next);
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: rect.x + quad.get()[index]!.x * rect.width - HANDLE_SIZE / 2 },
      { translateY: rect.y + quad.get()[index]!.y * rect.height - HANDLE_SIZE / 2 },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessibilityLabel={label}
        hitSlop={8}
        style={[{ position: 'absolute', width: HANDLE_SIZE, height: HANDLE_SIZE }, style]}
        className="items-center justify-center"
      >
        <View className="h-6 w-6 rounded-full border-2 border-white bg-primary" />
      </Animated.View>
    </GestureDetector>
  );
}

const CORNER_LABELS = ['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'];

export default function CropScreen() {
  const { pageId } = useLocalSearchParams<{ id: string; pageId: string }>();
  const db = useDb();
  const { colors } = useTheme();
  const [container, setContainer] = useState<{ width: number; height: number } | null>(null);
  const quad = useSharedValue<CropQuad>(FULL_PAGE_QUAD);

  const { data, error, refresh } = useDbQuery(
    async (d) => {
      const page = await getPage(d, pageId);
      if (!page) return null;
      // The crop is drawn on the untouched original, which may differ in size from the processed page.
      return { page, size: await getImageSize(page.originalUri) };
    },
    [pageId],
    [],
  );

  const savedCrop = data?.page.crop ?? null;
  useEffect(() => {
    quad.set(savedCrop ?? FULL_PAGE_QUAD);
  }, [quad, savedCrop]);

  const apply = useAsyncAction(async () => {
    const crop = quad.get();
    if (!isValidQuad(crop)) {
      Alert.alert('Adjust the corners', 'The corners cross over each other. Drag them so they outline the page.');
      return;
    }
    await editPage(db, pageId, { crop });
    goBack();
  });

  const rect = container && data ? containRect(container, data.size) : null;

  const polygonProps = useAnimatedProps(() => {
    if (!rect) return { points: '' };
    return {
      points: quad.get().map((p) => `${rect.x + p.x * rect.width},${rect.y + p.y * rect.height}`).join(' '),
    };
  });

  if (error) return <ErrorView error={error} onRetry={refresh} />;
  if (data === null) return <EmptyState icon="file-hidden" title="Page not found" actionLabel="Go back" onAction={() => goBack()} />;

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainer({ width, height });
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-black">
      <View className="flex-1" style={{ margin: PADDING }} onLayout={onLayout}>
        {data ? (
          <Image source={{ uri: data.page.originalUri }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel="Original page" />
        ) : null}
        {rect ? (
          <>
            <Svg style={{ position: 'absolute', inset: 0 }} pointerEvents="none">
              <AnimatedPolygon animatedProps={polygonProps} fill={`${colors.primary}33`} stroke={colors.primary} strokeWidth={2} />
            </Svg>
            {CORNER_LABELS.map((label, i) => (
              <Handle key={label} quad={quad} index={i} rect={rect} label={label} />
            ))}
          </>
        ) : null}
      </View>
      <View className="flex-row gap-3 bg-surface px-4 py-3">
        <Button label="Reset" variant="secondary" icon="crop-free" onPress={() => quad.set(FULL_PAGE_QUAD)} />
        <Button label="Apply" icon="check" onPress={() => apply.run()} loading={apply.pending} className="flex-1" />
      </View>
    </SafeAreaView>
  );
}
