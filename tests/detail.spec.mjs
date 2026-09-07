import { test, expect } from '@playwright/test';
import { mount, post, move, activate, back, rect } from './fixtures/timeline.mjs';

async function openDetail(page, replies = []) {
    await mount(page, [post({ id: '101' }), post({ id: '102', text: 'Long body. '.repeat(400), article: true })]);
    await move(page, 'down');
    await activate(page);
    await page.evaluate(html => {
        document.querySelector('[role="tablist"]').remove();
        document.querySelector('#timeline').innerHTML = html;
    }, post({ id: '102', text: 'Long body. '.repeat(400), article: true }) + replies.join(''));
    await page.waitForFunction(() => Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith('detail.css')));
}

test('detail uses native post and replies at the approved column geometry', async ({ page }) => {
    await openDetail(page, [post({id:'201',text:'Real reply fixture'})]);
    await expect.poll(() => rect(page.locator('[data-fixture-id="102"]'))).toEqual({x:96,y:160,width:1008,height:716});
    await expect.poll(async () => (await rect(page.locator('[data-fixture-id="201"]'))).x).toBe(1152);
    await expect.poll(async () => (await rect(page.locator('[data-fixture-id="201"]'))).width).toBe(672);
    await expect.poll(async () => (await rect(page.locator('[data-fixture-id="201"] [data-testid="tweetText"]'))).x).toBe(1224);
    await expect(page.getByRole('button', {name:'写评论…'})).toBeDisabled();
    await expect(page.locator('[data-fixture-id="201"]')).not.toHaveClass(/tv-focused/);
});

test('column scrolling stays independent through thread updates and fixed controls remain visible', async ({ page }) => {
    await openDetail(page, Array.from({length:12}, (_,i) => post({id:String(201+i),text:'Reply text. '.repeat(35)})));
    await expect(page.locator('body')).toHaveAttribute('data-tv-detail-column','post');
    const root = page.locator('[data-fixture-id="102"]');
    await move(page,'down');
    const postScroll = await root.evaluate(node => node.scrollTop);
    expect(postScroll).toBeGreaterThan(400);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await move(page,'right');
    await move(page,'down');
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    expect(await root.evaluate(node => node.scrollTop)).toBe(postScroll);
    await expect.poll(async () => (await rect(root.locator('[role="group"]'))).y).toBe(896);
    await expect(page.getByRole('button',{name:'写评论…'})).toBeVisible();
    await page.locator('#timeline').evaluate((node,html) => node.insertAdjacentHTML('beforeend',html),post({id:'999'}));
    await expect(page.locator('[data-fixture-id="999"]')).toHaveClass(/tv-detail-reply/);
    await expect(page.locator('body')).toHaveAttribute('data-tv-detail-column','comments');
    await move(page,'left');
    expect(await root.evaluate(node => node.scrollTop)).toBe(postScroll);
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/102');
});

test('loading, empty and unavailable details retain column focus and never activate a reply', async ({ page }) => {
    await openDetail(page);
    await expect(page.locator('#tv-detail-reply-status')).toHaveText('暂无已加载评论');
    await page.locator('#timeline').evaluate(node => node.insertAdjacentHTML('beforeend','<div role="progressbar"></div>'));
    await expect(page.locator('#tv-detail-reply-status')).toHaveText('正在加载评论…');
    await move(page,'right');
    await page.locator('#timeline').evaluate(node => {node.innerHTML='<div role="progressbar"></div>';});
    await expect(page.locator('#tv-detail-status')).toHaveText('正在加载帖子…');
    await page.locator('#timeline').evaluate((node,html) => {node.innerHTML=html;},post({id:'201'}));
    await expect(page.locator('#tv-detail-status')).toContainText('暂不可用');
    await expect(page.locator('body')).toHaveAttribute('data-tv-detail-column','comments');
    await activate(page);
    await expect(page).toHaveURL('https://x.com/fixture/status/102');
    await expect(page.locator('.tv-focused')).toHaveCount(0);
});

test('Back dismisses a native overlay then restores the original home post after native routing', async ({ page }) => {
    await openDetail(page,[post({id:'201'})]);
    await expect(page.locator('#tv-detail-header')).toBeVisible();
    await page.evaluate(() => {
        const dialog=document.createElement('div');
        dialog.setAttribute('role','dialog');
        dialog.innerHTML='<button aria-label="Close">Close</button>';
        dialog.querySelector('button').onclick=()=>dialog.remove();
        document.body.appendChild(dialog);
    });
    await back(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL('https://x.com/fixture/status/102');
    await back(page);
    await expect(page).toHaveURL('https://x.com/home');
    await page.evaluate(html => {
        document.querySelector('#timeline').innerHTML=html;
        document.querySelector('[data-testid="primaryColumn"]').insertAdjacentHTML('afterbegin','<div role="tablist"><div role="tab" aria-selected="true">For you</div></div>');
    },post({id:'101'})+post({id:'102'}));
    await expect(page.locator('[data-fixture-id="102"]')).toHaveClass(/tv-focused/);
    await expect.poll(async () => (await rect(page.locator('[data-fixture-id="102"]'))).y).toBe(192);
    await expect(page.locator('#tv-detail-chrome')).toHaveCount(0);
});

test('detail identifies its own footer timestamp without mistaking a quoted post for the root', async ({ page }) => {
    await openDetail(page,[post({id:'201'})]);
    await page.evaluate(() => {
        const selected=document.querySelector('[data-fixture-id="102"]');
        const time=selected.querySelector('[data-testid="User-Name"] a');
        time.querySelector('time').textContent='10:42 AM · Sep 7, 2026';
        selected.querySelector('[role="group"]').before(time);
        const reply=document.querySelector('[data-fixture-id="201"]');
        // A preceding reply quotes the current root, including its own nested identity.
        const quote=document.createElement('div');
        quote.setAttribute('role','link');
        quote.innerHTML='<div data-testid="User-Name"><a href="/fixture/status/102"><time>Quoted timestamp</time></a></div>';
        reply.appendChild(quote);
        selected.parentElement.before(reply.parentElement);
    });
    const selected=page.locator('[data-fixture-id="102"]');
    await expect.poll(() => rect(selected)).toEqual({x:96,y:160,width:1008,height:716});
    await expect(page.locator('[data-fixture-id="201"]')).not.toHaveClass(/tv-detail-post/);
    await expect(page.locator('#tv-detail-status')).toHaveText('');
    // The native footer metadata remains readable rather than being flattened away.
    await expect(selected.getByText('10:42 AM · Sep 7, 2026')).toBeVisible();
    await move(page,'down');
    expect(await selected.evaluate(node=>node.scrollTop)).toBeGreaterThan(400);
    // If the real root disappears, the quoted timestamp must never take its place.
    await selected.evaluate(node=>node.remove());
    await expect(page.locator('#tv-detail-status')).toContainText('暂不可用');
    await page.locator('[data-fixture-id="201"] [data-testid="User-Name"] a').first().evaluate(node=>node.remove());
    await move(page,'up');
    await expect(page.locator('[data-fixture-id="201"]')).not.toHaveClass(/tv-detail-post/);
});

test('reinjection retains detail focus and scrolling, and unmount removes its chrome', async ({ page }) => {
    await openDetail(page,[post({id:'201',text:'Reply text. '.repeat(150)})]);
    await move(page,'down');
    const selected=page.locator('[data-fixture-id="102"]');
    const before=await selected.evaluate(node=>node.scrollTop);
    await move(page,'right');
    const {fileURLToPath}=await import('node:url');
    await page.addScriptTag({path:fileURLToPath(new URL('../app/src/main/assets/tv-extension/sites/x/detail.js',import.meta.url))});
    await move(page,'down');
    await expect(page.locator('body')).toHaveAttribute('data-tv-detail-column','comments');
    expect(await selected.evaluate(node=>node.scrollTop)).toBe(before);
    await expect(page.locator('#tv-detail-chrome')).toHaveCount(1);
    await page.evaluate(()=>window.TvXAdapter.unmount());
    await expect(page.locator('#tv-detail-chrome')).toHaveCount(0);
    await expect(page.locator('.tv-detail-post')).toHaveCount(0);
    await page.evaluate(()=>window.TvXAdapter.init());
    await expect(page.locator('#tv-detail-chrome')).toHaveCount(1);
});
