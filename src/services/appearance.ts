import { Appearance } from 'react-native';

import type { ThemePreference } from '@/theme';

/** Applies the user's theme choice app-wide; useColorScheme() and NativeWind follow it. */
export function applyThemePreference(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}
