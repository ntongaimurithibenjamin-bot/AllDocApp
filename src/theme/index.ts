import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { vars } from 'nativewind';

import paletteModule from './palette';

export type ColorScheme = 'light' | 'dark';
export type ThemePreference = ColorScheme | 'system';

type ColorName =
  | 'background'
  | 'surface'
  | 'surface-muted'
  | 'border'
  | 'text'
  | 'muted'
  | 'primary'
  | 'on-primary'
  | 'danger'
  | 'success'
  | 'warning';

export type ThemeColors = Record<ColorName, string>;

const palette = paletteModule.palette as Record<ColorScheme, ThemeColors>;

const cssVars: Record<ColorScheme, ReturnType<typeof vars>> = {
  light: toVars(palette.light),
  dark: toVars(palette.dark),
};

function toVars(colors: ThemeColors) {
  return vars(
    Object.fromEntries(
      Object.entries(colors).map(([name, hex]) => [
        `--color-${name}`,
        paletteModule.hexToRgbChannels(hex),
      ]),
    ),
  );
}

/**
 * Resolved theme for the current appearance. The user's preference is applied app-wide via
 * Appearance.setColorScheme, so useColorScheme() already reflects it.
 */
export function useTheme() {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return useMemo(
    () => ({ scheme, colors: palette[scheme], cssVars: cssVars[scheme] }),
    [scheme],
  );
}
