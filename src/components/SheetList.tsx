import { FlashList } from '@shopify/flash-list';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';

export interface SheetItem {
  key: string;
  label: string;
  icon?: IconName;
  detail?: string;
  /** Indentation level (e.g. nested table-of-contents entries). */
  depth?: number;
  destructive?: boolean;
  onPress: () => void;
}

interface SheetListProps {
  visible: boolean;
  title?: string;
  items: SheetItem[];
  emptyText?: string;
  onClose: () => void;
}

/** Bottom sheet with a list of actions or destinations; tapping an item closes the sheet. */
export function SheetList({ visible, title, items, emptyText, onClose }: SheetListProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" onPress={onClose} className="flex-1 bg-black/40" />
      <SafeAreaView edges={['bottom']} className="max-h-[70%] rounded-t-2xl bg-surface">
        <View className="items-center pt-2">
          <View className="h-1 w-10 rounded-full bg-border" />
        </View>
        {title ? (
          <Text accessibilityRole="header" className="px-5 pb-2 pt-3 text-base font-semibold text-text">
            {title}
          </Text>
        ) : null}
        {items.length === 0 ? (
          <Text className="px-5 pb-8 pt-2 text-base text-muted">{emptyText ?? 'Nothing here yet.'}</Text>
        ) : (
          <View style={{ minHeight: Math.min(items.length, 8) * 52 }}>
            <FlashList
              data={items}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onClose();
                    item.onPress();
                  }}
                  className="min-h-13 flex-row items-center gap-4 py-3 pr-5"
                  style={{ paddingLeft: 20 + (item.depth ?? 0) * 16 }}
                >
                  {item.icon ? <Icon name={item.icon} color={item.destructive ? 'danger' : 'muted'} /> : null}
                  <Text numberOfLines={2} className={`flex-1 text-base ${item.destructive ? 'text-danger' : 'text-text'}`}>
                    {item.label}
                  </Text>
                  {item.detail ? <Text className="text-sm text-muted">{item.detail}</Text> : null}
                </Pressable>
              )}
            />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}
