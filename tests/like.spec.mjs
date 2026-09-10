import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);

function post(id, {text = 'A post', likes = 3, liked = false, replyTo = ''} = {}) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author', screen_name: 'author'}}}},
        legacy: {
            full_text: text,
            reply_count: 2,
            favorite_count: likes,
            favorited: liked,
            in_reply_to_status_id_str: replyTo,
            conversation_id_str: replyTo || id
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
const calls = (page, name) => page.evaluate(n => calls.filter(c => c[0] === n), name);
const like = page => page.evaluate(() => {
    // One synchronous task: whatever this returns needed no host round trip.
    TvXReader.key('menu');
    TvXReader.key('down');
    TvXReader.key('ok');
    return {
        stats: document.querySelector('.stats .like').textContent.replace(/\s+/g, ' ').trim(),
        dialog: !!document.querySelector('.action-dialog')
    };
});

/** Confirm reads the post full screen; a second confirm opens its detail. */
const openDetail = page => page.evaluate(() => { TvXReader.key('ok'); TvXReader.key('ok'); });
test('confirming like lights the heart and moves the count with no host round trip', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    expect(await like(page)).toEqual({stats: '已喜欢 4', dialog: false});
    expect(await calls(page, 'write')).toEqual([['write', 'w1', '101', 'like', true, 'Author']]);
});

test('cancelling a like is equally immediate', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {liked: true, likes: 4})]));
    expect(await like(page)).toEqual({stats: '喜欢 3', dialog: false});
    expect(await calls(page, 'write')).toEqual([['write', 'w1', '101', 'like', false, 'Author']]);
});

test('the new state follows the post into its detail and back', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await like(page);
    await openDetail(page);
    // The detail read was already in flight and still carries the old server state.
    await receive(page, 'r1', payload([post('101'), post('201', {replyTo: '101'})]));
    await expect(page.locator('.detail-post .stats .like')).toContainText('已喜欢 4');
    await page.evaluate(() => TvXReader.key('back'));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
});

test('liking inside a detail carries back to the timeline it came from', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await openDetail(page);
    await receive(page, 'r1', payload([post('101'), post('201', {replyTo: '101'})]));
    await expect(page.locator('.detail-post')).toHaveCount(1);
    expect(await like(page)).toEqual({stats: '已喜欢 4', dialog: false});
    await page.evaluate(() => TvXReader.key('back'));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    // The result lands after the user has left the post; it settles the copy without moving them.
    await page.evaluate(() => TvXReader.key('down'));
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'ok', liked: true, likes: 5}));
    await expect(page.locator('#position')).toHaveText('2 / 2');
    await expect(page.locator('.stats .like')).toContainText('喜欢 3');
    await page.evaluate(() => TvXReader.key('up'));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 5');
});

test('a stale timeline read cannot put the heart back out', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await receive(page, 'r0', payload([post('101')]));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
});

test('a definite failure restores the last confirmed state and says why', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'session'}));
    await expect(page.locator('.stats .like')).toContainText('喜欢 3');
    await expect(page.locator('.stats .like')).not.toContainText('已喜欢');
    await expect(page.locator('#notice')).toContainText('登录');
    expect(await calls(page, 'write')).toHaveLength(1);
});

test('an unknown result says it is checking and converges on a read-only check', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'unknown'}));
    await expect(page.locator('#notice')).toContainText('核对');
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    expect(await calls(page, 'verify')).toEqual([['verify', 'v1', '101']]);
    await page.evaluate(data => TvXReader.verifyResult('v1', '101', data, ''),
        payload([post('101', {liked: true, likes: 9})]));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 9');
    expect(await calls(page, 'write')).toHaveLength(1);
});

test('a mismatching read settles an unknown write without replaying it', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'unknown'}));
    await page.evaluate(data => TvXReader.verifyResult('v1', '101', data, ''),
        payload([post('101', {liked: false, likes: 3})]));
    expect(await calls(page, 'write')).toHaveLength(1);
    await expect(page.locator('.stats .like')).toHaveText('喜欢 3');
    await expect(page.locator('#notice')).toContainText('核对');
});

test('toggling during verification waits for the check before sending the latest intent', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'unknown'}));
    expect(await like(page)).toEqual({stats: '喜欢 3', dialog: false});
    expect(await calls(page, 'write')).toHaveLength(1);
    await page.evaluate(data => TvXReader.verifyResult('v1', '101', data, ''),
        payload([post('101', {liked: true, likes: 4})]));
    expect(await calls(page, 'write')).toEqual([
        ['write', 'w1', '101', 'like', true, 'Author'],
        ['write', 'w2', '101', 'like', false, 'Author']
    ]);
    await expect(page.locator('.stats .like')).toHaveText('喜欢 3');
});

test('rapid toggling keeps one request in flight and settles on the last intent', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await like(page);
    await like(page);
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    expect(await calls(page, 'write')).toEqual([['write', 'w1', '101', 'like', true, 'Author']]);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'ok', liked: true, likes: 4}));
    // The first request already carried the final intent, so nothing more is sent.
    expect(await calls(page, 'write')).toHaveLength(1);
    await like(page);
    await like(page);
    expect(await calls(page, 'write')).toEqual([
        ['write', 'w1', '101', 'like', true, 'Author'],
        ['write', 'w2', '101', 'like', false, 'Author']
    ]);
    await page.evaluate(() => TvXReader.writeResult('w2', '101', {status: 'ok', liked: false, likes: 3}));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    expect(await calls(page, 'write')).toEqual([
        ['write', 'w1', '101', 'like', true, 'Author'],
        ['write', 'w2', '101', 'like', false, 'Author'],
        ['write', 'w3', '101', 'like', true, 'Author']
    ]);
});

test('a session that is not ready yet is retried with backoff, never hammered', async ({page}) => {
    await page.clock.install();
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'not_ready'}));
    expect(await calls(page, 'write')).toHaveLength(1);
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    await page.clock.runFor(900);
    expect(await calls(page, 'write')).toHaveLength(2);
    await page.evaluate(() => TvXReader.writeResult('w2', '101', {status: 'not_ready'}));
    await page.clock.runFor(900);
    expect(await calls(page, 'write')).toHaveLength(2);
    await page.clock.runFor(1200);
    expect(await calls(page, 'write')).toHaveLength(3);
    await page.evaluate(() => TvXReader.writeResult('w3', '101', {status: 'not_ready'}));
    await page.clock.runFor(3300);
    expect(await calls(page, 'write')).toHaveLength(4);
    await page.evaluate(() => TvXReader.writeResult('w4', '101', {status: 'not_ready'}));
    await page.clock.runFor(30000);
    expect(await calls(page, 'write')).toHaveLength(4);
    await expect(page.locator('.stats .like')).toContainText('喜欢 3');
    await expect(page.locator('.stats .like')).not.toContainText('已喜欢');
    await expect(page.locator('#notice')).toContainText('未能提交');
});

test('a retried session that comes good keeps the state the user asked for', async ({page}) => {
    await page.clock.install();
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'not_ready'}));
    await page.clock.runFor(900);
    await page.evaluate(() => TvXReader.writeResult('w2', '101', {status: 'ok', liked: true, likes: 4}));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    await expect(page.locator('#notice')).toBeEmpty();
    await page.clock.runFor(30000);
    expect(await calls(page, 'write')).toHaveLength(2);
});

test('the menu acts on the post it was opened for, even if the timeline moves under it', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await page.evaluate(() => TvXReader.key('menu'));
    // A fresh timeline lands while the menu is open; the choice was made about post 101.
    await receive(page, 'r0', payload([post('900', {likes: 87})]));
    await page.evaluate(() => {
        TvXReader.key('down');
        TvXReader.key('ok');
    });
    expect(await calls(page, 'write')).toEqual([['write', 'w1', '101', 'like', true, 'Author']]);
    await expect(page.locator('.stats .like')).toContainText('喜欢 87');
    await expect(page.locator('.stats .like')).not.toContainText('已喜欢');
});

test('a late or foreign result cannot move a post that already settled', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'ok', liked: true, likes: 4}));
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'session'}));
    await page.evaluate(() => TvXReader.writeResult('w9', '101', {status: 'ok', liked: false, likes: 0}));
    await page.evaluate(data => TvXReader.verifyResult('v9', '101', data, ''),
        payload([post('101', {liked: false, likes: 0})]));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
});

test('liking one post leaves the others alone', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102', {likes: 7})]));
    await page.evaluate(() => TvXReader.key('down'));
    await like(page);
    await expect(page.locator('.stats .like')).toContainText('已喜欢 8');
    await page.evaluate(() => TvXReader.key('up'));
    await expect(page.locator('.stats .like')).toContainText('喜欢 3');
    await expect(page.locator('.stats .like')).not.toContainText('已喜欢');
    expect(await calls(page, 'write')).toEqual([['write', 'w1', '102', 'like', true, 'Author']]);
});

test('the statistics row stays read-only and the entry stays in the menu', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await expect(page.locator('.stats button, .stats [tabindex], .stats a')).toHaveCount(0);
    await page.evaluate(() => TvXReader.key('ok'));
    expect(await calls(page, 'write')).toEqual([]);
});

test('unavailable checks stay uncertain, survive reads, and resume on refresh without writes', async ({page}) => {
    await page.clock.install();
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'unknown'}));
    for (let i = 1; i <= 4; i++) {
        await page.evaluate(id => TvXReader.verifyResult(id, '101', null, 'offline'), 'v' + i);
        await page.clock.runFor(i < 4 ? [800, 1600, 3200][i - 1] : 30000);
    }
    expect(await calls(page, 'verify')).toHaveLength(4);
    await expect(page.locator('#notice')).toContainText('无法核对');
    await receive(page, 'r0', payload([post('101')]));
    await expect(page.locator('.stats .like')).toHaveText('已喜欢 4');
    await expect(page.locator('#notice')).toContainText('无法核对');
    await page.evaluate(() => TvXReader.refreshCurrent());
    expect(await calls(page, 'verify')).toHaveLength(5);
    await page.evaluate(data => TvXReader.verifyResult('v5', '101', data, ''), payload([post('101')]));
    await expect(page.locator('.stats .like')).toHaveText('喜欢 3');
    expect(await calls(page, 'write')).toHaveLength(1);
});

test('a check without an explicit like state cannot confirm an unlike', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {liked: true, likes: 4})]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'unknown'}));
    const incomplete = post('101');
    delete incomplete.legacy.favorited;
    await page.evaluate(data => TvXReader.verifyResult('v1', '101', data, ''), payload([incomplete]));
    await expect(page.locator('#notice')).toContainText('正在核对');
    expect(await calls(page, 'write')).toHaveLength(1);
});

test('confirmation without a count retains the optimistic count and rollback uses that baseline', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'ok', liked: true}));
    await expect(page.locator('.stats .like')).toHaveText('已喜欢 4');
    await like(page);
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w2', '101', {status: 'rate_limit'}));
    await expect(page.locator('.stats .like')).toHaveText('已喜欢 4');
});

test('a rejected unlike at zero restores the confirmed count rather than inventing a like', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', {liked: true, likes: 0})]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'failed'}));
    await expect(page.locator('.stats .like')).toHaveText('已喜欢 0');
});

test('a background rejection leaves the current post DOM and notice untouched until return', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await like(page);
    await page.evaluate(() => {
        TvXReader.key('down');
        window.readingBody = document.querySelector('.body');
    });
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'rate_limit'}));
    expect(await page.evaluate(() => readingBody === document.querySelector('.body'))).toBe(true);
    await expect(page.locator('#notice')).toBeEmpty();
    await page.evaluate(() => TvXReader.key('up'));
    await expect(page.locator('#notice')).toContainText('频繁');
});

test('a callback updates an open menu without moving its selection or replacing reading content', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => {
        TvXReader.key('menu');
        TvXReader.key('down');
        window.readingBody = document.querySelector('.body');
    });
    await expect(page.getByRole('button', {name: '取消喜欢'})).toBeFocused();
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'failed'}));
    await expect(page.getByRole('button', {name: '喜欢', exact: true})).toBeFocused();
    await expect(page.locator('.action-counts')).toContainText('喜欢 3');
    expect(await page.evaluate(() => readingBody === document.querySelector('.body'))).toBe(true);
});

test('rapid toggles during backoff do not bypass the retry delay', async ({page}) => {
    await page.clock.install();
    await mount(page);
    await receive(page, 'r0', payload([post('101')]));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'busy'}));
    await like(page);
    await like(page);
    expect(await calls(page, 'write')).toHaveLength(1);
    await page.clock.runFor(800);
    expect(await calls(page, 'write')).toHaveLength(2);
});

test('a callback with the right request ID but wrong post cannot release another queued write', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101'), post('102')]));
    await like(page);
    await page.evaluate(() => TvXReader.key('down'));
    await like(page);
    await page.evaluate(() => TvXReader.writeResult('w1', '999', {status: 'ok', liked: true}));
    expect(await calls(page, 'write')).toHaveLength(1);
    await page.evaluate(() => TvXReader.writeResult('w1', '101', {status: 'ok', liked: true}));
    expect(await calls(page, 'write')).toHaveLength(2);
    await expect(page.locator('.stats .like')).toHaveText('已喜欢 4');
});
