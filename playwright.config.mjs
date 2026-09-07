import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 15000,
    workers: 1,
    use: { browserName: 'firefox', viewport: { width: 1920, height: 1080 } },
});
