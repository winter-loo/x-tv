import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);

function post(id, {text = 'Post ' + id, media = false, liked = false, likes = 0} = {}) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author ' + id, screen_name: 'author' + id}}}},
        legacy: {
            full_text: text,
            reply_count: 0,
            favorite_count: likes,
            favorited: liked,
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
const calls = (page, name) => page.evaluate(n => calls.filter(c => c[0] === n), name);
const requests = page => page.evaluate(() => calls.filter(c => c[0] === 'request'));
/** The timeline, then one left press at its top: the entry point the ticket describes. */
async function openLikes(page, tweets = [post('501'), post('502')], cursor = 'LIKES_CURSOR') {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await key(page, 'left');
    const asked = (await requests(page)).filter(c => c[2] === 'likes');
    expect(asked).toHaveLength(1);
    await receive(page, asked[0][1], payload(tweets, cursor));
    return asked[0][1];
}

test('left at the top of the timeline opens the likes list', async ({page}) => {
    await openLikes(page);
    await expect(page.locator('#title .tab-now')).toHaveText('我的喜欢');
    await expect(page.locator('#title .tab-alt')).toHaveText('← X · 时间线');
    await expect(page.locator('#position')).toHaveText('1 / 2');
    await expect(page.locator('.post .text')).toHaveText('Post 501');
    const asked = (await requests(page)).filter(c => c[2] === 'likes');
    // The signed-in account is resolved natively, so the reader sends no post id of its own.
    expect(asked[0].slice(2)).toEqual(['likes', '', '']);
});

test('the timeline advertises the likes list and comes back without asking again', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await expect(page.locator('#title .tab-alt')).toHaveText('← 我的喜欢');
    await key(page, 'left');
    const asked = (await requests(page)).filter(c => c[2] === 'likes');
    await receive(page, asked[0][1], payload([post('501')]));
    await key(page, 'left');
    await expect(page.locator('#title .tab-now')).toHaveText('X · 时间线');
    await expect(page.locator('.post .text')).toHaveText('Post 101');
    // The timeline was primed natively, so the likes list is the only request the reader made.
    expect(await requests(page)).toHaveLength(1);
    expect((await calls(page, 'restoreScene')).map(c => c[2])).toEqual(['home']);
});

test('a second visit to the likes list reuses what was already loaded', async ({page}) => {
    await openLikes(page);
    await key(page, 'left');
    await key(page, 'left');
    await expect(page.locator('.post .text')).toHaveText('Post 501');
    expect((await requests(page)).filter(c => c[2] === 'likes')).toHaveLength(1);
    expect((await calls(page, 'restoreScene')).map(c => c[2])).toEqual(['home', 'likes']);
});

test('the media pane keeps left, while posts anywhere in the list switch lists cyclically', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {media: true}), post('102')]));
    await key(page, 'right');
    await expect(page.locator('.media.focus')).toHaveCount(1);
    await key(page, 'left');
    await expect(page.locator('.media.focus')).toHaveCount(0);
    expect((await requests(page)).filter(c => c[2] === 'likes')).toHaveLength(0);
    await key(page, 'down');
    await expect(page.locator('#position')).toHaveText('2 / 2');
    await key(page, 'left');
    const asked = (await requests(page)).filter(c => c[2] === 'likes');
    expect(asked).toHaveLength(1);
    await receive(page, asked[0][1], payload([post('501'), post('502')]));
    await expect(page.locator('#title .tab-now')).toHaveText('我的喜欢');
    await expect(page.locator('.post .text')).toHaveText('Post 501');
    await key(page, 'down');
    await expect(page.locator('#position')).toHaveText('2 / 2');
    await key(page, 'left');
    await expect(page.locator('#title .tab-now')).toHaveText('X · 时间线');
    await expect(page.locator('.post .text')).toHaveText('Post 102');
    await key(page, 'left');
    await expect(page.locator('#title .tab-now')).toHaveText('我的喜欢');
    await expect(page.locator('.post .text')).toHaveText('Post 502');
});

test('the end of the likes list pages with the cursor it was given', async ({page}) => {
    await openLikes(page);
    await key(page, 'down');
    await key(page, 'down');
    const paged = (await requests(page)).filter(c => c[2] === 'likes');
    expect(paged).toHaveLength(2);
    expect(paged[1][4]).toBe('LIKES_CURSOR');
    await receive(page, paged[1][1], payload([post('503')]));
    await expect(page.locator('#position')).toHaveText('2 / 3');
    await key(page, 'down');
    await expect(page.locator('.post .text')).toHaveText('Post 503');
});

test('an account with nothing liked reads as empty, and confirm asks again', async ({page}) => {
    await openLikes(page, [], '');
    await expect(page.locator('.loading')).toHaveText('还没有喜欢的帖子');
    await expect(page.locator('#position')).toHaveText('');
    await key(page, 'ok');
    const asked = (await requests(page)).filter(c => c[2] === 'likes');
    expect(asked).toHaveLength(2);
    await receive(page, asked[1][1], payload([post('501')]));
    await expect(page.locator('.post .text')).toHaveText('Post 501');
});

test('back from the likes list returns to the timeline instead of leaving the reader', async ({page}) => {
    await openLikes(page);
    await key(page, 'back');
    await expect(page.locator('#title .tab-now')).toHaveText('X · 时间线');
    expect(await calls(page, 'exit')).toHaveLength(0);
});

test('up at the top of the likes list asks for it again', async ({page}) => {
    await openLikes(page);
    await key(page, 'up');
    const asked = (await requests(page)).filter(c => c[2] === 'likes');
    expect(asked).toHaveLength(2);
    expect(asked[1][4]).toBe('');
    await expect(page.locator('#notice')).toHaveText('正在刷新…');
});

test('a like taken in the likes list shows on the same post in the timeline', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('501', {likes: 4}), post('102')]));
    await key(page, 'left');
    const asked = (await requests(page)).filter(c => c[2] === 'likes');
    await receive(page, asked[0][1], payload([post('501', {likes: 4})]));
    await key(page, 'menu');
    await key(page, 'down');
    await key(page, 'ok');
    await expect(page.locator('.stats .liked')).toContainText('已喜欢 5');
    await key(page, 'left');
    await expect(page.locator('#title .tab-now')).toHaveText('X · 时间线');
    await expect(page.locator('.stats .liked')).toContainText('已喜欢 5');
});

test('opening a liked post and coming back restores the likes list', async ({page}) => {
    await openLikes(page);
    await key(page, 'ok');
    const detail = (await requests(page)).filter(c => c[2] === 'detail');
    expect(detail).toHaveLength(1);
    expect(detail[0][3]).toBe('501');
    await key(page, 'back');
    await expect(page.locator('#title .tab-now')).toHaveText('我的喜欢');
    await expect(page.locator('#position')).toHaveText('1 / 2');
    expect((await calls(page, 'restoreScene')).map(c => c[2])).toEqual(['likes']);
});

test('leaving the timeline mid-refresh does not disable refreshing it later', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await key(page, 'up');
    await expect(page.locator('#notice')).toHaveText('正在刷新…');
    await key(page, 'left');
    const likes = (await requests(page)).filter(c => c[2] === 'likes');
    await receive(page, likes[0][1], payload([post('501')]));
    await key(page, 'left');
    await key(page, 'up');
    await expect(page.locator('#notice')).toHaveText('正在刷新…');
    const home = (await requests(page)).filter(c => c[2] === 'home');
    expect(home).toHaveLength(2);
});
