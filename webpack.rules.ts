import type { ModuleOptions } from 'webpack';

export const rules: Required<ModuleOptions>['rules'] = [
  // Vue single-file components (.vue)
  {
    test: /\.vue$/,
    use: {
      loader: 'vue-loader',
    },
  },
  // Add support for native node modules
  {
    // We're specifying native_modules in the test because the asset relocator loader generates a
    // "fake" .node file which is really a cjs file.
    test: /native_modules[/\\].+\.node$/,
    use: 'node-loader',
  },
  // ORT wasm sidecars must be emitted as static assets so they can be
  // fetched at runtime. The asset relocator would mangle these paths.
  {
    test: /\.wasm$/,
    type: 'asset/resource',
    generator: { filename: 'ort-assets/[name][ext]' },
  },
  // Exclude unblend and onnxruntime-web from the asset relocator. The
  // relocator emits raw file copies that can't resolve bare imports in a
  // browser worker context. By excluding them, webpack bundles ORT into the
  // worker chunks and handles `new Worker(new URL(...))` natively.
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    exclude: [/onnxruntime-web/, /unblend/],
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
  },
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|\.webpack)/,
    use: {
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
      },
    },
  },
];
