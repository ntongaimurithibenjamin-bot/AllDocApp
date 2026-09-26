import { Appearance } from 'react-native';

import { getSetting, setSetting } from '@/db/repositories/settings';
import type { SqlDb } from '@/db/types';
import { nextThemeId, shouldRotateTheme } from '@/domain/themeRotation';
import { getActiveThemeId, setActiveTheme, THEME_IDS, type ThemePreference } from '@/theme';

/** Applies the user's theme choice app-wide; useColorScheme() and NativeWind follow it. */
export function applyThemePreference(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

/** Startup: applies the saved light/dark preference and theme, rotating first if the app was away long enough. */
export async function restoreAppearance(db: SqlDb): Promise<void> {
  const [preference, themeId] = await Promise.all([getSetting(db, 'themePreference'), getSetting(db, 'themeId')]);
  applyThemePreference(preference);
  setActiveTheme(themeId);
  await rotateThemeIfAway(db);
}

/** Records that the app went to the background, so a later return can tell how long it was away. */
export async function markAppLeft(db: SqlDb, now = Date.now()): Promise<void> {
  await setSetting(db, 'themeLeftAt', now);
}

/** On return (or cold start): moves to the next theme when rotation is on and the app was away 5+ minutes. */
export async function rotateThemeIfAway(db: SqlDb, now = Date.now()): Promise<void> {
  const [enabled, leftAt] = await Promise.all([getSetting(db, 'themeAutoRotate'), getSetting(db, 'themeLeftAt')]);
  if (leftAt === null) return;
  await setSetting(db, 'themeLeftAt', null);
  if (!shouldRotateTheme(enabled, leftAt, now)) return;
  await selectTheme(db, nextThemeId(getActiveThemeId(), THEME_IDS));
}

export async function selectTheme(db: SqlDb, themeId: string): Promise<void> {
  setActiveTheme(themeId);
  await setSetting(db, 'themeId', getActiveThemeId());
}
