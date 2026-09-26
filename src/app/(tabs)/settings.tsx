import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import { Section } from '@/components/Section';
import { createDocument } from '@/db/repositories/documents';
import { getSetting, setSetting } from '@/db/repositories/settings';
import { defaultScanTitle } from '@/domain/validation';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useDb, useDbQuery } from '@/hooks/useDbQuery';
import { applyThemePreference, selectTheme } from '@/services/appearance';
import { THEMES, useTheme, type ThemePreference } from '@/theme';

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

  const { scheme, themeId, colors } = useTheme();
  const autoRotate = useDbQuery((d) => getSetting(d, 'themeAutoRotate'), [], ['settings']);
  const pickTheme = useAsyncAction((id: string) => selectTheme(db, id));
  const ocrEnabled = useDbQuery((d) => getSetting(d, 'ocrEnabled'), [], ['settings']);
  const toggleOcr = useAsyncAction(() => setSetting(db, 'ocrEnabled', !(ocrEnabled.data ?? true)));
  const toggleRotation =useAsyncAction(() => setSetting(db, 'themeAutoRotate', !(autoRotate.data ?? true)));

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

      <Section title="Theme" card>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-4 pb-2 pt-4">
          {THEMES.map((option) => {
            const selected = option.id === themeId;
            const swatch = option[scheme];
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.name} theme`}
                onPress={() => pickTheme.run(option.id)}
                className="w-20 items-center"
              >
                <View
                  className={`h-16 w-16 items-center justify-center rounded-2xl border-2 ${selected ? 'border-primary' : 'border-border'}`}
                  style={{ backgroundColor: swatch.background }}
                >
                  <View className="h-7 w-7 rounded-full" style={{ backgroundColor: swatch.primary }} />
                  <View className="mt-1.5 h-1.5 w-8 rounded-full" style={{ backgroundColor: swatch.surface }} />
                </View>
                <Text numberOfLines={1} className={`mt-1.5 w-full text-center text-sm ${selected ? 'font-semibold text-text' : 'text-muted'}`}>
                  {option.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ListRow
          title="Refresh theme automatically"
          subtitle="Switch to the next theme when you come back after 5 minutes away"
          onPress={() => toggleRotation.run()}
          accessory={
            <Switch
              value={autoRotate.data ?? true}
              onValueChange={() => {
                toggleRotation.run();
              }}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={(autoRotate.data ?? true) ? '#FFFFFF' : colors.muted}
              accessibilityLabel="Refresh theme automatically"
            />
          }
        />
      </Section>

      <Section title="Text recognition" card>
        <ListRow
          icon="text-recognition"
          title="Make documents searchable"
          subtitle="Reads the words in scans and PDFs on this phone while Docuna is open. Nothing is uploaded."
          onPress={() => toggleOcr.run()}
          accessory={
            <Switch
              value={ocrEnabled.data ?? true}
              onValueChange={() => {
                toggleOcr.run();
              }}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={(ocrEnabled.data ?? true) ? '#FFFFFF' : colors.muted}
              accessibilityLabel="Make documents searchable"
            />
          }
        />
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
