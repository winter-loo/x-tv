// This is injected at document_start, before X can paint its native composer.
window.TvXBoot = window.TvXBoot || (() => {
    if (window.TvXAuthPage) return {reveal() {},report() {}};
    const supported = /(^|\.)(x\.com|twitter\.com)$/.test(location.hostname);
    let ready = false, pending = false;
    function cover() { if (supported && document.documentElement && !ready) document.documentElement.classList.add('tv-x-boot'); }
    cover();
    if (!document.documentElement) {
        const observer = new MutationObserver(() => { cover(); if (document.documentElement) observer.disconnect(); });
        observer.observe(document,{childList:true});
    }
    function reveal() {
        if (!supported || ready || pending) return;
        const home = location.pathname === '/home';
        const detail = !!document.getElementById('tv-detail-chrome');
        const styleIds = ['tv-x-styles', home ? 'tv-x-reading-styles' : detail ? 'tv-x-detail-styles' : 'tv-x-styles'];
        if (styleIds.some(id => !document.getElementById(id)?.sheet)) return;
        if (home && !document.querySelector('.tv-reading-card.tv-focused')) return;
        if (!home && !detail) return;
        pending = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            pending = false;
            if (home && !document.querySelector('.tv-reading-card.tv-focused')) return;
            ready = true;
            window.TvXLoadMetrics?.mark('presentation_ready');
            document.documentElement.classList.remove('tv-x-boot');
            browser.runtime.sendMessage({event:'presentation_ready'}).catch(() => {});
        }));
    }
    function report() { if (ready) browser.runtime.sendMessage({event:'presentation_ready'}).catch(() => {}); else reveal(); }
    // Stylesheet completion is not a DOM mutation. A loading/empty status must
    // never release the native cover: X can append its composer afterward.
    // The native timeout provides a retry/exit prompt if no post arrives.
    if (supported) {
        const timer = setInterval(() => { reveal(); if (ready) clearInterval(timer); },100);
        addEventListener('pagehide',()=>clearInterval(timer),{once:true});
    }
    return {reveal,report};
})();
