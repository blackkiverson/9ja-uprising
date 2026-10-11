import { defineConfig } from 'vite';

// Read without Node typings (the client tsconfig only knows browser globals).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  // GitHub Pages serves the game from /<repo>/; locally it's /.
  base: env.BASE_PATH ?? '/',
  // host: true exposes the dev server on your LAN so you can test on a phone early.
  server: { host: true },
  // Three.js alone is ~130 kB gzipped; warn only if the bundle grows well past that.
  build: { chunkSizeWarningLimit: 700 },
});
