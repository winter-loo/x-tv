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
    await page.getByRole('tablist', { includeHidden: true }).evaluate(node => node.remove());
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

test('high-frequency remote D-pad navigation reuses cached article bounds and prevents event queue drift', async ({ page }) => {
    const posts = Array.from({ length: 10 }, (_, i) => post({ id: String(100 + i), text: `Post ${i}` }));
    await mount(page, posts);
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '100');

    // Instrument getBoundingClientRect to count layout reflows during navigation
    await page.evaluate(() => {
        window.rectCallCount = 0;
        const orig = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function() {
            if (this.tagName?.toLowerCase() === 'article') {
                window.rectCallCount++;
            }
            return orig.apply(this, arguments);
        };
    });

    // Simulate rapid repeated keydown burst within a single tick (remote hardware repeat)
    await page.keyboard.down('ArrowDown');
    await page.evaluate(() => {
        for (let i = 0; i < 5; i++) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', repeat: true, bubbles: true, cancelable: true }));
        }
    });
    await page.keyboard.up('ArrowDown');

    // Rapid burst within 80ms was throttled; focus stayed on 101 without queue overflow
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '101');

    // Next discrete step
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '102');

    // Up navigation restores previous item smoothly
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '101');

    // Verify layout queries were bounded
    const rectCalls = await page.evaluate(() => window.rectCallCount);
    expect(rectCalls).toBeLessThan(100);
});


test('current inline X username form is recognized without an old sign-in link', async ({ page }) => {
    await mount(page, []);
    await page.evaluate(() => {
        history.replaceState({}, '', '/');
        document.querySelector('header').remove();
        document.querySelector('#react-root').innerHTML = '<form><input name="username_or_email" type="text"><input name="password" type="password" hidden><button type="submit">继续</button></form>';
    });
    await expect(page.locator('#tv-custom-login-stage')).toBeVisible();
    await expect(page.locator('#tv-stage-google-btn')).toBeVisible();
});

test('TV login offers remote assistance and reports actual authentication separately', async ({ page }) => {
    await mount(page, []);
    await page.evaluate(() => {
        window.assistMessages=[];
        window.browser.runtime.sendMessage=message=>{window.assistMessages.push(message);return Promise.resolve();};
        history.replaceState({}, '', '/i/flow/login');
        window.dispatchEvent(new PopStateEvent('popstate'));
        window.TvXAdapter.reportState();
    });
    await expect(page.locator('#tv-stage-assist-btn')).toBeVisible();
    await page.locator('#tv-stage-assist-btn').click();
    await expect.poll(()=>page.evaluate(()=>window.assistMessages.some(m=>m.event==='login_assist'))).toBe(true);
    expect(await page.evaluate(()=>window.assistMessages.filter(m=>m.event==='state').at(-1).authenticated)).toBe(false);
    await page.evaluate(()=>{history.replaceState({}, '', '/home');window.dispatchEvent(new PopStateEvent('popstate'));});
    await expect.poll(()=>page.evaluate(()=>window.assistMessages.filter(m=>m.event==='state').at(-1).authenticated)).toBe(true);
});

test('login actions remain reachable with a short TV viewport', async ({ page }) => {
    await page.setViewportSize({width:960,height:540});
    await mount(page, []);
    await page.evaluate(()=>{history.replaceState({}, '', '/i/flow/login');window.dispatchEvent(new PopStateEvent('popstate'));});
    await expect(page.locator('#tv-stage-assist-btn')).toBeVisible();
    for(let i=0;i<4;i++)await page.keyboard.press('ArrowDown');
    await expect(page.locator('#tv-stage-apple-btn')).toHaveClass(/tv-custom-focused/);
    const box=await page.locator('#tv-stage-apple-btn').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(540);
});

test('login D-pad stays responsive while the native login DOM settles', async ({ page }) => {
    await mount(page, []);
    await page.evaluate(() => {
        history.replaceState({}, '', '/i/flow/login');
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('#tv-custom-login-stage')).toBeVisible();
    await page.waitForTimeout(150);

    const result = await page.evaluate(async () => {
        let unrelatedPageRefreshes = 0;
        window.TvXMedia.update = () => {
            unrelatedPageRefreshes++;
            // A cold X document makes every full-page update expensive on the TV.
            const deadline = performance.now() + 90;
            while (performance.now() < deadline) { /* deterministic CPU pressure */ }
        };

        const nativeRoot = document.querySelector('#react-root');
        const churn = setInterval(() => {
            const node = document.createElement('span');
            nativeRoot.appendChild(node);
            node.remove();
        }, 5);
        const started = performance.now();
        const keyDelay = await new Promise(resolve => setTimeout(() => {
            const delay = performance.now() - started - 65;
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowDown', bubbles: true, cancelable: true
            }));
            resolve(delay);
        }, 65));
        clearInterval(churn);
        // Include work that the last observed mutation queued for the next tick.
        await new Promise(resolve => setTimeout(resolve, 140));
        return {
            keyDelay,
            unrelatedPageRefreshes,
            focused: document.querySelector('.tv-custom-focused')?.id,
            active: document.activeElement?.id
        };
    });

    expect(result.focused).toBe('tv-stage-next-btn');
    expect(result.active).toBe('tv-stage-next-btn');
    expect(result.keyDelay).toBeLessThan(50);
    expect(result.unrelatedPageRefreshes).toBe(0);
});

test('login focus movement bypasses unrelated page adapters and paints cheaply', async ({ page }) => {
    await mount(page, []);
    await page.evaluate(() => {
        history.replaceState({}, '', '/i/flow/login');
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('#tv-custom-login-stage')).toBeVisible();

    const result = await page.evaluate(() => {
        const calls = [];
        const expensiveMove = name => () => {
            calls.push(name);
            const deadline = performance.now() + 60;
            while (performance.now() < deadline) { /* model unrelated layout work */ }
            return false;
        };
        window.TvXActions.move = expensiveMove('actions');
        window.TvXMedia.move = expensiveMove('media');
        window.TvXCard.move = expensiveMove('card');

        const started = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', bubbles: true, cancelable: true
        }));
        const duration = performance.now() - started;
        const cardStyle = getComputedStyle(document.querySelector('.tv-login-card'));
        const focusStyle = getComputedStyle(document.querySelector('.tv-custom-focused'));
        return {
            calls,
            duration,
            focused: document.querySelector('.tv-custom-focused')?.id,
            active: document.activeElement?.id,
            backdropFilter: cardStyle.backdropFilter,
            focusBoxShadow: focusStyle.boxShadow,
            focusTransform: focusStyle.transform
        };
    });

    expect(result.focused).toBe('tv-stage-next-btn');
    expect(result.active).toBe('tv-stage-next-btn');
    expect(result.calls).toEqual([]);
    expect(result.duration).toBeLessThan(50);
    expect(result.backdropFilter).toBe('none');
    expect(result.focusBoxShadow).toBe('none');
    expect(result.focusTransform).toBe('none');
});

test('hidden custom login stops consuming keys during native authentication', async ({ page }) => {
    await mount(page, []);
    await page.evaluate(() => {
        history.replaceState({}, '', '/i/flow/login');
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('#tv-custom-login-stage')).toBeVisible();

    const prevented = await page.evaluate(() => {
        const stage = document.getElementById('tv-custom-login-stage');
        stage.style.setProperty('display', 'none', 'important');
        document.body.classList.remove('tv-custom-login-active');
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowDown', bubbles: true, cancelable: true
        });
        window.dispatchEvent(event);
        return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
});
