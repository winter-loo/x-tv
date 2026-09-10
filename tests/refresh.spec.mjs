import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);

function post(id, {text = 'Post ' + id, media = false} = {}) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author ' + id, screen_name: 'author' + id}}}},
        legacy: {
            full_text: text,
            reply_count: 0,
            favorite_count: 0,
            conversation_id_str: id,
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
const homeUpdated = (page, data, error = '') =>
    page.evaluate(([data, error]) => TvXReader.homeUpdated(data, error), [data, error]);
const calls = (page, name) => page.evaluate(n => calls.filter(c => c[0] === n), name);
const requests = page => page.evaluate(() => calls.filter(c => c[0] === 'request'));
/** Reading two posts down and coming back to the first, exactly as the ticket describes. */
async function readAndReturn(page) {
    await key(page, 'down');
    await key(page, 'down');
    await expect(page.locator('#position')).toHaveText('3 / 3');
    await key(page, 'back');
    await expect(page.locator('#position')).toHaveText('1 / 3');
}

test('up at the top merges an update that is already waiting', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102'), post('103')]));
    await readAndReturn(page);
    await homeUpdated(page, payload([post('201'), post('202'), post('101'), post('102'), post('103')]));
    await expect(page.locator('#freshness')).toContainText('2');
    await expect(page.locator('#position')).toHaveText('1 / 3');
    const before = await requests(page);
    await key(page, 'up');
    await expect(page.locator('#position')).toHaveText('1 / 5');
    await expect(page.locator('.post .name')).toHaveText('Author 201');
    await expect(page.locator('#notice')).toContainText('2');
    await expect(page.locator('#freshness')).not.toContainText('新帖');
    expect(await requests(page)).toEqual(before);
});

test('up at the top asks for a refresh when nothing is waiting', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102'), post('103')]));
    await readAndReturn(page);
    await key(page, 'up');
    const asked = await requests(page);
    expect(asked).toHaveLength(1);
    expect(asked[0].slice(2)).toEqual(['home', '', '']);
    await expect(page.locator('#refresh')).toContainText('正在刷新');
    await expect(page.locator('#position')).toHaveText('1 / 3');
    await expect(page.locator('.post .name')).toHaveText('Author 101');
});

test('a refresh shows the new posts, focuses the first and counts what actually arrived', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await key(page, 'up');
    const id = (await requests(page))[0][1];
    await receive(page, id, payload([post('201'), post('101'), post('102')]));
    await expect(page.locator('#position')).toHaveText('1 / 3');
    await expect(page.locator('.post .name')).toHaveText('Author 201');
    await expect(page.locator('#notice')).toContainText('1');
    await expect(page.locator('#refresh')).not.toContainText('正在刷新');
    // The count matches the list: one new post on top, the two known ones once each below.
    await key(page, 'down');
    await expect(page.locator('.post .name')).toHaveText('Author 101');
    await key(page, 'down');
    await expect(page.locator('.post .name')).toHaveText('Author 102');
    await expect(page.locator('#position')).toHaveText('3 / 3');
});

test('a refresh that brings nothing new says so and leaves the reading position alone', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102'), post('103')]));
    await readAndReturn(page);
    await key(page, 'up');
    const id = (await requests(page))[0][1];
    await receive(page, id, payload([post('101'), post('102'), post('103')]));
    await expect(page.locator('#notice')).toContainText('暂无新帖子');
    await expect(page.locator('#position')).toHaveText('1 / 3');
    await expect(page.locator('.post .name')).toHaveText('Author 101');
});

test('a failed refresh explains itself and the next up key retries', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await key(page, 'up');
    const id = (await requests(page))[0][1];
    await receive(page, id, null, 'network');
    await expect(page.locator('#notice')).toContainText('重试');
    await expect(page.locator('#position')).toHaveText('1 / 2');
    await key(page, 'up');
    expect(await requests(page)).toHaveLength(2);
});

test('holding up does not pile refreshes on top of each other', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await key(page, 'up');
    await key(page, 'up');
    await key(page, 'up');
    expect(await requests(page)).toHaveLength(1);
    const id = (await requests(page))[0][1];
    await receive(page, id, payload([post('201'), post('101'), post('102')]));
    await expect(page.locator('#position')).toHaveText('1 / 3');
    expect(await requests(page)).toHaveLength(1);
});

test('a background update never moves the reader off the post being read', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102'), post('103')]));
    await key(page, 'down');
    await key(page, 'down');
    await expect(page.locator('#position')).toHaveText('3 / 3');
    await homeUpdated(page, payload([post('201'), post('101'), post('102'), post('103')]));
    await expect(page.locator('#position')).toHaveText('3 / 3');
    await expect(page.locator('.post .name')).toHaveText('Author 103');
    // Up in the middle of the list is still ordinary navigation, not a refresh.
    await key(page, 'up');
    await expect(page.locator('#position')).toHaveText('2 / 3');
    expect(await requests(page)).toEqual([]);
});

test('up belongs to whatever overlay has focus, not to the timeline', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {media: true}), post('102')]));
    await key(page, 'menu');
    await key(page, 'up');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(await requests(page)).toEqual([]);
    await key(page, 'back');
    await key(page, 'right');
    await key(page, 'ok');
    await expect(page.locator('.viewer')).toHaveCount(1);
    await key(page, 'up');
    await expect(page.locator('.viewer')).toHaveCount(1);
    expect(await requests(page)).toEqual([]);
    await key(page, 'back');
    // Back out of the viewer and the media pane still owns up, not the timeline.
    await key(page, 'up');
    expect(await requests(page)).toEqual([]);
});

test('the refresh chip is a status line, not something the remote has to visit', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await key(page, 'up');
    await expect(page.locator('#refresh.selected')).toHaveCount(0);
    await key(page, 'down');
    await expect(page.locator('#position')).toHaveText('2 / 2');
});
