// @ts-check
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

import { version } from './package.json';

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist/es',
    format: 'es',

    // dir: 'dist/umd',
    // format: 'umd',
    // name: 'localdb',
    sourcemap: true
  },
  banner: `/*! localdb version v${version} */`,
  plugins: [
    typescript({
      sourceMap: true,
      declaration: true,
      declarationDir: './dist/es/types'
    }),
    resolve(),
    commonjs()
  ]
};
