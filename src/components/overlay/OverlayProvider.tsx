import { BlurTargetView, BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
// Gesture-handler Pressable: native hit-testing, reliable for views layered over the navigator.
import { Pressable } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { GlassDivider, GlassRow } from '@/components/glass/GlassItems';
import { GlassSheet } from '@/components/glass/GlassSheet';
import type { IconName } from '@/components/Icon';
import { PromptDialog } from '@/components/PromptDialog';
import { useTheme } from '@/theme';

export interface OverlayAction {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  /** Runs after the sheet has started closing. */
  onPress: () => void;
}

interface ActionSheetOptions {
  title?: string;
  subtitle?: string;
  actions: OverlayAction[];
}

interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds; default 4 s (6 s when there is an action to take). */
  duration?: number;
}

interface PromptOptions {
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void | Promise<unknown>;
}

interface OverlayApi {
  showActions: (options: ActionSheetOptions) => void;
  showToast: (options: ToastOptions) => void;
  showPrompt: (options: PromptOptions) => void;
}

const OverlayContext = createContext<OverlayApi | null>(null);

const SUPPORTS_BLUR = Platform.OS !== 'android' || Number(Platform.Version) >= 31;

/**
 * App-wide glass overlays: action sheets (e.g. long-press on a document), toasts with an optional
 * action (Undo), and a text prompt. Wraps the app in a blur target so glass surfaces blur whatever
 * is behind them, including the tab bar.
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const blurTarget = useRef<View>(null);
  const [sheet, setSheet] = useState<ActionSheetOptions | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const [prompt, setPrompt] = useState<PromptOptions | null>(null);

  const showActions = useCallback((options: ActionSheetOptions) => {
    Haptics.selectionAsync().catch(() => {});
    setSheet(options);
    setSheetVisible(true);
  }, []);
  const showToast = useCallback((options: ToastOptions) => setToast({ ...options, id: Date.now() }), []);
  const showPrompt = useCallback((options: PromptOptions) => setPrompt(options), []);
  const api = useMemo(() => ({ showActions, showToast, showPrompt }), [showActions, showToast, showPrompt]);

  const closeSheet = useCallback(() => setSheetVisible(false), []);
  const clearToast = useCallback(() => setToast(null), []);

  return (
    <OverlayContext value={api}>
      <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
        {children}
      </BlurTargetView>

      <GlassSheet visible={sheetVisible} onClose={closeSheet} blurTarget={blurTarget} title={sheet?.title} subtitle={sheet?.subtitle}>
        {sheet?.actions.map((action, index) => (
          <View key={action.key}>
            {action.destructive && index > 0 ? <GlassDivider /> : null}
            <GlassRow
              icon={action.icon}
              label={action.label}
              destructive={action.destructive}
              onPress={() => {
                closeSheet();
                action.onPress();
              }}
            />
          </View>
        ))}
      </GlassSheet>

      {toast ? <Toast key={toast.id} options={toast} blurTarget={blurTarget} onDone={clearToast} /> : null}

      <PromptDialog
        visible={prompt !== null}
        title={prompt?.title ?? ''}
        initialValue={prompt?.initialValue}
        placeholder={prompt?.placeholder}
        confirmLabel={prompt?.confirmLabel}
        onCancel={() => setPrompt(null)}
        onConfirm={async (value) => {
          const current = prompt;
          setPrompt(null);
          await current?.onConfirm(value);
        }}
      />
    </OverlayContext>
  );
}

function Toast({
  options,
  blurTarget,
  onDone,
}: {
  options: ToastOptions;
  blurTarget: React.RefObject<View | null>;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const dark = scheme === 'dark';
  const progress = useSharedValue(0);

  // Slides/fades out, then unmounts. Driven by an animated style (not a layout animation) so the
  // toast is always hit-testable and its action button receives taps.
  const hide = useCallback(() => {
    progress.set(
      withTiming(0, { duration: 180 }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      }),
    );
  }, [progress, onDone]);

  useEffect(() => {
    progress.set(withSpring(1, { damping: 18, stiffness: 220 }));
    const timer = setTimeout(hide, options.duration ?? (options.onAction ? 6000 : 4000));
    return () => clearTimeout(timer);
  }, [progress, hide, options]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 24 }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[styles.toast, { bottom: insets.bottom + 76, borderColor: dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)' }, animatedStyle]}
      >
        {SUPPORTS_BLUR ? (
          <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={60} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dark ? `rgba(18,22,28,${SUPPORTS_BLUR ? 0.6 : 0.94})` : `rgba(255,255,255,${SUPPORTS_BLUR ? 0.6 : 0.96})` },
          ]}
        />
        <Text className="flex-1 text-base text-text" numberOfLines={2}>
          {options.message}
        </Text>
        {options.actionLabel && options.onAction ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => {
              options.onAction?.();
              hide();
            }}
            style={styles.toastAction}
          >
            <Text className="text-base font-semibold text-primary">{options.actionLabel}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

export function useOverlay(): OverlayApi {
  const api = useContext(OverlayContext);
  if (!api) throw new Error('useOverlay must be used inside <OverlayProvider>');
  return api;
}

const styles = StyleSheet.create({
  toastAction: { marginLeft: 12, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    elevation: 16,
  },
});
