import { test, expect } from '@playwright/test';
import { mount, post, move, activate, back, rect } from './fixtures/timeline.mjs';

test('Menu traps remote focus, matches the approved overlay and returns to the selected post', async ({ page }) => {
    await mount(page, [post(), post({ id: '102' })]);
    await move(page, 'down');
    await page.keyboard.press('m');
    const menu = page.getByRole('dialog', { name: '帖子操作' });
    await expect(menu).toBeVisible();
    expect(await rect(menu)).toEqual({ x: 690, y: 392, width: 540, height: 296 });
    const commentButton = page.getByRole('button', { name: '评论', exact: true });
    const likeButton = page.getByRole('button', { name: '喜欢', exact: true });
    expect((await rect(likeButton)).height).toBe(68);
    await expect(commentButton).toBeFocused();
    await expect.poll(async () => (await rect(commentButton)).height).toBe(69);
    await move(page, 'down');
    await expect(likeButton).toBeFocused();
    await expect.poll(async () => (await rect(likeButton)).height).toBe(69);
    await expect.poll(async () => (await rect(commentButton)).height).toBe(68);
    await move(page, 'right');
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '评论', exact: true })).toBeFocused();
    await back(page);
    await expect(menu).toHaveCount(0);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await page.keyboard.press('m');
    await activate(page);
    const composer = page.locator('#tv-composer-dialog');
    await expect(composer).toBeVisible();
    expect((await rect(composer)).width).toBe(880);
});

test('Aero Dark action menu renders symmetrical SVG icons and sky-blue focus styling', async ({ page }) => {
    await mount(page, [post()]);
    await move(page, 'down');
    await page.keyboard.press('m');
    const menu = page.getByRole('dialog', { name: '帖子操作' });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('button', { name: '评论', exact: true })).toBeFocused();

    const styles = await page.evaluate(() => {
        const commentBtn = document.querySelector('#tv-action-menu button.tv-action-btn-comment');
        const likeBtn = document.querySelector('#tv-action-menu button.tv-action-btn-like');
        const commentBefore = window.getComputedStyle(commentBtn, '::before');
        const likeBefore = window.getComputedStyle(likeBtn, '::before');
        return {
            commentBg: commentBefore.backgroundImage,
            commentWidth: commentBefore.width,
            likeBg: likeBefore.backgroundImage,
            likeWidth: likeBefore.width,
            commentFocusedBoxShadow: window.getComputedStyle(commentBtn).boxShadow,
            commentFocusedBg: window.getComputedStyle(commentBtn).backgroundColor
        };
    });
    expect(styles.commentBg).toContain('comments.svg');
    expect(styles.commentWidth).toBe('24px');
    expect(styles.likeBg).toContain('like.svg');
    expect(styles.likeWidth).toBe('24px');
    expect(styles.commentFocusedBoxShadow).toContain('56, 189, 248');
    expect(styles.commentFocusedBg).toContain('42, 55, 74');
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
    await expect(page.locator('#tv-composer-dialog')).toBeVisible();
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


test('Native service-worker fallback preserves confirmation and the in-flight fence', async ({ page }) => {
    await mountActions(page);
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await page.evaluate(() => serviceWorkerFallback(0));
    await activate(page);
    expect(await page.evaluate(() => nativeRequests.length)).toBe(1);
    const bytes = await page.evaluate(() => finishNative(0));
    expect(bytes.delivered).toBe(bytes.original);
    await expect(page.getByRole('status').filter({ hasText: '已喜欢，即将返回帖子' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('article.tv-focused [data-testid="unlike"]')).toHaveText('204');
});

test('An edited detail menu identifies the canonical root instead of a quoted timestamp', async ({ page }) => {
    await mountActions(page);
    await page.evaluate(() => {
        const other = document.querySelector('article[data-fixture-id="101"]');
        other.querySelector('[data-testid="User-Name"] a').remove();
        const quote = document.createElement('div');
        quote.dataset.testid = 'quoteTweet';
        quote.innerHTML = '<a href="/fixture/status/102"><time>Quoted timestamp</time></a>';
        other.append(quote);
        const root = document.querySelector('article[data-fixture-id="102"]');
        const timestamp = root.querySelector('[data-testid="User-Name"] a');
        timestamp.href = '/fixture/status/102/history';
        root.append(timestamp);
        history.pushState({}, '', '/fixture/status/102');
        dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.keyboard.press('m');
    await expect(page.getByRole('dialog', { name: '帖子操作' })).toBeVisible();
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/102');
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.map(request => request.id))).toEqual(['102']);
    await page.evaluate(() => finishNative(0));
    await expect(page.getByRole('status').filter({ hasText: '已喜欢，即将返回帖子' })).toBeVisible();
});

test('home inline composer opens with account identity and reply target, showing empty, draft-ready, and liked-post variants', async ({ page }) => {
    await mount(page, [post(), post({ id: '102' })]);
    await move(page, 'down');
    await page.keyboard.press('m');
    await activate(page);

    const dialog = page.locator('#tv-composer-dialog');
    await expect(dialog).toBeVisible();
    expect((await rect(dialog)).width).toBe(880);

    // Account identity and reply target
    const avatar = page.locator('#tv-composer-avatar');
    await expect(avatar).toBeVisible();
    await expect(page.locator('#tv-composer-target')).toHaveText('回复 @fixture');

    // Empty state
    const input = page.locator('#tv-composer-input');
    const submit = page.locator('#tv-composer-submit');
    await expect(input).toHaveValue('');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await expect(submit).toHaveText('回复');

    // Draft-ready state
    await input.fill('Home inline reply draft text');
    await expect(submit).toHaveAttribute('aria-disabled', 'false');

    // Whitespace only disables submit
    await input.fill('     ');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');

    // Preserve draft on Back cancel
    await input.fill('Preserved draft on home post');
    await back(page);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');

    // Reopening restores draft
    await page.keyboard.press('m');
    await activate(page);
    await expect(input).toHaveValue('Preserved draft on home post');
    await expect(submit).toHaveAttribute('aria-disabled', 'false');
    await back(page);

    // Liked post variant
    await page.locator('article[data-fixture-id="102"] [data-testid="like"]').evaluate(button => {
        button.dataset.testid = 'unlike';
        button.querySelector('span').textContent = '204';
    });
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: '取消喜欢', exact: true })).toBeVisible();
    await activate(page);
    await expect(dialog).toBeVisible();
    await back(page);
    await expect(page.locator('article.tv-focused [data-testid="unlike"]')).toBeVisible();
});

test('home inline composer supports remote navigation, focus cycling without trapping, and suppresses empty submission', async ({ page }) => {
    await mount(page, [post(), post({ id: '102' })]);
    await move(page, 'down');
    await page.keyboard.press('m');
    await activate(page);

    const input = page.locator('#tv-composer-input');
    const submit = page.locator('#tv-composer-submit');
    const cancel = page.locator('#tv-composer-cancel');

    // Initial remote focus on input
    await expect(input).toBeFocused();

    // Move down to submit
    await move(page, 'down');
    await expect(submit).toBeFocused();

    // Activating submit while empty does not submit or dismiss
    await activate(page);
    await expect(page.locator('#tv-composer-dialog')).toBeVisible();

    // Move right to cancel
    await move(page, 'right');
    await expect(cancel).toBeFocused();

    // Move left back to submit
    await move(page, 'left');
    await expect(submit).toBeFocused();

    // Move up back to input
    await move(page, 'up');
    await expect(input).toBeFocused();

    // Remote Confirm on input allows entering editing via installed TV IME
    await activate(page);
    await expect(input).toBeFocused();

    // D-pad moves out of text editing to available composer actions without trapping
    await move(page, 'down');
    await expect(submit).toBeFocused();

    // Tab key cycling
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();

    // Activating cancel returns to home post
    await move(page, 'right');
    await activate(page);
    await expect(page.locator('#tv-composer-dialog')).toHaveCount(0);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
});

test('actions composer activates cursor on Enter, navigates via remote D-pad keys, and synchronizes voice IME input', async ({ page }) => {
    await mount(page, [post(), post({ id: '102' })]);
    await move(page, 'down');
    await page.keyboard.press('m');
    await activate(page);

    const input = page.locator('#tv-composer-input');
    const submit = page.locator('#tv-composer-submit');
    const cancel = page.locator('#tv-composer-cancel');

    // Initial focus on input
    await expect(input).toBeFocused();

    // Enter on input activates cursor / IME without submitting or newline
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    expect(await input.inputValue()).toBe('');

    // Remote D-pad ArrowDown directly from textarea moves focus to Submit button
    await page.keyboard.press('ArrowDown');
    await expect(submit).toBeFocused();

    // Remote D-pad ArrowUp moves back to input
    await page.keyboard.press('ArrowUp');
    await expect(input).toBeFocused();

    // Remote D-pad ArrowUp from input moves to cancel button
    await page.keyboard.press('ArrowUp');
    await expect(cancel).toBeFocused();

    // Voice IME input synchronization test
    await page.keyboard.press('ArrowDown'); // back to input
    await expect(input).toBeFocused();
    await page.evaluate(() => {
        const el = document.querySelector('#tv-composer-input');
        el.value = 'Voice input from remote';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('compositionend', { bubbles: true }));
    });
    await expect(submit).toHaveAttribute('aria-disabled', 'false');

    // Escape closes composer and restores focus
    await page.keyboard.press('Escape');
    await expect(page.locator('#tv-composer-dialog')).toHaveCount(0);
});

test('real X reply flow from home: submits to native composer, enters pending, suppresses duplicates, confirms success with sent simulation, and reconciles count', async ({ page }) => {
    await mountActions(page);
    await page.evaluate(() => {
        window.submittedReplies = [];
        const article = document.querySelector('article[data-fixture-id="102"]');
        article.querySelector('[data-testid="reply"]').onclick = () => {
            if (!document.querySelector('[data-testid="tweetTextarea_0"]')) {
                const comp = document.createElement('div');
                comp.innerHTML = `
                    <textarea data-testid="tweetTextarea_0"></textarea>
                    <button data-testid="tweetButtonInline">Reply</button>
                `;
                document.body.appendChild(comp);
                comp.querySelector('[data-testid="tweetButtonInline"]').onclick = () => {
                    const inp = comp.querySelector('[data-testid="tweetTextarea_0"]');
                    window.submittedReplies.push(inp.value || inp.textContent);
                };
            }
        };
    });

    await move(page, 'down');
    await page.keyboard.press('m');
    await activate(page);

    const input = page.locator('#tv-composer-input');
    await input.fill('Confirmed reply from home TV');
    await move(page, 'down');
    await activate(page);

    // Verified text delivered to native X composer
    expect(await page.evaluate(() => window.submittedReplies)).toEqual(['Confirmed reply from home TV']);

    // Pending state
    const submit = page.locator('#tv-composer-submit');
    const status = page.locator('#tv-composer-status');
    await expect(status).toHaveText('正在发送回复…');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await expect(submit).toHaveAttribute('aria-busy', 'true');

    // Duplicate submission suppressed while request pending
    await activate(page);
    expect(await page.evaluate(() => window.submittedReplies.length)).toBe(1);

    // Observable successful submission from X
    await page.evaluate(replyHtml => {
        const nativeInput = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (nativeInput) nativeInput.value = '';
        const replyBtn = document.querySelector('article[data-fixture-id="102"] [data-testid="reply"] span');
        if (replyBtn) replyBtn.textContent = '18';
        document.querySelector('#timeline').insertAdjacentHTML('beforeend', replyHtml);
    }, post({ id: '205', text: 'Confirmed reply from home TV' }));

    // Sent simulation
    await expect(page.locator('#tv-composer-sent')).toBeVisible();
    await expect(status).toHaveText('已发送，即将返回帖子');

    // Auto-return to home post
    await expect(page.locator('#tv-composer-dialog')).toHaveCount(0);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await expect(page.locator('article[data-fixture-id="102"] [data-testid="reply"] span')).toHaveText('18');
    await expect(page.locator('article[data-fixture-id="102"] [data-testid="like"] span')).toHaveText('203');
});

test('failed submission preserves draft, displays error, and provides retry path that succeeds', async ({ page }) => {
    await mountActions(page);
    await page.evaluate(() => {
        let attempts = 0;
        const comp = document.createElement('div');
        comp.innerHTML = `
            <textarea data-testid="tweetTextarea_0"></textarea>
            <button data-testid="tweetButtonInline">Reply</button>
        `;
        document.body.appendChild(comp);
        comp.querySelector('[data-testid="tweetButtonInline"]').onclick = () => {
            attempts++;
            if (attempts === 1) {
                const toast = document.createElement('div');
                toast.setAttribute('data-testid', 'toast');
                toast.textContent = 'Server rejection: failed to reply';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 1000);
            } else {
                const replyBtn = document.querySelector('article[data-fixture-id="102"] [data-testid="reply"] span');
                if (replyBtn) replyBtn.textContent = '18';
                window.dispatchEvent(new CustomEvent('tv_reply_result', { detail: { outcome: 'confirmed' } }));
            }
        };
    });

    await move(page, 'down');
    await page.keyboard.press('m');
    await activate(page);

    const input = page.locator('#tv-composer-input');
    await input.fill('Draft to retry on home failure');
    await move(page, 'down');
    await activate(page);

    // Failure state
    const status = page.locator('#tv-composer-status');
    const submit = page.locator('#tv-composer-submit');
    await expect(status).toHaveText('未能发送回复，请确认重试');
    await expect(input).toHaveValue('Draft to retry on home failure');
    await expect(submit).toHaveAttribute('aria-disabled', 'false');
    await expect(submit).toHaveText('重试');
    await expect(submit).toBeFocused();

    // Activating retry path succeeds
    await activate(page);
    await expect(page.locator('#tv-composer-sent')).toBeVisible();
    await expect(page.locator('#tv-composer-dialog')).toHaveCount(0);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await expect(page.locator('article[data-fixture-id="102"] [data-testid="reply"] span')).toHaveText('18');
});

test('liked post preserves like state throughout reply flow and clears draft on success', async ({ page }) => {
    await mountActions(page);
    await move(page, 'down');
    await page.keyboard.press('m');
    await move(page, 'down');
    await activate(page);
    await expect.poll(() => page.evaluate(() => nativeRequests.length)).toBe(1);
    await page.evaluate(() => finishNative(0));
    await expect(page.locator('#tv-action-overlay')).toHaveCount(0);
    await expect(page.locator('article.tv-focused [data-testid="unlike"]')).toHaveText('204');

    // Open composer on liked post
    await page.keyboard.press('m');
    await expect(page.getByRole('button', { name: '取消喜欢', exact: true })).toBeVisible();
    await activate(page);
    const input = page.locator('#tv-composer-input');
    await input.fill('Draft on liked post');
    await back(page);

    // Liked state preserved after cancel
    await expect(page.locator('article.tv-focused [data-testid="unlike"]')).toHaveText('204');

    // Reopen and complete reply
    await page.keyboard.press('m');
    await activate(page);
    await expect(input).toHaveValue('Draft on liked post');

    await page.evaluate(() => {
        const comp = document.createElement('div');
        comp.innerHTML = `<textarea data-testid="tweetTextarea_0"></textarea><button data-testid="tweetButtonInline">Reply</button>`;
        document.body.appendChild(comp);
        comp.querySelector('[data-testid="tweetButtonInline"]').onclick = () => {
            const replyBtn = document.querySelector('article[data-fixture-id="102"] [data-testid="reply"] span');
            if (replyBtn) replyBtn.textContent = '18';
            window.dispatchEvent(new CustomEvent('tv_reply_result', { detail: { outcome: 'confirmed' } }));
        };
    });

    await move(page, 'down');
    await activate(page);
    await expect(page.locator('#tv-composer-sent')).toBeVisible();
    await expect(page.locator('#tv-action-overlay')).toHaveCount(0);

    // Liked state and updated reply count preserved on return
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');
    await expect(page.locator('article.tv-focused [data-testid="unlike"]')).toHaveText('204');
    await expect(page.locator('article.tv-focused [data-testid="reply"] span')).toHaveText('18');

    // Reopening menu confirms draft was cleared on success
    await page.keyboard.press('m');
    await activate(page);
    await expect(page.locator('#tv-composer-input')).toHaveValue('');
    await back(page);
});
