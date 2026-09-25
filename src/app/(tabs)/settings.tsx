import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { Section } from '@/components/Section';
import { createDocument } from '@/db/repositories/documents';
import { getSetting, setSetting } from '@/db/repositories/settings';
import { defaultScanTitle } from '@/domain/validation';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { applyThemePreference } from '@/services/appearance';
import type { ThemePreference } from '@/theme';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const db = useDb();
  const theme = useDbQuery((d) => getSetting(d, 'themePreference'), [], ['settings']);

  const chooseTheme = useAsyncAction(async (preference: ThemePreference) => {
    await setSetting(db, 'themePreference', preference);
    applyThemePreference(preference);
  });

  const createTestDocument = useAsyncAction(async () => {
    const document = await createDocument(db, { title: defaultScanTitle(), source: 'scan' });
    router.push(`/document/${document.id}`);
  });

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      <Section title="Appearance" card>
        {THEME_OPTIONS.map(({ value, label }) => {
          const selected = theme.data === value;
          return (
            <ListRow
              key={value}
              title={label}
              onPress={() => chooseTheme.run(value)}
              accessory={<Icon name={selected ? 'radiobox-marked' : 'radiobox-blank'} color={selected ? 'primary' : 'muted'} />}
            />
          );
        })}
      </Section>

      <Section title="Documents" card>
        <ListRow icon="harddisk" title="Storage" onPress={() => router.push('/settings/storage')} />
        <ListRow icon="delete-outline" title="Trash" onPress={() => router.push('/trash')} />
      </Section>

      <Section title="Privacy" card>
        <ListRow
          icon="shield-lock-outline"
          title="How Docuna handles your data"
          onPress={() => router.push('/settings/privacy')}
        />
      </Section>

      {__DEV__ ? (
        <Section title="Developer" card>
          <ListRow
            icon="flask-outline"
            title="Create empty test document"
            subtitle="Development builds only"
            onPress={() => createTestDocument.run()}
            disabled={createTestDocument.pending}
          />
        </Section>
      ) : null}

      <Text className="mt-8 text-center text-sm text-muted">
        Docuna {Constants.expoConfig?.version ?? ''} · Variety Tech
      </Text>
    </ScrollView>
  );
}
