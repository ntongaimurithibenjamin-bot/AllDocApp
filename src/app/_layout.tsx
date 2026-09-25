import '../../global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { IncomingFilesHandler } from '@/components/IncomingFilesHandler';
import { OverlayProvider } from '@/components/overlay/OverlayProvider';
import { DatabaseProvider, useDatabase } from '@/db/DatabaseProvider';
import { getSetting } from '@/db/repositories/settings';
import { toAppError } from '@/domain/errors';
import { applyThemePreference } from '@/services/appearance';
import { purgeExpiredTrash } from '@/services/documents/lifecycle';
import { repairPdfThumbnails } from '@/services/pdf';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden (e.g. fast refresh); nothing to do.
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Suspense fallback={null}>
        <DatabaseProvider>
          <AppShell />
        </DatabaseProvider>
      </Suspense>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  const db = useDatabase();
  const { scheme, colors, cssVars } = useTheme();

  useEffect(() => {
    // Apply the saved theme before the splash screen hides, so the first frame is already right.
    getSetting(db, 'themePreference')
      .then(applyThemePreference)
      .catch(() => {})
      .finally(() => SplashScreen.hideAsync().catch(() => {}));
    // Housekeeping must never block startup.
    purgeExpiredTrash(db)
      .then(() => repairPdfThumbnails(db))
      .catch((error: unknown) => {
        if (__DEV__) console.warn('Startup housekeeping failed', error);
      });
  }, [db]);

  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
      },
    };
  }, [scheme, colors]);

  return (
    <View style={[{ flex: 1 }, cssVars]}>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <OverlayProvider>
        <IncomingFilesHandler />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="scan/index" options={{ title: 'Scan', presentation: 'modal' }} />
          <Stack.Screen name="scan/review" options={{ title: 'Review' }} />
          <Stack.Screen name="document/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="document/[id]/read" options={{ title: '' }} />
          <Stack.Screen name="document/[id]/pages" options={{ title: 'Pages' }} />
          <Stack.Screen name="document/[id]/page/[pageId]/index" options={{ title: '' }} />
          <Stack.Screen name="document/[id]/page/[pageId]/crop" options={{ title: 'Crop', presentation: 'fullScreenModal' }} />
          <Stack.Screen name="document/[id]/move" options={{ title: 'Move to folder', presentation: 'modal' }} />
          <Stack.Screen name="folders/[id]" options={{ title: '' }} />
          <Stack.Screen name="inbox" options={{ title: 'Inbox' }} />
          <Stack.Screen name="trash" options={{ title: 'Trash' }} />
          <Stack.Screen name="settings/storage" options={{ title: 'Storage' }} />
          <Stack.Screen name="settings/privacy" options={{ title: 'Privacy' }} />
        </Stack>
        </OverlayProvider>
      </ThemeProvider>
    </View>
  );
}

/** Last-resort boundary, including failures while opening or migrating the database. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useTheme();
  const appError = toAppError(error);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    if (__DEV__) console.error(error);
  }, [error]);

  return (
    <View
      accessibilityRole="alert"
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.background }}
    >
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }}>
        Docuna couldn’t start
      </Text>
      <Text style={{ color: colors.muted, fontSize: 15, marginTop: 8, textAlign: 'center' }}>
        {appError.userMessage} Your documents have not been changed.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{ marginTop: 24, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 }}
      >
        <Text style={{ color: colors['on-primary'], fontWeight: '600', fontSize: 16 }}>Try again</Text>
      </Pressable>
    </View>
  );
}
