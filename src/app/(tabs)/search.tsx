import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { kindIcon } from '@/components/documentKind';
import { EmptyState } from '@/components/EmptyState';
import { ErrorView } from '@/components/ErrorView';
import { Icon } from '@/components/Icon';
import { countPendingOcrPages } from '@/db/repositories/ocr';
import { searchDocuments } from '@/db/repositories/search';
import { getSetting } from '@/db/repositories/settings';
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

function SearchResult({ hit, query }: { hit: SearchHit; query: string }) {
  const { colors } = useTheme();
  const more = hit.pageMatches - 1;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/document/[id]/read',
          params: hit.pageNumber ? { id: hit.documentId, page: String(hit.pageNumber), q: query } : { id: hit.documentId },
        })
      }
      android_ripple={{ color: colors.border }}
      className="flex-row gap-4 px-4 py-3"
    >
      <Icon name={kindIcon(hit.kind)} color="muted" />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-base font-medium text-text">
          {hit.title}
        </Text>
        {hit.pageNumber !== null ? (
          <Text className="text-sm text-primary">
            Page {hit.pageNumber}
            {more > 0 ? ` · ${more} more ${more === 1 ? 'page' : 'pages'}` : ''}
          </Text>
        ) : null}
        {hit.snippet ? <Snippet text={hit.snippet} /> : null}
      </View>
    </Pressable>
  );
}

/** Tells the user why a fresh scan may not be searchable yet. */
function OcrStatusLine() {
  const { data } = useDbQuery(
    async (db) => ({ pending: await countPendingOcrPages(db), enabled: await getSetting(db, 'ocrEnabled') }),
    [],
    ['ocr', 'pages', 'documents', 'settings'],
  );
  if (!data || data.pending === 0) return null;
  return (
    <View className="mx-4 mt-2 flex-row items-center gap-2">
      <Icon name={data.enabled ? 'text-recognition' : 'pause-circle-outline'} size={16} color="muted" />
      <Text className="flex-1 text-sm text-muted">
        {data.enabled
          ? `Reading text in ${data.pending} ${data.pending === 1 ? 'page' : 'pages'}… they become searchable as they’re done.`
          : `Text recognition is off, so ${data.pending} ${data.pending === 1 ? 'page isn’t' : 'pages aren’t'} searchable yet. Turn it on in Settings.`}
      </Text>
    </View>
  );
}

export default function SearchScreen() {
  const { colors } = useTheme();
  const [input, setInput] = useState('');
  const query = useDebounced(input.trim(), DEBOUNCE_MS);
  const { data, error, refresh } = useDbQuery(
    (db) => (query ? searchDocuments(db, query) : Promise.resolve([])),
    [query],
    ['documents', 'ocr'],
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

      <OcrStatusLine />

      {error ? (
        <ErrorView error={error} onRetry={refresh} />
      ) : !query ? (
        <EmptyState
          icon="text-search"
          title="Search works offline"
          body="Find documents by title or by any word on their pages: scans, PDFs and text files. Try an amount like “KSh 25,000”. Nothing you type leaves your phone."
        />
      ) : (
        <FlashList
          data={data ?? []}
          keyExtractor={(hit) => hit.documentId}
          renderItem={({ item }) => <SearchResult hit={item} query={query} />}
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
