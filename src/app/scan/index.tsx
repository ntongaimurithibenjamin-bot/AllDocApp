import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { toAppError, type AppError } from '@/domain/errors';
import { defaultScanTitle } from '@/domain/validation';
import { useDb } from '@/hooks/useDbQuery';
import { goBack } from '@/lib/navigation';
import { createDocumentFromImages, importImagesIntoDocument, replacePageImage } from '@/services/pages/pageService';
import {
  captureWithCamera,
  getScannerAvailability,
  pickImages,
  scanWithScanner,
  type ScannerAvailability,
} from '@/services/scanner';

/**
 * Entry point for every capture:
 *   /scan                              → new document, then review
 *   /scan?documentId=…&at=…            → add pages to a document
 *   /scan?replacePageId=…              → replace one page's image
 * With the ML Kit scanner available, it opens immediately — no extra screen to tap through.
 */
type Params = { documentId?: string; at?: string; replacePageId?: string };
type Source = 'scanner' | 'camera' | 'photos';

type State =
  | { phase: 'checking' }
  | { phase: 'choose'; availability: ScannerAvailability; error?: AppError; scannerFailed?: boolean }
  | { phase: 'capturing' }
  | { phase: 'saving'; done: number; total: number };

export default function ScanScreen() {
  const db = useDb();
  const params = useLocalSearchParams<Params>();
  const [state, setState] = useState<State>({ phase: 'checking' });
  const replacing = Boolean(params.replacePageId);

  const saveCapture = async (uris: string[], source: Source) => {
    setState({ phase: 'saving', done: 0, total: uris.length });
    const succeeded = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const onProgress = (done: number, total: number) => setState({ phase: 'saving', done, total });

    if (params.replacePageId) {
      await replacePageImage(db, params.replacePageId, uris[0]!);
      succeeded();
      goBack();
    } else if (params.documentId) {
      const at = params.at !== undefined ? Number(params.at) : undefined;
      await importImagesIntoDocument(db, params.documentId, uris, { atPosition: at, onProgress });
      succeeded();
      goBack();
    } else {
      const document = await createDocumentFromImages(db, uris, {
        title: defaultScanTitle(),
        source: source === 'photos' ? 'import_image' : 'scan',
        inInbox: true,
        onProgress,
      });
      succeeded();
      router.replace({ pathname: '/scan/review', params: { documentId: document.id } });
    }
  };

  const capture = async (source: Source, availability: ScannerAvailability) => {
    setState({ phase: 'capturing' });
    try {
      const uris =
        source === 'scanner'
          ? await scanWithScanner({ pageLimit: replacing ? 1 : 0 })
          : source === 'camera'
            ? await captureWithCamera()
            : await pickImages({ multiple: !replacing });
      if (!uris) {
        // Cancelled: leave the flow if the scanner opened automatically, else stay on the choices.
        if (source === 'scanner') goBack();
        else setState({ phase: 'choose', availability });
        return;
      }
      await saveCapture(replacing ? uris.slice(0, 1) : uris, source);
    } catch (error) {
      // Google's scanner can refuse to start (e.g. on low-RAM Android Go phones): fall back to the
      // camera instead of offering the same failing button again.
      setState({ phase: 'choose', availability, error: toAppError(error), scannerFailed: source === 'scanner' });
    }
  };

  const onAvailability = useEffectEvent((availability: ScannerAvailability) => {
    if (availability === 'available') capture('scanner', availability);
    else setState({ phase: 'choose', availability });
  });

  useEffect(() => {
    getScannerAvailability().then(onAvailability);
  }, []);

  if (state.phase === 'checking' || state.phase === 'capturing') {
    return <View className="flex-1 bg-background" />;
  }

  if (state.phase === 'saving') {
    return (
      <View accessibilityLiveRegion="polite" className="flex-1 items-center justify-center bg-background px-8">
        <ActivityIndicator size="large" />
        <Text className="mt-4 text-base text-text">
          {state.total > 1 ? `Saving page ${Math.min(state.done + 1, state.total)} of ${state.total}…` : 'Saving…'}
        </Text>
      </View>
    );
  }

  const { availability, error, scannerFailed = false } = state;
  const canScan = availability === 'available' && !scannerFailed;
  const canUsePhone = availability !== 'needs_native_build';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-grow justify-center px-8 py-12">
      <View className="items-center">
        <View className="mb-5 h-20 w-20 items-center justify-center rounded-full bg-surface-muted">
          <Icon name="scan-helper" size={40} color="primary" />
        </View>
        <Text accessibilityRole="header" className="text-center text-xl font-semibold text-text">
          {replacing ? 'Replace page' : 'Add pages'}
        </Text>
        <Text className="mt-3 text-center text-base text-muted">
          {availability === 'needs_native_build'
            ? 'Scanning needs the full Docuna app. It is not available in this preview.'
            : availability === 'no_play_services'
              ? 'Automatic edge detection needs Google Play services, which this phone doesn’t have. Take a photo and adjust the corners afterwards.'
              : 'Scan with automatic edge detection, or add pages from your photos.'}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" className="mt-4 text-center text-base text-danger">
            {error.userMessage}
          </Text>
        ) : null}

        <View className="mt-8 gap-3 self-stretch">
          {canScan ? <Button label="Scan" icon="scan-helper" size="lg" onPress={() => capture('scanner', availability)} /> : null}
          {canUsePhone && !canScan ? (
            <Button label="Take photo" icon="camera-outline" size="lg" onPress={() => capture('camera', availability)} />
          ) : null}
          {canUsePhone ? (
            <Button
              label={replacing ? 'Choose a photo' : 'Choose photos'}
              icon="image-multiple-outline"
              variant="secondary"
              onPress={() => capture('photos', availability)}
            />
          ) : null}
          <Button label="Cancel" variant="ghost" onPress={() => goBack()} />
        </View>
      </View>
    </ScrollView>
  );
}
