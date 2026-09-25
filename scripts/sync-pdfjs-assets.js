#!/usr/bin/env node
/**
 * Refreshes the PDF.js reader assets in an existing android/ project without a full prebuild
 * (e.g. after editing reader-web/pdf/*). Prebuild runs the same step via plugins/withPdfJsAssets.
 */
const path = require('path');

const { syncPdfJsAssets } = require('../plugins/pdfjsAssets');

const root = path.join(__dirname, '..');
const target = syncPdfJsAssets(root, path.join(root, 'android'));
console.log(`PDF.js reader assets synced to ${path.relative(root, target)}`);
