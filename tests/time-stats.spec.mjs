import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
/** X sends created_at in this shape, so the fixtures do too. */
function xDate(msAgo) {
    return new Date(NOW - msAgo)
        .toUTCString()
        .replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) ([\d:]{8}) GMT$/, '$1 $3 $2 $5 +0000 $4');
}
function post(id, {text = 'Post ' + id, created = xDate(3 * 3600e3), replies, likes, views,
                   liked = false, replyTo = ''} = {}) {
    const legacy = {
        full_text: text,
        created_at: created,
        favorited: liked,
        in_reply_to_status_id_str: replyTo,
        conversation_id_str: replyTo || id
    };
    if (created === null) delete legacy.created_at;
    if (replies !== undefined) legacy.reply_count = replies;
    if (likes !== undefined) legacy.favorite_count = likes;
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author ' + id, screen_name: 'author' + id}}}},
        legacy,
        ...(views !== undefined ? {views: {count: String(views)}} : {})
    };
}
function payload(tweets, cursor = '') {
    return {
        data: {
            timeline: {
                instructions: [{
                    entries: [
                        ...tweets.map(t => ({content: {itemContent: {tweet_results: {result: t}}}})),
                        ...(cursor ? [{content: {cursorType: 'Bottom', value: cursor}}] : [])
                    ]
                }]
            }
        }
    };
}
async function mount(page) {
    await page.clock.install({time: new Date(NOW)});
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
async function openDetail(page, tweets) {
    await key(page, 'ok');
    await key(page, 'ok');
    await receive(page, 'r1', payload(tweets));
    await expect(page.locator('.detail-post')).toHaveCount(1);
}

test('the timeline post carries how long ago it was published', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {created: xDate(3 * 3600e3)})]));
    await expect(page.locator('.post .time')).toHaveText('3 小时前');
});

test('the detail spells the publication time out in full, year and minutes included', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await openDetail(page, [post('101', {created: xDate(400 * 24 * 3600e3)}), post('201', {replyTo: '101'})]);
    const full = await page.locator('.detail-post .time').textContent();
    expect(full, 'the detail time has no year').toMatch(/2025/);
    expect(full, 'the detail time has no clock time').toMatch(/\d{1,2}:\d{2}/);
});

test('every comment shows when it was published, first batch and next page alike', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await key(page, 'ok');
    await key(page, 'ok');
    await receive(page, 'r1', payload([
        post('101'),
        post('201', {replyTo: '101', created: xDate(30 * 60e3)}),
        post('202', {replyTo: '101', created: xDate(2 * 24 * 3600e3)})
    ], 'next-page'));
    await expect(page.locator('.detail-post')).toHaveCount(1);
    await expect(page.locator('.comment .time')).toHaveCount(2);
    await expect(page.locator('.comment').nth(0).locator('.time')).toHaveText('30 分钟前');
    await expect(page.locator('.comment').nth(1).locator('.time')).toHaveText('2 天前');
    // A further page of comments arrives and carries times too.
    await page.evaluate(() => TvXReader.key('right'));
    await page.evaluate(() => TvXReader.key('down'));
    await page.evaluate(() => TvXReader.key('down'));
    await receive(page, 'r2', payload([post('203', {replyTo: '101', created: xDate(5 * 60e3)})]));
    await expect(page.locator('.comment .time')).toHaveCount(3);
    await expect(page.locator('.comment').nth(2).locator('.time')).toHaveText('5 分钟前');
});

test('a comment that was just posted shows its time straight away', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await openDetail(page, [post('101'), post('201', {replyTo: '101'})]);
    // Go through the composer so the reader is actually waiting on this reply.
    await key(page, 'menu');
    await key(page, 'ok');
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'write').at(-1)))
        .toEqual(['write', 'w1', '101', 'reply', false, 'Author 101']);
    await page.evaluate(reply => TvXReader.writeResult('w1', '101', {status: 'ok', reply}),
        post('999', {replyTo: '101', created: xDate(0), text: 'Just posted'}));
    await expect(page.locator('.comment').nth(0)).toContainText('Just posted');
    await expect(page.locator('.comment').nth(0).locator('.time')).toHaveText('刚刚');
});

test('recent posts read as an age and older ones as a date', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([
        post('101', {created: xDate(20e3)}),
        post('102', {created: xDate(45 * 60e3)}),
        post('103', {created: xDate(10 * 24 * 3600e3)}),
        post('104', {created: xDate(400 * 24 * 3600e3)})
    ]));
    const label = async () => (await page.locator('.post .time').textContent()).trim();
    expect(await label()).toBe('刚刚');
    await key(page, 'down');
    expect(await label()).toBe('45 分钟前');
    await key(page, 'down');
    expect(await label(), 'a ten day old post should read as a date').toMatch(/8 月 31 日/);
    await key(page, 'down');
    expect(await label(), 'a post from another year needs the year').toMatch(/2025 年/);
});

test('a post with no publication time shows none rather than a wrong one', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {created: null})]));
    await expect(page.locator('.post .time')).toHaveCount(0);
    await expect(page.locator('.post')).not.toContainText('Invalid');
    await expect(page.locator('.post')).not.toContainText('NaN');
    await receive(page, 'r0', payload([post('102', {created: 'not a date'})]));
    await expect(page.locator('.post .time')).toHaveCount(0);
});

test('a real zero is shown and a missing field is left out', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {replies: 0, likes: 0, views: 0})]));
    await expect(page.locator('.post .stats')).toContainText('评论 0');
    await expect(page.locator('.post .stats')).toContainText('喜欢 0');
    await expect(page.locator('.post .stats')).toContainText('浏览 0');
    await receive(page, 'r0', payload([post('102', {likes: 4})]));
    await expect(page.locator('.post .stats')).toContainText('喜欢 4');
    await expect(page.locator('.post .stats'), 'a missing view count was invented')
        .not.toContainText('浏览');
    await expect(page.locator('.post .stats'), 'a missing reply count was invented')
        .not.toContainText('评论');
    await expect(page.locator('.post .stats .stat')).toHaveCount(1);
});

test('a post X sent no counts for shows no counts row at all', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await expect(page.locator('.post .stats')).toHaveCount(0);
    await expect(page.locator('.post')).not.toContainText('评论');
    await expect(page.locator('.post')).not.toContainText('浏览');
});

test('every number a comment shows comes with its own icon', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await openDetail(page, [
        post('101'),
        post('201', {replyTo: '101', replies: 2, likes: 7, views: 99})
    ]);
    const stats = page.locator('.comment .stats');
    await expect(stats.locator('.stat')).toHaveCount(3);
    await expect(stats.locator('svg')).toHaveCount(3);
    await expect(stats).toContainText('评论 2');
    await expect(stats).toContainText('喜欢 7');
    await expect(stats).toContainText('浏览 99');
});

test('the detail author block grows for the full time instead of clipping the name', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await openDetail(page, [post('101'), post('201', {replyTo: '101'})]);
    const rect = sel => page.evaluate(s => {
        const r = document.querySelector(s).getBoundingClientRect();
        return {top: r.top, bottom: r.bottom};
    }, sel);
    const author = await rect('.detail-post .author');
    const name = await rect('.detail-post .name');
    const time = await rect('.detail-post .time');
    expect(name.top, 'the name is clipped at the top').toBeGreaterThanOrEqual(author.top);
    expect(time.bottom, 'the time overflows the author block').toBeLessThanOrEqual(author.bottom);
});

test('times and counts stay out of the remote focus order', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {replies: 1, likes: 2, views: 3})]));
    await openDetail(page, [post('101', {replies: 1, likes: 2, views: 3}), post('201', {replyTo: '101'})]);
    await expect(page.locator('.stats button, .stats a, .stats [tabindex]')).toHaveCount(0);
    await expect(page.locator('.time button, .time a, .time [tabindex]')).toHaveCount(0);
    await key(page, 'ok');
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'write'))).toEqual([]);
});
