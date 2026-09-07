import { test, expect } from '@playwright/test';
import { mount, post, move, activate, back, rect } from './fixtures/timeline.mjs';

test('Menu traps remote focus, matches the approved overlay and returns to the selected post', async ({ page }) => {
    await mount(page, [post(), post({ id: '102' })]);
    await move(page, 'down');
    await page.keyboard.press('m');
    const menu = page.getByRole('dialog', { name: '帖子操作' });
    await expect(menu).toBeVisible();
    expect(await rect(menu)).toEqual({ x: 640, y: 314, width: 640, height: 452 });
    await expect(page.getByRole('button', { name: '评论', exact: true })).toBeFocused();
    await move(page, 'down');
    await expect(page.getByRole('button', { name: '喜欢', exact: true })).toBeFocused();
    await move(page, 'right');
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '评论', exact: true })).toBeFocused();
    await back(page);
    await expect(menu).toHaveCount(0);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await page.keyboard.press('m');
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/102');
});

import { mountActions, bootFreshActions } from './fixtures/actions.mjs';

test('Like waits for the matching native response, suppresses duplicates and returns after 800 ms', async ({ page }) => {
    await mountActions(page);
    await move(page, 'down');
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await expect(page.getByRole('status').filter({ hasText: '正在' })).toBeVisible();
    await activate(page);
    await page.waitForTimeout(900);
    await expect(page.getByRole('dialog', { name: '帖子操作' })).toBeVisible();
    expect(await page.evaluate(() => nativeRequests.map(r => r.id))).toEqual(['102']);
    const bytes = await page.evaluate(() => finishNative(0));
    expect(bytes.delivered).toBe(bytes.original);
    await expect(page.getByRole('status').filter({ hasText: '已喜欢，即将返回帖子' })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByRole('dialog', { name: '帖子操作' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '帖子操作' })).toHaveCount(0);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await expect(page.locator('article.tv-focused [data-testid="unlike"]')).toHaveText('204');
});

test('A rejected optimistic like stays open and can be retried, then unliked using the real control', async ({ page }) => {
    await mountActions(page);
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await page.evaluate(() => finishNative(0, { error: true }));
    await expect(page.getByRole('status').filter({ hasText: '未能完成操作' })).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('article.tv-focused [data-testid="like"]')).toHaveText('203');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(2);
    await page.evaluate(() => finishNative(1));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: '取消喜欢', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '评论', exact: true })).toBeFocused();
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(3);
    await page.evaluate(() => finishNative(2));
    await expect(page.getByRole('status').filter({ hasText: '已取消喜欢' })).toBeVisible();
    await expect(page.getByRole('button', { name: '喜欢', exact: true })).toBeFocused();
    await expect(page.locator('article.tv-focused [data-testid="like"]')).toHaveText('203');
});

test('Back cancels the menu, not the native request, and late success never steals focus', async ({ page }) => {
    await mountActions(page);
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await back(page);
    await move(page, 'down');
    await page.evaluate(() => finishNative(0));
    await page.waitForTimeout(900);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await move(page, 'up');
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: '取消喜欢', exact: true })).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('Unknown responses never confirm or reverse an optimistic like, and recycled rows cannot receive the action', async ({ page }) => {
    await mountActions(page);
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await page.evaluate(() => finishNative(0, { unknown: true }));
    await expect(page.getByRole('status').filter({ hasText: '尚未确认' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新载入帖子', exact: true })).toBeVisible();
    expect(await page.evaluate(() => nativeRequests.length)).toBe(1);
    await back(page);
    await move(page, 'down');
    await page.keyboard.press('m');
    await page.locator('article.tv-focused').evaluate(article => {
        article.querySelector('[data-testid="User-Name"] a').setAttribute('href', '/fixture/status/999');
        article.dataset.fixtureId = '999';
    });
    await move(page, 'down');
    await activate(page);
    await expect(page.getByRole('status').filter({ hasText: '暂不可用' })).toBeVisible();
    expect(await page.evaluate(() => nativeRequests.length)).toBe(1);
    await page.waitForTimeout(900);
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('Closing while the confirmation channel is being armed never clicks X and permits reopening', async ({ page }) => {
    await mountActions(page);
    await page.evaluate(() => {
        const send = browser.runtime.sendMessage;
        browser.runtime.sendMessage = async message => {
            const result = await send(message);
            if (message.event === 'tv_like_arm') await new Promise(resolve => setTimeout(resolve, 250));
            return result;
        };
    });
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await back(page);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => nativeRequests.length)).toBe(0);
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
});

test('An unrelated native response cannot confirm the selected action', async ({ page }) => {
    await mountActions(page);
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await page.locator('article[data-fixture-id="102"] [data-testid="like"]').evaluate(button => button.click());
    await page.evaluate(() => finishNative(1));
    await page.waitForTimeout(900);
    await expect(page.getByRole('status').filter({ hasText: '正在等待 X 确认' })).toBeVisible();
    await page.evaluate(() => finishNative(0, { status: 503 }));
    await expect(page.getByRole('status').filter({ hasText: '未能完成操作' })).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('A slow in-flight request cannot be duplicated after the UI timeout and can still confirm later', async ({ page }) => {
    await mountActions(page);
    await page.clock.install();
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    // The native page can remove its optimistic state before the transport ends.
    await page.locator('article.tv-focused [data-testid="unlike"]').evaluate(button => button.dataset.testid = 'like');
    await page.clock.fastForward(16001);
    await activate(page);
    expect(await page.evaluate(() => nativeRequests.length)).toBe(1);
    await page.locator('article.tv-focused [data-testid="like"]').evaluate(button => button.dataset.testid = 'unlike');
    await page.evaluate(() => finishNative(0));
    await expect(page.getByRole('status').filter({ hasText: '已喜欢，即将返回帖子' })).toBeVisible();
    await page.clock.fastForward(800);
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Native page keyboard shortcuts do not escape the open menu', async ({ page }) => {
    await mountActions(page);
    await page.evaluate(() => {
        window.nativeShortcuts = 0;
        document.addEventListener('keydown', () => nativeShortcuts++);
    });
    await page.keyboard.press('m');
    await page.keyboard.press('l');
    expect(await page.evaluate(() => nativeShortcuts)).toBe(0);
    await expect(page.getByRole('button', { name: '评论', exact: true })).toBeFocused();
});

test('A native state change while arming cannot turn Like into an unintended Unlike', async ({ page }) => {
    await mountActions(page);
    await page.evaluate(() => {
        const send = browser.runtime.sendMessage;
        browser.runtime.sendMessage = async message => {
            const result = await send(message);
            if (message.event === 'tv_like_arm') {
                document.querySelector('article.tv-focused [data-testid="like"]').dataset.testid = 'unlike';
            }
            return result;
        };
    });
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect(page.getByRole('status').filter({ hasText: '未能完成操作' })).toBeVisible();
    expect(await page.evaluate(() => nativeRequests.length)).toBe(0);
});

test('Comment on another post remains available while a like is pending', async ({ page }) => {
    await mountActions(page);
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await back(page);
    await move(page, 'down');
    await page.keyboard.press('m');
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/102');
    expect(await page.evaluate(() => nativeRequests.length)).toBe(1);
});

test('An unresolved like offers a full native reload instead of an inverse action', async ({ page }) => {
    await mountActions(page);
    await move(page, 'down');
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await page.evaluate(() => finishNative(0, { unknown: true }));
    await back(page);
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: '重新载入帖子', exact: true })).toBeVisible();
    await move(page, 'down');
    const navigation = page.waitForRequest(request => request.isNavigationRequest() && request.url() === 'https://x.com/fixture/status/102');
    await activate(page);
    await navigation;
    await page.waitForLoadState();
    // The external page supplies a fresh unliked post, rather than old optimism.
    await expect(page.locator('article[data-fixture-id="102"] [data-testid="like"]')).toHaveText('203');
    await page.locator('article[data-fixture-id="102"]').evaluate(article => {
        // Native expanded detail puts its own timestamp outside User-Name.
        article.append(article.querySelector('[data-testid="User-Name"] a'));
    });
    await bootFreshActions(page);
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: '喜欢', exact: true })).toBeVisible();
    await expect(page.getByLabel('帖子互动计数')).toHaveText('评论 17 · 喜欢 203');
    await back(page);
    await page.goBack();
    await page.waitForLoadState();
    // A fresh home document restores the selected anchor saved before recovery.
    await bootFreshActions(page);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
});

test('Menu counts remain at the last known value while pending and synchronize after confirmation', async ({ page }) => {
    await mountActions(page);
    await page.keyboard.press('m');
    const counts = page.getByLabel('帖子互动计数');
    await expect(counts).toHaveText('评论 17 · 喜欢 203');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await expect(counts).toHaveText('评论 17 · 喜欢 203 · 待确认');
    await page.evaluate(() => finishNative(0));
    await expect(counts).toHaveText('评论 17 · 喜欢 204');
    await expect(page.locator('article.tv-focused [data-testid="unlike"]')).toHaveText('204');
});
