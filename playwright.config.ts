import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright')

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: 'list',

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1100 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  projects: [
    { name: 'studio', testMatch: '**/studio.spec.ts' },
    { name: 'production', testMatch: '**/production.spec.ts', use: { baseURL: 'http://127.0.0.1:4174' } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npm run build && npm run preview -- --port 4174 --strictPort --base /paperslicer/',
      url: 'http://127.0.0.1:4174/paperslicer/',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
})
