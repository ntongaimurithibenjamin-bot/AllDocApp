import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';

export default function NotFoundScreen() {
  return (
    <View className="flex-1 justify-center bg-background">
      <Stack.Screen options={{ title: 'Not found' }} />
      <EmptyState
        icon="map-marker-question-outline"
        title="This page doesn't exist"
        actionLabel="Go home"
        onAction={() => router.replace('/')}
      />
    </View>
  );
}
