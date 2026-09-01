import type { Configuration } from 'webpack';
import { createRequire } from 'module';
import * as path from 'path';
import { DefinePlugin } from 'webpack';

// vue-loader's plugin class is loaded through a genuine CommonJS require
// (created via module.createRequire) instead of an ESM import or jiti's
// transformed require: jiti's ESM interop, which is used to load this .ts
// config file, mis-resolves the named `VueLoaderPlugin` export into a broken
// class reference. A real CJS require returns the working plugin class.
const cjsRequire = createRequire(__filename);
const VueLoaderPluginCtor: any = cjsRequire('vue-loader/dist/plugin').default;
// jiti's ESM interop (used to load this .ts config) breaks the `new` operator
// on required class exports ("Class constructor cannot be invoked without
// 'new'"), even though the value is a genuine class. Reflect.construct invokes
// the real [[Construct]] internal method and sidesteps that transform bug.
const VueLoaderPlugin: any = Reflect.construct(VueLoaderPluginCtor, []);

import CopyWebpackPlugin from 'copy-webpack-plugin';
import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

// video.js ships its own CSS and font assets; emit them as static files.
rules.push(
  {
    test: /\.(woff2?|ttf|eot)$/i,
    type: 'asset/resource',
    generator: { filename: 'fonts/[name][ext]' },
  },
  {
    test: /\.(png|svg|gif|jpe?g)$/i,
    type: 'asset/resource',
    generator: { filename: 'img/[name][ext]' },
  },
);



export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins: [
    VueLoaderPlugin,
    // Vue's esm-bundler build expects these compile-time feature flags to be
    // injected by the bundler for proper tree-shaking.
    new DefinePlugin({
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    }),
    ...plugins,
    // Copy ORT's dist (bundle + wasm sidecars) as static files. The unblend
    // workers are emitted as raw ESM files by the asset relocator and import
    // onnxruntime-web via a bare specifier; we alias that to an absolute path
    // pointing at this copy so the worker can load ORT in its own context.
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
          to: path.resolve(__dirname, '.webpack/renderer/main_window/ort'),
        },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.vue', '.css'],
    alias: {
      vue$: 'vue/dist/vue.esm-bundler.js',
    },
  },
};
