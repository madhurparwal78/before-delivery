import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The browser runs the small React-compatible renderer so the desk's own script
  // stays inside its budget. The server renders with React and React Router itself.
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/client': 'preact/compat/client',
      'react/jsx-runtime': 'preact/compat/jsx-runtime',
    },
  },
  build: {
    outDir: 'build/client',
    emptyOutDir: true,
    manifest: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: 'src/app/entry.client.jsx',
    },
  },
});
