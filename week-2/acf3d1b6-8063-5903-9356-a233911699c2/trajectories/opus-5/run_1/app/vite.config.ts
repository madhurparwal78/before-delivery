import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [preact()],
  build: isSsrBuild
    ? {
        ssr: 'client/entry-server.tsx',
        outDir: 'dist/ssr',
        emptyOutDir: true,
        rollupOptions: {
          output: { format: 'cjs', entryFileNames: 'entry-server.cjs' }
        }
      }
    : {
        outDir: 'dist/client',
        emptyOutDir: true,
        assetsInlineLimit: 0
      },
  ssr: { noExternal: true }
}));
