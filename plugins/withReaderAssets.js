const { withDangerousMod } = require('expo/config-plugins');

const { syncReaderAssets } = require('./readerAssets');

/**
 * Bundles the offline readers (PDF.js, and the Word/Excel/PowerPoint viewer) into the Android app's
 * assets at prebuild, so the reader WebView loads them from file:///android_asset/.
 */
module.exports = function withReaderAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      syncReaderAssets(cfg.modRequest.projectRoot, cfg.modRequest.platformProjectRoot);
      return cfg;
    },
  ]);
};
