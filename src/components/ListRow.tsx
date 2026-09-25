import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme, type ThemeColors } from '@/theme';

import { Icon, type IconName } from './Icon';

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconColor?: keyof ThemeColors;
  /** Rendered on the right; defaults to a chevron when the row is pressable. */
  accessory?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  accessory,
  onPress,
  onLongPress,
  destructive = false,
  disabled = false,
}: ListRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={disabled || (!onPress && !onLongPress)}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: colors.border }}
      className={`min-h-14 flex-row items-center gap-4 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}
    >
      {icon ? <Icon name={icon} color={iconColor ?? (destructive ? 'danger' : 'muted')} /> : null}
      <View className="flex-1">
        <Text numberOfLines={1} className={`text-base ${destructive ? 'text-danger' : 'text-text'}`}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} className="mt-0.5 text-sm text-muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {accessory ?? (onPress ? <Icon name="chevron-right" color="muted" /> : null)}
    </Pressable>
  );
}
