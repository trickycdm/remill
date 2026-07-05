import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vitest/config';
import ssrPlugin from 'vite-ssr-components/plugin';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    cloudflare(),
    ssrPlugin({ entry: { target: ['src/layouts.tsx', 'src/routes/**/*.tsx'] } }),
    tailwindcss(),
  ],
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  // Vitest only — `vite dev`/`vite build` ignore this `test` field.
  // Scope unit/integration tests to src/ so Playwright specs under e2e/ are not
  // collected by vitest (they run via `bun run e2e` / Playwright instead).
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.wrangler/**'],
    setupFiles: ['src/test/setup.ts'],
  },
});
