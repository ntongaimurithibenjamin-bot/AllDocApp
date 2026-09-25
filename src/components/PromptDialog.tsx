import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { useTheme } from '@/theme';

import { Button } from './Button';

interface PromptDialogProps {
  visible: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  keyboardType?: KeyboardTypeOptions;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** Single text-field dialog (Alert.prompt is iOS-only). */
export function PromptDialog({ visible, onCancel, ...rest }: PromptDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      {/* Modal unmounts its children while hidden, so the field resets to initialValue on every open. */}
      {visible ? <PromptBody onCancel={onCancel} {...rest} /> : null}
    </Modal>
  );
}

function PromptBody({
  title,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  keyboardType,
  onConfirm,
  onCancel,
}: Omit<PromptDialogProps, 'visible'>) {
  const { colors } = useTheme();
  const [value, setValue] = useState(initialValue);

  const canConfirm = value.trim().length > 0;
  const confirm = () => {
    if (canConfirm) onConfirm(value);
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <Pressable accessibilityLabel="Close dialog" onPress={onCancel} className="flex-1 justify-center bg-black/50 px-6">
        <Pressable className="rounded-2xl bg-surface p-5">
          <Text accessibilityRole="header" className="mb-4 text-lg font-semibold text-text">
            {title}
          </Text>
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={confirm}
            maxLength={120}
            keyboardType={keyboardType}
            className="rounded-xl border border-border bg-background px-4 py-3 text-base text-text"
          />
          <View className="mt-5 flex-row justify-end gap-2">
            <Button label="Cancel" variant="ghost" onPress={onCancel} />
            <Button label={confirmLabel} onPress={confirm} disabled={!canConfirm} />
          </View>
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
