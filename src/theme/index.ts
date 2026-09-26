import { useMemo, useSyncExternalStore } from 'react';
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

export interface AppTheme {
  id: string;
  name: string;
  light: ThemeColors;
  dark: ThemeColors;
}

export const THEMES = paletteModule.themes as [AppTheme, ...AppTheme[]];
export const THEME_IDS = THEMES.map((theme) => theme.id);
export const DEFAULT_THEME_ID = THEMES[0].id;

export function findTheme(id: string | null | undefined): AppTheme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

function toVars(colors: ThemeColors) {
  return vars(
    Object.fromEntries(
      Object.entries(colors).map(([name, hex]) => [`--color-${name}`, paletteModule.hexToRgbChannels(hex)]),
    ),
  );
}

const cssVars = new Map(THEMES.map((theme) => [theme.id, { light: toVars(theme.light), dark: toVars(theme.dark) }]));

// The active theme lives outside React so every useTheme() (including the error boundary, which
// renders outside the providers) follows it without a context.
let activeThemeId = DEFAULT_THEME_ID;
const listeners = new Set<() => void>();

export function setActiveTheme(id: string): void {
  const next = findTheme(id).id;
  if (next === activeThemeId) return;
  activeThemeId = next;
  listeners.forEach((listener) => listener());
}

export function getActiveThemeId(): string {
  return activeThemeId;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resolved theme for the current appearance. The user's light/dark preference is applied app-wide
 * via Appearance.setColorScheme, so useColorScheme() already reflects it.
 */
export function useTheme() {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const themeId = useSyncExternalStore(subscribe, getActiveThemeId);
  return useMemo(() => {
    const theme = findTheme(themeId);
    return { scheme, themeId: theme.id, colors: theme[scheme], cssVars: cssVars.get(theme.id)![scheme] };
  }, [scheme, themeId]);
}
