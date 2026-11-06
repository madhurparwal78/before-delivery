import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(`src/client/${name}.html`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('src/client', import.meta.url)),
  publicDir: fileURLToPath(new URL('public', import.meta.url)),
  base: '/',
  build: {
    outDir: fileURLToPath(new URL('dist/client', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        story: page('index'),
        manage: page('manage'),
        signin: page('signin'),
        partner: page('partner'),
        privacy: page('privacy'),
      },
    },
  },
});
