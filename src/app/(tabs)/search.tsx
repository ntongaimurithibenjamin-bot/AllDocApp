import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { searchDocuments } from '@/db/repositories/search';
import type { SearchHit } from '@/domain/models';
import { useDbQuery } from '@/hooks/useDbQuery';
import { useTheme } from '@/theme';

const DEBOUNCE_MS = 150;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Renders an FTS snippet, bolding the [matched] terms. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]*\])/g);
  return (
    <Text numberOfLines={2} className="mt-1 text-sm text-muted">
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <Text key={i} className="font-semibold text-text">
            {part.slice(1, -1)}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function SearchResult({ hit }: { hit: SearchHit }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/document/${hit.documentId}`)}
      android_ripple={{ color: colors.border }}
      className="flex-row gap-4 px-4 py-3"
    >
      <Icon name="file-document-outline" color="muted" />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-base font-medium text-text">
          {hit.title}
        </Text>
        {hit.pageNumber !== null ? <Text className="text-xs text-primary">Page {hit.pageNumber}</Text> : null}
        {hit.snippet ? <Snippet text={hit.snippet} /> : null}
      </View>
    </Pressable>
  );
}

export default function SearchScreen() {
  const { colors } = useTheme();
  const [input, setInput] = useState('');
  const query = useDebounced(input.trim(), DEBOUNCE_MS);
  const { data, error, refresh } = useDbQuery(
    (db) => (query ? searchDocuments(db, query) : Promise.resolve([])),
    [query],
    ['documents', 'pages'],
  );

  return (
    <View className="flex-1 bg-background">
      <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-xl bg-surface px-4">
        <Icon name="magnify" color="muted" />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Search titles and text"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search documents"
          className="flex-1 py-3 text-base text-text"
        />
        {input ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={12} onPress={() => setInput('')}>
            <Icon name="close-circle" color="muted" size={20} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <ErrorView error={error} onRetry={refresh} />
      ) : !query ? (
        <EmptyState
          icon="text-search"
          title="Search works offline"
          body="Search by title, or by words inside your scanned pages once text recognition has run. Nothing you type leaves your phone."
        />
      ) : (
        <FlashList
          data={data ?? []}
          keyExtractor={(hit) => hit.documentId}
          renderItem={({ item }) => <SearchResult hit={item} />}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            data ? <EmptyState icon="file-search-outline" title="No matches" body={`Nothing found for "${query}".`} /> : null
          }
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        />
      )}
    </View>
  );
}
