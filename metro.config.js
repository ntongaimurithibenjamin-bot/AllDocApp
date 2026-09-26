const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// pdf-lib's package entry (CommonJS) pulls in an HTML parser and colour library for SVG/form
// features Docuna doesn't use. Its self-contained UMD build is ~600 KB and has no extra deps.
const PDF_LIB_BUNDLE = path.join(__dirname, 'node_modules/@cantoo/pdf-lib/dist/pdf-lib.min.js');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@cantoo/pdf-lib') return { type: 'sourceFile', filePath: PDF_LIB_BUNDLE };
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
