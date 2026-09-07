// Synthetic X-shaped DOM, never live account data. Only the external page and
// WebExtension host are simulated; production adapter/presentation run unchanged.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const extension = new URL('../../app/src/main/assets/tv-extension/', import.meta.url);
const pixel = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="824" height="328"><rect width="824" height="328" fill="steelblue"/></svg>');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export function post({ id = '101', text = 'Original fixture post text.', article = false, long = false, recognized = true } = {}) {
    return `<div data-testid="cellInnerDiv"><article data-testid="tweet" data-fixture-id="${id}"><div class="native"><div class="native">
      <div data-testid="Tweet-User-Avatar"><img alt="Author avatar" src="${pixel}" width="48" height="48"></div>
      <div class="native"><div data-testid="User-Name"><div><span>Fixture Author</span></div><div><span>@fixture</span>${recognized ? `<a href="/fixture/status/${id}"><time>1h</time></a>` : ''}</div></div>
      <div data-testid="tweetText" dir="auto">${escape(text)}</div>
      ${article ? `<a href="/i/article/901"><div data-testid="article-cover-image"><img alt="Fixture article cover" src="${pixel}"></div><div><div><span dir="auto">An independently supplied article title</span></div><div dir="auto">${long ? 'Long article excerpt. '.repeat(160) : 'An independently supplied article excerpt.'}<span> END OF ARTICLE</span></div></div></a>` : ''}
      <div role="group"><div><button data-testid="reply"><svg></svg><span>17</span></button></div><div><button data-testid="like"><svg></svg><span>203</span></button></div><div><a href="/fixture/status/${id}/analytics"><svg></svg><span>9.2K</span></a></div></div>
      </div></div></div></article></div>`;
}
export const tabs = '<div role="tablist"><div role="tab" aria-selected="true">For you</div><div role="tab" aria-selected="false">Following</div></div>';
export async function mount(page, posts = [post()], extra = '', { styleDelay = 0 } = {}) {
    await page.route('https://x.com/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/extension/')) {
            const path = url.pathname.slice('/extension/'.length);
            if (path.endsWith('reading.css') && styleDelay) await new Promise(resolve => setTimeout(resolve, styleDelay));
            const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript';
            await route.fulfill({ body: await readFile(new URL(path, extension)), contentType: type });
        } else await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>
            *{box-sizing:border-box}body{margin:0} .native{display:flex;flex-direction:column} [data-testid="primaryColumn"]{width:600px} [data-testid="User-Name"]{display:flex;flex-direction:column} img{display:block;max-width:100%} button{background:none;border:0} a{text-decoration:none}
            </style></head><body><header role="banner"><a aria-label="X"><svg viewBox="0 0 24 24"></svg></a><button data-testid="SideNav_AccountSwitcher_Button"><img src="${pixel}" alt="Account"></button></header><div id="react-root"><main role="main"><div data-testid="primaryColumn">${tabs}<div id="timeline">${posts.join('')}</div>${extra}</div></main></div></body></html>`});
    });
    await page.goto('https://x.com/home');
    await page.evaluate(() => {
        window.browser = { runtime: {
            getURL: path => 'https://x.com/extension/' + path,
            sendMessage: () => Promise.resolve(),
        } };
        document.addEventListener('click', event => {
            const link = event.target.closest('a[href]');
            if (link) {
                event.preventDefault();
                // External site router: observe the actual clicked destination.
                history.pushState({}, '', link.getAttribute('href'));
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        });
    });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', extension), 'utf8'));
    for (const path of manifest.content_scripts[0].js.filter(path => !['runtime/content.js', 'runtime/adapter-registry.js'].includes(path))) {
        await page.addScriptTag({ path: fileURLToPath(new URL(path, extension)) });
    }
    await page.evaluate(() => window.TvXAdapter.init());
    await page.locator('#tv-reading-header').waitFor();
    await page.waitForFunction(() => Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith('reading.css')));
}
export const move = (page, direction) => page.evaluate(direction => window.TvXAdapter.move(direction), direction);
export const activate = page => page.evaluate(() => window.TvXAdapter.activate());
export const back = page => page.evaluate(() => window.TvXAdapter.handleBack());
export const rect = locator => locator.evaluate(node => {
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
