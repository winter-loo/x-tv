import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const assets = new URL('../app/src/main/assets/reader/', import.meta.url);

function photo(url = 'https://pbs.twimg.com/a.jpg', alt = '') {
    return {type: 'photo', media_url_https: url, ext_alt_text: alt};
}
function video(seconds = 83) {
    return {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/poster.jpg',
        video_info: {
            duration_millis: seconds * 1000,
            variants: [{content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/a.mp4'}]
        }
    };
}
function gif() {
    return {
        type: 'animated_gif',
        media_url_https: 'https://pbs.twimg.com/gif.jpg',
        video_info: {
            duration_millis: 3000,
            variants: [{content_type: 'video/mp4', bitrate: 0, url: 'https://video.twimg.com/g.mp4'}]
        }
    };
}
function post(id, media = []) {
    return {
        rest_id: id,
        core: {user_results: {result: {core: {name: 'Author ' + id, screen_name: 'author' + id}}}},
        legacy: {
            full_text: 'Post ' + id,
            reply_count: 0,
            favorite_count: 0,
            created_at: 'Wed Sep 10 06:29:00 +0000 2026',
            conversation_id_str: id,
            ...(media.length ? {extended_entities: {media}} : {})
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
    // A picture with a real intrinsic size, so zoom and pan have something to work on.
    await page.route('https://pbs.twimg.com/**', route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000">' +
            '<rect width="4000" height="3000" fill="#345"/></svg>'
    }));
    await page.route('https://video.twimg.com/**', route => route.abort());
    await page.goto('https://reader.test/');
}
const receive = (page, id, data, error = '') =>
    page.evaluate(([id, data, error]) => TvXReader.receive(id, data, error), [id, data, error]);
const key = (page, k) => page.evaluate(k => TvXReader.key(k), k);
const help = page => page.locator('#help');

test('a video cover is marked as video, with its length', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(83)])]));
    const mark = page.locator('.media .media-mark');
    await expect(mark).toContainText('视频');
    await expect(mark).toContainText('1:23');
    await expect(mark.locator('.play')).toHaveCount(1);
});

test('a photo carries no play mark', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo()])]));
    await expect(page.locator('.media .play')).toHaveCount(0);
    await expect(page.locator('.media .media-mark'), 'a lone photo needs no mark at all')
        .toHaveCount(0);
});

test('an animated gif is marked apart from video and invents no length', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [gif()])]));
    const mark = page.locator('.media .media-mark');
    await expect(mark).toContainText('GIF');
    await expect(mark).not.toContainText('视频');
    await expect(mark).not.toContainText(':');
});

test('a video with no length says video without inventing one', async ({page}) => {
    await mount(page);
    const noLength = video(83);
    delete noLength.video_info.duration_millis;
    await receive(page, 'r0', payload([post('101', [noLength])]));
    await expect(page.locator('.media .media-mark')).toContainText('视频');
    await expect(page.locator('.media .media-mark')).not.toContainText(':');
});

test('several images show which one this is', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo(), photo(), photo()])]));
    await expect(page.locator('.media .count')).toHaveText('1 / 3');
    await key(page, 'right');
    await key(page, 'right');
    await expect(page.locator('.media .count')).toHaveText('2 / 3');
});

test('mixed media marks whichever item is showing', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo(), video(45), gif()])]));
    await key(page, 'right');
    await expect(page.locator('.media .media-mark')).not.toContainText('视频');
    await key(page, 'right');
    await expect(page.locator('.media .media-mark')).toContainText('视频');
    await expect(page.locator('.media .media-mark')).toContainText('0:45');
    await key(page, 'right');
    await expect(page.locator('.media .media-mark')).toContainText('GIF');
});

test('the prompt says what confirm will do with the focused item', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo(), video(10)])]));
    await key(page, 'right');
    await expect(help(page)).toContainText('确认 查看图片');
    await key(page, 'right');
    await expect(help(page)).toContainText('确认 播放视频');
});

test('confirm cycles the image between fit, twice and four times', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo()])]));
    await key(page, 'right');
    await key(page, 'ok');
    const scale = () => page.evaluate(() => Number(document.querySelector('.viewer').dataset.scale));
    expect(await scale()).toBe(1);
    await key(page, 'ok');
    expect(await scale()).toBe(2);
    await key(page, 'ok');
    expect(await scale()).toBe(4);
    await key(page, 'ok');
    expect(await scale()).toBe(1);
});

test('arrows pan a zoomed image and never drag it off the screen', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo(), photo()])]));
    await key(page, 'right');
    await key(page, 'ok');
    await key(page, 'ok');
    const offset = () => page.evaluate(() => {
        const v = document.querySelector('.viewer');
        return {x: Number(v.dataset.x), y: Number(v.dataset.y), scale: Number(v.dataset.scale)};
    });
    await key(page, 'right');
    const moved = await offset();
    expect(moved.scale, 'panning changed the zoom').toBe(2);
    expect(moved.x, 'the right arrow did not pan').not.toBe(0);
    for (let i = 0; i < 30; i++) await key(page, 'right');
    const far = await offset();
    const limit = await page.evaluate(() => TvXMedia.panLimit());
    expect(Math.abs(far.x), 'the image was dragged past its edge')
        .toBeLessThanOrEqual(limit.x + 0.5);
});

test('at fit size the arrows change picture and reset the view', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([
        post('101', [photo('https://pbs.twimg.com/1.jpg'), photo('https://pbs.twimg.com/2.jpg')])
    ]));
    await key(page, 'right');
    await key(page, 'ok');
    await key(page, 'right');
    await expect(page.locator('.viewer .count')).toHaveText('2 / 2');
    await key(page, 'ok');
    await key(page, 'right');
    await key(page, 'right');
    await expect(page.locator('.viewer .count'), 'switching pictures while zoomed').toHaveText('2 / 2');
});

test('back leaves the zoom before it leaves the picture', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo()])]));
    await key(page, 'right');
    await key(page, 'ok');
    await key(page, 'ok');
    await key(page, 'back');
    await expect(page.locator('.viewer')).toHaveCount(1);
    expect(await page.evaluate(() => Number(document.querySelector('.viewer').dataset.scale))).toBe(1);
    await key(page, 'back');
    await expect(page.locator('.viewer')).toHaveCount(0);
    await expect(page.locator('.post')).toHaveCount(1);
});

test('a zoomed picture shows where in the frame you are looking', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo()])]));
    await key(page, 'right');
    await key(page, 'ok');
    await expect(page.locator('.viewer .minimap')).toHaveCount(0);
    await key(page, 'ok');
    await expect(page.locator('.viewer .minimap')).toHaveCount(1);
});

test('the wheel zooms about the pointer rather than the middle', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo()])]));
    await key(page, 'right');
    await key(page, 'ok');
    const size = page.viewportSize();
    await page.mouse.move(size.width * 0.25, size.height * 0.25);
    // Enough steps that the picture is wider than the frame and really has slack to move.
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
    const at = await page.evaluate(() => {
        const v = document.querySelector('.viewer');
        return {x: Number(v.dataset.x), y: Number(v.dataset.y), scale: Number(v.dataset.scale)};
    });
    expect(at.scale, 'the wheel did not zoom').toBeGreaterThan(1);
    expect(at.x, 'zooming at the pointer did not shift the view').not.toBe(0);
});

test('a video opens straight into the player with a readable control bar', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(83)])]));
    await key(page, 'right');
    await key(page, 'ok');
    await expect(page.locator('.viewer video')).toHaveCount(1);
    await expect(page.locator('.viewer .controls')).toHaveCount(1);
    await expect(page.locator('.viewer .total')).toHaveText('1:23');
    await expect(page.locator('.viewer .elapsed')).toHaveText('0:00');
    // A low-resolution source must fill the viewport too, without shrinking after metadata.
    const player = page.locator('.viewer video');
    const viewport = page.viewportSize();
    const bounds = await player.boundingBox();
    expect(bounds).toEqual({x: 0, y: 0, width: viewport.width, height: viewport.height});
    await player.evaluate(v => { v.width = 504; v.height = 360; });
    expect(await player.boundingBox()).toEqual(bounds);
    // Filling the screen must not distort the picture.
    expect(await page.locator('.viewer video').evaluate(n => getComputedStyle(n).objectFit))
        .toBe('contain');
});

test('the progress bar can be clicked and dragged, and clamps at the ends', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(100)])]));
    await key(page, 'right');
    await key(page, 'ok');
    const bar = page.locator('.viewer .bar');
    await expect(bar).toHaveCount(1);
    const box = await bar.boundingBox();
    const at = () => page.evaluate(() => Number(document.querySelector('.viewer').dataset.seek));
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    expect(await at(), 'a click in the middle did not seek there').toBeCloseTo(50, 0);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.up();
    expect(await at(), 'dragging did not seek').toBeCloseTo(80, 0);
    // Dragging past either end clamps rather than running away.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 100, box.y + box.height / 2);
    expect(await at(), 'dragging past the start did not clamp').toBe(0);
    await page.mouse.move(box.x + box.width + 100, box.y + box.height / 2);
    expect(await at(), 'dragging past the end did not clamp').toBe(100);
    await page.mouse.up();
    // A click away from the bar is not a seek at all.
    await page.mouse.click(box.x + box.width * 0.5, box.y - 200);
    expect(await at()).toBe(100);
});

test('seeking with the remote reports where it landed and marks the bar', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(100)])]));
    await key(page, 'right');
    await key(page, 'ok');
    // Read the line in the same task as the press: a failed media load also posts a notice.
    const told = await page.evaluate(() => {
        TvXReader.key('right');
        return document.getElementById('notice').textContent;
    });
    expect(told).toContain('定位到');
    await expect(page.locator('.viewer .bar')).toHaveClass(/seeking/);
});

test('a stream of unknown length shows no draggable progress', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(83)])]));
    await key(page, 'right');
    await key(page, 'ok');
    await page.evaluate(() => TvXMedia.describe({duration: Infinity, currentTime: 0, seekable: {length: 0}}));
    await expect(page.locator('.viewer .total')).toHaveText('直播');
    await expect(page.locator('.viewer .bar')).toHaveCount(0);
});

test('the mouse opens the viewer the same way the remote does', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo()])]));
    await page.locator('.media').click();
    await expect(page.locator('.viewer img')).toHaveCount(1);
    await key(page, 'back');
    await receive(page, 'r0', payload([post('102', [video(30)])]));
    await page.locator('.media').click();
    await expect(page.locator('.viewer video')).toHaveCount(1);
});

test('an animated gif is offered as a gif, not as a video', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [gif()])]));
    await key(page, 'right');
    await expect(help(page)).toContainText('确认 播放动图');
    await expect(help(page)).not.toContainText('播放视频');
});

test('multiple pictures offer a visible previous and next', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [photo(), photo(), photo()])]));
    await key(page, 'right');
    await key(page, 'ok');
    await expect(page.locator('.viewer .step-next')).toHaveCount(1);
    await page.locator('.viewer .step-next').click();
    await expect(page.locator('.viewer .count')).toHaveText('2 / 3');
    await page.locator('.viewer .step-prev').click();
    await expect(page.locator('.viewer .count')).toHaveText('1 / 3');
    // They stay usable while zoomed, where the arrows are panning instead.
    await key(page, 'ok');
    await page.locator('.viewer .step-next').click();
    await expect(page.locator('.viewer .count')).toHaveText('2 / 3');
    expect(await page.evaluate(() => Number(document.querySelector('.viewer').dataset.scale)))
        .toBe(1);
});

test('a seek shows the target before it commits it', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(100)])]));
    await key(page, 'right');
    await key(page, 'ok');
    const shown = await page.evaluate(() => {
        TvXReader.key('right');
        TvXReader.key('right');
        return {
            preview: document.querySelector('.viewer .elapsed').textContent,
            committed: Math.round(document.querySelector('.viewer video').currentTime)
        };
    });
    expect(shown.preview, 'two presses did not preview twenty seconds').toBe('0:20');
    expect(shown.committed, 'the seek committed before the presses settled').toBe(0);
    await expect(page.locator('.viewer .bar')).toHaveClass(/seeking/);
    await expect
        .poll(() => page.evaluate(() => Math.round(document.querySelector('.viewer video').currentTime)))
        .toBe(20);
});

test('the control bar hides when left alone and comes back on use', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(30)])]));
    await key(page, 'right');
    await key(page, 'ok');
    await expect(page.locator('.viewer')).not.toHaveClass(/idle/);
    await expect(page.locator('.viewer')).toHaveClass(/idle/, {timeout: 6000});
    await expect(page.locator('.viewer .hint')).toHaveCSS('opacity', '0');
    await key(page, 'ok');
    await expect(page.locator('.viewer')).not.toHaveClass(/idle/);
    await expect(page.locator('.viewer .hint')).toHaveCSS('opacity', '1');
});

test('the bar shows how much has been buffered', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(100)])]));
    await key(page, 'right');
    await key(page, 'ok');
    await page.evaluate(() => TvXMedia.describe({
        duration: 100, currentTime: 10,
        buffered: {length: 1, end: () => 40}
    }));
    await expect(page.locator('.viewer .buffered')).toHaveAttribute('style', /width: 40%/);
    await expect(page.locator('.viewer .played')).toHaveAttribute('style', /width: 10%/);
});

test('a picture that failed to open can be retried rather than left stuck', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(30)])]));
    await key(page, 'right');
    await key(page, 'ok');
    const reloaded = await page.evaluate(() => {
        const video = document.querySelector('.viewer video');
        const before = video.getAttribute('src');
        video.dispatchEvent(new Event('error'));
        TvXReader.key('ok');
        return {before, after: video.getAttribute('src'), retried: video.dataset.retried};
    });
    expect(reloaded.retried, 'confirm after a failure did not reload the media').toBe('1');
    expect(reloaded.after).toBe(reloaded.before);
});

test('the reader formats times the way a viewer reads them', async ({page}) => {
    await mount(page);
    expect(await page.evaluate(() => [
        TvXMedia.time(0), TvXMedia.time(9), TvXMedia.time(83), TvXMedia.time(3671),
        TvXMedia.time(NaN), TvXMedia.time(Infinity)
    ])).toEqual(['0:00', '0:09', '1:23', '1:01:11', '', '']);
});

test('seeking clamps at both ends of the video', async ({page}) => {
    await mount(page);
    expect(await page.evaluate(() => [
        TvXMedia.seekTo(0, -10, 100), TvXMedia.seekTo(5, -10, 100),
        TvXMedia.seekTo(95, 10, 100), TvXMedia.seekTo(40, 10, 100)
    ])).toEqual([0, 0, 100, 50]);
});

test('leaving the player stops it and puts the reader back', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(83)]), post('102')]));
    await key(page, 'right');
    await key(page, 'ok');
    await expect(page.locator('.viewer video')).toHaveCount(1);
    await key(page, 'back');
    await expect(page.locator('.viewer')).toHaveCount(0);
    await expect(page.locator('#position')).toHaveText('1 / 2');
    await expect(page.locator('.media')).toHaveClass(/focus/);
});

function videoWithVariants(seconds = 83) {
    return {
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/poster.jpg',
        video_info: {
            duration_millis: seconds * 1000,
            variants: [
                {content_type: 'video/mp4', bitrate: 288000, url: 'https://video.twimg.com/360p.mp4'},
                {content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/720p.mp4'},
                {content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/1080p.mp4'}
            ]
        }
    };
}

test('up and down keys adjust video playback speed', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(100)])]));
    await key(page, 'right');
    await key(page, 'ok');

    const badge = page.locator('.viewer .speed-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1x');
    await expect(badge).not.toHaveClass(/active/);

    // Speed up to 1.25x
    const notice125 = await page.evaluate(() => {
        TvXReader.key('up');
        return {
            notice: document.getElementById('notice').textContent,
            rate: document.querySelector('.viewer video').playbackRate
        };
    });
    expect(notice125.notice).toContain('1.25x');
    expect(notice125.rate).toBe(1.25);
    await expect(badge).toHaveText('1.25x');
    await expect(badge).toHaveClass(/active/);

    // Speed up to 1.5x and 2.0x
    await key(page, 'up');
    expect(await page.evaluate(() => document.querySelector('.viewer video').playbackRate)).toBe(1.5);
    await key(page, 'up');
    expect(await page.evaluate(() => document.querySelector('.viewer video').playbackRate)).toBe(2);

    // Beyond limit
    const limitNotice = await page.evaluate(() => {
        TvXReader.key('up');
        return document.getElementById('notice').textContent;
    });
    expect(limitNotice).toContain('倍速已达限制：2x');

    // Slow down to 1.0x (should remove active class)
    await key(page, 'down'); // 1.5x
    await key(page, 'down'); // 1.25x
    await key(page, 'down'); // 1.0x
    expect(await page.evaluate(() => document.querySelector('.viewer video').playbackRate)).toBe(1);
    await expect(badge).not.toHaveClass(/active/);

    // Slow down to 0.5x minimum limit
    await key(page, 'down'); // 0.75x
    await key(page, 'down'); // 0.5x
    expect(await page.evaluate(() => document.querySelector('.viewer video').playbackRate)).toBe(0.5);
    const minLimitNotice = await page.evaluate(() => {
        TvXReader.key('down');
        return document.getElementById('notice').textContent;
    });
    expect(minLimitNotice).toContain('倍速已达限制：0.5x');

    // Click on speed badge increases speed
    await badge.click();
    await expect(badge).toHaveText('0.75x');
    expect(await page.evaluate(() => document.querySelector('.viewer video').playbackRate)).toBe(0.75);
});

test('menu key and quality badge cycle video resolution variants preserving time and speed', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [videoWithVariants(120)])]));
    await key(page, 'right');
    await key(page, 'ok');

    const qualityBadge = page.locator('.viewer .quality-badge');
    await expect(qualityBadge).toBeVisible();
    // Default selected variant by bitrate >= 800000 is 720p
    await expect(qualityBadge).toHaveText('720p');

    // Adjust speed and position
    await key(page, 'up'); // 1.25x
    await page.evaluate(() => {
        document.querySelector('.viewer video').currentTime = 42;
    });

    // Cycle quality via menu key -> 1080p
    const switch1 = await page.evaluate(() => {
        TvXReader.key('menu');
        const v = document.querySelector('.viewer video');
        return {
            notice: document.getElementById('notice').textContent,
            src: v.src,
            currentTime: v.currentTime,
            rate: v.playbackRate
        };
    });
    expect(switch1.notice).toContain('1080p 超清');
    expect(switch1.src).toContain('1080p.mp4');
    expect(switch1.currentTime).toBe(42);
    expect(switch1.rate).toBe(1.25);
    await expect(qualityBadge).toHaveText('1080p');

    // Cycle again via badge click -> 360p
    await qualityBadge.click();
    await expect(qualityBadge).toHaveText('360p');
    const switch2 = await page.evaluate(() => {
        const v = document.querySelector('.viewer video');
        return {
            src: v.src,
            currentTime: v.currentTime,
            rate: v.playbackRate
        };
    });
    expect(switch2.src).toContain('360p.mp4');
    expect(switch2.currentTime).toBe(42);
    expect(switch2.rate).toBe(1.25);
});

test('single variant video has no quality badge and menu reports current is best', async ({page}) => {
    await mount(page);
    await receive(page, 'r0', payload([post('101', [video(60)])]));
    await key(page, 'right');
    await key(page, 'ok');

    await expect(page.locator('.viewer .quality-badge')).toHaveCount(0);
    const notice = await page.evaluate(() => {
        TvXReader.key('menu');
        return document.getElementById('notice').textContent;
    });
    expect(notice).toContain('当前已是最佳画质');
});

