/** How long Docuna must be in the background before it comes back in the next theme. */
export const THEME_AWAY_MS = 5 * 60 * 1000;

/**
 * True when the theme should move on: rotation is on and the app was left at `leftAt` at least
 * `awayMs` ago. Never rotates while the app is in use; a clock set backwards counts as not away.
 */
export function shouldRotateTheme(enabled: boolean, leftAt: number | null, now: number, awayMs = THEME_AWAY_MS): boolean {
  if (!enabled || leftAt === null) return false;
  return now - leftAt >= awayMs;
}

/** The theme after `current` in `ids`, wrapping around; unknown ids start from the first. */
export function nextThemeId(current: string, ids: readonly string[]): string {
  if (ids.length === 0) return current;
  const index = ids.indexOf(current);
  return ids[(index + 1) % ids.length] ?? current;
}
