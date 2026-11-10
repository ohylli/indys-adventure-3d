import { defineConfig } from 'vite';

// Relative base so the built site works from any GitHub Pages path.
export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
