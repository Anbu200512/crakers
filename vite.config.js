import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite is the whole runtime now: `npm run dev` serves the React app directly and
 * `npm run build` emits dist/, which `npm start` previews. There is no second
 * server - the API calls the app makes are answered in the browser by
 * src/frontend/services/mockApi.js - so the app stays on one port (5000) and one
 * origin, with no proxy and no CORS.
 *
 * The entry is the root index.html, which loads /src/frontend/main.jsx.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5000,
    fs: {
      // A stray .env must never be served as a module, in any folder.
      deny: ['.env', '.env.*', '**/.env', '**/.env.*'],
    },
  },
  preview: {
    port: 5000,
  },
});
