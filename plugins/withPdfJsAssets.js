const { withDangerousMod } = require('expo/config-plugins');

const { syncPdfJsAssets } = require('./pdfjsAssets');

/**
 * Bundles the offline PDF.js reader into the Android app's assets at prebuild, so the reader
 * WebView loads it from file:///android_asset/pdfjs/web/viewer.html.
 */
module.exports = function withPdfJsAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      syncPdfJsAssets(cfg.modRequest.projectRoot, cfg.modRequest.platformProjectRoot);
      return cfg;
    },
  ]);
};
