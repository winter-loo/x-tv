// Reading adapter. Authentication belongs to LoginActivity and its dedicated tab.
if (!window.TvXAuthPage) window.TvXAdapter = window.TvXAdapter || (function() {
    let activeArticleIndex = 0;
    let lastAnchorId = null;
    let observer = null;
    let authenticatedReported = false;
    let loginRequested = false;
    let refreshTimer = null;
    let pendingMove = null;
    let pendingTimer = null;
    let homeAnchor = null;
    let homeScroll = 0;
    let restoringHome = false;
    let homeRestoreTimer = null;
    let homeRestoreStarted = 0;
    let homeRestoreStable = 0;

    function scheduleHomeRestore() {
        if (homeRestoreTimer || !restoringHome) return;
        homeRestoreTimer = setTimeout(() => {
            homeRestoreTimer = null;
            if (restoringHome && isHome()) handlePageMode();
        }, 100);
    }
    let previousMode = "";
    let timelineTab = "";
    let topRequested = false;
    let refreshPage = null;
    let initialTimer = null;
    let handledLocation = "";
    let recoveryNavigation = false;
    const recoveryHomeKey = "tv-x-recovery-home";
    window.addEventListener("pageshow", event => {
        if (event.persisted && recoveryNavigation) window.location.reload();
    });

    function init() {
        if (observer) return;
        console.log("[TvXAdapter] Initializing X adapter on:", window.location.href);
        if (isHome()) {
            try {
                const saved = JSON.parse(sessionStorage.getItem(recoveryHomeKey));
                if (saved && /^\/[^/]+\/status\/\d+$/.test(saved.anchor) && Number.isFinite(saved.scroll)) {
                    homeAnchor = saved.anchor;
                    homeScroll = saved.scroll;
                }
                sessionStorage.removeItem(recoveryHomeKey);
            } catch (_) { /* Storage may be unavailable; native navigation still works. */ }
        }
        injectTvStyles();
        setupObserver();

        window.addEventListener("keydown", handleActionKeyDown, true);
        window.addEventListener("keydown", handleRemoteKeyDown, true);
        initialTimer = setTimeout(() => {
            initialTimer = null;
            handlePageMode();
        }, 0);
    }

    function isHome() {
        return window.location.pathname === "/home";
    }

    function isPostDetail() {
        return /^\/[^/]+\/status\/\d+(?:\/(?:photo|video)\/\d+)?$/.test(window.location.pathname);
    }

    function isExplicitLoginRoute() {
        const path = window.location.pathname;
        return path === "/i/flow/login" || path === "/login" ||
            (path === "/i/jf/onboarding/web" && new URL(window.location.href).searchParams.get("mode") === "login");
    }

    function hasAuthenticatedNavigation() {
        return !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    }

    function handlePageMode() {
        if (!document.body) return;
        handledLocation = window.location.href;
        window.TvXMedia?.update();
        window.TvXActions?.update();
        updateTimelineLayout();
        const mode = isLoginMode() ? "login" : (isHome() ? "home" : "other");
        if (mode === "login") authenticatedReported = false;
        else if (!authenticatedReported && hasAuthenticatedNavigation()) {
            authenticatedReported = true;
            reportState();
        }
        let articles = getArticles();
        if (window.TvXReading) {
            const unhid = window.TvXReading.update(mode === "home", articles, statusLink);
            if (unhid) {
                articles = getArticles(true);
                window.TvXReading.update(mode === "home", articles, statusLink);
            }
        }
        const detail = mode !== "login" && isPostDetail();
        if (window.TvXDetail) window.TvXDetail.update(detail, statusLink);
        if (detail && window.TvXDetail) {
            const request=window.TvXReaderBrowser;
            if(request && !request.announced && request.path===location.pathname && document.querySelector('article.tv-detail-post:not(.tv-instant-post)')) {
                request.announced=true;
                if(request.action==='menu')menu();
                else if(request.action==='like')menu('like');
                else if(request.action==='reply')window.TvXDetail.openComposer();
                browser.runtime.sendMessage({event:'reader_browser_ready',path:request.path}).catch(()=>{});
            }
            cancelPendingMove();
            previousMode = "detail";
            return;
        }
        if (mode === "login") {
            requestNativeLogin();
        } else {
            loginRequested = false;
            const selectedTab = document.querySelector('[data-testid="primaryColumn"] [role="tab"][aria-selected="true"]');
            const tab = selectedTab ? selectedTab.textContent.trim() : "";
            if (mode === "home" && tab && timelineTab && tab !== timelineTab) {
                lastAnchorId = null;
                homeAnchor = null;
                restoringHome = false;
                cancelPendingMove();
            }
            if (mode === "home" && tab) timelineTab = tab;
            if (mode === "home" && previousMode !== "home" && homeAnchor) {
                lastAnchorId = homeAnchor;
                restoringHome = true;
                homeRestoreStarted = Date.now();
                homeRestoreStable = 0;
            }
            if (mode !== previousMode && mode !== "home") {
                lastAnchorId = null;
                restoringHome = false;
                topRequested = false;
                cancelPendingMove();
            }
            if (mode === "home" && restoringHome) {
                // The URL can change before React replaces the outgoing detail DOM.
                if (!selectedTab) {
                    previousMode = mode;
                    scheduleHomeRestore();
                    return;
                }
                const now = Date.now();
                if (focusedArticle()) {
                    if (!homeRestoreStable) homeRestoreStable = now;
                    // X can apply its cached scroll a second time after the row
                    // first appears. Keep the anchor until that handoff settles.
                    if (now - homeRestoreStable >= 1200) restoringHome = false;
                } else {
                    homeRestoreStable = 0;
                    pageScroller().scrollTo({ top: homeScroll, behavior: "instant" });
                }
                if (now - homeRestoreStarted >= 5000) {
                    restoringHome = false;
                    if (!focusedArticle()) window.TvXReading?.waiting("原帖暂未恢复，按上下键继续浏览");
                }
                scheduleHomeRestore();
            }
            if (topRequested) {
                const first = articles[0];
                const top = first && first.getBoundingClientRect().top;
                if (first && top >= -50 && top < window.innerHeight) {
                    topRequested = false;
                    focusFirstVisibleArticle();
                } else {
                    pageScroller().scrollTo({ top: 0, behavior: "instant" });
                    if (window.TvXReading) window.TvXReading.waiting("正在返回时间线顶部…");
                }
                previousMode = mode;
                return;
            }
            if (pendingMove) completePendingMove(articles);
            if (!pendingMove) {
                if (lastAnchorId) verifyOrRestoreFocus();
                else if (articles.length) focusFirstVisibleArticle();
            }
        }
        previousMode = mode;
    }

    function isLoginMode() {
        const path = window.location.pathname;
        // An explicit login route can retain the previous timeline behind its dialog.
        if (isExplicitLoginRoute()) return true;
        const hasArticles = document.querySelectorAll('article[data-testid="tweet"], .timeline-card').length > 0;
        if (hasArticles) return false;

        // A pending /home response, empty timeline, or unrelated dialog is not a login form.
        if (document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Home_Link"], [data-testid="tweetTextarea_0"]')) return false;
        // X's current signed-out landing page no longer has a #react-root wrapper.
        if (path === "/" && document.querySelector('a[href^="/i/jf/onboarding/web?mode=login"]')) return true;
        // Current X landing renders an inline form without the legacy sign-in link.
        return !!document.querySelector(
            '#react-root input[name="username_or_email"], #react-root input[autocomplete="username"], #layers input[autocomplete="username"], ' +
            '#react-root a[href="/i/flow/login"], #react-root a[href="/login"]'
        );
    }

    function updateTimelineLayout() {
        const main = document.querySelector('main[role="main"]');
        if (!document.body) return;
        const timeline = !!main && !isLoginMode();
        if (document.body.classList.contains("tv-timeline-active") !== timeline) document.body.classList.toggle("tv-timeline-active", timeline);
        if (!timeline) return;
        // X keeps width constraints on wrappers above and below main.
        for (let parent = main.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            parent.classList.add("tv-main-ancestor");
        }
        const column = main.querySelector('[data-testid="primaryColumn"]');
        for (let parent = column && column.parentElement; parent && parent !== main; parent = parent.parentElement) {
            parent.classList.add("tv-column-ancestor");
        }
        const tabs = main.querySelector('[role="tablist"]');
        for (let parent = tabs; parent && parent !== column && parent !== main; parent = parent.parentElement) {
            if (getComputedStyle(parent).position === "sticky") {
                parent.classList.add("tv-timeline-header");
            }
        }
    }

    function injectTvStyles() {
        if (document.getElementById("tv-x-styles")) return;
        const link = document.createElement("link");
        link.id = "tv-x-styles";
        link.rel = "stylesheet";
        link.type = "text/css";
        try {
            link.href = browser.runtime.getURL("sites/x/tv.css");
        } catch (e) {
            console.warn("[TvXAdapter] Could not get tv.css URL:", e);
        }
        (document.head || document.documentElement).appendChild(link);
        console.log("[TvXAdapter] Injected tv.css successfully.");
    }

    function handleHomeScroll(event) {
        // Only the page viewport: text, image zoom and fullscreen media own
        // their internal scrolling. Explicit D-pad moves own virtual loading.
        if (!isHome() || document.fullscreenElement || pendingMove || topRequested || !lastAnchorId ||
            ![document, document.body, document.documentElement].includes(event.target)) return;
        if (!focusedArticle() && !restoringHome) {
            restoringHome = true;
            homeRestoreStarted = Date.now();
            homeRestoreStable = 0;
            scheduleHomeRestore();
        }
        refreshPage?.();
    }

    function setupObserver() {
        if (observer) return;
        refreshPage = () => {
            invalidateArticlesCache();
            if (refreshTimer !== null) return;
            refreshTimer = setTimeout(() => {
                refreshTimer = null;
                handlePageMode();
            }, 50);
        };
        observer = new MutationObserver(records => {
            if (records && records.some(record => record.type === "childList")) {
                invalidateArticlesCache();
            }
            // X positions virtual rows with inline styles after measuring their media.
            if (!records || records.some(record => record.type !== "attributes" || record.attributeName !== "style" ||
                record.target.getAttribute("data-testid") === "cellInnerDiv")) refreshPage();
        });
        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["href", "src", "aria-selected", "data-testid", "style"]
        });
        window.addEventListener("popstate", refreshPage);
        window.addEventListener("resize", refreshPage);
        window.addEventListener("scroll", handleHomeScroll, true);
    }

    function requestNativeLogin() {
        if (loginRequested) return;
        loginRequested = true;
        try { browser.runtime.sendMessage({event:'login_required'}).catch(() => {loginRequested=false;}); }
        catch (_) {loginRequested=false;}
    }

    /* =========================================================================
       Timeline Navigation Implementation
       ========================================================================= */

    let cachedArticles = null;
    let cachedArticlesTime = 0;
    const ARTICLE_CACHE_TTL = 60;

    function invalidateArticlesCache() {
        cachedArticles = null;
        cachedArticlesTime = 0;
    }

    function getArticles(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && cachedArticles && (now - cachedArticlesTime < ARTICLE_CACHE_TTL)) {
            if (cachedArticles.length > 0 && cachedArticles[0].isConnected) {
                return cachedArticles;
            }
        }
        const list = Array.from(document.querySelectorAll(
            'article[data-testid="tweet"], article[role="article"], .timeline-card'
        ));
        const filtered = list.filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.height > 20;
        });
        cachedArticles = filtered;
        cachedArticlesTime = now;
        return filtered;
    }

    function statusLink(article) {
        if (!article) return null;
        if (window.TvXPostIdentity) return window.TvXPostIdentity.statusLink(article);
        const name = article.querySelector('[data-testid="User-Name"]');
        const links = Array.from((name || article).querySelectorAll('a[href*="/status/"]'));
        return links.find(link => {
            const href = link.getAttribute("href") || "";
            return /^\/[^/]+\/status\/\d+$/.test(href) && !!link.querySelector("time");
        }) || null;
    }

    function extractArticleAnchor(article) {
        const link = statusLink(article);
        if (link && window.TvXPostIdentity) return window.TvXPostIdentity.canonicalPath(link);
        return link ? new URL(link.getAttribute("href"), location.href).pathname : article.getAttribute("data-tweet-id");
    }

    function focusedArticle() {
        if (!lastAnchorId) return null;
        return getArticles().find(article => extractArticleAnchor(article) === lastAnchorId) || null;
    }

    function focusFirstVisibleArticle() {
        const articles = getArticles();
        const index = articles.findIndex(article => article.getBoundingClientRect().top >= -50 && extractArticleAnchor(article));
        if (index >= 0) focusArticleAtIndex(index, articles);
    }

    function focusArticleAtIndex(index, articlesList) {
        const articles = articlesList || getArticles();
        const target = articles[index];
        if (!target || !extractArticleAnchor(target)) return;
        const changed = lastAnchorId !== extractArticleAnchor(target);
        activeArticleIndex = index;
        lastAnchorId = extractArticleAnchor(target);
        if (isHome()) homeAnchor = lastAnchorId;
        for (const old of document.querySelectorAll(".tv-focused")) {
            if (old !== target) old.classList.remove("tv-focused");
        }
        if (!target.classList.contains("tv-focused")) target.classList.add("tv-focused");
        if (isHome()) window.TvXLoadMetrics?.mark("home_readable");
        if (isHome() && window.TvXReading) {
            if (changed) {
                target.querySelectorAll(".tv-reading-text, .tv-reading-attachment").forEach(node => { node.scrollTop = 0; });
            }
            window.TvXReading.focus(target);
            // Keep the latest aligned offset, including X's row measurements,
            // so a subsequent native scroll cannot lose the logical post.
            homeScroll = pageScrollY();
        } else if (changed) TvNavigationRuntime.setFocus(target);
        if (changed) {
            reportState();
            if (isHome() && window.TvXDetail?.stash) {
                const link = statusLink(target);
                const path = window.TvXPostIdentity?.canonicalPath(link);
                if (path) window.TvXDetail.stash(target, path);
            }
        }
    }

    function verifyOrRestoreFocus() {
        const articles = getArticles();
        const index = articles.findIndex(article => extractArticleAnchor(article) === lastAnchorId);
        if (index >= 0) focusArticleAtIndex(index, articles);
        else {
            // A recycled DOM node is not the same post, even if its CSS class survived.
            document.querySelectorAll(".tv-focused").forEach(node => node.classList.remove("tv-focused"));
        }
    }

    function cancelPendingMove() {
        pendingMove = null;
        clearTimeout(pendingTimer);
        pendingTimer = null;
    }

    function completePendingMove(articles) {
        const { direction, anchor, known } = pendingMove;
        const index = articles.findIndex(article => extractArticleAnchor(article) === anchor);
        const step = direction === "down" ? 1 : -1;
        let target = index >= 0 ? index + step : -1;
        if (index < 0) {
            const candidates = articles.map((article, i) => ({ id: extractArticleAnchor(article), i }))
                .filter(item => item.id && !known.includes(item.id));
            target = (direction === "down" ? candidates[0] : candidates[candidates.length - 1])?.i ?? -1;
        }
        while (target >= 0 && target < articles.length && !extractArticleAnchor(articles[target])) target += step;
        if (target >= 0 && target < articles.length) {
            cancelPendingMove();
            focusArticleAtIndex(target, articles);
        }
    }

    function pageScroller() {
        const body = document.body;
        return body && body.scrollHeight > body.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(body).overflowY)
            ? body : (document.scrollingElement || window);
    }

    function pageScrollY() {
        const scroller = pageScroller();
        return scroller === window ? window.scrollY : scroller.scrollTop;
    }

    function movePost(direction) {
        restoringHome = false;
        if (direction !== "up" && direction !== "down") {
            if (isHome() && window.TvXReading) window.TvXReading.scrollText(focusedArticle(), direction);
            return;
        }
        if (pendingMove || topRequested) return;
        const articles = getArticles();
        if (!articles.length) return;
        const index = articles.findIndex(article => extractArticleAnchor(article) === lastAnchorId);
        if (index < 0) {
            focusFirstVisibleArticle();
            return;
        }
        const step = direction === "down" ? 1 : -1;
        for (let i = index + step; i >= 0 && i < articles.length; i += step) {
            if (extractArticleAnchor(articles[i])) {
                focusArticleAtIndex(i, articles);
                return;
            }
        }
        pendingMove = { direction, anchor: lastAnchorId, known: articles.map(extractArticleAnchor) };
        if (window.TvXReading && isHome()) window.TvXReading.waiting("正在加载更多帖子…");
        // Instant scrolling triggers X's virtual list without queuing smooth animations.
        pageScroller().scrollBy({ top: step * window.innerHeight * 0.75, behavior: "instant" });
        pendingTimer = setTimeout(() => {
            cancelPendingMove();
            verifyOrRestoreFocus();
            if (window.TvXReading && isHome()) window.TvXReading.waiting("未加载到更多帖子，按上下键重试     返回 回到顶部");
        }, 2500);
    }

    /* =========================================================================
       D-pad Movement & Action Dispatcher
       ========================================================================= */

    let lastRepeatMoveTime = 0;
    const REPEAT_MOVE_INTERVAL = 80;

    // Also works when native messaging is reconnecting. Android forwards a full
    // trusted key pair, so media playback has a real user gesture.
    function handleRemoteKeyDown(event) {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape' || event.key === 'BrowserBack') {
            if (!event.repeat && !handleBack().handled) browser.runtime.sendMessage({event:'exit_requested'}).catch(() => {});
            event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        if (isLoginMode()) return;
        if (event.target.closest?.('input, textarea, [contenteditable=true]')) {
            // Down/up leaves a TV composer field; horizontal keys still move
            // the caret and Enter still belongs to the input method.
            if (window.TvXDetail?.isOpen() && ['ArrowDown','ArrowUp'].includes(event.key)) {
                window.TvXDetail.move(event.key === 'ArrowDown' ? 'down' : 'up');
                event.preventDefault(); event.stopImmediatePropagation();
            } else if (window.TvXActions?.isComposerOpen?.() && ['ArrowDown','ArrowUp'].includes(event.key)) {
                window.TvXActions.move(event.key === 'ArrowDown' ? 'down' : 'up');
                event.preventDefault(); event.stopImmediatePropagation();
            }
            return;
        }
        const direction = {ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right'}[event.key];
        if (direction) {
            if (event.repeat && (direction === 'up' || direction === 'down')) {
                const now = Date.now();
                if (now - lastRepeatMoveTime < REPEAT_MOVE_INTERVAL) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return;
                }
                lastRepeatMoveTime = now;
            } else {
                lastRepeatMoveTime = Date.now();
            }
            move(direction);
        } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'MediaPlayPause') {
            if (!event.repeat) activate();
        } else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function openStatus(link, article) {
        const path = window.TvXPostIdentity?.canonicalPath(link);
        if (!path) return;
        const targetArticle = article || link.closest('article[data-testid="tweet"]') || focusedArticle();
        if (targetArticle && window.TvXDetail?.stash) {
            window.TvXDetail.stash(targetArticle, path);
        }
        // React must receive a normal unmodified click. Edited timestamps point
        // to history; temporarily give that same native link its canonical URL.
        const original = link.getAttribute('href');
        if (new URL(original, location.href).pathname !== path) link.setAttribute('href', path);
        link.click();
        if (link.isConnected && link.getAttribute('href') === path && original !== path) link.setAttribute('href', original);
    }

    function handleActionKeyDown(event) {
        if (window.TvXActions?.key(event)) return;
        if (!event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey &&
            (event.key.toLowerCase() === "m" || event.key === "ContextMenu") &&
            !event.target.closest("input, textarea, [contenteditable=true]")) {
            if (menu()) { event.preventDefault(); event.stopImmediatePropagation(); }
        }
    }

    function menu(initialAction) {
        if (isLoginMode() || !window.TvXActions) return false;
        const detailPath = /^\/[^/]+\/status\/\d+$/.test(location.pathname) ? location.pathname : null;
        if (!isHome() && !detailPath) return false;
        const anchor = detailPath || lastAnchorId;
        const match = anchor?.match(/^\/[^/]+\/status\/(\d+)$/);
        if (!match) return false;
        const post = { id: match[1], path: anchor };
        cancelPendingMove();
        const opened = window.TvXActions.open({
            post,
            initialAction,
            reloadPost: () => {
                try {
                    if (isHome()) sessionStorage.setItem(recoveryHomeKey, JSON.stringify({ anchor: post.path, scroll: pageScrollY() }));
                } catch (_) { /* Reload remains available without storage. */ }
                recoveryNavigation = true;
                // Full-document native navigation discards X's optimistic JS state.
                // Never reinterpret it as confirmation of the previous mutation.
                location.assign(post.path);
            },
            article: () => getArticles().find(article => extractArticleAnchor(article) === anchor),
            openPost: () => {
                // Already on the canonical detail: do not open its edit-history timestamp.
                if (!isHome() && location.pathname === post.path) return;
                const article = getArticles().find(item => extractArticleAnchor(item) === post.path);
                const link = statusLink(article);
                if (link) {
                    if (isHome()) homeScroll = pageScrollY();
                    openStatus(link, article);
                }
            },
            restore: () => { verifyOrRestoreFocus(); reportState(); }
        });
        reportState();
        return opened;
    }

    function move(direction) {
        if (isLoginMode()) { requestNativeLogin(); return; }
        if (window.TvXActions?.move(direction)) return;
        if (window.TvXMedia?.move(direction)) return;
        if (window.TvXCard?.move(direction)) return;
        if (isHome() && direction === "right" && window.TvXMedia?.select(focusedArticle())) return;

        if (window.TvXDetail && isPostDetail()) {
            window.TvXDetail.update(true, statusLink);
            window.TvXDetail.move(direction);
            return;
        }
        movePost(direction);
    }

    function activate() {
        if (window.TvXActions?.activate()) return;
        if (window.TvXMedia?.activate()) return;
        if (isLoginMode()) { requestNativeLogin(); return; }

        if (window.TvXDetail && isPostDetail()) { window.TvXDetail.activate(); return; }
        const current = focusedArticle();
        const link = statusLink(current);
        if (link) {
            cancelPendingMove();
            if (isHome()) homeScroll = pageScrollY();
            openStatus(link, current);
        } else if (current && current.classList.contains("timeline-card")) {
            TvNavigationRuntime.clickElement(current);
        } else if (isHome()) {
            window.TvXReading?.waiting("帖子位置已更新，请按上下键重新选择");
        }
    }

    function handleBack() {
        console.log("[TvXAdapter] handleBack requested.");
        if (window.TvXCard?.back()) return { event: "backResult", handled: true };
        if (window.TvXMedia?.back()) return { event: "backResult", handled: true };
        if (window.TvXDetail?.isOpen()) { window.TvXDetail.closeComposer(false); return { event: "backResult", handled: true }; }
        if (window.TvXActions?.close()) return { event: "backResult", handled: true };
        restoringHome = false;
        cancelPendingMove();
        if (isLoginMode()) return {event:"backResult",handled:false};

        const closeBtn = document.querySelector(
            '#tv-modal.active .close-btn, ' +
            '[role="dialog"] [aria-label="Close"], [role="dialog"] [aria-label="关闭"], [role="dialog"] [data-testid="app-bar-close"], ' +
            'div[aria-labelledby="modal-header"] [aria-label="Close"], ' +
            'div[data-testid="app-bar-close"], ' +
            'div[aria-label="Close"]'
        );
        if (closeBtn) {
            closeBtn.click();
            return { event: "backResult", handled: true };
        }

        if (window.location.pathname.includes("/status/")) {
            if(window.TvXReaderBrowser?.announced) {
                const path=window.TvXReaderBrowser.path;
                window.TvXReaderBrowser=null;
                browser.runtime.sendMessage({event:'reader_browser_return',path}).catch(()=>{});
                return {event:'backResult',handled:true};
            }
            if (homeAnchor) {
                lastAnchorId = homeAnchor;
                restoringHome = true;
                homeRestoreStarted = Date.now();
                homeRestoreStable = 0;
                scheduleHomeRestore();
            }
            // Use X's router Back button so its virtual timeline cache and
            // scroll restoration run before the adapter restores the anchor.
            const nativeBack = document.querySelector('[data-testid="app-bar-back"]');
            if (nativeBack) nativeBack.click();
            else window.history.back();
            return { event: "backResult", handled: true };
        }

        if (pageScrollY() > 300) {
            topRequested = isHome();
            lastAnchorId = null;
            homeAnchor = null;
            document.querySelectorAll(".tv-focused").forEach(node => node.classList.remove("tv-focused"));
            pageScroller().scrollTo({ top: 0, behavior: "instant" });
            if (refreshPage) refreshPage();
            return { event: "backResult", handled: true };
        }

        return { event: "backResult", handled: false };
    }

    function reportState() {
        window.TvXBoot?.report();
        const isLogin = isLoginMode();
        const isDetail = window.location.pathname.includes("/status/");
        const state = {
            event: "state",
            authenticated: !isLogin && hasAuthenticatedNavigation(),
            pageType: isLogin ? "login" : (isDetail ? "detail" : "timeline"),
            hasOverlay: isLogin || !!window.TvXActions?.isOpen(),
            canBack: isDetail || pageScrollY() > 100,
            focusedIndex: isLogin ? -1 : activeArticleIndex
        };
        console.log("[TvXAdapter] reportState:", JSON.stringify(state));
        try {
            browser.runtime.sendMessage(state).catch(() => {});
        } catch (e) {}
    }

    function unmount() {
        restoringHome = false;
        clearTimeout(homeRestoreTimer); homeRestoreTimer = null;
        if (observer) observer.disconnect();
        observer = null;
        clearTimeout(initialTimer);
        clearTimeout(refreshTimer);
        initialTimer = null;
        refreshTimer = null;
        cancelPendingMove();
        window.removeEventListener("popstate", refreshPage);
        window.removeEventListener("resize", refreshPage);
        window.removeEventListener("scroll", handleHomeScroll, true);
        window.removeEventListener("keydown", handleActionKeyDown, true);
        window.removeEventListener("keydown", handleRemoteKeyDown, true);
        window.TvXMedia?.reset();
        window.TvXActions?.close();
        refreshPage = null;
        if (window.TvXReading) window.TvXReading.update(false, []);
        if (window.TvXDetail) window.TvXDetail.update(false);
    }

    return {
        init,
        unmount,
        move,
        activate,
        handleBack,
        menu,
        reportState
    };
})();
