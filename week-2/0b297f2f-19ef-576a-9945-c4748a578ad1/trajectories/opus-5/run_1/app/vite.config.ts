import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    manifest: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: 'src/client/main.tsx',
        lender: 'src/client/lender.tsx',
      },
    },
  },
});
