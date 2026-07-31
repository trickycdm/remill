import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e. The suite runs against a BUILT preview (workerd via
 * `vite preview`), not `vite dev` — the dev server's on-demand SSR compile
 * degrades under a long serial suite and produced late-suite timing flakes
 * (2026-07-05 re-plan); the preview serves the production bundle from the same
 * local D1 state (`.wrangler/state`). `bun run e2e` migrates + seeds that DB
 * first so the admin login works. Datastar reactive expressions are opaque to
 * the type-checker, so these e2e flows are the safety net for interactive
 * admin behavior (steering/E2E_TESTING.md).
 */
export default defineConfig({
  testDir: './e2e',
  // Serial: all specs share one dev server + one local D1, so parallel workers
  // collide on shared state (unique slugs, seeded rows). Correctness over speed.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry everywhere: a genuine failure still fails both attempts; this only
  // absorbs rare shared-server timing hiccups.
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',

  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    // Disable entrance animations: deterministic snapshots (no flaky mid-animation
    // opacity), and axe reads true resting colors rather than alpha-blended frames.
    // Also exercises the prefers-reduced-motion path (A11Y_STANDARDS.md §Motion).
    reducedMotion: 'reduce',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Build once, serve the production bundle in workerd (same .wrangler/state
    // D1 the seed scripts populate). Stable under the full serial suite.
    command: 'bun run build && bun run preview',
    url: 'http://127.0.0.1:3100/admin/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
