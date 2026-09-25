import { Text, View } from 'react-native';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="items-center px-8 py-12">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-surface-muted">
        <Icon name={icon} size={30} color="muted" />
      </View>
      <Text className="text-center text-lg font-semibold text-text">{title}</Text>
      {body ? <Text className="mt-2 text-center text-base text-muted">{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} className="mt-6" />
      ) : null}
    </View>
  );
}
