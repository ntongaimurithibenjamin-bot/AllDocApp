import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

/** Round quick-action toggle for the top of a glass sheet (lit when active). */
export function GlassTile({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const { scheme } = useTheme();
  const idle = scheme === 'dark' ? 'bg-white/10' : 'bg-black/5';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="flex-1 items-center"
    >
      {({ pressed }) => (
        <>
          <View
            className={`h-14 w-14 items-center justify-center rounded-2xl ${active ? 'bg-primary' : idle}`}
            style={{ transform: [{ scale: pressed ? 0.92 : 1 }] }}
          >
            <Icon name={icon} size={24} color={active ? 'on-primary' : 'text'} />
          </View>
          <Text
            numberOfLines={2}
            textBreakStrategy="simple"
            className={`mt-1.5 px-0.5 text-center text-xs ${active ? 'font-semibold text-primary' : 'text-text'}`}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function GlassTileRow({ children }: { children: ReactNode }) {
  return <View className="flex-row gap-1 px-3 pb-3 pt-2">{children}</View>;
}

/** A tappable row in a glass sheet. */
export function GlassRow({
  icon,
  label,
  detail,
  indent = 0,
  destructive = false,
  onPress,
}: {
  icon?: IconName;
  label: string;
  detail?: string;
  indent?: number;
  destructive?: boolean;
  onPress: () => void;
}) {
  const { scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      android_ripple={{ color: scheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }}
      className="min-h-12 flex-row items-center gap-4 py-3 pl-5 pr-5"
    >
      {indent > 0 ? <View style={{ width: indent * 16 }} /> : null}
      {icon ? <Icon name={icon} color={destructive ? 'danger' : 'muted'} /> : null}
      <Text numberOfLines={2} textBreakStrategy="simple" className={`flex-1 text-base ${destructive ? 'text-danger' : 'text-text'}`}>
        {label}
      </Text>
      {detail ? (
        <Text numberOfLines={1} className="shrink-0 text-sm text-muted">
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function GlassDivider() {
  const { scheme } = useTheme();
  return <View className={`mx-5 my-1 h-px ${scheme === 'dark' ? 'bg-white/10' : 'bg-black/10'}`} />;
}

/** Scrollable list body for long sheets (contents, bookmarks); the drag stays on the header. */
export function GlassList({ children, empty }: { children: ReactNode; empty?: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!hasChildren) {
    return (
      <Text textBreakStrategy="simple" className="px-5 pb-4 pt-1 text-base text-muted">
        {empty ?? 'Nothing here yet.'}
      </Text>
    );
  }
  return <ScrollView bounces={false}>{children}</ScrollView>;
}
