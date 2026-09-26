import { router, type Href } from 'expo-router';

/**
 * Goes back when there is somewhere to go back to; otherwise replaces the screen with `fallback`.
 * Screens opened from a deep link, a shared file or after `router.replace` have no history, and a
 * bare `router.back()` there throws "GO_BACK was not handled by any navigator".
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
