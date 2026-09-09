export async function connect(port = 9333) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = list.find(t => t.type === 'page');
    if (!target) throw new Error('no page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = e => fail(new Error('ws: ' + e.message)); });
    let id = 0;
    const waiting = new Map();
    ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        const pending = waiting.get(msg.id);
        if (pending) { waiting.delete(msg.id); pending(msg); }
    };
    async function send(method, params = {}) {
        const mine = ++id;
        const reply = new Promise(ok => waiting.set(mine, ok));
        ws.send(JSON.stringify({id: mine, method, params}));
        const msg = await Promise.race([reply,
            new Promise((_, fail) => setTimeout(() => fail(new Error(method + ' timed out')), 45000))]);
        if (msg.error) throw new Error(method + ': ' + JSON.stringify(msg.error));
        return msg.result;
    }
    // The projector's WebView occasionally stalls long enough to miss a reply; one retry is
    // cheaper than failing a whole device journey over a transient stall.
    async function evaluate(expression, retries = 1) {
        let r;
        try {
            r = await send('Runtime.evaluate',
                {expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true});
        } catch (error) {
            if (!retries || !/timed out/.test(error.message)) throw error;
            await new Promise(ok => setTimeout(ok, 2000));
            return evaluate(expression, retries - 1);
        }
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
        return r.result.value;
    }
    return {url: target.url, evaluate, close: () => ws.close()};
}
