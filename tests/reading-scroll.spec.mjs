import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);
const LONG = 'A paragraph of the article that has to wrap across the column.\n'.repeat(120);

function post(id, {text = 'Post ' + id, complete = true, replyTo = ''} = {}) {
    const legacy = {
        full_text: text,
        reply_count: 0,
        favorite_count: 0,
        created_at: 'Wed Sep 10 06:29:00 +0000 2026',
        in_reply_to_status_id_str: replyTo,
        conversation_id_str: replyTo || id
    };
    if (!complete) legacy.truncated = true;
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author ' + id, screen_name: 'author' + id}}}},
        legacy
    };
}
function payload(tweets) {
    return {
        data: {
            timeline: {
                instructions: [{
                    entries: tweets.map(t => ({content: {itemContent: {tweet_results: {result: t}}}}))
                }]
            }
        }
    };
}
async function mount(page) {
    await page.addInitScript(() => {
        window.calls = [];
        window.ReaderHost = new Proxy({}, {
            get: (_, name) => (...args) => window.calls.push([name, ...args])
        });
    });
    await page.route('https://reader.test/**', async route => {
        const path = new URL(route.request().url()).pathname.slice(1) || 'index.html';
        await route.fulfill({
            body: await readFile(new URL(path, assets)),
            contentType: path.endsWith('.js') ? 'text/javascript' :
                path.endsWith('.css')         ? 'text/css' :
                                                'text/html'
        });
    });
    await page.goto('https://reader.test/');
}
const receive = (page, id, data, error = '') =>
    page.evaluate(([id, data, error]) => TvXReader.receive(id, data, error), [id, data, error]);
const key = (page, k) => page.evaluate(k => TvXReader.key(k), k);
const body = page => page.evaluate(() => {
    const node = document.querySelector('.body');
    const line = parseFloat(getComputedStyle(node).lineHeight);
    return {top: node.scrollTop, view: node.clientHeight, full: node.scrollHeight, line};
});
/** Waits for the reader's own animation to come to rest. */
async function settle(page) {
    await page.waitForTimeout(60);
    let last = -1;
    for (let i = 0; i < 40; i++) {
        const at = (await body(page)).top;
        if (at === last) return at;
        last = at;
        await page.waitForTimeout(60);
    }
    return last;
}
async function openLongDetail(page) {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await key(page, 'ok');
    await receive(page, 'r1', payload([post('101', {text: LONG}), post('201', {replyTo: '101'})]));
    await expect(page.locator('.detail-post')).toHaveCount(1);
}

test('a page down keeps one sixth of the container height as overlap', async ({page}) => {
    await openLongDetail(page);
    const before = await body(page);
    expect(before.full, 'the fixture is not long enough to page').toBeGreaterThan(before.view * 2);
    await key(page, 'down');
    const after = await settle(page);
    const overlap = before.view - after;
    expect(overlap, 'the page moved without leaving any overlap').toBeGreaterThan(0);
    expect(overlap).toBeCloseTo(before.view / 6, 0);
});

test('paging up mirrors the overlap it left going down', async ({page}) => {
    await openLongDetail(page);
    await key(page, 'down');
    const down = await settle(page);
    await key(page, 'up');
    const back = await settle(page);
    expect(back, 'paging back did not return to the start').toBe(0);
    await key(page, 'down');
    await key(page, 'down');
    const twice = await settle(page);
    await key(page, 'up');
    const once = await settle(page);
    expect(Math.abs((twice - once) - down), 'up and down move by different amounts')
        .toBeLessThanOrEqual(2);
});

test('the step is five sixths of the container height', async ({page}) => {
    await openLongDetail(page);
    await key(page, 'down');
    const step = await settle(page);
    const {view} = await body(page);
    expect(step).toBeCloseTo(view * 5 / 6, 0);
});

test('scrolling clamps at both ends of a short and a long body', async ({page}) => {
    await openLongDetail(page);
    await key(page, 'up');
    expect(await settle(page), 'scrolled above the top').toBe(0);
    for (let i = 0; i < 40; i++) await key(page, 'down');
    await settle(page);
    const {top, view, full} = await body(page);
    expect(top, 'scrolled past the bottom').toBeLessThanOrEqual(full - view);
    expect(top, 'did not reach the bottom').toBeGreaterThan(full - view - 4);
});

test('a body that fits does not move at all', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await key(page, 'ok');
    await receive(page, 'r1', payload([post('101'), post('201', {replyTo: '101'})]));
    await key(page, 'down');
    expect(await settle(page)).toBe(0);
});

test('holding the key does not pile animations up behind the reader', async ({page}) => {
    await openLongDetail(page);
    const {view, line} = await body(page);
    await page.evaluate(() => {
        TvXReader.key('down');
        TvXReader.key('down');
        TvXReader.key('down');
    });
    const at = await settle(page);
    const expected = Math.round(view * 5 / 6) * 3;
    expect(Math.abs(at - expected), `chained to ${at}, expected about ${expected}`)
        .toBeLessThanOrEqual(3);
});

test('the comment column scrolls to keep the selected comment in view', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await key(page, 'ok');
    await receive(page, 'r1', payload([
        post('101'),
        ...Array.from({length: 12}, (_, i) => post('20' + i, {text: LONG, replyTo: '101'}))
    ]));
    await key(page, 'right');
    const list = () => page.evaluate(() => {
        const node = document.querySelector('.comment-list');
        return {top: node.scrollTop, view: node.clientHeight, full: node.scrollHeight};
    });
    const before = await list();
    expect(before.full).toBeGreaterThan(before.view * 2);
    for (let i = 0; i < 6; i++) await key(page, 'down');
    await page.waitForTimeout(500);
    const after = await list();
    expect(after.top, 'the comment list never scrolled').toBeGreaterThan(0);
    expect(after.top).toBeLessThanOrEqual(after.full - after.view);
    // The selection is what the column follows, so it must still be on screen.
    const visible = await page.evaluate(() => {
        const selected = document.querySelector('.comment.selected').getBoundingClientRect();
        const area = document.querySelector('.comment-list').getBoundingClientRect();
        return selected.top < area.bottom && selected.bottom > area.top;
    });
    expect(visible, 'the selected comment was scrolled out of view').toBe(true);
});

test('a comment X truncated carries the same marker as a post', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await key(page, 'ok');
    await receive(page, 'r1', payload([
        post('101'),
        post('201', {text: 'Whole reply', replyTo: '101'}),
        post('202', {text: 'Cut off reply', complete: false, replyTo: '101'})
    ]));
    await expect(page.locator('.comment .show-more')).toHaveCount(1);
    await expect(page.locator('.comment').nth(1).locator('.show-more')).toContainText('Show more');
    await page.locator('.comment .show-more').click();
    await expect(page.locator('.detail-post .text')).toContainText('Cut off reply');
    await expect(page.locator('.detail-post .fetching')).toContainText('正在取完整正文');
});

test('the media viewer keeps the up key for zooming', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([{
        ...post('101'),
        legacy: {
            ...post('101').legacy,
            extended_entities: {media: [{type: 'photo', media_url_https: 'https://pbs.twimg.com/a.jpg'}]}
        }
    }]));
    await key(page, 'right');
    await key(page, 'ok');
    await expect(page.locator('.viewer')).toHaveCount(1);
    // The viewer owns up: it pans the picture and never reaches the timeline behind it.
    await key(page, 'up');
    await expect(page.locator('.viewer')).toHaveCount(1);
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'request'))).toEqual([]);
});

test('a preview that is cut off says so, and a short one does not', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {text: LONG}), post('102')]));
    await expect(page.locator('.post .show-more')).toHaveCount(1);
    await expect(page.locator('.post .show-more')).toContainText('Show more');
    await key(page, 'down');
    await expect(page.locator('.post .show-more')).toHaveCount(0);
});

test('a cut-off post opens detail first by remote and by mouse', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {text: LONG})]));
    await key(page, 'ok');
    await expect(page.locator('.detail-post')).toHaveCount(1);
    await expect(page.locator('body.reading')).toHaveCount(0);
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'request').length)).toBe(1);
    await key(page, 'back');
    await expect(page.locator('.detail-post')).toHaveCount(0);
    await expect(page.locator('body.reading')).toHaveCount(0);
    await page.locator('.post .show-more').click();
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'request').length)).toBe(2);
    await expect(page.locator('.detail-post')).toHaveCount(1);
});

test('a post whose text X truncated says the full text is on its way', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {text: 'Short but truncated', complete: false})]));
    await expect(page.locator('.post .show-more')).toHaveCount(1);
    await key(page, 'ok');
    await expect(page.locator('.detail-post .fetching')).toContainText('正在取完整正文');
    await receive(page, 'r1', null, 'network');
    await expect(page.locator('.detail-post .fetching')).toContainText('重试');
});

test('a detail with the whole text already cached shows no marker and never refetches text',
    async ({page}) => {
        await openLongDetail(page);
        await expect(page.locator('.detail-post .show-more')).toHaveCount(0);
        await expect(page.locator('.detail-post .fetching')).toHaveCount(0);
        await expect(page.locator('.detail-post .text')).toContainText('A paragraph of the article');
    });

test('the text reads as X wrote it, entities and all', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {
        text: 'Centralized roles &amp; permissions &lt;tag&gt; &quot;quoted&quot; it&#39;s'
    })]));
    await expect(page.locator('.post .text'))
        .toHaveText('Centralized roles & permissions <tag> "quoted" it\'s');
    // Escaping happens exactly once: no markup leaks into the page.
    expect(await page.locator('.post .text').evaluate(n => n.querySelectorAll('*').length)).toBe(0);
});

test('coming back from the full reading restores the post and where it was', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102', {text: LONG}), post('103')]));
    await key(page, 'down');
    await expect(page.locator('#position')).toHaveText('2 / 3');
    await page.locator('.post .show-more').click();
    await receive(page, 'r1', payload([post('102', {text: LONG}), post('201', {replyTo: '102'})]));
    await key(page, 'down');
    const read = await settle(page);
    expect(read).toBeGreaterThan(0);
    await key(page, 'back');
    await expect(page.locator('#position')).toHaveText('2 / 3');
    await expect(page.locator('.post .name')).toHaveText('Author 102');
});
