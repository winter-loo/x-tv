// Read-only metadata adapter. Only extension messages reach this listener; it never submits a post.
(() => {
    if (location.origin !== 'https://x.com' || window.top !== window || window.__tvxWriteMetadata) return;
    window.__tvxWriteMetadata = true;
    let requirePage;
    function requireModules() {
        if (requirePage) return requirePage;
        const page = window.wrappedJSObject;
        const chunks = page?.webpackChunk_twitter_responsive_web;
        if (!chunks?.push) throw Error('webpack_not_ready');
        const name = 'tvx_metadata_' + crypto.randomUUID();
        const chunk = cloneInto([[name], {}, r => { requirePage = r.wrappedJSObject || r; }], window, {cloneFunctions: true});
        chunks.push(chunk);
        const index = chunks.indexOf(chunk);
        if (index >= 0) chunks.splice(index, 1);
        if (!requirePage?.m) throw Error('require_not_ready');
        return requirePage;
    }
    function query(name) {
        const req = requireModules();
        const found = Object.entries(req.m).find(([, f]) =>
            new RegExp('operationName:["\']' + name + '["\']').test(String(f)));
        if (!found) throw Error('module_not_ready');
        const data = JSON.parse(JSON.stringify(req(found[0])));
        if (data.operationName !== name || !/^[\w-]{8,100}$/.test(data.queryId)) throw Error('metadata');
        return data;
    }
    function switches() {
        const source = Array.from(document.scripts).find(s => s.textContent.startsWith('window.__INITIAL_STATE__='))?.textContent;
        if (!source) throw Error('state_not_ready');
        const start = source.indexOf('{');
        let depth = 0, quoted = false, escaped = false, end = start;
        for (; end < source.length; end++) {
            const c = source[end];
            if (quoted) {
                if (escaped) escaped = false;
                else if (c === '\\') escaped = true;
                else if (c === '"') quoted = false;
            } else if (c === '"') quoted = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) { end++; break; }
        }
        return JSON.parse(source.slice(start, end)).featureSwitch;
    }
    function transactionGenerator() {
        const req = requireModules();
        const found = Object.entries(req.m).find(([, f]) => {
            const source = String(f);
            return source.includes('x-client-transaction-id') && source.includes('jf.x.com') && source.includes('PATCH');
        });
        if (!found) throw Error('module_not_ready');
        const fn = Object.values(req(found[0])).find(f => typeof f === 'function' && String(f).includes('jf.x.com') && String(f).includes('PATCH'));
        if (!fn) throw Error('metadata');
        return fn;
    }
    async function prepare(operation) {
        const config = switches(), generate = transactionGenerator();
        const result = {csrf: document.cookie.match(/(?:^|; )ct0=([^;]*)/)?.[1], queries: {}};
        if (!result.csrf) throw Error('session');
        // GET metadata supports readback after a successful or ambiguous write.
        for (const name of [operation, 'TweetResultByRestId']) {
            const q = query(name), method = name === 'TweetResultByRestId' ? 'GET' : 'POST';
            const path = '/i/api/graphql/' + q.queryId + '/' + name;
            const transaction = await generate('x.com', path, method);
            if (typeof transaction !== 'string' || transaction.length > 1024 || atob(transaction).startsWith('e:')) throw Error('metadata');
            const features = Object.fromEntries(q.metadata.featureSwitches.map(k => {
                const v = config.customOverrides?.[k] ?? config.user?.config?.[k] ?? config.defaultConfig?.[k];
                return [k, typeof v === 'object' ? v.value === true : v === true];
            }));
            result.queries[name] = {queryId: q.queryId, transaction, features,
                fieldToggles: Object.fromEntries(q.metadata.fieldToggles.map(k => [k, false]))};
        }
        // A logout/rotation during preparation invalidates this result.
        if (result.csrf !== document.cookie.match(/(?:^|; )ct0=([^;]*)/)?.[1]) throw Error('session');
        return result;
    }
    browser.runtime.onMessage.addListener(message => {
        if (message.command !== 'writePrepare') return undefined;
        if (!['FavoriteTweet', 'UnfavoriteTweet', 'CreateTweet'].includes(message.operation)) return Promise.resolve({error:'invalid'});
        return prepare(message.operation).catch(() => ({error:'not_ready'}));
    });
})();
