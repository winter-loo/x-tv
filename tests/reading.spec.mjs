import { test, expect } from '@playwright/test';
import { mount, post, move, activate, back, rect, tabs } from './fixtures/timeline.mjs';

test('renders supplied article content at the approved equal-column geometry', async ({ page }) => {
    await mount(page, [post({ article: true })], '', {styleDelay:900});
    const author = page.getByTestId('User-Name');
    const body = page.getByTestId('tweetText');
    const attachment = page.locator('a[href="/i/article/901"]');
    await expect(author).toContainText('Fixture Author');
    await expect(body).toHaveText('Original fixture post text.');
    await expect(attachment).toContainText('An independently supplied article title');
    await expect(attachment).toContainText('An independently supplied article excerpt.');
    await expect(page.getByAltText('Fixture article cover')).toBeVisible();
    await expect(page.getByRole('group')).toHaveText('172039.2K');
    await expect.poll(() => rect(attachment)).toEqual({ x: 1000, y: 192, width: 824, height: 688 });
    await expect.poll(() => rect(body)).toEqual({ x: 96, y: 304, width: 824, height: 414 });
});

test('remote left/right reveals long text and article excerpts without changing the post', async ({ page }) => {
    await mount(page, [post({ article: true, long: true, text: 'Long original text. '.repeat(200) + 'END OF POST' }), post({ id: '102' })]);
    const body = page.getByTestId('tweetText').first();
    const attachment = page.locator('a[href="/i/article/901"]');
    await expect(page.locator('#tv-reading-guidance')).toContainText('翻阅长内容');
    await move(page, 'right');
    await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => attachment.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) await move(page, 'right');
    await expect.poll(() => body.evaluate(node => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThan(2);
    await expect.poll(() => attachment.evaluate(node => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThan(2);
    await move(page, 'left');
    await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeLessThan(await body.evaluate(node => node.scrollHeight - node.clientHeight));
    await move(page, 'down');
    await move(page, 'up');
    await expect.poll(() => body.evaluate(node => node.scrollTop)).toBe(0);
    await expect.poll(() => attachment.evaluate(node => node.scrollTop)).toBe(0);
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/101');
});

test('loads the next post across equal-count virtual replacement and never activates a recycled row', async ({ page }) => {
    await mount(page, [post(), post({ id: '102' })]);
    await move(page, 'down');
    await move(page, 'down');
    await expect(page.locator('#tv-reading-guidance')).toContainText('加载更多');
    await page.locator('#timeline').evaluate((node, html) => { node.innerHTML = html; }, post({ id: '103', recognized: false }) + post({ id: '104', article: true }));
    await expect(page.locator('[data-fixture-id="104"]')).toHaveClass(/tv-focused/);
    // X reuses the focused article itself before its observer callback runs.
    await page.evaluate(html => {
        const node = document.querySelector('[data-fixture-id="104"]');
        const replacement = document.createElement('div');
        replacement.innerHTML = html;
        node.innerHTML = replacement.querySelector('article').innerHTML;
        window.TvXAdapter.activate();
    }, post({ id: '105' }));
    await expect(page).toHaveURL('https://x.com/home');
    await expect(page.locator('.tv-focused')).toHaveCount(0);
    await move(page, 'down');
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/105');
});

test('loading, empty and unrecognized home content never becomes login or an uncertain click', async ({ page }) => {
    await mount(page, [], '<div role="progressbar"></div>');
    await expect(page.getByRole('status')).toHaveText('正在加载帖子…');
    await expect(page.locator('#tv-custom-login-stage')).toHaveCount(0);
    await page.getByRole('progressbar').evaluate(node => node.remove());
    await expect(page.getByRole('status')).toContainText('暂无可浏览帖子');
    await page.locator('#timeline').evaluate((node, html) => { node.innerHTML = html; }, post({ recognized: false }));
    await expect(page.getByRole('status')).toContainText('暂未识别');
    await move(page, 'down');
    await activate(page);
    await expect(page).toHaveURL('https://x.com/home');
    await expect(page.locator('#tv-custom-login-stage')).toHaveCount(0);
});

test('header follows native account/tab updates and text-only posts use the available space', async ({ page }) => {
    await mount(page, [post()]);
    await expect.poll(() => rect(page.getByTestId('tweetText'))).toEqual({x:96,y:304,width:1200,height:414});
    await expect(page.locator('#tv-reading-tabs [aria-current="true"]')).toHaveText('为你推荐');
    await page.evaluate(() => {
        const nativeTabs = document.querySelectorAll('[role="tab"]');
        nativeTabs[0].setAttribute('aria-selected', 'false');
        nativeTabs[1].setAttribute('aria-selected', 'true');
        document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img').remove();
    });
    await expect(page.locator('#tv-reading-tabs [aria-current="true"]')).toHaveText('正在关注');
    await expect(page.locator('#tv-reading-account')).toBeHidden();
    await expect(page.locator('#tv-custom-login-stage')).toHaveCount(0);
});

test('Back waits for native home DOM and restores the selected post after list rebuilding', async ({ page }) => {
    await mount(page, [post(), post({ id: '102' }), post({ id: '103' })]);
    await move(page, 'down');
    await move(page, 'down');
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/103');
    await page.getByRole('tablist').evaluate(node => node.remove());
    await page.locator('#timeline').evaluate((node, html) => { node.innerHTML = html; }, post({ id: '103' }));
    await back(page);
    await expect(page).toHaveURL('https://x.com/home');
    // Outgoing detail remains briefly after the URL changes; native home is not ready.
    await page.locator('#timeline').evaluate(node => { node.innerHTML = '<div role="progressbar"></div>'; });
    await page.locator('[data-testid="primaryColumn"]').evaluate((node, html) => node.insertAdjacentHTML('afterbegin', html), tabs);
    await page.locator('#timeline').evaluate((node, html) => { node.innerHTML = html; }, post() + post({ id: '102' }) + post({ id: '103' }));
    await expect(page.locator('[data-fixture-id="103"]')).toHaveClass(/tv-focused/);
    await expect.poll(async () => (await rect(page.locator('[data-fixture-id="103"]'))).y).toBe(192);
    await back(page);
    await expect(page.locator('[data-fixture-id="101"]')).toHaveClass(/tv-focused/);
    await expect.poll(async () => (await rect(page.locator('[data-fixture-id="101"]'))).y).toBe(192);
});

test('late native row measurement keeps the same post visible at the projector viewport', async ({ page }) => {
    await page.setViewportSize({width:980,height:551});
    await mount(page, [post(), post({id:'102',article:true})]);
    await move(page, 'down');
    const selected = page.locator('[data-fixture-id="102"]');
    await selected.locator('..').evaluate(node => { node.style.paddingTop = '250px'; });
    await expect.poll(async () => (await rect(selected)).y).toBe(98);
    await expect.poll(async () => (await rect(selected)).width).toBe(882);
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/102');
});

test('the current X sign-in link opens TV login while ordinary home stays readable', async ({ page }) => {
    await mount(page, []);
    await expect(page.locator('#tv-custom-login-stage')).toHaveCount(0);
    await page.evaluate(() => {
        history.replaceState({}, '', '/');
        document.querySelector('header').remove();
        const landing = document.createElement('div');
        landing.innerHTML = '<a href="/i/jf/onboarding/web?mode=login&redirect_after_login=%2F">Sign in</a>';
        document.querySelector('#react-root').replaceWith(landing);
    });
    await expect(page.locator('#tv-custom-login-stage')).toBeVisible();
    await expect(page.locator('#tv-stage-google-btn')).toBeVisible();
});

test('an explicit current login route takes precedence over a background timeline', async ({ page }) => {
    await mount(page, [post()]);
    await page.evaluate(() => {
        history.pushState({}, '', '/i/jf/onboarding/web?mode=login');
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('#tv-custom-login-stage')).toBeVisible();
});
