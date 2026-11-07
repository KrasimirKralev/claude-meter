import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3418',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    // The fake provider replays a recorded stream, so tests cost nothing and never flake on an AI.
    command: 'npx vite build && PORT=3418 BALONCHE_PROVIDER=fake node server/index.ts',
    url: 'http://127.0.0.1:3418/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
