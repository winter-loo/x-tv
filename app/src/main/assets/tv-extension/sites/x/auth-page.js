// Authentication owns an entire tab. The reading adapter must never mount here.
// The marker correlates UI events only; it grants no authority and stores no credentials.
window.TvXAuthPage = window.TvXAuthPage || (() => {
    if (!/^(x\.com|twitter\.com)$/.test(location.hostname)) return null;
    const key = 'tvx-auth-attempt';
    let attempt = '';
    const marker = location.hash.match(/^#tvx-auth=([a-f0-9-]{36})$/);
    try {
        if (marker) sessionStorage.setItem(key, marker[1]);
        attempt = sessionStorage.getItem(key) || '';
    } catch (_) { attempt = marker ? marker[1] : ''; }
    if (!/^[a-f0-9-]{36}$/.test(attempt)) return null;
    let last = '', timer, observer;
    function googlePrompt() {
        return Array.from(document.querySelectorAll('iframe[src*="accounts.google.com/gsi/iframe/select"]'))
            .find(frame => frame.getBoundingClientRect().width>0 && frame.getBoundingClientRect().height>0);
    }
    const googleFrames = new WeakMap();
    function googleReady() {
        let ready = false;
        for (const frame of document.querySelectorAll('iframe[src*="accounts.google.com/gsi/button"]')) {
            let state = googleFrames.get(frame);
            if (!state) {
                state = {src: frame.src, loaded: false};googleFrames.set(frame,state);
                frame.addEventListener('load', () => {
                    state.src=frame.src;state.loaded=true;
                    requestAnimationFrame(() => report(true));
                });
            }
            if (state.src !== frame.src) {state.src=frame.src;state.loaded=false;}
            const r=frame.getBoundingClientRect();
            if(state.loaded && r.width>0 && r.height>0)ready=true;
        }
        return ready;
    }
    function report(force = false) {
        const state = {
            event: 'auth_state', attempt,
            authenticated: !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
            googleReady: googleReady(),
            googlePrompt: !!googlePrompt(),
            pageReady: document.readyState !== 'loading' && !!document.body
        };
        const signature = JSON.stringify(state);
        if (force || signature !== last) {
            last = signature;
            browser.runtime.sendMessage(state).catch(() => {});
        }
    }
    function google() {
        const prompt=googlePrompt();
        if(prompt){prompt.focus();prompt.contentWindow.focus();return true;}
        const target = Array.from(document.querySelectorAll('iframe[src*="accounts.google.com/gsi/button"]'))
            .find(node => googleFrames.get(node)?.loaded && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
        if (!target) return false;
        target.scrollIntoView({block: 'center'});
        requestAnimationFrame(() => {
            const r = target.getBoundingClientRect();
            if (r.width && r.height) browser.runtime.sendMessage({event:'auth_tap',attempt,
                x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}).catch(() => {});
        });
        return true;
    }
    function start() {
        if (observer) return;
        observer = new MutationObserver(() => {
            // Attach load listeners immediately, including cached frames that can load
            // before the debounced state report runs.
            googleReady();
            if (timer) return;
            timer = setTimeout(() => {timer=null;report();}, 100);
        });
        observer.observe(document.documentElement, {childList:true,subtree:true,attributes:true,
            attributeFilter:['src','data-testid','style','class','hidden','width','height']});
        report(true);
    }
    browser.runtime.onMessage.addListener(message => {
        if (message.attempt !== attempt) return undefined;
        if (message.command === 'authState') report(true);
        if (message.command === 'authGoogle') return Promise.resolve({event:'auth_google',attempt,opened:google()});
        return undefined;
    });
    if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start, {once:true});
    addEventListener('load', () => report(true), {once:true});
    addEventListener('pageshow', () => {start();report(true);});
    addEventListener('pagehide', () => {observer?.disconnect();observer=null;clearTimeout(timer);timer=null;});
    return {attempt};
})();
