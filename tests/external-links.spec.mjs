import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);

function post(id, text = 'A post', extra = {}, legacyExtra = {}) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author', screen_name: 'author'}}}},
        legacy: {
            full_text: text,
            reply_count: 0,
            favorite_count: 0,
            conversation_id_str: id,
            ...legacyExtra
        },
        ...extra
    };
}
function entities(urls) {
    return {entities: {urls}};
}
function card(url, values) {
    return {
        card: {
            legacy: {
                url,
                name: 'summary_large_image',
                binding_values: Object.keys(values).map(key => ({
                    key,
                    value: {type: 'STRING', string_value: values[key]}
                }))
            }
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
async function parse(tweets) {
    const sandbox = {URL, Set, Map};
    runInNewContext(await readFile(new URL('data.js', assets), 'utf8'), sandbox);
    return sandbox.TvXReadData.parse(payload(tweets), 'home').posts;
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
const calls = (page, name) => page.evaluate(n => calls.filter(c => c[0] === n), name);

test('a link card contributes its title and publisher domain, not the t.co wrapper', async () => {
    const [parsed] = await parse([post('101', 'Read this', {
        ...card('https://t.co/abc', {
            title: 'Algorithms for Modern Hardware',
            domain: 'en.algorithmica.org',
            card_url: 'https://en.algorithmica.org/hpc/'
        })
    }, entities([{
        url: 'https://t.co/abc',
        expanded_url: 'https://en.algorithmica.org/hpc/',
        display_url: 'en.algorithmica.org/hpc/'
    }]))]);
    expect(parsed.links).toEqual([{
        url: 'https://en.algorithmica.org/hpc/',
        title: 'Algorithms for Modern Hardware',
        domain: 'en.algorithmica.org'
    }]);
});

test('a card wrapping the same t.co as the body link is listed once', async () => {
    // Real X shape: summary_large_image puts the t.co wrapper in card_url, not the publisher URL.
    const [parsed] = await parse([post('101', 'Read this', {
        ...card('https://t.co/jY4O5OeWz0', {
            title: '1,000,000 taps. Then everything freezes.',
            domain: '1milliontaps.lol',
            vanity_url: '1milliontaps.lol',
            card_url: 'https://t.co/jY4O5OeWz0'
        })
    }, entities([{
        url: 'https://t.co/jY4O5OeWz0',
        expanded_url: 'https://1milliontaps.lol/',
        display_url: '1milliontaps.lol'
    }]))]);
    expect(parsed.links).toEqual([{
        url: 'https://1milliontaps.lol/',
        title: '1,000,000 taps. Then everything freezes.',
        domain: '1milliontaps.lol'
    }]);
});

test('links back into X are never offered as external targets', async () => {
    const [parsed] = await parse([post('101', 'Quoting', {}, entities([{
        url: 'https://t.co/q',
        expanded_url: 'https://x.com/other/status/999',
        display_url: 'x.com/other/status/999'
    }, {
        url: 'https://t.co/p',
        expanded_url: 'https://twitter.com/i/web/status/1',
        display_url: 'twitter.com/i/web/status/1'
    }]))]);
    expect(parsed.links).toEqual([]);
});

test('every body link is kept in order and labelled by its display text', async () => {
    const [parsed] = await parse([post('101', 'Two links', {}, entities([{
        url: 'https://t.co/1',
        expanded_url: 'https://github.com/a/b',
        display_url: 'github.com/a/b'
    }, {
        url: 'https://t.co/2',
        expanded_url: 'https://www.example.org/post?x=1',
        display_url: 'example.org/post?x=1'
    }]))]);
    expect(parsed.links).toEqual([
        {url: 'https://github.com/a/b', title: 'github.com/a/b', domain: 'github.com'},
        {url: 'https://www.example.org/post?x=1', title: 'example.org/post?x=1', domain: 'example.org'}
    ]);
});

test('an already unwound redirect target wins over the shortener it came from', async () => {
    const [parsed] = await parse([post('101', 'Shortened', {}, entities([{
        url: 'https://t.co/3',
        expanded_url: 'https://bit.ly/xyz',
        display_url: 'bit.ly/xyz',
        unwound_url: 'https://blog.example.com/real'
    }]))]);
    expect(parsed.links).toEqual([
        {url: 'https://blog.example.com/real', title: 'blog.example.com/real', domain: 'blog.example.com'}
    ]);
});

test('an unresolved t.co stays openable and is named by the domain X displayed', async () => {
    const [parsed] = await parse([post('101', 'Unresolved', {}, entities([{
        url: 'https://t.co/4',
        expanded_url: 'https://t.co/4',
        display_url: 'uirules.com'
    }, {
        url: 'https://t.co/5',
        expanded_url: 'http://insecure.example/page',
        display_url: 'insecure.example/page'
    }]))]);
    expect(parsed.links).toEqual([
        {url: 'https://t.co/4', title: 'uirules.com', domain: 'uirules.com'},
        {url: 'https://t.co/5', title: 'insecure.example/page', domain: 'insecure.example'}
    ]);
});

test('a post without usable link data offers no external entry at all', async () => {
    const [plain] = await parse([post('101', 'No links')]);
    expect(plain.links).toEqual([]);
    const [broken] = await parse([post('102', 'Broken', {}, entities([
        {url: 'not-a-url', expanded_url: '', display_url: ''},
        {expanded_url: 'javascript:alert(1)', display_url: ''}
    ]))]);
    expect(broken.links).toEqual([]);
});

test('long-form note links are read from the note entity set', async () => {
    const [parsed] = await parse([post('101', 'Short', {
        note_tweet: {
            note_tweet_results: {
                result: {
                    text: 'The whole note',
                    entity_set: {
                        urls: [{
                            url: 'https://t.co/n',
                            expanded_url: 'https://notes.example.com/deep',
                            display_url: 'notes.example.com/deep'
                        }]
                    }
                }
            }
        }
    }, entities([{
        url: 'https://t.co/old',
        expanded_url: 'https://stale.example.com/',
        display_url: 'stale.example.com'
    }]))]);
    expect(parsed.links).toEqual([
        {url: 'https://notes.example.com/deep', title: 'notes.example.com/deep', domain: 'notes.example.com'}
    ]);
});

test('the action menu names each external target by title and domain', async ({page}) => {
    await mount(page);
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([post('101', 'Read this', {
        ...card('https://t.co/abc', {
            title: 'Algorithms for Modern Hardware',
            domain: 'en.algorithmica.org',
            card_url: 'https://en.algorithmica.org/hpc/'
        })
    }, entities([
        {url: 'https://t.co/abc', expanded_url: 'https://en.algorithmica.org/hpc/', display_url: 'en.algorithmica.org/hpc/'},
        {url: 'https://t.co/2', expanded_url: 'https://github.com/a/b', display_url: 'github.com/a/b'}
    ]))]));
    await key(page, 'menu');
    const links = page.locator('.action-options button.external');
    await expect(links).toHaveCount(2);
    await expect(links.nth(0).locator('.label')).toHaveText('Algorithms for Modern Hardware');
    await expect(links.nth(0).locator('.domain')).toHaveText('en.algorithmica.org');
    await expect(links.nth(1).locator('.domain')).toHaveText('github.com');
});

test('a post with no links shows only the write actions', async ({page}) => {
    await mount(page);
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([post('101', 'No links')]));
    await key(page, 'menu');
    await expect(page.locator('.action-options button')).toHaveCount(2);
    await expect(page.locator('.action-options button.external')).toHaveCount(0);
});

test('the post itself shows a card naming each external target', async ({page}) => {
    await mount(page);
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([post('101', 'Read this', {
        ...card('https://t.co/abc', {
            title: 'Algorithms for Modern Hardware',
            domain: 'en.algorithmica.org',
            card_url: 'https://en.algorithmica.org/hpc/'
        })
    }, entities([
        {url: 'https://t.co/abc', expanded_url: 'https://en.algorithmica.org/hpc/', display_url: 'en.algorithmica.org/hpc/'},
        {url: 'https://t.co/2', expanded_url: 'https://github.com/a/b', display_url: 'github.com/a/b'}
    ]))]));
    const cards = page.locator('.post .link-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.label')).toHaveText('Algorithms for Modern Hardware');
    await expect(cards.nth(0).locator('.domain')).toHaveText('en.algorithmica.org');
    await expect(cards.nth(1).locator('.domain')).toHaveText('github.com');
});

test('clicking a card opens the same target the remote would', async ({page}) => {
    await mount(page);
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([post('101', 'Read this', {}, entities([
        {url: 'https://t.co/2', expanded_url: 'https://github.com/a/b', display_url: 'github.com/a/b'}
    ]))]));
    await page.locator('.post .link-card').click();
    expect(await calls(page, 'openExternal')).toEqual([['openExternal', 'https://github.com/a/b']]);
    await expect(page.locator('.external-status')).toContainText('github.com');
    expect(await page.evaluate(() => location.href)).toBe('https://reader.test/');
});

test('a post without links renders no card, and comments never carry one', async ({page}) => {
    await mount(page);
    const linked = entities([{url: 'https://t.co/2', expanded_url: 'https://github.com/a/b', display_url: 'github.com/a/b'}]);
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([post('101', 'No links')]));
    await expect(page.locator('.link-card')).toHaveCount(0);
    await key(page, 'ok');
    await page.evaluate(data => TvXReader.receive('r1', data, ''),
        payload([post('101', 'Root'), post('102', 'A reply', {}, {...linked, in_reply_to_status_id_str: '101'})]));
    await expect(page.locator('.comment')).toHaveCount(1);
    await expect(page.locator('.comment .link-card')).toHaveCount(0);
});

async function openFirstLink(page) {
    await mount(page);
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([post('101', 'Read this', {}, entities([
        {url: 'https://t.co/abc', expanded_url: 'https://en.algorithmica.org/hpc/', display_url: 'en.algorithmica.org/hpc/'}
    ]))]));
    await key(page, 'menu');
    await key(page, 'down');
    await key(page, 'down');
    await key(page, 'ok');
}

test('confirming a link asks the host to open it and reports progress immediately', async ({page}) => {
    await openFirstLink(page);
    expect(await calls(page, 'openExternal')).toEqual([['openExternal', 'https://en.algorithmica.org/hpc/']]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const status = page.locator('.external-status');
    await expect(status).toContainText('en.algorithmica.org');
    await expect(status).toContainText('取消');
});

test('back cancels an external open and restores the reader', async ({page}) => {
    await openFirstLink(page);
    await key(page, 'back');
    expect(await calls(page, 'cancelExternal')).toEqual([['cancelExternal']]);
    await expect(page.locator('.external-status')).toHaveCount(0);
    await expect(page.locator('.post')).toHaveCount(1);
});

test('a failed open explains itself and retries on confirm', async ({page}) => {
    await openFirstLink(page);
    await page.evaluate(() => TvXReader.externalFailed('https://en.algorithmica.org/hpc/', 'network'));
    const status = page.locator('.external-status');
    await expect(status).toContainText('未能打开');
    await expect(status).toContainText('重试');
    await key(page, 'ok');
    expect(await calls(page, 'openExternal')).toHaveLength(2);
    await expect(status).not.toContainText('未能打开');
    await key(page, 'back');
    await expect(page.locator('.external-status')).toHaveCount(0);
});

const linked = entities([{url: 'https://t.co/2', expanded_url: 'https://github.com/a/b', display_url: 'github.com/a/b'}]);
const scrollTop = page => page.evaluate(() => document.querySelector('.body').scrollTop);

test('returning to the timeline restores the selected post and its reading position', async ({page}) => {
    await mount(page);
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([
        post('101', 'First'),
        post('102', 'A very long post\n'.repeat(200), {}, linked)
    ]));
    await key(page, 'down');
    await expect(page.locator('#position')).toHaveText('2 / 2');
    await page.evaluate(() => document.querySelector('.body').scrollTop = 400);
    const at = await scrollTop(page);
    expect(at).toBeGreaterThan(0);
    await key(page, 'menu');
    await key(page, 'down');
    await key(page, 'down');
    await key(page, 'ok');
    expect(await calls(page, 'openExternal')).toEqual([['openExternal', 'https://github.com/a/b']]);
    await page.evaluate(() => TvXReader.externalClosed());
    await expect(page.locator('#position')).toHaveText('2 / 2');
    expect(await scrollTop(page)).toBe(at);
});

test('returning to a detail restores the post, the comment focus and both scroll positions', async ({page}) => {
    await mount(page);
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([post('101', 'Root', {}, linked)]));
    await key(page, 'ok');
    await page.evaluate(data => TvXReader.receive('r1', data, ''), payload([
        post('101', 'A very long root\n'.repeat(200), {}, linked),
        post('201', 'First reply', {}, {in_reply_to_status_id_str: '101'}),
        post('202', 'Second reply', {}, {in_reply_to_status_id_str: '101'})
    ]));
    await expect(page.locator('.detail-post')).toHaveCount(1);
    await page.evaluate(() => document.querySelector('.body').scrollTop = 300);
    const at = await scrollTop(page);
    expect(at).toBeGreaterThan(0);
    await key(page, 'right');
    await key(page, 'down');
    await expect(page.locator('.comment.selected')).toContainText('Second reply');
    await key(page, 'menu');
    await key(page, 'down');
    await key(page, 'down');
    await key(page, 'ok');
    expect(await calls(page, 'openExternal')).toEqual([['openExternal', 'https://github.com/a/b']]);
    await page.evaluate(() => TvXReader.externalClosed());
    await expect(page.locator('.detail-post')).toHaveCount(1);
    await expect(page.locator('.comment.selected')).toContainText('Second reply');
    expect(await scrollTop(page)).toBe(at);
});

test('a late page callback never overwrites a reader the user already came back to', async ({page}) => {
    await openFirstLink(page);
    await key(page, 'back');
    await page.evaluate(() => TvXReader.externalFailed('https://en.algorithmica.org/hpc/', 'network'));
    await expect(page.locator('.external-status')).toHaveCount(0);
    await page.evaluate(() => TvXReader.externalClosed());
    await expect(page.locator('.external-status')).toHaveCount(0);
    await expect(page.locator('.post')).toHaveCount(1);
    expect(await calls(page, 'openExternal')).toHaveLength(1);
});

test('the reader ignores navigation keys while an external target is opening', async ({page}) => {
    await openFirstLink(page);
    await key(page, 'down');
    await key(page, 'menu');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.external-status')).toHaveCount(1);
    await page.evaluate(() => TvXReader.externalClosed());
    await expect(page.locator('.external-status')).toHaveCount(0);
});
