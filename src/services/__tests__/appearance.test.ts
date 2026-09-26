/**
 * @jest-environment node
 */
import { Appearance } from 'react-native';

import { createMigratedDb } from '@/db/__tests__/nodeSqlite';
import { getSetting, setSetting } from '@/db/repositories/settings';
import type { SqlDb } from '@/db/types';
import { nextThemeId, shouldRotateTheme, THEME_AWAY_MS } from '@/domain/themeRotation';
import { getActiveThemeId, setActiveTheme, THEME_IDS } from '@/theme';

import { markAppLeft, restoreAppearance, rotateThemeIfAway } from '../appearance';

jest.mock('nativewind', () => ({ vars: (values: object) => values }));

describe('theme rotation rules', () => {
  it('rotates only when enabled and away for at least five minutes', () => {
    const now = 1_000_000_000;
    expect(shouldRotateTheme(true, now - THEME_AWAY_MS, now)).toBe(true);
    expect(shouldRotateTheme(true, now - THEME_AWAY_MS + 1, now)).toBe(false);
    expect(shouldRotateTheme(false, now - 10 * THEME_AWAY_MS, now)).toBe(false);
    expect(shouldRotateTheme(true, null, now)).toBe(false);
    // Clock moved backwards: not "away".
    expect(shouldRotateTheme(true, now + 60_000, now)).toBe(false);
  });

  it('cycles through themes and wraps around', () => {
    expect(nextThemeId('a', ['a', 'b', 'c'])).toBe('b');
    expect(nextThemeId('c', ['a', 'b', 'c'])).toBe('a');
    expect(nextThemeId('gone', ['a', 'b', 'c'])).toBe('a');
  });
});

describe('appearance service', () => {
  let db: SqlDb;
  const now = 5_000_000_000;

  beforeEach(async () => {
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    db = await createMigratedDb();
    setActiveTheme(THEME_IDS[0]!);
  });

  it('moves to the next theme after five minutes away and saves it', async () => {
    await markAppLeft(db, now - THEME_AWAY_MS - 1);
    await rotateThemeIfAway(db, now);
    expect(getActiveThemeId()).toBe(THEME_IDS[1]);
    expect(await getSetting(db, 'themeId')).toBe(THEME_IDS[1]);
    expect(await getSetting(db, 'themeLeftAt')).toBeNull();
  });

  it('keeps the theme after a short trip away, and only rotates once per absence', async () => {
    await markAppLeft(db, now - 60_000);
    await rotateThemeIfAway(db, now);
    expect(getActiveThemeId()).toBe(THEME_IDS[0]);

    await markAppLeft(db, now - THEME_AWAY_MS);
    await rotateThemeIfAway(db, now);
    await rotateThemeIfAway(db, now + 1);
    expect(getActiveThemeId()).toBe(THEME_IDS[1]);
  });

  it('keeps the chosen theme when automatic refresh is off', async () => {
    await setSetting(db, 'themeAutoRotate', false);
    await markAppLeft(db, now - 10 * THEME_AWAY_MS);
    await rotateThemeIfAway(db, now);
    expect(getActiveThemeId()).toBe(THEME_IDS[0]);
  });

  it('restores the saved theme on startup, rotating if the app was closed long enough', async () => {
    await setSetting(db, 'themeId', THEME_IDS[2]!);
    await restoreAppearance(db);
    expect(getActiveThemeId()).toBe(THEME_IDS[2]);

    await markAppLeft(db, Date.now() - THEME_AWAY_MS - 1000);
    setActiveTheme(THEME_IDS[0]!);
    await restoreAppearance(db);
    expect(getActiveThemeId()).toBe(THEME_IDS[3]);
  });

  it('falls back to the first theme for an unknown saved id', async () => {
    await setSetting(db, 'themeId', 'retired-theme');
    await restoreAppearance(db);
    expect(getActiveThemeId()).toBe(THEME_IDS[0]);
  });
});
