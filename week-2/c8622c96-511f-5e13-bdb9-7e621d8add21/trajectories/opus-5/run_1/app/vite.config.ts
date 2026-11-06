import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/client',
  build: { outDir: '../../dist/client', emptyOutDir: true },
  plugins: [react()],
});
