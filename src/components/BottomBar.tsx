import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Action bar pinned to the bottom of a screen. Android draws apps edge-to-edge, so the bar pads
 * itself above the system navigation buttons / gesture area.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={{ bottom: 'maximum' }} className="flex-row gap-3 border-t border-border bg-surface px-4 pb-3 pt-3">
      {children}
    </SafeAreaView>
  );
}
