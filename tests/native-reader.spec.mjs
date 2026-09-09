import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);
function tweet(id, text = 'Full post', replyTo = '', extra = {}) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author', screen_name: 'author'}}}},
        legacy: {
            full_text: text,
            reply_count: 2,
            favorite_count: 3,
            in_reply_to_status_id_str: replyTo,
            conversation_id_str: replyTo || id
        },
        ...extra
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
        window.ReaderHost = {
            ready() {},
            request(...args) {
                window.calls.push(['request', ...args]);
            },
            rendered(...args) {
                window.calls.push(['rendered', ...args]);
            },
            restoreScene(...args) {
                window.calls.push(['restore', ...args]);
            },
            browser(...args) {
                window.calls.push(['browser', ...args]);
            },
            write(...args) { window.calls.push(['write', ...args]); },
            exit() {
                window.calls.push(['exit']);
            }
        };
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

test('detail statistics have three SVG icons and stay outside remote focus', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([tweet('101', 'A short post', '', {views: {count: '42'}})]));
    await key(page, 'ok');
    const stats = page.locator('.detail-post .stats');
    await expect(stats.locator('.stat')).toHaveCount(3);
    await expect(stats.locator('svg')).toHaveCount(3);
    await expect(stats).toContainText('评论 2');
    await expect(stats).toContainText('喜欢 3');
    await expect(stats).toContainText('浏览 42');
    await expect(stats.locator('button, [tabindex]')).toHaveCount(0);
    await key(page, 'down');
    await key(page, 'left');
    await expect(page.locator('.detail-post')).toHaveClass(/focus/);
    await key(page, 'ok');
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'browser'))).toEqual([]);
});

test('post menu opens locally, traps navigation and submits writes without a browser handoff', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([tweet('101'), tweet('102', 'Second')]));
    await key(page, 'down');
    // Synchronous DOM assertion: opening the menu does not await a Gecko or network callback.
    expect(await page.evaluate(() => {
        TvXReader.key('menu');
        return !!document.querySelector('.action-dialog');
    })).toBe(true);
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'browser'))).toEqual([]);
    await expect(page.getByRole('button', {name: '写评论', exact: true})).toBeFocused();
    await key(page, 'down');
    await expect(page.getByRole('button', {name: '喜欢', exact: true})).toBeFocused();
    await key(page, 'right');
    await expect(page.locator('#position')).toHaveText('2 / 2');
    await key(page, 'back');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'browser'))).toEqual([]);
    await key(page, 'menu');
    await key(page, 'down');
    await key(page, 'ok');
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'browser'))).toEqual([]);
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'write')))
        .toEqual([['write', 'w1', '102', 'like', true, 'Author']]);
    await expect(page.locator('.stats .like')).toContainText('喜欢 3');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => TvXReader.writeResult('w1', '102', {status:'ok',liked:true,likes:4}));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    await key(page, 'menu');
    await key(page, 'ok');
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'write').at(-1)))
        .toEqual(['write', 'w2', '102', 'reply', false, 'Author']);
});

test('live data parser expands notes and keeps quoted/recommended tweets out of comments', async () => {
    const sandbox = {URL, Set, Map};
    runInNewContext(await readFile(new URL('data.js', assets), 'utf8'), sandbox);
    const root = tweet('101', 'Short summary', '', {
        note_tweet: {note_tweet_results: {result: {text: 'Entire long note '.repeat(200)}}},
        quoted_status_result: {result: tweet('999', 'Quoted')}
    });
    const result = sandbox.TvXReadData.parse(
        payload([root, tweet('102', 'Child', '101'), tweet('103', 'Unrelated')]), 'detail', '101');
    expect(result.root.text.length).toBeGreaterThan(2000);
    expect(result.root.complete).toBe(true);
    expect(result.posts.map(p => p.id)).toEqual(['102']);
    expect(result.root.quoted.id).toBe('999');
});

test(
    'reader rejects a truncated home excerpt as complete detail and ignores a late abandoned response',
    async ({page}) => {
        await mount(page);
        const partial = tweet('101', 'Timeline text');
        partial.legacy.truncated = true;
        await receive(page, 'r0', payload([partial, tweet('102')]));
        await expect(page.locator('.text')).toContainText('Timeline text');
        await key(page, 'ok');
        await expect(page.locator('#stage')).toContainText('正在加载完整帖子');
        expect(await page.evaluate(() => calls.some(c => c[0] === 'rendered' && c[2].startsWith('detail'))))
            .toBe(false);
        await key(page, 'back');
        await receive(page, 'r1', payload([tweet('101', 'Late detail')]));
        await expect(page.locator('.text')).toContainText('Timeline text');
        await expect(page.locator('#title')).toContainText('时间线');
    });

test('fresh detail and reply navigation preserve the parent selection and scroll', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([tweet('101'), tweet('102', 'Second post')]));
    await key(page, 'down');
    await key(page, 'ok');
    await receive(
        page, 'r1', payload([tweet('102', 'Complete root '.repeat(300)), tweet('201', 'Reply', '102')]));
    await key(page, 'down');
    const y = await page.locator('.body').evaluate(n => n.scrollTop);
    expect(y).toBeGreaterThan(0);
    await key(page, 'right');
    await key(page, 'ok');
    await receive(page, 'r2', payload([tweet('201', 'Full reply', '102')]));
    await key(page, 'back');
    await expect(page.locator('.comment.selected')).toContainText('Reply');
    expect(await page.locator('.body').evaluate(n => n.scrollTop)).toBe(y);
    await key(page, 'back');
    await expect(page.locator('.text')).toContainText('Second post');
});

test(
    'comments paginate without requiring the root to be repeated and errors retry the failed request',
    async ({page}) => {
        await mount(page);
        await receive(page, 'r0', payload([tweet('101')]));
        await key(page, 'ok');
        await receive(page, 'r1', payload([tweet('101'), tweet('201', 'One', '101')], 'next'));
        await key(page, 'right');
        await key(page, 'down');
        await receive(page, 'r2', null, 'network');
        await key(page, 'ok');
        expect(await page.evaluate(() => calls.filter(c => c[0] === 'request').at(-1))).toEqual([
            'request', 'r3', 'detail', '101', 'next'
        ]);
        await receive(page, 'r3', payload([tweet('202', 'Two', '101')]));
        await expect(page.locator('.comment')).toHaveCount(2);
    });

test(
    'network text is escaped and an incomplete article never passes full-detail readiness',
    async ({page}) => {
        await mount(page);
        await receive(
            page, 'r0', payload([tweet('101', '<img src=x onerror="window.pwned=true">', '', {
                article: {
                    article_results:
                        {result: {title: 'Title', preview_text: '<img src=x onerror="window.pwned=true">'}}
                }
            })]));
        expect(await page.evaluate(() => window.pwned)).toBeUndefined();
        await expect(page.locator('.text')).toContainText('<img');
        await key(page, 'ok');
        await receive(page, 'r1', payload([tweet('101', 'Excerpt', '', {
                          article: {article_results: {result: {title: 'Title', preview_text: 'Excerpt'}}}
                      })]));
        expect(await page.evaluate(() => calls.some(c => c[0] === 'rendered' && c[2].startsWith('detail'))))
            .toBe(false);
        await expect(page.locator('#notice')).toContainText('未完整');
    });

test(
    'returning from browser actions refreshes counts without discarding the selected home post',
    async ({page}) => {
        await mount(page);
        await receive(page, 'r0', payload([tweet('101'), tweet('102', 'Second')]));
        await key(page, 'down');
        await page.evaluate(() => TvXReader.refreshCurrent());
        expect(await page.evaluate(() => calls.filter(c => c[0] === 'request').at(-1))).toEqual([
            'request', 'r1', 'detail', '102', ''
        ]);
        const updated = tweet('102', 'Second');
        updated.legacy.favorite_count = 4;
        updated.legacy.favorited = true;
        await receive(page, 'r1', payload([updated]));
        await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
        await expect(page.locator('#position')).toHaveText('2 / 2');
        await page.evaluate(() => TvXReader.refreshCurrent());
        await key(page, 'ok');
        await receive(page, 'r2', payload([tweet('102', 'Late stats refresh')]));
        await expect(page.locator('.detail-post .text').first()).toHaveText('Second');
        await receive(page, 'r3', payload([tweet('102', 'Complete detail')]));
        await expect(page.locator('.text')).toContainText('Complete detail');
    });

test(
    'session capture forwards only successful X read queries and never logs request credentials',
    async () => {
        const source = await readFile(
            new URL('../app/src/main/assets/tv-extension/runtime/background.js', import.meta.url), 'utf8');
        const sent = [], logs = [], events = {};
        const event = name => ({
            addListener(fn) {
                (events[name] || (events[name] = [])).push(fn);
            }
        });
        const browser = {
            runtime: {
                onMessage: event('message'),
                connectNative: () => ({
                    onMessage: event('native'),
                    onDisconnect: event('disconnect'),
                    postMessage: m => sent.push(m)
                })
            },
            tabs: {onActivated: event('activated'), onUpdated: event('updated')},
            webRequest: {
                onBeforeRequest: event('before'),
                onBeforeSendHeaders: event('headers'),
                onCompleted: event('completed'),
                onErrorOccurred: event('error')
            }
        };
        runInNewContext(source, {
            browser,
            URL,
            TextDecoder,
            Date,
            setInterval() {},
            setTimeout() {},
            console: {
                log(...a) {
                    logs.push(a.join(' '));
                },
                warn(...a) {
                    logs.push(a.join(' '));
                },
                error(...a) {
                    logs.push(a.join(' '));
                }
            }
        });
        const body = JSON.stringify({variables: {count: 20}, features: {read: true}});
        function query(id, url, method = 'GET', statusCode = 200) {
            events.before[0]({
                requestId: id,
                url,
                method,
                requestBody: method === 'POST' ? {raw: [{bytes: new TextEncoder().encode(body).buffer}]} :
                                                 undefined
            });
            events.headers[0](
                {requestId: id, requestHeaders: [{name: 'Cookie', value: 'auth_token=fixture-secret'}]});
            events.completed[0]({requestId: id, statusCode});
        }
        query('1', 'https://x.com/i/api/graphql/query/HomeTimeline', 'POST');
        query('2', 'https://x.com/i/api/graphql/query/TweetDetail');
        query('3', 'https://x.com/i/api/graphql/query/FavoriteTweet', 'POST');
        query('4', 'https://other.test/i/api/graphql/query/TweetDetail');
        query('5', 'https://x.com/i/api/graphql/query/TweetDetail', 'GET', 403);
        const templates = sent.filter(m => m.event === 'read_api_template');
        expect(templates).toHaveLength(2);
        expect(templates[0].body).toBe(body);
        expect(templates[1].method).toBe('GET');
        expect(logs.join('\n')).not.toContain('fixture-secret');
        events.before[1]();
        expect(sent.at(-1).event).toBe('read_session_clear');
    });

test(
    'complete cached home is labeled, stays readable on refresh failure, and is never passed off as fresh',
    async ({page}) => {
        await mount(page);
        await page.evaluate(
            data => TvXReader.cachedHome(data, Date.now() - 60000),
            payload([tweet('101', 'Complete saved text '.repeat(100))]));
        await expect(page.locator('#freshness')).toContainText('上次时间线');
        await expect
            .poll(() => page.evaluate(() => calls.some(c => c[0] === 'rendered' && c[2] === 'home_cached')))
            .toBe(true);
        await receive(page, 'r0', null, 'network');
        await expect(page.locator('.text')).toContainText('Complete saved text');
        await expect(page.locator('#freshness')).toContainText('更新未完成');
        expect(await page.evaluate(() => calls.some(c => c[0] === 'rendered' && c[2] === 'home')))
            .toBe(false);
        await key(page, 'ok');
        await expect(page.locator('.detail-post .text').first()).toContainText('Complete saved text');
        await expect(page.locator('#freshness')).toContainText('上次内容');
    });

test(
    'fresh home arriving during detail reading does not steal the current scene or discard its parent',
    async ({page}) => {
        await mount(page);
        await page.evaluate(
            data => TvXReader.cachedHome(data, Date.now() - 60000), payload([tweet('101', 'Saved home')]));
        await key(page, 'ok');
        await page.evaluate(data => TvXReader.homeUpdated(data, ''), payload([tweet('102', 'New home')]));
        await receive(page, 'r1', payload([tweet('101', 'Fresh detail')]));
        await expect(page.locator('.text')).toContainText('Fresh detail');
        await key(page, 'back');
        await expect(page.locator('.text')).toContainText('Saved home');
        await expect(page.locator('#freshness')).toContainText('有新内容');
        await key(page, 'up');
        await key(page, 'ok');
        await expect(page.locator('.text')).toContainText('New home');
        await expect(page.locator('#freshness')).toHaveText('刚刚更新');
    });

test('a complete API long note opens immediately while comments load separately', async ({page}) => {
    await mount(page);
    const full = 'Entire long note '.repeat(200);
    await receive(page, 'r0', payload([tweet(
                                  '101', 'Truncated legacy field', '',
                                  {note_tweet: {note_tweet_results: {result: {text: full}}}})]));
    await key(page, 'ok');
    await expect(page.locator('.detail-post .text').first()).toHaveText(full.trim());
    await expect(page.locator('.comment-list')).toContainText('正在加载评论');
    await expect
        .poll(() => page.evaluate(() => calls.some(c => c[0] === 'rendered' && c[2] === 'detail_reused')))
        .toBe(true);
    await receive(page, 'r1', payload([tweet('101', full), tweet('201', 'Reply', '101')]));
    await expect(page.locator('.comment')).toHaveCount(1);
    await expect(page.locator('.detail-post .text').first()).toHaveText(full.trim());
});


test('write result is correlated, deduplicated and updates saved scenes without stealing navigation', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([tweet('101'), tweet('102','Second')]));
    await key(page,'menu'); await key(page,'down'); await key(page,'ok');
    await key(page,'menu'); await key(page,'down'); await key(page,'ok');
    expect(await page.evaluate(() => calls.filter(c => c[0] === 'write').length)).toBe(1);
    await page.evaluate(() => TvXReader.writeResult('wrong','101',{status:'ok',liked:true,likes:99}));
    await expect(page.locator('.stats .like')).toContainText('喜欢 3');
    await key(page,'down');
    await page.evaluate(() => TvXReader.writeResult('w1','101',{status:'ok',liked:true,likes:4}));
    await expect(page.locator('#position')).toHaveText('2 / 2');
    await expect(page.locator('.stats .like')).toContainText('喜欢 3');
    await key(page,'up');
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    await page.evaluate(() => TvXReader.writeResult('w1','101',{status:'ok',liked:false,likes:3}));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
});

test('ambiguous writes never fall back to DOM actions and cancelled drafts do not increment comments', async ({page}) => {
    await mount(page); await receive(page,'r0',payload([tweet('101')]));
    await key(page,'menu'); await key(page,'down'); await key(page,'ok');
    await page.evaluate(() => TvXReader.writeResult('w1','101',{status:'unknown'}));
    await expect(page.locator('#notice')).toContainText('勿重复提交');
    await expect(page.locator('.stats .like')).toContainText('喜欢 3');
    expect(await page.evaluate(() => calls.filter(c=>c[0]==='browser'))).toEqual([]);
    await key(page,'menu'); await key(page,'ok');
    await page.evaluate(() => TvXReader.writeResult('w2','101',{status:'cancelled'}));
    await expect(page.locator('.stats')).toContainText('评论 2');
    await key(page,'menu'); await key(page,'ok');
    await page.evaluate(() => TvXReader.writeResult('w3','101',{status:'ok',replyId:'201'}));
    await expect(page.locator('.stats')).toContainText('评论 3');
});


test('an earlier detail response cannot revert a confirmed like or hide the newly posted reply',async({page})=>{
    await mount(page);await receive(page,'r0',payload([tweet('101')]));await key(page,'ok');
    await key(page,'menu');await key(page,'down');await key(page,'ok');
    await page.evaluate(()=>TvXReader.writeResult('w1','101',{status:'ok',liked:true,likes:4}));
    await key(page,'menu');await key(page,'ok');
    await page.evaluate(reply=>TvXReader.writeResult('w2','101',{status:'ok',replyId:'201',reply}),tweet('201','My new reply','101'));
    await receive(page,'r1',payload([tweet('101'),tweet('202','Earlier comment','101')]));
    await expect(page.locator('.stats .like')).toContainText('已喜欢 4');
    await expect(page.locator('.stats')).toContainText('评论 3');
    await expect(page.locator('.comment-list')).toContainText('My new reply');
});
