import type { ExpoConfig } from 'expo/config';

type Variant = 'development' | 'preview' | 'production';

const variant = (process.env.APP_VARIANT ?? 'development') as Variant;

// Separate application ids let dev, preview and production builds live side by side on one device.
const VARIANTS: Record<Variant, { name: string; packageSuffix: string }> = {
  development: { name: 'Docuna (Dev)', packageSuffix: '.dev' },
  preview: { name: 'Docuna (Preview)', packageSuffix: '.preview' },
  production: { name: 'Docuna', packageSuffix: '' },
};

const { name, packageSuffix } = VARIANTS[variant];

const config: ExpoConfig = {
  name,
  slug: 'docuna',
  scheme: 'docuna',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: `com.varietytech.docuna${packageSuffix}`,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // The overlay permission only serves the development menu.
    blockedPermissions: variant === 'production' ? ['android.permission.SYSTEM_ALERT_WINDOW'] : [],
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    // FTS5 powers offline full-text search over OCR text.
    ['expo-sqlite', { enableFTS: true }],
    'expo-image',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        backgroundColor: '#FFFFFF',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#0B0F14' },
      },
    ],
    'expo-font',
    [
      'expo-image-picker',
      {
        // Camera is only used as a fallback on devices without the Google Play scanner.
        cameraPermission: 'Docuna uses the camera to scan documents.',
        microphonePermission: false,
      },
    ],
    // Offline PDF reader (Mozilla PDF.js) bundled as Android assets.
    './plugins/withPdfJsAssets',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appVariant: variant,
  },
};

export default config;
