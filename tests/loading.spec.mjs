import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mount, post } from './fixtures/timeline.mjs';

const extension = new URL('../app/src/main/assets/tv-extension/', import.meta.url);

test('slow detail hydration and unrelated replies never imply the target post was deleted', async ({ page }) => {
    await mount(page, []);
    await page.clock.install();
    await page.evaluate(() => { history.replaceState({}, '', '/fixture/status/102'); window.TvXDetail.update(true); });
    await page.clock.runFor(7000);
    await page.locator('#timeline').evaluate((node, html) => node.innerHTML = html, post({ id: '201' }));
    await page.evaluate(() => window.TvXDetail.update(true));
    await expect(page.locator('#tv-detail-error-card')).toHaveCount(0);
    await expect(page.locator('#tv-detail-status')).toContainText('加载');
    await page.locator('#timeline').evaluate((node, html) => node.innerHTML = html, post({ id: '102' }));
    await page.evaluate(() => window.TvXDetail.update(true));
    await expect(page.locator('.tv-detail-post')).toBeVisible();
});

test('a stalled detail offers a neutral retry and cancels its deadline on exit', async ({ page }) => {
    await mount(page, []);
    await page.clock.install();
    await page.evaluate(() => { history.replaceState({}, '', '/fixture/status/102'); window.TvXDetail.update(true); });
    await page.clock.runFor(25050);
    await expect(page.locator('#tv-detail-status')).toContainText('确认重试');
    await expect(page.locator('#tv-detail-error-card')).toHaveCount(0);
    await page.evaluate(() => { history.replaceState({}, '', '/home'); window.TvXDetail.update(false); });
    await page.clock.runFor(26000);
    await expect(page.locator('#tv-detail-chrome')).toHaveCount(0);
});

test('startup keeps X pending list measurable under the opaque cover', async ({ page }) => {
    await mount(page, [], '<div id="pending-list" style="height:400px"><div data-testid="tweetTextarea_0">Composer</div><div role="progressbar"></div></div>', { boot: true });
    await expect(page.locator('html')).toHaveClass(/tv-x-boot/);
    await expect(page.getByTestId('tweetTextarea_0')).toBeHidden();
    expect(await page.locator('#pending-list').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(0);
});

test('explicit login route mounts the TV stage at document start', async ({ page }) => {
    const stageSource = await readFile(new URL('sites/x/login-stage.js', extension), 'utf8');
    const bootSource = await readFile(new URL('sites/x/bootstrap.js', extension), 'utf8');
    await page.addInitScript({content: `
        window.browser={runtime:{sendMessage:()=>Promise.resolve()}};
        ${stageSource}
        ${bootSource}
    `});
    await page.route('https://x.com/i/flow/login', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>'
    }));

    await page.goto('https://x.com/i/flow/login');
    await expect(page.locator('#tv-custom-login-stage')).toBeAttached();
    await expect(page.locator('#tv-custom-login-stage')).toHaveAttribute('data-mounted-ready-state', 'loading');
});
