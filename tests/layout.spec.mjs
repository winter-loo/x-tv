import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);

function post(id, {text = 'Post ' + id, media = false, replyTo = ''} = {}) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author ' + id, screen_name: 'author' + id}}}},
        legacy: {
            full_text: text,
            reply_count: 0,
            favorite_count: 0,
            in_reply_to_status_id_str: replyTo,
            conversation_id_str: replyTo || id,
            ...(media ? {extended_entities: {media: [{type: 'photo', media_url_https: 'https://pbs.twimg.com/a.jpg'}]}} : {})
        }
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
/** Confirm reads the post full screen; a second confirm opens its detail. */
const openDetail = async page => { await key(page, 'ok'); await key(page, 'ok'); };
const box = (page, selector) => page.evaluate(sel => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height};
}, selector);
/** How far the focus decoration reaches outside the element it is drawn on. */
const ringExtent = (page, selector) => page.evaluate(sel => {
    const style = getComputedStyle(document.querySelector(sel));
    const lengths = (style.boxShadow.match(/-?[\d.]+px/g) || []).map(parseFloat);
    const spread = lengths.length ? Math.max(...lengths.map(Math.abs)) : 0;
    return parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset) + spread;
}, selector);

test('the update line, post count and refresh all sit at the top left', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    const title = await box(page, '#title');
    const half = page.viewportSize().width / 2;
    for (const sel of ['#freshness', '#position', '#refresh']) {
        const at = await box(page, sel);
        expect(at.width, sel + ' is not visible').toBeGreaterThan(0);
        expect(at.left, sel + ' is not on the left').toBeLessThan(half);
    }
    const status = await box(page, '#status');
    expect(Math.abs(status.left - title.left), 'status is not aligned with the title')
        .toBeLessThanOrEqual(1);
});

test('a long update line neither overlaps the posts nor runs off the screen', async ({page}) => {
    await mount(page);
    await page.evaluate(data => TvXReader.cachedHome(data, Date.now() - 86400000),
        payload([post('101'), post('102')]));
    await expect(page.locator('#freshness')).toContainText('上次时间线');
    const status = await box(page, '#status');
    const stage = await box(page, '#stage');
    const refresh = await box(page, '#refresh');
    await expect(page.locator('.post')).toHaveClass(/focus/);
    const extent = await ringExtent(page, '.post');
    expect(status.bottom, 'the status line reaches into the focus ring')
        .toBeLessThanOrEqual(stage.top - extent);
    expect(refresh.right, 'refresh runs off the screen').toBeLessThanOrEqual(page.viewportSize().width);
    expect(refresh.left, 'refresh overlaps the update text').toBeGreaterThanOrEqual(status.left);
});

test('the focused post keeps its whole ring clear of the stage edge', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await expect(page.locator('.post')).toHaveClass(/focus/);
    const post101 = await box(page, '.post');
    const stage = await box(page, '#stage');
    const extent = await ringExtent(page, '.post');
    expect(extent, 'the focus ring has no outward extent to protect').toBeGreaterThan(0);
    expect(post101.left - extent, 'the ring is clipped on the left').toBeGreaterThan(stage.left);
    expect(post101.left - extent, 'the ring is off the screen').toBeGreaterThanOrEqual(0);
    expect(post101.right + extent, 'the ring is clipped on the right').toBeLessThan(stage.right);
    expect(post101.top - extent, 'the ring is clipped at the top').toBeGreaterThan(stage.top);
    expect(post101.bottom + extent, 'the ring is clipped at the bottom').toBeLessThan(stage.bottom);
});

test('the post body is not pressed against its own focus frame', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    const post101 = await box(page, '.post');
    const name = await box(page, '.post .name');
    expect(name.left - post101.left, 'the text touches the frame').toBeGreaterThanOrEqual(6);
});

test('a text-only post keeps about three quarters of the screen', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    const post101 = await box(page, '.post');
    const share = post101.width / page.viewportSize().width;
    expect(share).toBeGreaterThan(0.65);
    expect(share).toBeLessThan(0.85);
});

test('a post with media keeps the two-column split', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {media: true})]));
    const post101 = await box(page, '.post');
    const media = await box(page, '#stage>.media');
    expect(media, 'the media pane is missing').not.toBeNull();
    expect(Math.abs(post101.width - media.width) / post101.width).toBeLessThan(0.15);
    expect(media.left).toBeGreaterThanOrEqual(post101.right);
});

test('the detail starts at the same left edge as the timeline', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    const timeline = await box(page, '.post');
    await openDetail(page);
    await receive(page, 'r1', payload([post('101'), post('201', {replyTo: '101'})]));
    const detail = await box(page, '.detail-post');
    expect(Math.abs(detail.left - timeline.left)).toBeLessThanOrEqual(1);
    const extent = await ringExtent(page, '.detail-post');
    const stage = await box(page, '#stage');
    expect(detail.left - extent).toBeGreaterThanOrEqual(stage.left);
});

test('refresh answers the mouse and the status text adds no focus stops', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await page.locator('#refresh').click();
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'request'))).toHaveLength(1);
    await expect(page.locator('#freshness[tabindex], #position[tabindex]')).toHaveCount(0);
    await expect(page.locator('header button, header a')).toHaveCount(0);
});

test('a link card keeps its domain off the title line', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([{
        ...post('101'),
        legacy: {
            ...post('101').legacy,
            entities: {urls: [{
                url: 'https://t.co/x',
                expanded_url: 'https://aaronqian.com/rust',
                display_url: 'aaronqian.com/rust'
            }]}
        }
    }]));
    const label = await box(page, '.link-card .label');
    const domain = await box(page, '.link-card .domain');
    expect(domain.left, 'the domain shares the title line').toBeLessThanOrEqual(label.left + 1);
    expect(domain.top - label.bottom, 'the domain is glued to the title').toBeGreaterThanOrEqual(4);
});
