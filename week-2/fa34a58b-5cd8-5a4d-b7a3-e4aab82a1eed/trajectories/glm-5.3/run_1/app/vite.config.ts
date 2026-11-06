import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  esbuild: { target: 'es2022' },
  build: {
    outDir: 'public',
    emptyOutDir: true,
    rollupOptions: {
      input: { client: path.resolve(__dirname, 'src/client/client.tsx') },
    },
  },
  resolve: { extensions: ['.tsx', '.ts', '.js'] },
});
