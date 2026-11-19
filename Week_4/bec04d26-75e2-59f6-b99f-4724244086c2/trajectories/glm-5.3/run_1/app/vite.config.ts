import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/frontend',
  plugins: [react()],
  build: {
    outDir: '../../dist/frontend',
    emptyOutDir: true,
  },
  server: { port: 5199 },
});
