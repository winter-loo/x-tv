import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);

function post(id, text = 'A post', extra = {}, legacyExtra = {}) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author ' + id, screen_name: 'author' + id}}}},
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
const key = (page, k) => page.evaluate(k => TvXReader.key(k), k);
const calls = (page, name) => page.evaluate(n => calls.filter(c => c[0] === n), name);

test('quoted post appears in the action menu and displays author and status link', async ({page}) => {
    await mount(page);
    const quotedTweet = post('999', 'Quoted content here', {});
    quotedTweet.core.user_results.result.core.name = 'SpaceX';
    quotedTweet.core.user_results.result.core.screen_name = 'SpaceX';

    const mainTweet = post('101', 'Look at this quote', {
        quoted_status_result: {result: quotedTweet}
    });

    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([mainTweet]));
    await key(page, 'menu');

    const options = page.locator('.action-options button');
    await expect(options).toHaveCount(5); // like, author, reply, quoted post link, and logout
    const tweetLink = page.locator('.action-options button.tweet-link');
    await expect(tweetLink).toHaveCount(1);
    await expect(tweetLink.locator('.label')).toContainText('SpaceX');
    await expect(tweetLink.locator('.label')).toContainText('Quoted content here');
    await expect(tweetLink.locator('.domain')).toBeVisible();
    await expect(tweetLink.locator('.domain')).toHaveText('x.com/SpaceX/status/999');
});

test('activating a quoted post option opens it in detail mode in app, Back returns to original post', async ({page}) => {
    await mount(page);
    const quotedTweet = post('999', 'Quoted content here', {});
    quotedTweet.core.user_results.result.core.name = 'SpaceX';
    quotedTweet.core.user_results.result.core.screen_name = 'SpaceX';

    const mainTweet = post('101', 'Main post text', {
        quoted_status_result: {result: quotedTweet}
    });

    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([mainTweet]));
    await key(page, 'menu');

    // Click the tweet-link
    await page.locator('.action-options button.tweet-link').click();

    // Verify it opened in detail mode inside app
    const title = page.locator('#title');
    await expect(title).toContainText('帖子详情');
    await expect(page.locator('.detail-post .text')).toContainText('Quoted content here');

    // Verify request for detail was sent to ReaderHost
    const reqCalls = await calls(page, 'request');
    expect(reqCalls.some(c => c[2] === 'detail' && c[3] === '999')).toBe(true);

    // Press Back key
    await key(page, 'back');

    // Verify returned to original post
    await expect(page.locator('.post .text')).toContainText('Main post text');
    await expect(title).toContainText('时间线');
});

test('a tweet URL in entities.urls is offered in menu and opens in detail mode', async ({page}) => {
    await mount(page);
    const tweetWithUrl = post('101', 'Check this tweet out', {}, entities([
        {
            url: 'https://t.co/abc',
            expanded_url: 'https://x.com/OpenAI/status/888',
            display_url: 'x.com/OpenAI/status/888'
        }
    ]));

    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweetWithUrl]));
    await key(page, 'menu');

    const tweetLink = page.locator('.action-options button.tweet-link');
    await expect(tweetLink).toHaveCount(1);
    await expect(tweetLink.locator('.label')).toContainText('@OpenAI');
    await expect(tweetLink.locator('.domain')).toHaveText('x.com/OpenAI/status/888');

    // Activate option
    await tweetLink.click();
    await expect(page.locator('#title')).toContainText('帖子详情');

    const reqCalls = await calls(page, 'request');
    expect(reqCalls.some(c => c[2] === 'detail' && c[3] === '888')).toBe(true);

    // Press Back to return
    await key(page, 'back');
    await expect(page.locator('.post .text')).toContainText('Check this tweet out');
});

test('a tweet URL in post body text is offered in menu and opens in detail mode', async ({page}) => {
    await mount(page);
    const tweetWithTextLink = post('101', 'Here is a link: https://x.com/elonmusk/status/777');

    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweetWithTextLink]));
    await key(page, 'menu');

    const tweetLink = page.locator('.action-options button.tweet-link');
    await expect(tweetLink).toHaveCount(1);
    await expect(tweetLink.locator('.label')).toContainText('@elonmusk');
    await expect(tweetLink.locator('.domain')).toHaveText('x.com/elonmusk/status/777');

    await tweetLink.click();
    await expect(page.locator('#title')).toContainText('帖子详情');

    await key(page, 'back');
    await expect(page.locator('.post .text')).toContainText('Here is a link:');
});

test('in detail view, embedded post link opens second detail, and Back returns to first detail', async ({page}) => {
    await mount(page);
    const innerQuoted = post('999', 'Inner post body');
    innerQuoted.core.user_results.result.core.name = 'InnerAuthor';
    innerQuoted.core.user_results.result.core.screen_name = 'inner';

    const rootPost = post('101', 'First detail post', {
        quoted_status_result: {result: innerQuoted}
    });

    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([rootPost]));

    // Open first post into detail
    await key(page, 'ok');
    await expect(page.locator('#title')).toContainText('帖子详情');
    await expect(page.locator('.detail-post .text')).toContainText('First detail post');

    // Open menu in detail view
    await key(page, 'menu');
    const tweetLink = page.locator('.action-options button.tweet-link');
    await expect(tweetLink).toHaveCount(1);
    await expect(tweetLink.locator('.label')).toContainText('InnerAuthor');

    // Click inner post
    await tweetLink.click();
    await expect(page.locator('.detail-post .text')).toContainText('Inner post body');

    // Press Back once: return to first detail view
    await key(page, 'back');
    await expect(page.locator('.detail-post .text')).toContainText('First detail post');

    // Press Back second time: return to timeline
    await key(page, 'back');
    await expect(page.locator('.post .text')).toContainText('First detail post');
    await expect(page.locator('#title')).toContainText('时间线');
});

test('deduplication: quoted post and matching URL produce only one option, self link is ignored', async ({page}) => {
    await mount(page);
    const quotedTweet = post('999', 'Quoted text');
    quotedTweet.core.user_results.result.core.name = 'SpaceX';
    quotedTweet.core.user_results.result.core.screen_name = 'SpaceX';

    // Post quotes 999, also has 999 in entities, also links to itself (101)
    const tweet = post('101', 'Self link https://x.com/author101/status/101 and https://x.com/SpaceX/status/999', {
        quoted_status_result: {result: quotedTweet}
    }, entities([
        {
            url: 'https://t.co/999',
            expanded_url: 'https://x.com/SpaceX/status/999',
            display_url: 'x.com/SpaceX/status/999'
        },
        {
            url: 'https://t.co/101',
            expanded_url: 'https://x.com/author101/status/101',
            display_url: 'x.com/author101/status/101'
        }
    ]));

    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweet]));
    await key(page, 'menu');

    // Should have only 1 tweet link (for 999), self (101) ignored, duplicate 999 deduplicated
    const tweetLinks = page.locator('.action-options button.tweet-link');
    await expect(tweetLinks).toHaveCount(1);
    await expect(tweetLinks.nth(0).locator('.domain')).toHaveText('x.com/SpaceX/status/999');
});
