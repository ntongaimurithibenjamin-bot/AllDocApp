import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

const TOOLS: { label: string; icon: IconName; href: Href }[] = [
  { label: 'Merge', icon: 'file-multiple-outline', href: '/tools/merge' },
  { label: 'Extract', icon: 'file-export-outline', href: { pathname: '/tools/pick', params: { tool: 'extract' } } },
  { label: 'Compress', icon: 'arrow-collapse', href: { pathname: '/tools/pick', params: { tool: 'compress' } } },
  { label: 'Rotate', icon: 'file-rotate-right-outline', href: { pathname: '/tools/pick', params: { tool: 'rotate' } } },
];

/** Home shortcut row for the PDF tools. */
export function ToolsStrip() {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-4">
      {TOOLS.map((tool) => (
        <Pressable
          key={tool.label}
          accessibilityRole="button"
          accessibilityLabel={`${tool.label} PDFs`}
          onPress={() => router.push(tool.href)}
          android_ripple={{ color: colors.border }}
          className="w-28 items-center overflow-hidden rounded-2xl bg-surface px-2 py-4"
        >
          <View className="h-11 w-11 items-center justify-center rounded-full bg-primary/15">
            <Icon name={tool.icon} color="primary" />
          </View>
          <Text numberOfLines={1} className="mt-2 text-sm font-medium text-text">
            {tool.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
