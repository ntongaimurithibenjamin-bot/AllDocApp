import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}

const CONTAINER: Record<Variant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-surface-muted',
  ghost: 'bg-transparent',
  danger: 'bg-danger',
};

const LABEL: Record<Variant, string> = {
  primary: 'text-on-primary',
  secondary: 'text-text',
  ghost: 'text-primary',
  danger: 'text-on-primary',
};

const ICON_COLOR = { primary: 'on-primary', secondary: 'text', ghost: 'primary', danger: 'on-primary' } as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  size = 'md',
  className = '',
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      android_ripple={{ color: colors.border }}
      className={`flex-row items-center justify-center overflow-hidden rounded-xl px-4 ${
        size === 'lg' ? 'min-h-14' : 'min-h-11'
      } ${CONTAINER[variant]} ${inactive ? 'opacity-50' : ''} ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={colors[ICON_COLOR[variant]]} />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon ? <Icon name={icon} size={size === 'lg' ? 24 : 20} color={ICON_COLOR[variant]} /> : null}
          <Text className={`font-semibold ${size === 'lg' ? 'text-lg' : 'text-base'} ${LABEL[variant]}`}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
