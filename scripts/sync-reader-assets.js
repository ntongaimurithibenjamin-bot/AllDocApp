#!/usr/bin/env node
/**
 * Refreshes the reader assets (PDF.js + office viewer) in an existing android/ project without a
 * full prebuild, e.g. after editing reader-web/*. Prebuild runs the same step via
 * plugins/withReaderAssets.
 */
const path = require('path');

const { syncReaderAssets } = require('../plugins/readerAssets');

const root = path.join(__dirname, '..');
for (const target of syncReaderAssets(root, path.join(root, 'android'))) {
  console.log(`Synced ${path.relative(root, target)}`);
}
