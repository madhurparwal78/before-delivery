// This file is used by Vite during the build only; the server reads dist/.
export default {
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html'
    }
  }
}
