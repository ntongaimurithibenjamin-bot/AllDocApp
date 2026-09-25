import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

interface SectionProps {
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Wrap children in a rounded surface card. */
  card?: boolean;
  children: ReactNode;
}

export function Section({ title, actionLabel, onAction, card = false, children }: SectionProps) {
  return (
    <View className="mt-6">
      {title ? (
        <View className="mb-2 flex-row items-center justify-between px-4">
          <Text accessibilityRole="header" className="text-sm font-semibold uppercase tracking-wide text-muted">
            {title}
          </Text>
          {actionLabel && onAction ? (
            <Pressable accessibilityRole="button" onPress={onAction} hitSlop={12}>
              <Text className="text-sm font-semibold text-primary">{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {card ? <View className="mx-4 overflow-hidden rounded-2xl bg-surface">{children}</View> : children}
    </View>
  );
}
