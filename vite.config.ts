import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vitest/config';
import ssrPlugin from 'vite-ssr-components/plugin';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { build } from 'esbuild';
import type { Plugin } from 'vite';

/**
 * `virtual:frame-bridge` (D60) — the framed page's comment bridge
 * (src/client/frame-bridge.ts), bundled to ONE minified classic-script string
 * the frame content route inlines into the author's document. It cannot be a
 * `<Script>` asset: the framed document runs in an opaque origin, so a module
 * script would be a cross-origin request to static assets that send no CORS
 * headers. Inlining also keeps the frame self-contained if it ever moves host.
 */
function frameBridge(): Plugin {
  const ID = 'virtual:frame-bridge';
  const RESOLVED = `\0${ID}`;
  const entry = path.resolve(__dirname, 'src/client/frame-bridge.ts');
  return {
    name: 'remill-frame-bridge',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return;
      const out = await build({
        entryPoints: [entry],
        bundle: true,
        minify: true,
        format: 'iife',
        target: 'es2020',
        write: false,
        metafile: true,
        alias: { '@': path.resolve(__dirname, './src') },
      });
      for (const input of Object.keys(out.metafile.inputs)) this.addWatchFile(path.resolve(__dirname, input));
      return `export default ${JSON.stringify(out.outputFiles[0].text)};`;
    },
  };
}

export default defineConfig({
  plugins: [
    frameBridge(),
    cloudflare(),
    // Components are scanned too: shared panels may own their island's <Script>
    // (GraphPanel carries /src/client/graph.ts for both /admin and /admin/graph).
    ssrPlugin({
      entry: { target: ['src/layouts.tsx', 'src/routes/**/*.tsx', 'src/components/**/*.tsx'] },
    }),
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
