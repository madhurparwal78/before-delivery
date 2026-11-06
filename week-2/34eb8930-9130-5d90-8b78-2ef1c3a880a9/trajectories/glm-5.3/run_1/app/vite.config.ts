import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/browser',
  publicDir: '../../public',
  build: {
    outDir: '../../dist/browser',
    emptyOutDir: true,
  },
});
