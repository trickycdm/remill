import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e. The dev server (`bun run dev`) migrates local D1 and generates
 * routes; the DB must be seeded (`bun run db:seed`) so the admin login works.
 * Datastar reactive expressions are opaque to the type-checker, so these e2e
 * flows are the safety net for interactive admin behavior (steering/E2E_TESTING.md).
 */
export default defineConfig({
  testDir: './e2e',
  // Serial: all specs share one dev server + one local D1, so parallel workers
  // collide on shared state (unique slugs, seeded rows). Correctness over speed.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
    command: 'bun run dev',
    url: 'http://127.0.0.1:3100/admin/login',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
