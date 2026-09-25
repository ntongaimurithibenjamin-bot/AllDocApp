import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme';

function tabIcon(name: IconName, focusedName: IconName) {
  return function TabIcon({ color, focused }: { color: string; focused: boolean }) {
    return <MaterialCommunityIcons name={focused ? focusedName : name} size={24} color={color} />;
  };
}

function ScanTabIcon() {
  return (
    <View className="h-12 w-12 items-center justify-center rounded-full bg-primary">
      <Icon name="scan-helper" size={26} color="on-primary" />
    </View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', headerShown: false, tabBarIcon: tabIcon('home-outline', 'home') }}
      />
      <Tabs.Screen
        name="documents"
        options={{ title: 'Documents', tabBarIcon: tabIcon('folder-outline', 'folder') }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: 'Scan a document',
          tabBarIcon: ScanTabIcon,
        }}
        listeners={{
          // Scanning is a full-screen flow, not a tab: open it on top of the current tab.
          tabPress: (event) => {
            event.preventDefault();
            router.push('/scan');
          },
        }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Search', tabBarIcon: tabIcon('magnify', 'magnify') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('cog-outline', 'cog') }}
      />
    </Tabs>
  );
}
