import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';

/**
 * Entry point of the scan flow. The on-device document scanner (ML Kit) ships with the native
 * module in the next build, so this screen says so instead of pretending to scan.
 */
export default function ScanScreen() {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-grow justify-center px-8 py-12">
      <View className="items-center">
        <View className="mb-5 h-20 w-20 items-center justify-center rounded-full bg-surface-muted">
          <Icon name="scan-helper" size={40} color="primary" />
        </View>
        <Text accessibilityRole="header" className="text-center text-xl font-semibold text-text">
          Scanner not available in this build
        </Text>
        <Text className="mt-3 text-center text-base text-muted">
          Docuna's scanner runs entirely on your phone, with automatic edge detection, multi-page capture and
          cleanup filters. It needs a native build of the app, which is the next step in development.
        </Text>
        <Button label="Close" variant="secondary" onPress={() => router.back()} className="mt-8 self-stretch" />
      </View>
    </ScrollView>
  );
}
