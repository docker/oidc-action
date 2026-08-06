// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
const config = {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs()],
  // Suppress known warnings from third-party dependencies in node_modules
  onwarn: (warning, warn) => {
    if (
      warning.code === 'THIS_IS_UNDEFINED' &&
      warning.loc?.file?.includes('node_modules')
    ) {
      return;
    }
    if (
      warning.code === 'CIRCULAR_DEPENDENCY' &&
      warning.ids?.every((id) => id.includes('node_modules'))
    ) {
      return;
    }
    warn(warning);
  }
};

export default config;
