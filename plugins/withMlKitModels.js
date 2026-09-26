const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const KEY = 'com.google.mlkit.vision.DEPENDENCIES';

/**
 * Asks Google Play services to download the on-device ML Kit models Docuna uses when the app is
 * installed from the Play Store, instead of on first use.
 *
 * Several libraries declare this same meta-data (expo-dev-launcher adds "barcode_ui" for its QR
 * scanner in development builds), so the app manifest declares the complete list and overrides
 * theirs with tools:replace.
 *
 * @param {import('expo/config-plugins').ExpoConfig} config
 * @param {{ models: string[] }} options
 */
module.exports = function withMlKitModels(config, { models }) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application['meta-data'] = (application['meta-data'] ?? []).filter((item) => item.$['android:name'] !== KEY);
    application['meta-data'].push({
      $: { 'android:name': KEY, 'android:value': models.join(','), 'tools:replace': 'android:value' },
    });
    return cfg;
  });
};
