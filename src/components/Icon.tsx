import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

import { useTheme, type ThemeColors } from '@/theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface IconProps {
  name: IconName;
  size?: number;
  color?: keyof ThemeColors;
}

export function Icon({ name, size = 22, color = 'text' }: IconProps) {
  const { colors } = useTheme();
  return <MaterialCommunityIcons name={name} size={size} color={colors[color]} />;
}
