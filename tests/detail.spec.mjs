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
    await expect(page.getByRole('button', {name:'写评论…'})).toBeEnabled();
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

test('detail loading state machine shows loading without flashing unavailable when empty without progressbar', async ({ page }) => {
    await mount(page, [post({ id: '101' }), post({ id: '102', text: 'Detail post text', article: true })]);
    await move(page, 'down');
    await activate(page);
    // Emulate initial loading period before React renders anything
    await page.evaluate(() => {
        document.querySelector('[role="tablist"]')?.remove();
        document.querySelector('#timeline').innerHTML = '';
    });
    // Must show '正在加载帖子…' with shimmer skeleton screen, and NEVER false unavailable error
    await expect(page.locator('#tv-detail-status')).toHaveText('正在加载帖子…');
    await expect(page.locator('#tv-detail-status')).toHaveClass(/tv-loading-shimmer/);
    await expect(page.locator('#tv-detail-status')).not.toContainText('暂不可用');
    await expect(page.locator('#tv-detail-skeleton-card')).toBeVisible();

    // Tombstone (e.g. deleted tweet) immediately transitions to friendly error screen with 1-click return
    await page.evaluate(() => {
        document.querySelector('#timeline').innerHTML = '<div data-testid="tombstone">此帖已被删除</div>';
    });
    await expect(page.locator('#tv-detail-status')).toContainText('暂不可用');
    await expect(page.locator('#tv-detail-status')).not.toHaveClass(/tv-loading-shimmer/);
    await expect(page.locator('#tv-detail-skeleton-card')).toHaveCount(0);
    await expect(page.locator('#tv-detail-error-card')).toBeVisible();
    await expect(page.locator('#tv-detail-error-back')).toBeVisible();
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

test('native flex growth and absolute photo wrappers stay within the approved columns', async ({ page }) => {
    await page.setViewportSize({width:980,height:551});
    await openDetail(page,[post({id:'201'})]);
    await page.evaluate(() => {
        document.querySelector('#react-root').style.cssText='display:flex;flex-direction:row;width:100%';
        const primary=document.querySelector('[data-testid="primaryColumn"]');
        const header=document.createElement('div');
        header.style.cssText='position:sticky;top:0';
        header.innerHTML='<div><div><button data-testid="app-bar-back">Back</button><h2>Post</h2></div></div>';
        primary.prepend(header);
        const root=document.querySelector('[data-fixture-id="102"]');
        root.querySelector('[data-testid="tweetText"]').textContent='Native photo post';
        const previous=root.querySelector('[data-testid="article-cover-image"]').parentElement;
        const media=document.createElement('div');
        media.innerHTML='<a role="link" href="/fixture/status/102/photo/1"><div style="position:relative"><div style="padding-bottom:75%"></div><div style="position:absolute;inset:0"><div data-testid="tweetPhoto" style="position:absolute;inset:0"><img alt="Native fixture photo" style="position:absolute;inset:0;width:100%;height:100%"></div></div></div></a>';
        media.querySelector('img').src=root.querySelector('[data-testid="Tweet-User-Avatar"] img').src;
        previous.replaceWith(media);
    });
    await expect.poll(async ()=>(await rect(page.locator('[data-fixture-id="201"]'))).width).toBe(343);
    await expect(page.getByRole('heading',{name:'Post',exact:true})).toBeHidden();
    const text=page.locator('[data-fixture-id="102"] [data-testid="tweetText"]');
    const photo=page.getByAltText('Native fixture photo');
    await expect.poll(async ()=>(await rect(photo)).y).toBeGreaterThan((await rect(text)).y+(await rect(text)).height);
    expect((await rect(photo)).width).toBe(515);
    expect((await rect(photo)).height).toBeGreaterThan(300);
});

test('edited post history timestamps identify the root without adopting a quoted edit history', async ({ page }) => {
    await openDetail(page,[post({id:'201'})]);
    await page.evaluate(() => {
        const root=document.querySelector('[data-fixture-id="102"]');
        const timestamp=root.querySelector('[data-testid="User-Name"] a');
        timestamp.href='/fixture/status/102/history';
        root.querySelector('[role="group"]').before(timestamp);
        const reply=document.querySelector('[data-fixture-id="201"]');
        reply.insertAdjacentHTML('beforeend','<div role="link"><a href="/fixture/status/102/history"><time>Quoted edited timestamp</time></a></div>');
        root.parentElement.before(reply.parentElement);
    });
    await move(page,'down');
    const root=page.locator('[data-fixture-id="102"]');
    await expect.poll(()=>rect(root)).toEqual({x:96,y:160,width:1008,height:716});
    expect(await root.evaluate(node=>node.scrollTop)).toBeGreaterThan(400);
    await expect(page.locator('#tv-detail-status')).toHaveText('');
    await root.evaluate(node=>node.remove());
    await move(page,'up');
    await expect(page.locator('#tv-detail-status')).toContainText('暂不可用');
    await expect(page.locator('[data-fixture-id="201"]')).not.toHaveClass(/tv-detail-post/);
});

test('detail composer opens from reply entry with signed-in identity and correct reply target, showing empty and draft-ready states', async ({ page }) => {
    await openDetail(page, [post({ id: '201' })]);
    await expect(page.getByRole('button', { name: '写评论…' })).toBeEnabled();
    await move(page, 'right');
    await move(page, 'right'); // Focus the fixed write-comment entry.
    await activate(page);
    const dialog = page.locator('#tv-detail-composer-dialog');
    await expect(dialog).toBeVisible();
    expect((await rect(dialog)).width).toBe(880);

    // Verify identity & reply target
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
    await input.fill('A meaningful reply draft');
    await expect(submit).toHaveAttribute('aria-disabled', 'false');

    // Invalid whitespace disables submit
    await input.fill('    ');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');

    // Re-fill and close
    await input.fill('Preserved text');
    await back(page);
    await expect(page.locator('#tv-detail-composer-overlay')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-tv-detail-column', 'comments');
});

test('composer supports remote-only navigation, focus cycling, and suppresses empty submission', async ({ page }) => {
    await openDetail(page, [post({ id: '201' })]);
    await move(page, 'right');
    await move(page, 'right'); // Focus the fixed write-comment entry.
    await activate(page);

    const input = page.locator('#tv-composer-input');
    const submit = page.locator('#tv-composer-submit');
    const cancel = page.locator('#tv-composer-cancel');

    // Initial focus on input
    await expect(input).toBeFocused();

    // Remote navigation down to submit
    await move(page, 'down');
    await expect(submit).toBeFocused();

    // Empty submission does not submit or close
    await activate(page);
    await expect(page.locator('#tv-detail-composer-dialog')).toBeVisible();

    // Move right to cancel
    await move(page, 'right');
    await expect(cancel).toBeFocused();

    // Move left back to submit
    await move(page, 'left');
    await expect(submit).toBeFocused();

    // Move up back to input
    await move(page, 'up');
    await expect(input).toBeFocused();

    // Tab key cycling
    await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();

    // Activate cancel closes composer
    await move(page, 'down');
    await move(page, 'right');
    await activate(page);
    await expect(page.locator('#tv-detail-composer-overlay')).toHaveCount(0);
});

test('detail composer activates cursor on Enter, navigates via remote D-pad keys, and synchronizes voice IME input', async ({ page }) => {
    await openDetail(page, [post({ id: '201' })]);
    await move(page, 'right');
    await move(page, 'right');
    await activate(page);

    const input = page.locator('#tv-composer-input');
    const submit = page.locator('#tv-composer-submit');
    const cancel = page.locator('#tv-composer-cancel');

    // Initial focus on input
    await expect(input).toBeFocused();

    // Enter on input activates cursor / IME without submitting or inserting newline
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
        el.value = 'Voice recognition result from Dangbei remote';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('compositionend', { bubbles: true }));
    });
    await expect(submit).toHaveAttribute('aria-disabled', 'false');

    // Escape closes composer and restores focus
    await page.keyboard.press('Escape');
    await expect(page.locator('#tv-detail-composer-overlay')).toHaveCount(0);
});

test('real X reply flow: submits to native composer, enters pending, suppresses duplicates, confirms success with sent simulation, and reconciles count', async ({ page }) => {
    await openDetail(page, [post({ id: '201' })]);
    await page.evaluate(() => {
        const primary = document.querySelector('[data-testid="primaryColumn"]');
        const composer = document.createElement('div');
        composer.innerHTML = `
            <div data-testid="tweetTextarea_0" contenteditable="true" role="textbox"></div>
            <button data-testid="tweetButtonInline">Reply</button>
        `;
        primary.prepend(composer);
        window.submittedReplies = [];
        composer.querySelector('[data-testid="tweetButtonInline"]').onclick = () => {
            const input = composer.querySelector('[data-testid="tweetTextarea_0"]');
            window.submittedReplies.push(input.textContent || input.value);
        };
    });

    await move(page, 'right');
    await move(page, 'right'); // Focus the fixed write-comment entry.
    await activate(page);
    await page.locator('#tv-composer-input').fill('Native reply content from TV');
    await move(page, 'down');
    await activate(page);

    // Native X composer received the text
    expect(await page.evaluate(() => window.submittedReplies)).toEqual(['Native reply content from TV']);

    // Pending state
    const submit = page.locator('#tv-composer-submit');
    const status = page.locator('#tv-composer-status');
    await expect(status).toHaveText('正在发送回复…');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await expect(submit).toHaveAttribute('aria-busy', 'true');

    // Duplicate submission while pending is suppressed
    await activate(page);
    expect(await page.evaluate(() => window.submittedReplies.length)).toBe(1);

    // Native confirmation from X
    await page.evaluate(replyHtml => {
        const input = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (input) input.textContent = '';
        const replyBtn = document.querySelector('[data-fixture-id="102"] [data-testid="reply"] span');
        if (replyBtn) replyBtn.textContent = '18';
        document.querySelector('#timeline').insertAdjacentHTML('beforeend', replyHtml);
    }, post({ id: '202', text: 'Native reply content from TV' }));

    // Sent simulation treatment
    await expect(page.locator('#tv-composer-sent')).toBeVisible();
    await expect(status).toHaveText('已发送，即将返回评论');

    // Auto-return to comments view
    await expect(page.locator('#tv-detail-composer-overlay')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-tv-detail-column', 'comments');
    await expect(page.locator('[data-fixture-id="202"]')).toHaveClass(/tv-detail-reply/);
    await expect(page.locator('#tv-detail-comments-title')).toHaveText('评论 18　　↓ 更多');
});

test('failed submission preserves draft, displays error, and provides retry path that succeeds', async ({ page }) => {
    await openDetail(page, [post({ id: '201' })]);
    await page.evaluate(() => {
        const primary = document.querySelector('[data-testid="primaryColumn"]');
        const composer = document.createElement('div');
        composer.innerHTML = `
            <textarea data-testid="tweetTextarea_0"></textarea>
            <button data-testid="tweetButtonInline">Reply</button>
        `;
        primary.prepend(composer);
        let attempts = 0;
        composer.querySelector('[data-testid="tweetButtonInline"]').onclick = () => {
            attempts++;
            if (attempts === 1) {
                const toast = document.createElement('div');
                toast.setAttribute('data-testid', 'toast');
                toast.textContent = 'Server rejection: failed to reply';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 1000);
            } else {
                const replyBtn = document.querySelector('[data-fixture-id="102"] [data-testid="reply"] span');
                if (replyBtn) replyBtn.textContent = '18';
                window.dispatchEvent(new CustomEvent('tv_reply_result', { detail: { outcome: 'confirmed' } }));
            }
        };
    });

    await move(page, 'right');
    await move(page, 'right'); // Focus the fixed write-comment entry.
    await activate(page);
    const input = page.locator('#tv-composer-input');
    await input.fill('Draft to retry on failure');
    await move(page, 'down');
    await activate(page);

    // Failure state
    const status = page.locator('#tv-composer-status');
    const submit = page.locator('#tv-composer-submit');
    await expect(status).toHaveText('未能发送回复，请确认重试');
    await expect(input).toHaveValue('Draft to retry on failure');
    await expect(submit).toHaveAttribute('aria-disabled', 'false');
    await expect(submit).toHaveText('重试');
    await expect(submit).toBeFocused();

    // Activating retry path
    await activate(page);
    await expect(page.locator('#tv-composer-sent')).toBeVisible();
    await expect(page.locator('#tv-detail-composer-overlay')).toHaveCount(0);
    await expect(page.locator('#tv-detail-comments-title')).toHaveText('评论 18　　↓ 更多');
});

test('cancellation leaves without publishing, preserves draft on reopen, and restores column scroll positions', async ({ page }) => {
    await openDetail(page, Array.from({ length: 12 }, (_, i) => post({ id: String(201 + i), text: 'Reply text. '.repeat(35) })));
    const root = page.locator('[data-fixture-id="102"]');

    // Scroll post column
    await move(page, 'down');
    const postScroll = await root.evaluate(node => node.scrollTop);
    expect(postScroll).toBeGreaterThan(400);

    // Scroll comments column
    await move(page, 'right');
    await move(page, 'down');
    const commentsScroll = await page.evaluate(() => window.scrollY);
    expect(commentsScroll).toBeGreaterThan(400);

    // Open composer without changing the selected comment's scroll position.
    await move(page, 'right');
    await activate(page);
    await expect(page.locator('#tv-detail-composer-dialog')).toBeVisible();
    await page.locator('#tv-composer-input').fill('Cancelled draft thought');

    // Cancel via Back
    await back(page);
    await expect(page.locator('#tv-detail-composer-overlay')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-tv-detail-column', 'comments');

    // Verify independent scroll offsets preserved
    expect(await root.evaluate(node => node.scrollTop)).toBe(postScroll);
    expect(await page.evaluate(() => window.scrollY)).toBe(commentsScroll);

    // Reopen preserves draft
    await activate(page);
    await expect(page.locator('#tv-composer-input')).toHaveValue('Cancelled draft thought');
    await expect(page.locator('#tv-composer-submit')).toHaveAttribute('aria-disabled', 'false');
    await back(page);
    await expect(page.locator('#tv-detail-composer-overlay')).toHaveCount(0);
});


test('remote selects a comment and opens its canonical detail instead of the composer', async ({ page }) => {
    await openDetail(page,[post({id:'201'}),post({id:'202'})]);
    await page.evaluate(()=>{window.TvXNativeHost={openPost:path=>window.__openedComment=path};});
    await move(page,'right');
    await expect(page.locator('[data-fixture-id="201"]')).toHaveAttribute('data-tv-reply-selected','true');
    await move(page,'down');
    await expect(page.locator('[data-fixture-id="202"]')).toHaveAttribute('data-tv-reply-selected','true');
    await activate(page);
    await expect.poll(()=>page.evaluate(()=>window.__openedComment)).toBe('/fixture/status/202');
    await expect(page.locator('#tv-detail-composer-overlay')).toHaveCount(0);
    await expect(page).toHaveURL('https://x.com/fixture/status/102');
});

test('comment identity survives DOM replacement and refuses a recycled row', async ({page}) => {
    await openDetail(page,[post({id:'201'})]);
    await page.evaluate(()=>{window.TvXNativeHost={openPost:path=>window.__openedComment=path};});
    await move(page,'right');
    await page.locator('[data-fixture-id="201"]').evaluate((n,html)=>n.parentElement.outerHTML=html,post({id:'201',text:'Updated same comment'}));
    await expect(page.locator('[data-fixture-id="201"]')).toHaveAttribute('data-tv-reply-selected','true');
    await page.locator('[data-fixture-id="201"] a[href="/fixture/status/201"]').evaluate(n=>n.setAttribute('href','/fixture/status/299'));
    await activate(page);
    expect(await page.evaluate(()=>window.__openedComment)).toBeUndefined();
    await move(page,'down');await activate(page);
    await expect.poll(()=>page.evaluate(()=>window.__openedComment)).toBe('/fixture/status/299');
});

test('a second Right selects the write-comment entry without opening a comment', async ({page}) => {
    await openDetail(page,[post({id:'201'})]);
    await move(page,'right');await move(page,'right');await activate(page);
    await expect(page.locator('#tv-detail-composer-dialog')).toBeVisible();
    await back(page);
    await move(page,'up');
    await expect(page.locator('[data-fixture-id="201"]')).toHaveAttribute('data-tv-reply-selected','true');
});

test('clicking comment text opens its own edited permalink without following quoted identity', async ({page}) => {
    await openDetail(page,[post({id:'201'})]);
    await page.evaluate(()=>{window.TvXNativeHost={openPost:path=>window.__openedComment=path};});
    await page.locator('[data-fixture-id="201"] a[href="/fixture/status/201"]').evaluate(n=>n.setAttribute('href','/fixture/status/201/history'));
    await page.locator('[data-fixture-id="201"]').evaluate(node => node.insertAdjacentHTML('afterbegin','<div role="link"><div data-testid="User-Name"><a href="/quoted/status/999"><time>Quoted time</time></a></div></div>'));
    await page.locator('[data-fixture-id="201"] [data-testid="tweetText"]').click();
    await expect.poll(()=>page.evaluate(()=>window.__openedComment)).toBe('/fixture/status/201');
});


test('long comment scrolls before advancing and late pagination selects the newly loaded comment', async ({page}) => {
    await openDetail(page,[post({id:'201',text:'Long reply. '.repeat(200)})]);
    await move(page,'right');await move(page,'down');
    await expect(page.locator('[data-fixture-id="201"]')).toHaveAttribute('data-tv-reply-selected','true');
    expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(400);
    for (let i=0;i<20;i++) await move(page,'down');
    await page.locator('#timeline').evaluate((node,html)=>node.insertAdjacentHTML('beforeend',html),post({id:'202'}));
    await expect(page.locator('[data-fixture-id="202"]')).toHaveAttribute('data-tv-reply-selected','true');
});


test('ancestor context is not presented as a child comment in a reply detail', async ({page}) => {
    await openDetail(page,[post({id:'201'})]);
    await page.locator('[data-fixture-id="102"]').evaluate((node,html)=>node.parentElement.insertAdjacentHTML('beforebegin',html),post({id:'100',text:'Parent context'}));
    await expect(page.locator('[data-fixture-id="100"]')).toBeHidden();
    await move(page,'right');
    await expect(page.locator('[data-fixture-id="201"]')).toHaveAttribute('data-tv-reply-selected','true');
    await page.locator('[data-fixture-id="201"]').evaluate(node=>node.parentElement.remove());
    await expect(page.locator('#tv-detail-reply-status')).toHaveText('暂无已加载评论');
});
