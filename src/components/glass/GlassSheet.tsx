import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useTheme } from '@/theme';

/** Real blur needs Android 12+ (RenderNode); older phones get a denser frosted panel instead. */
const SUPPORTS_BLUR = Platform.OS !== 'android' || Number(Platform.Version) >= 31;
const OPEN_SPRING = { damping: 22, stiffness: 220, mass: 0.9 } as const;
const CLOSE_MS = 220;
/** Drag past this fraction of the sheet's height (or flick) to dismiss. */
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 900;
const OFFSCREEN = 2000;

interface GlassSheetProps {
  visible: boolean;
  /** Requests closing (drag, backdrop tap, back button). The parent sets `visible` to false. */
  onClose: () => void;
  /** Content behind the sheet, wrapped in a BlurTargetView, which the glass blurs. */
  blurTarget: RefObject<View | null>;
  title?: string;
  subtitle?: string;
  /**
   * Set when the content scrolls: dragging to dismiss then starts from the handle/title only, so it
   * doesn't fight the list's own scrolling.
   */
  scrollable?: boolean;
  children: ReactNode;
}

/**
 * Floating frosted-glass bottom sheet. Drag it down (or flick) to dismiss; it springs back
 * otherwise. Rendered inside the screen (not a Modal) so it can blur the content behind it.
 */
export function GlassSheet({ visible, onClose, blurTarget, title, subtitle, scrollable = false, children }: GlassSheetProps) {
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(OFFSCREEN);
  const sheetHeight = useSharedValue(0);
  const entered = useSharedValue(false);

  // Stay mounted while the close animation plays.
  const [mounted, setMounted] = useState(visible);
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setMounted(true);
  }

  useEffect(() => {
    if (visible) return;
    translateY.set(
      withTiming(sheetHeight.get() || OFFSCREEN, { duration: CLOSE_MS }, (finished) => {
        if (!finished) return;
        entered.set(false);
        scheduleOnRN(setMounted, false);
      }),
    );
  }, [visible, translateY, sheetHeight, entered]);

  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [visible, onClose]);

  const onLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    sheetHeight.set(height);
    if (!entered.get() && visible) {
      entered.set(true);
      translateY.set(height);
      translateY.set(withSpring(0, OPEN_SPRING));
    }
  };

  const dismissByGesture = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onClose();
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      // Follow the finger downwards; resist (rubber-band) upwards.
      translateY.set(event.translationY > 0 ? event.translationY : event.translationY * 0.15);
    })
    .onEnd((event) => {
      const height = sheetHeight.get();
      if (event.translationY > height * DISMISS_FRACTION || event.velocityY > DISMISS_VELOCITY) {
        scheduleOnRN(dismissByGesture);
      } else {
        translateY.set(withSpring(0, OPEN_SPRING));
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, Math.max(sheetHeight.get(), 1)], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  const dark = scheme === 'dark';
  const glassTint = dark
    ? `rgba(18, 22, 28, ${SUPPORTS_BLUR ? 0.55 : 0.92})`
    : `rgba(255, 255, 255, ${SUPPORTS_BLUR ? 0.55 : 0.94})`;
  const edge = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)';

  const header = (
    <View>
      <View className="items-center pb-1 pt-2.5">
        <View className={`h-1.5 w-10 rounded-full ${dark ? 'bg-white/30' : 'bg-black/20'}`} />
      </View>
      {title ? (
        <View className="px-5 pb-2 pt-1">
          <Text accessibilityRole="header" numberOfLines={1} textBreakStrategy="simple" className="text-lg font-semibold text-text">
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} textBreakStrategy="simple" className="mt-0.5 text-sm text-muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const sheet = (
    <Animated.View
      accessibilityViewIsModal
      onLayout={onLayout}
      style={[styles.sheet, { bottom: insets.bottom + 10, borderColor: edge, maxHeight: '75%' }, sheetStyle]}
    >
      {SUPPORTS_BLUR ? (
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={60}
          tint={dark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: glassTint }]} />
      {scrollable ? <GestureDetector gesture={pan}>{header}</GestureDetector> : header}
      {children}
    </Animated.View>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      </Animated.View>

      {scrollable ? sheet : <GestureDetector gesture={pan}>{sheet}</GestureDetector>}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    paddingBottom: 12,
    elevation: 24,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
});
