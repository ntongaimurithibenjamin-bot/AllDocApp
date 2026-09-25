import { Text, View } from 'react-native';

import type { AppError } from '@/domain/errors';

import { Button } from './Button';
import { Icon } from './Icon';

interface ErrorViewProps {
  error: Pick<AppError, 'userMessage'>;
  onRetry?: () => void;
}

export function ErrorView({ error, onRetry }: ErrorViewProps) {
  return (
    <View accessibilityRole="alert" className="items-center px-8 py-12">
      <Icon name="alert-circle-outline" size={36} color="danger" />
      <Text className="mt-3 text-center text-base text-text">{error.userMessage}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} className="mt-5" /> : null}
    </View>
  );
}
