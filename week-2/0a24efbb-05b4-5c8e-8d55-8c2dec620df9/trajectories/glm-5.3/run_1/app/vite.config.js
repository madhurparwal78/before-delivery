import fs from 'node:fs';
import { createRequire } from 'node:module';
import { reactRouter } from '@react-router/dev/vite';

const require = createRequire(import.meta.url);

const FONT_FILES = {
  'open-sans-latin-wght-normal.woff2':
    '@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2',
  'poppins-latin-600-normal.woff2':
    '@fontsource/poppins/files/poppins-latin-600-normal.woff2',
};

export default {
  build: { target: 'node22' },
  plugins: [
    reactRouter(),
    {
      name: 'rostara-assets',
      apply: 'build',
      generateBundle() {
        for (const [file, spec] of Object.entries(FONT_FILES)) {
          this.emitFile({
            type: 'asset',
            fileName: `assets/${file}`,
            source: fs.readFileSync(require.resolve(spec)),
          });
        }
      },
    },
  ],
};
