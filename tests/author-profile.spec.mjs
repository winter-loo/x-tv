import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);

function authorPost(id, text = 'Author post', extraUser = {}) {
    return {
        rest_id: id,
        core: {
            user_results: {
                result: {
                    rest_id: '44196397',
                    core: {name: '智见AI-大鹏', screen_name: 'zjp1997720'},
                    avatar: {image_url: 'https://twimg.com/avatar.jpg'},
                    legacy: {
                        name: '智见AI-大鹏',
                        screen_name: 'zjp1997720',
                        profile_image_url_https: 'https://twimg.com/avatar.jpg',
                        profile_banner_url: 'https://twimg.com/banner.jpg',
                        description: '北交大硕士，前大厂产业研究员&数据分析师\n现带领家族企业转型AI',
                        verified: true,
                        followers_count: 4742,
                        friends_count: 316,
                        statuses_count: 1999,
                        location: 'Beijing, China',
                        entities: {
                            url: {
                                urls: [{
                                    expanded_url: 'https://zhijian-ai.cn',
                                    display_url: 'zhijian-ai.cn'
                                }]
                            }
                        },
                        created_at: 'Fri Feb 14 00:00:00 +0000 2025',
                        following: false,
                        ...extraUser
                    }
                }
            }
        },
        legacy: {
            full_text: text,
            reply_count: 12,
            favorite_count: 88,
            conversation_id_str: id,
            created_at: 'Sat Sep 12 12:00:00 +0000 2026'
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

const key = (page, k) => page.evaluate(k => TvXReader.key(k), k);
const calls = (page, name) => page.evaluate(n => calls.filter(c => c[0] === n), name);

test('right-click menu contains view author but no follow action', async ({page}) => {
    await mount(page);
    const tweet = authorPost('101', 'Test tweet');
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweet]));

    // Open action menu (Menu key / right click)
    await key(page, 'menu');

    const options = page.locator('.action-options button');
    await expect(options.nth(0)).toContainText('喜欢');
    await expect(options.nth(1)).toContainText('写评论');
    await expect(options).toHaveCount(4);
    await expect(options.nth(2)).toContainText('查看作者');
    await expect(options.nth(3)).toContainText('退出 X 登录');
    await expect(options.filter({hasText: '关注'})).toHaveCount(0);
});

test('activating view author button in menu opens author profile with biography and posts', async ({page}) => {
    await mount(page);
    const tweet1 = authorPost('101', 'First post by author');
    const tweet2 = authorPost('102', 'Second post by author');
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweet1, tweet2]));

    await key(page, 'menu');
    // Select "查看作者" (index 2)
    await key(page, 'down');
    await key(page, 'down');
    await key(page, 'ok');

    // Title shows author name and verified badge
    const title = page.locator('#title');
    await expect(title).toContainText('智见AI-大鹏');
    await expect(title.locator('.verified-badge')).toBeVisible();

    // Verify author information
    const profile = page.locator('.author-profile');
    await expect(profile).toBeVisible();
    await expect(profile.locator('.author-display-name')).toContainText('智见AI-大鹏');
    await expect(profile.locator('.author-handle')).toContainText('@zjp1997720');
    await expect(profile.locator('.author-bio')).toContainText('北交大硕士');
    await expect(profile.locator('.author-meta-row')).toContainText('Beijing, China');
    await expect(profile.locator('.author-meta-row')).toContainText('zhijian-ai.cn');
    await expect(profile.locator('.author-meta-row')).toContainText('2025 年 2 月加入');
    await expect(profile.locator('.author-stats-row')).toContainText('316 正在关注');
    await expect(profile.locator('.author-stats-row')).toContainText('4,742 关注者');
    await expect(profile.locator('.author-follow-btn')).toContainText('关注');

    // Verify the companion posts section
    const postsList = page.locator('.author-posts-list');
    await expect(postsList).toBeVisible();
    const postCards = postsList.locator('.author-post-card');
    await expect(postCards).toHaveCount(2);
    await expect(postCards.nth(0)).toContainText('First post by author');
    await expect(postCards.nth(1)).toContainText('Second post by author');
});

test('clicking author on a timeline card opens author profile', async ({page}) => {
    await mount(page);
    const tweet = authorPost('101', 'Hello author test');
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweet]));

    // Click author block
    await page.locator('.author').click();

    // Verify author profile is open
    await expect(page.locator('.author-profile')).toBeVisible();
    await expect(page.locator('.author-display-name')).toContainText('智见AI-大鹏');
    await expect(page.locator('.author-posts-list .author-post-card')).toHaveCount(1);
});

test('DPAD navigation on author page: bio to posts, open detail, and Back returns correctly', async ({page}) => {
    await mount(page);
    const tweet1 = authorPost('101', 'First post by author');
    const tweet2 = authorPost('102', 'Second post by author');
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweet1, tweet2]));

    // Open author
    await page.locator('.author').click();
    await expect(page.locator('.author-profile')).toBeVisible();

    // Initial focus on bio / follow button
    await expect(page.locator('.author-follow-btn')).toHaveClass(/focus/);

    // Press down: moves focus to first post
    await key(page, 'down');
    const firstPost = page.locator('.author-post-card').nth(0);
    await expect(firstPost).toHaveClass(/selected/);

    // Press down: moves focus to second post
    await key(page, 'down');
    const secondPost = page.locator('.author-post-card').nth(1);
    await expect(secondPost).toHaveClass(/selected/);

    // Press OK: opens detail view of second post
    await key(page, 'ok');
    await expect(page.locator('#title')).toContainText('帖子详情');
    await expect(page.locator('.detail-post .text')).toContainText('Second post by author');

    // Press Back: returns to author page
    await key(page, 'back');
    await expect(page.locator('.author-profile')).toBeVisible();
    await expect(page.locator('.author-display-name')).toContainText('智见AI-大鹏');

    // Press Back again: returns to original timeline
    await key(page, 'back');
    await expect(page.locator('.author-profile')).toHaveCount(0);
    await expect(page.locator('.post')).toHaveCount(1);
});

test('toggling follow on author profile page toggles state and notice', async ({page}) => {
    await mount(page);
    const tweet = authorPost('101', 'Profile follow test');
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweet]));

    await page.locator('.author').click();
    await expect(page.locator('.author-profile')).toBeVisible();

    const followBtn = page.locator('.author-follow-btn');
    await expect(followBtn).toContainText('关注');

    // Press OK while focused on bio to toggle follow
    await key(page, 'ok');

    // Follow button optimistically updates to "已关注"
    await expect(followBtn).toContainText('已关注');
    await expect(followBtn).toHaveClass(/following/);

    const writeCalls = await calls(page, 'write');
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0][1]).toBe('w1');
    expect(writeCalls[0][2]).toBe('44196397');
    expect(writeCalls[0][3]).toBe('follow');
    expect(writeCalls[0][4]).toBe(true);

    // Simulate completion
    await page.evaluate(() => TvXReader.writeResult('w1', '44196397', {status: 'ok', following: true}));
    await expect(page.locator('#notice')).toContainText('已关注');

    // Click again to unfollow
    await followBtn.click();
    await expect(followBtn).toContainText('关注');
    await expect(followBtn).not.toHaveClass(/following/);
});

test('current X profile fields render readable TV columns and remote focus', async ({page}) => {
    await mount(page);
    const tweet = authorPost('301', 'A post to read on TV');
    const u = tweet.core.user_results.result;
    delete u.legacy;
    u.profile_bio = {description: '真诚交友 &amp; 互助共享\n记录极客日常', entities: {url: {urls: [{expanded_url: 'https://mjj.wiki', display_url: 'mjj.wiki'}]}}};
    u.location = {location: '北京'};
    u.relationship_counts = {followers: 5592, following: 2955};
    u.tweet_counts = {tweets: 3567};
    u.core.created_at = 'Sun Apr 26 07:16:18 +0000 2026';
    u.relationship_perspectives = {following: true};
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweet]));
    await page.locator('.author').click();
    await expect(page.locator('.author-bio')).toHaveText('真诚交友 & 互助共享\n记录极客日常');
    await expect(page.locator('.author-meta-row')).toContainText('北京');
    await expect(page.locator('.author-meta-row')).toContainText('2026 年 4 月加入');
    await expect(page.locator('.author-stats-row')).toContainText('5,592 关注者');
    await expect(page.locator('.author-follow-btn')).toContainText('已关注');
    await expect(page.locator('.author-handle')).toContainText('3,567 篇帖子');
    await expect(page.locator('.author-page')).not.toContainText('[object Object]');
    const profile = await page.locator('.author-profile').boundingBox();
    const posts = await page.locator('.author-posts-list').boundingBox();
    expect(profile.x + profile.width).toBeLessThan(posts.x);
    expect(Math.abs(profile.y - posts.y)).toBeLessThan(100);
    await key(page, 'right');
    await expect(page.locator('.author-post-card')).toHaveClass(/selected/);
    await key(page, 'left');
    await expect(page.locator('.author-follow-btn')).toHaveClass(/focus/);
    expect(await calls(page, 'write')).toHaveLength(0);
});

test('empty structured location and invalid biography never stringify objects', async ({page}) => {
    await mount(page);
    const tweet = authorPost('302');
    const u = tweet.core.user_results.result;
    delete u.legacy;
    u.location = {location: ''};
    u.bio = {unknown: 'not text'};
    await page.evaluate(data => TvXReader.receive('r0', data, ''), payload([tweet]));
    await page.locator('.author').click();
    await expect(page.locator('.author-page')).not.toContainText('[object Object]');
    await expect(page.locator('.author-bio')).toHaveText('作者暂未提供简介');
});
