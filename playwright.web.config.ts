import { defineConfig, devices } from '@playwright/test'

// The built web app on phone viewports, with Google sign-in and Drive replaced by stubs (tests/web-e2e/fixtures.ts).
export default defineConfig({
  testDir: 'tests/web-e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173/', trace: 'retain-on-failure', actionTimeout: 15_000 },
  webServer: {
    command: 'npm run build:web -- --mode e2e && npx vite preview -c vite.web.config.ts --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    timeout: 180_000,
    reuseExistingServer: false
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }
  ]
})
