import { ScrollView, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';

interface Point {
  icon: IconName;
  title: string;
  body: string;
}

// Describes what this build actually does. Update it when features that use the network ship
// (AI actions, ads, subscriptions) — never promise more than the code guarantees.
const POINTS: Point[] = [
  {
    icon: 'cellphone-lock',
    title: 'Stored on your phone',
    body: 'Your documents, pages and search index are saved on this device. Docuna does not upload or sync them.',
  },
  {
    icon: 'account-off-outline',
    title: 'No account needed',
    body: 'You can use Docuna without signing up or signing in.',
  },
  {
    icon: 'magnify',
    title: 'Search stays local',
    body: 'Searches run on your phone against your own documents. What you type is not sent anywhere.',
  },
  {
    icon: 'share-variant-outline',
    title: 'You decide what leaves',
    body: 'A document only leaves your phone when you share or export it yourself.',
  },
];

export default function PrivacyScreen() {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pb-10 pt-4">
      {POINTS.map((point) => (
        <View key={point.title} className="mb-3 flex-row gap-4 rounded-2xl bg-surface p-4">
          <Icon name={point.icon} color="primary" />
          <View className="flex-1">
            <Text className="text-base font-semibold text-text">{point.title}</Text>
            <Text className="mt-1 text-sm text-muted">{point.body}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
