import { mount, post } from './timeline.mjs';
import { fileURLToPath } from 'node:url';

// The external WebExtension host and X page are simulated. Both production
// observer and adapter run unchanged, exchanging messages across that boundary.
export async function mountActions(page, posts = [post(), post({ id: '102' })]) {
    await mount(page, posts);
    await attachActionHost(page);
}

export async function attachActionHost(page) {
    await page.evaluate(() => {
        const listeners = [];
        const events = {};
        const filters = new Map();
        window.nativeRequests = [];
        const emit = (name, value) => events[name]?.forEach(listener => listener(value));
        browser.runtime.onMessage = { addListener: listener => listeners.push(listener), removeListener: listener => listeners.splice(listeners.indexOf(listener), 1) };
        browser.runtime.sendMessage = async message => {
            for (const listener of listeners) {
                const result = listener(message, { tab: { id: 7 }, frameId: 0, url: location.href });
                if (result !== undefined) return await result;
            }
        };
        browser.tabs = { sendMessage: async (tabId, message) => { if (tabId === 7) listeners.forEach(listener => listener(message, {})); }, onRemoved: { addListener() {} } };
        browser.webRequest = { filterResponseData: id => {
            const filter = { bytes: '', write(data) { this.bytes += new TextDecoder().decode(data); }, close() {}, disconnect() {} };
            filters.set(id, filter);
            return filter;
        } };
        for (const name of ['onBeforeRequest', 'onHeadersReceived', 'onCompleted', 'onErrorOccurred']) {
            events[name] = [];
            browser.webRequest[name] = { addListener: listener => events[name].push(listener) };
        }
        document.addEventListener('click', event => {
            const button = event.target.closest('[data-testid="like"], [data-testid="unlike"]');
            if (!button) return;
            const article = button.closest('article');
            const liked = button.dataset.testid === 'like';
            const request = { requestId: String(nativeRequests.length + 1), tabId: 7, frameId: 0, method: 'POST',
                url: 'https://x.com/i/api/graphql/native-query/' + (liked ? 'FavoriteTweet' : 'UnfavoriteTweet'),
                requestBody: { raw: [{ bytes: new TextEncoder().encode(JSON.stringify({ variables: { tweet_id: article.dataset.fixtureId } })).buffer }] },
                button, liked, previousCount: button.textContent, id: article.dataset.fixtureId };
            nativeRequests.push(request);
            emit('onBeforeRequest', request);
            button.dataset.testid = liked ? 'unlike' : 'like';
            button.querySelector('span').textContent = String(Number(request.previousCount) + (liked ? 1 : -1));
        });
        window.serviceWorkerFallback = index => {
            const request = nativeRequests[index];
            const filter = filters.get(request.requestId);
            // HttpChannelChild::OnDetachStreamFilters drops pre-response filters.
            if (filter) {
                filter.error = 'ServiceWorker fallback redirection';
                filter.onerror();
                filters.delete(request.requestId);
            }
            emit('onBeforeRequest', request);
        };
        window.finishNative = (index, { status = 200, error = false, unknown = false } = {}) => {
            const request = nativeRequests[index];
            if (error || status !== 200) {
                request.button.dataset.testid = request.liked ? 'like' : 'unlike';
                request.button.querySelector('span').textContent = request.previousCount;
            }
            const body = JSON.stringify(error ? { errors: [{ message: 'Fixture rejection' }] } : unknown ? { data: {} } : { data: { [request.liked ? 'favorite_tweet' : 'unfavorite_tweet']: 'Done' } });
            emit('onHeadersReceived', { ...request, statusCode: status });
            const filter = filters.get(request.requestId);
            filter?.ondata({ data: new TextEncoder().encode(body).buffer });
            filter?.onstop();
            emit('onCompleted', { ...request, statusCode: status });
            return { original: body, delivered: filter?.bytes };
        };
    });
    await page.addScriptTag({ path: fileURLToPath(new URL('../../app/src/main/assets/tv-extension/sites/x/like-observer.js', import.meta.url)) });
}

// Reinstall extension scripts after an actual document navigation in the fixture.
export async function bootFreshActions(page) {
    await page.evaluate(() => {
        window.browser = { runtime: { getURL: path => 'https://x.com/extension/' + path } };
    });
    await attachActionHost(page);
    for (const file of ['runtime/navigation-runtime.js', 'sites/x/post-identity.js', 'sites/x/reading.js', 'sites/x/actions.js', 'sites/x/adapter.js']) {
        await page.addScriptTag({ path: fileURLToPath(new URL('../../app/src/main/assets/tv-extension/' + file, import.meta.url)) });
    }
    await page.evaluate(() => TvXAdapter.init());
    await page.locator('article.tv-focused').waitFor();
}
