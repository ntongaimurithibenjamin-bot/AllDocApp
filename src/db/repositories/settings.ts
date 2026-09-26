import type { ThemePreference } from '@/theme';
import paletteModule from '@/theme/palette';

import { notifyChanged } from '../events';
import type { SqlDb } from '../types';

/** Every persisted setting, with its type and default. Add new settings here only. */
const DEFAULTS = {
  themePreference: 'system' as ThemePreference,
  /** Active colour theme (see src/theme/palette.js). */
  themeId: paletteModule.themes[0].id as string,
  /** Move to the next theme after the app has been away for 5+ minutes. */
  themeAutoRotate: true,
  /** When the app last went to the background (ms), for theme rotation; null once handled. */
  themeLeftAt: null as number | null,
  /** SAF directory URI where saved PDFs are mirrored; null = off. */
  autoExportDirectoryUri: null as string | null,
  analyticsEnabled: true,
  readerNightMode: false,
  /** Keep the screen on while a document is open in the reader. */
  readerKeepAwake: true,
  /** Recognise text in scans and PDFs on the device so they can be searched. */
  ocrEnabled: true,
};

export type Settings = typeof DEFAULTS;
export type SettingKey = keyof Settings;

export async function getSetting<K extends SettingKey>(db: SqlDb, key: K): Promise<Settings[K]> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return DEFAULTS[key];
  try {
    return JSON.parse(row.value) as Settings[K];
  } catch {
    return DEFAULTS[key];
  }
}

export async function setSetting<K extends SettingKey>(db: SqlDb, key: K, value: Settings[K]): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
  notifyChanged('settings');
}
