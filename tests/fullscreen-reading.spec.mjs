import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);
const LONG = 'A paragraph of the post that has to wrap across the column.\n'.repeat(120);

function post(id, {text = 'Post ' + id, media = false, replyTo = '', complete = true} = {}) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author ' + id, screen_name: 'author' + id}}}},
        legacy: {
            full_text: text,
            reply_count: 0,
            favorite_count: 0,
            conversation_id_str: replyTo || id,
            ...(complete ? {} : {truncated: true}),
            ...(replyTo ? {in_reply_to_status_id_str: replyTo} : {}),
            ...(media ? {extended_entities: {media: [{type: 'photo', media_url_https: 'https://pbs.twimg.com/a.jpg'}]}} : {})
        }
    };
}
function payload(tweets, cursor = '') {
    return {
        data: {
            timeline: {
                instructions: [{
                    entries: [
                        ...tweets.map(t => ({content: {itemContent: {tweet_results: {result: t}}}})),
                        {content: {cursorType: 'Bottom', value: cursor}}
                    ]
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
const key = (page, k) => page.evaluate(k => TvXReader.key(k), k);
const receive = (page, id, data, error = '') =>
    page.evaluate(([id, data, error]) => TvXReader.receive(id, data, error), [id, data, error]);
const requests = page => page.evaluate(() => calls.filter(c => c[0] === 'request'));
const box = (page, selector) => page.locator(selector).boundingBox();
const reading = page => page.evaluate(() => document.body.classList.contains('reading'));

/** Long enough not to fit: reading mode is only offered for a post that overflows its pane. */
async function timeline(page, tweets = [post('101', {text: LONG, media: true}), post('102')]) {
    await mount(page);
    await receive(page, 'r0', payload(tweets));
}
/** The timeline, then into the detail of its first post, both panes populated. */
async function detail(page, {text = LONG} = {}) {
    await timeline(page, [post('101', {text: LONG, media: true})]);
    await key(page, 'ok');
    await key(page, 'ok');
    const asked = (await requests(page)).filter(c => c[2] === 'detail');
    await receive(page, asked[0][1],
        payload([post('101', {text, media: true}), post('201', {text: 'Reply 201', replyTo: '101'})]));
    await expect(page.locator('.detail-post')).toHaveCount(1);
}

test('confirm on a timeline post reads it full screen, three quarters wide and centred', async ({page}) => {
    await timeline(page);
    expect(await reading(page)).toBe(false);
    await expect(page.locator('header')).toBeVisible();
    await key(page, 'ok');

    expect(await reading(page)).toBe(true);
    await expect(page.locator('header')).toBeHidden();
    const stage = await box(page, '#stage');
    const view = page.viewportSize();
    expect(stage.width).toBeCloseTo(view.width * 0.75, 0);
    // Centred: the gap on the left matches the gap on the right.
    expect(stage.x).toBeCloseTo(view.width - stage.x - stage.width, 0);
    // The header is gone, but the focus ring must not end up on the screen edge.
    expect((await box(page, '.post')).y).toBeGreaterThanOrEqual(6);
    expect(await requests(page)).toHaveLength(0);
});

test('full screen unifies the post and its media into a single scrollable container', async ({page}) => {
    await timeline(page);
    const beside = {post: await box(page, '.post'), media: await box(page, '#stage>.media')};
    expect(beside.media.x).toBeGreaterThan(beside.post.x + beside.post.width - 1);

    await key(page, 'ok');
    await expect(page.locator('#stage>.media')).toHaveCount(0);
    await expect(page.locator('.post .media')).toHaveCount(1);

    const postBox = await box(page, '.post');
    const mediaBox = await box(page, '.post .media');
    expect(mediaBox.x).toBeGreaterThanOrEqual(postBox.x);

    const scrollBefore = await page.evaluate(() => (document.querySelector('.post-content') || document.querySelector('.post')).scrollTop);
    expect(scrollBefore).toBe(0);
    await key(page, 'down');
    await expect(page.locator('#guide-canvas')).toHaveCount(1);
    await page.waitForTimeout(300);
    const scrollAfter = await page.evaluate(() => (document.querySelector('.post-content') || document.querySelector('.post')).scrollTop);
    expect(scrollAfter).toBeGreaterThan(0);
});

test('back leaves reading mode and puts the page back the way it was', async ({page}) => {
    await timeline(page);
    const before = {stage: await box(page, '#stage'), post: await box(page, '.post')};
    await key(page, 'ok');
    expect(await reading(page)).toBe(true);

    await key(page, 'back');
    expect(await reading(page)).toBe(false);
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('#position')).toHaveText('1 / 2');
    await expect(page.locator('.post .text')).toContainText('A paragraph of the post');
    expect(await box(page, '#stage')).toEqual(before.stage);
    expect(await box(page, '.post')).toEqual(before.post);
    await page.evaluate(() => calls.length = 0);
    await key(page, 'back');
    expect(await page.evaluate(() => calls.map(c => c[0]))).toEqual(['exit']);
});

test('a second confirm from reading mode still opens the post detail', async ({page}) => {
    await timeline(page);
    await key(page, 'ok');
    await key(page, 'ok');
    const asked = (await requests(page)).filter(c => c[2] === 'detail');
    expect(asked).toHaveLength(1);
    expect(asked[0][3]).toBe('101');
});

test('the detail reads full screen in a unified container', async ({page}) => {
    await detail(page);
    const beside = {post: await box(page, '.detail-post'), comments: await box(page, '.comments')};
    expect(beside.comments.x).toBeGreaterThan(beside.post.x + beside.post.width - 1);

    await key(page, 'ok');
    expect(await reading(page)).toBe(true);
    await expect(page.locator('header')).toBeHidden();
    await expect(page.locator('.comments')).toBeHidden();
    expect(await box(page, '#stage')).toMatchObject({width: page.viewportSize().width * 0.75});
});

test('back in a full-screen detail leaves reading mode before it leaves the post', async ({page}) => {
    await detail(page);
    await key(page, 'ok');
    expect(await reading(page)).toBe(true);

    await key(page, 'back');
    expect(await reading(page)).toBe(false);
    await expect(page.locator('.detail-post')).toHaveCount(1);
    await key(page, 'back');
    await expect(page.locator('.detail-post')).toHaveCount(0);
    await expect(page.locator('#position')).toHaveText('1 / 1');
});

test('reading mode belongs to the scene it was entered from', async ({page}) => {
    await timeline(page);
    await key(page, 'ok');
    await key(page, 'ok');
    const asked = (await requests(page)).filter(c => c[2] === 'detail');
    await receive(page, asked[0][1], payload([post('101', {media: true})]));
    // The detail opens in the ordinary layout, however the timeline behind it was being read.
    expect(await reading(page)).toBe(false);
    await key(page, 'back');
    expect(await reading(page)).toBe(true);
    await expect(page.locator('header')).toBeHidden();
});

test('a third confirm in a full-screen detail opens the media, as confirm always did', async ({page}) => {
    await detail(page);
    await expect(page.locator('#help')).toContainText('确认 全屏阅读');
    await key(page, 'ok');
    await key(page, 'ok');
    await expect(page.locator('.viewer')).toHaveCount(1);
    await key(page, 'back');
    await expect(page.locator('.viewer')).toHaveCount(0);
    expect(await reading(page)).toBe(true);
});

test('confirm on the media pane opens the picture rather than reading mode', async ({page}) => {
    await timeline(page);
    await key(page, 'right');
    await key(page, 'ok');
    await expect(page.locator('.viewer')).toHaveCount(1);
    expect(await reading(page)).toBe(false);
});

test('the footer says what confirm and back mean in each mode', async ({page}) => {
    await timeline(page);
    await expect(page.locator('#help')).toContainText('确认 全屏阅读');
    await key(page, 'ok');
    await expect(page.locator('#help')).toContainText('确认 帖子详情');
    await expect(page.locator('#help')).toContainText('返回 退出全屏');

    await detail(page);
    await expect(page.locator('#help')).toContainText('确认 全屏阅读');
    await expect(page.locator('#help')).toContainText('返回 上一层');
    await key(page, 'ok');
    await expect(page.locator('#help')).toContainText('确认 查看媒体');
    await expect(page.locator('#help')).toContainText('返回 退出全屏');
});

test('a post that already fits keeps confirm on its detail, with no extra press', async ({page}) => {
    await timeline(page, [post('101'), post('102')]);
    await expect(page.locator('#help')).toContainText('确认 帖子详情');
    await key(page, 'ok');
    expect(await reading(page)).toBe(false);
    const asked = (await requests(page)).filter(c => c[2] === 'detail');
    expect(asked).toHaveLength(1);
    expect(asked[0][3]).toBe('101');
});

test('a detail that already fits keeps confirm on its media', async ({page}) => {
    await detail(page, {text: 'Short enough to fit the pane'});
    await expect(page.locator('#help')).toContainText('确认 查看媒体');
    await key(page, 'ok');
    expect(await reading(page)).toBe(false);
    await expect(page.locator('.viewer')).toHaveCount(1);
});

test('an excerpt X has not sent in full goes to fetch it rather than into reading mode', async ({page}) => {
    await timeline(page, [post('101', {text: LONG, complete: false})]);
    await expect(page.locator('.post .show-more')).toHaveCount(1);
    await expect(page.locator('#help')).toContainText('确认 帖子详情');
    await key(page, 'ok');
    expect(await reading(page)).toBe(false);
    expect((await requests(page)).filter(c => c[2] === 'detail')).toHaveLength(1);
});

test('a post grown too long to fit offers reading mode without being reloaded', async ({page}) => {
    await timeline(page, [post('101'), post('102')]);
    await expect(page.locator('#help')).toContainText('确认 帖子详情');
    await receive(page, 'r0', payload([post('101', {text: LONG}), post('102')]));
    await expect(page.locator('#help')).toContainText('确认 全屏阅读');
    await key(page, 'ok');
    expect(await reading(page)).toBe(true);
    expect(await requests(page)).toHaveLength(0);
});

test('a long post in full screen displays an initial idle guide dot at 1/6th from bottom', async ({page}) => {
    await timeline(page, [post('101', {text: LONG})]);
    await key(page, 'ok');
    expect(await reading(page)).toBe(true);
    await expect(page.locator('#guide-canvas')).toHaveCount(1);

    const checkDot = await page.evaluate(() => {
        const canvas = document.getElementById('guide-canvas');
        const post = document.querySelector('.post-content') || document.querySelector('.post');
        const thresholdRelY = post.clientHeight - Math.round(post.clientHeight / 6);
        const postNode = post.closest('.post') || post;
        const cx = postNode.offsetLeft + 30;
        const headY = postNode.offsetTop + thresholdRelY;
        const ctx = canvas.getContext('2d');
        const pixel = ctx.getImageData(cx, headY, 1, 1).data;
        return { cx, headY, pixel: Array.from(pixel) };
    });
    expect(checkDot.pixel[3]).toBeGreaterThan(0);
});

test('downward guide comet stops at the top of the container where threshold text moved', async ({page}) => {
    await timeline(page, [post('101', {text: LONG})]);
    await key(page, 'ok');

    const cometResult = await page.evaluate(() => {
        const post = document.querySelector('.post-content') || document.querySelector('.post');
        const step = post.clientHeight - Math.round(post.clientHeight / 6);
        TvXReader.drawGuideComet(post, 1, 1, false, 0, 0, step);
        const canvas = document.getElementById('guide-canvas');
        const ctx = canvas.getContext('2d');
        const postNode = post.closest('.post') || post;
        const cx = postNode.offsetLeft + 30;
        const topY = postNode.offsetTop; // Y_rel = 0
        const pixel = ctx.getImageData(cx, topY, 1, 1).data;
        return { cx, topY, pixel: Array.from(pixel) };
    });
    expect(cometResult.pixel[3]).toBeGreaterThan(0);
});

test('stats bar with replies, likes and views stays visible in viewport across scrolling in full screen reading', async ({page}) => {
    await timeline(page, [post('101', {text: LONG})]);
    await key(page, 'ok');
    expect(await reading(page)).toBe(true);

    const statsLocator = page.locator('.post .stats');
    await expect(statsLocator).toBeVisible();
    await expect(statsLocator).toBeInViewport();

    // Scroll down to next page of post
    await key(page, 'down');
    await page.waitForTimeout(350);
    const scrollPos = await page.evaluate(() =>
        (document.querySelector('.post-content') || document.querySelector('.post')).scrollTop
    );
    expect(scrollPos).toBeGreaterThan(0);

    // Stats bar must still be visible and in viewport at the bottom of the card!
    await expect(statsLocator).toBeVisible();
    await expect(statsLocator).toBeInViewport();
});

