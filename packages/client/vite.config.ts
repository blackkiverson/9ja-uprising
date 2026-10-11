import { defineConfig } from 'vite';

export default defineConfig({
  // host: true exposes the dev server on your LAN so you can test on a phone early.
  server: { host: true },
  // Three.js alone is ~130 kB gzipped; warn only if the bundle grows well past that.
  build: { chunkSizeWarningLimit: 700 },
});
