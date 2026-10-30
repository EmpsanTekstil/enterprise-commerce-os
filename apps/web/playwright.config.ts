import { defineConfig } from '@playwright/test';

/** Arayüz testleri: API (4000) ve web (3000) çalışır durumda olmalı. CI bunları başlatır. */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:3000', locale: 'tr-TR', actionTimeout: 10_000, navigationTimeout: 20_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: process.env.CI ? [['list'], ['json', { outputFile: '/tmp/ui.json' }]] : 'list',
});
