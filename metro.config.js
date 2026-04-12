const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

module.exports = mergeConfig(defaultConfig, {
  projectRoot: __dirname,
  resolver: {
    ...defaultConfig.resolver,
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
});
