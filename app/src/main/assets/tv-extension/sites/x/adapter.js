// X (Twitter) Site Adapter for Android TV with 100% Custom Headless TV Login UI
window.TvXAdapter = window.TvXAdapter || (function() {
    let activeArticleIndex = 0;
    let customLoginFocusIndex = 0;
    let lastAnchorId = null;
    let observer = null;
    let currentLoginStep = "username"; // "username" | "password"
    let authHandoffActive = false;
    let usernameSubmissionPending = false;
    let refreshTimer = null;
    let pendingMove = null;
    let pendingTimer = null;
    let homeAnchor = null;
    let homeScroll = 0;
    let restoringHome = false;
    let previousMode = "";
    let timelineTab = "";
    let topRequested = false;
    let refreshPage = null;
    let initialTimer = null;
    let recoveryNavigation = false;
    const recoveryHomeKey = "tv-x-recovery-home";
    window.addEventListener("pageshow", event => {
        if (event.persisted && recoveryNavigation) window.location.reload();
    });

    function init() {
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

        window.addEventListener("keydown", handleLoginKeyDown, true);
        window.addEventListener("keydown", handleActionKeyDown, true);
        initialTimer = setTimeout(() => {
            initialTimer = null;
            handlePageMode();
        }, 350);
    }

    function isHome() {
        return window.location.pathname === "/home";
    }

    function isPostDetail() {
        return /^\/[^/]+\/status\/\d+(?:\/(?:photo|video)\/\d+)?$/.test(window.location.pathname);
    }

    function handlePageMode() {
        window.TvXActions?.update();
        updateTimelineLayout();
        const mode = isLoginMode() ? "login" : (isHome() ? "home" : "other");
        const articles = getArticles();
        if (window.TvXReading) window.TvXReading.update(mode === "home", articles, statusLink);
        const detail = mode !== "login" && isPostDetail();
        if (window.TvXDetail) window.TvXDetail.update(detail, statusLink);
        if (detail && window.TvXDetail) {
            unmountCustomTvLogin();
            cancelPendingMove();
            previousMode = "detail";
            return;
        }
        if (mode === "login") {
            mountCustomTvLogin();
        } else {
            unmountCustomTvLogin();
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
                    return;
                }
                if (focusedArticle()) restoringHome = false;
                else pageScroller().scrollTo({ top: homeScroll, behavior: "instant" });
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
        if (path === "/i/flow/login" || path === "/login" ||
            (path === "/i/jf/onboarding/web" && new URL(window.location.href).searchParams.get("mode") === "login")) return true;
        const hasArticles = document.querySelectorAll('article[data-testid="tweet"], .timeline-card').length > 0;
        if (hasArticles) return false;

        // A pending /home response, empty timeline, or unrelated dialog is not a login form.
        if (document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Home_Link"], [data-testid="tweetTextarea_0"]')) return false;
        // X's current signed-out landing page no longer has a #react-root wrapper.
        if (path === "/" && document.querySelector('a[href^="/i/jf/onboarding/web?mode=login"]')) return true;
        return !!document.querySelector(
            '#react-root input[autocomplete="username"], #layers input[autocomplete="username"], ' +
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

    function setupObserver() {
        if (observer) return;
        refreshPage = () => {
            if (refreshTimer !== null) return;
            refreshTimer = setTimeout(() => {
                refreshTimer = null;
                handlePageMode();
                if (isLoginMode()) checkNativeLoginProgression();
            }, 50);
        };
        observer = new MutationObserver(records => {
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
    }

    /* =========================================================================
       100% Custom Headless TV Login UI Implementation
       ========================================================================= */

    function mountCustomTvLogin() {
        if (document.getElementById("tv-custom-login-stage")) return;
        document.body.classList.add("tv-custom-login-active");

        const stage = document.createElement("div");
        stage.id = "tv-custom-login-stage";
        stage.innerHTML = `
            <div class="tv-login-card">
                <svg class="tv-login-logo" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 24.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                <h1 id="tv-stage-title" class="tv-login-title">登录 X (Twitter)</h1>
                <p id="tv-stage-subtitle" class="tv-login-subtitle">Android TV 大屏专享控制台</p>

                <div id="tv-stage-error" class="tv-error-badge"></div>

                <div class="tv-form-container">
                    <div class="tv-input-wrapper">
                        <input id="tv-stage-input" class="tv-login-input" type="text" placeholder="输入用户名、邮箱或手机号" autocomplete="off" />
                    </div>

                    <button id="tv-stage-next-btn" class="tv-btn tv-btn-primary">
                        <span id="tv-stage-btn-text">下一步</span>
                    </button>

                    <div id="tv-oauth-divider" class="tv-login-divider">
                        <span>或通过快捷方式继续</span>
                    </div>

                    <div id="tv-oauth-container" style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
                        <button id="tv-stage-google-btn" class="tv-btn tv-btn-oauth">
                            <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
                            <span>使用 Google 账号继续</span>
                        </button>
                        <button id="tv-stage-apple-btn" class="tv-btn tv-btn-oauth">
                            <svg viewBox="0 0 170 170" fill="#ffffff"><path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.58-7.7-11.64-13.99-6.97-10.74-12.28-22.95-15.93-36.63-3.65-13.67-5.48-26.68-5.48-39.02 0-14.99 3.59-27.76 10.77-38.3 7.18-10.55 16.51-15.95 27.99-16.2 5.01 0 10.79 1.34 17.33 4.02 6.54 2.68 10.56 4.07 12.06 4.17 1.84-.2 5.96-1.63 12.36-4.29 6.4-2.67 12.02-3.83 16.86-3.48 12.5.64 22.75 4.96 30.74 12.96-10.96 6.64-16.32 15.77-16.08 27.39.24 9.15 3.84 17.06 10.8 23.72 6.96 6.67 15.35 10.47 25.17 11.41-2.22 6.96-5.07 14.12-8.54 21.48zM119.22 33.72c0-7.46 2.64-14.61 7.92-21.45 5.28-6.84 12.01-11.39 20.19-13.65.65 1.52.98 3.12.98 4.79 0 7.46-2.73 14.77-8.19 21.93-5.46 7.16-12.29 11.59-20.5 13.29-.22-1.63-.4-3.27-.4-4.91z"/></svg>
                            <span>使用 Apple 账号继续</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(stage);

        // Bind Custom Buttons Click Handlers
        document.getElementById("tv-stage-next-btn").onclick = handleCustomNextSubmit;
        document.getElementById("tv-stage-google-btn").onclick = handleCustomGoogleAuth;
        document.getElementById("tv-stage-apple-btn").onclick = handleCustomAppleAuth;

        // Auto Focus First Interactive Element
        customLoginFocusIndex = 0;
        updateCustomFocus();

        console.log("[TvXAdapter] Mounted 100% custom TV login stage.");
    }

    function unmountCustomTvLogin() {
        if (document.body.classList.contains("tv-custom-login-active")) document.body.classList.remove("tv-custom-login-active");
        const stage = document.getElementById("tv-custom-login-stage");
        if (stage) stage.remove();
    }

    function getCustomInteractiveElements() {
        const stage = document.getElementById("tv-custom-login-stage");
        if (!stage) return [];

        const elements = [
            document.getElementById("tv-stage-input"),
            document.getElementById("tv-stage-next-btn")
        ];

        if (currentLoginStep === "username") {
            elements.push(document.getElementById("tv-stage-google-btn"));
            elements.push(document.getElementById("tv-stage-apple-btn"));
        }

        return elements.filter(el => el && !el.classList.contains("tv-hidden") && el.style.display !== "none");
    }

    // Direct window-level KeyDown Listener for D-pad (Up/Down/Left/Right/OK)
    function handleLoginKeyDown(e) {
        console.log("[TvXAdapter] Window keydown received:", e.key, e.keyCode);
        if (isLoginMode()) {
            if (e.key === "ArrowDown" || e.keyCode === 40 || e.key === "ArrowRight" || e.keyCode === 39) {
                e.preventDefault();
                move("down");
            } else if (e.key === "ArrowUp" || e.keyCode === 38 || e.key === "ArrowLeft" || e.keyCode === 37) {
                e.preventDefault();
                move("up");
            } else if (e.key === "Enter" || e.keyCode === 13) {
                const currentEl = getCustomInteractiveElements()[customLoginFocusIndex];
                // Only preventDefault if not actively typing in input, or trigger activate
                if (currentEl && currentEl.tagName.toLowerCase() !== "input") {
                    e.preventDefault();
                    activate();
                } else if (currentEl && currentEl.tagName.toLowerCase() === "input" && e.target !== currentEl) {
                    e.preventDefault();
                    activate();
                }
            }
        }
    }

    function updateCustomFocus() {
        const elements = getCustomInteractiveElements();
        if (elements.length === 0) return;

        if (customLoginFocusIndex < 0) customLoginFocusIndex = 0;
        if (customLoginFocusIndex >= elements.length) customLoginFocusIndex = elements.length - 1;

        elements.forEach(el => el.classList.remove("tv-custom-focused"));
        const target = elements[customLoginFocusIndex];
        target.classList.add("tv-custom-focused");

        console.log("[TvXAdapter] Custom focus updated to [" + customLoginFocusIndex + "]:", target.id);
    }

    /* Headless Synchronizers with Native React DOM */

    function setNativeInputValue(nativeInput, val) {
        if (!nativeInput) return;
        const proto = Object.getPrototypeOf(nativeInput);
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(nativeInput, val);
        nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
        nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function handleCustomNextSubmit() {
        const customInput = document.getElementById("tv-stage-input");
        const val = customInput ? customInput.value.trim() : "";
        if (!val) {
            showError("请输入有效的用户名、邮箱或密码");
            return;
        }

        console.log("[TvXAdapter] handleCustomNextSubmit step=" + currentLoginStep);

        if (currentLoginStep === "username") {
            const nativeInput = document.querySelector('input[autocomplete="username"], input[name="text"]');
            if (nativeInput) {
                setNativeInputValue(nativeInput, val);
            }

            // Click native Next button in background
            const buttons = Array.from(document.querySelectorAll('#react-root [role="button"], #react-root button, div[role="dialog"] [role="button"]'));
            const nextBtn = buttons.find(b => {
                const text = b.textContent.trim();
                return text.includes("下一步") || text.includes("Next") || text.includes("继续");
            });

            if (nextBtn) {
                usernameSubmissionPending = true;
                console.log("[TvXAdapter] Clicking native Next button:", nextBtn.textContent.trim());
                nextBtn.click();
            } else {
                console.warn("[TvXAdapter] Could not find native Next button.");
            }
        } else if (currentLoginStep === "password") {
            const nativePasswordInput = document.querySelector('input[type="password"], input[name="password"]');
            if (nativePasswordInput) {
                setNativeInputValue(nativePasswordInput, val);
            }

            // Click native Log in button
            const buttons = Array.from(document.querySelectorAll('#react-root [role="button"], #react-root button, div[role="dialog"] [role="button"]'));
            const loginBtn = buttons.find(b => {
                const text = b.textContent.trim();
                return text.includes("登录") || text.includes("Log in");
            });

            if (loginBtn) {
                console.log("[TvXAdapter] Clicking native Log in button:", loginBtn.textContent.trim());
                loginBtn.click();
            }
        }
    }

    function handleCustomGoogleAuth() {
        authHandoffActive = true;
        const stage = document.getElementById("tv-custom-login-stage");
        // Hand off to the real sign-in control so Google's own account chooser is visible.
        if (document.body.classList.contains("tv-custom-login-active")) document.body.classList.remove("tv-custom-login-active");
        if (stage) stage.style.setProperty("display", "none", "important");
        const scope = document.querySelector('div[role="dialog"]') || document;
        const target = scope.querySelector('iframe[src*="accounts.google.com/gsi/button"]');
        if (!target) {
            restoreCustomLogin();
            showError("Google 登录入口尚未就绪，请稍后重试");
            return false;
        }
        target.scrollIntoView({ block: "center" });
        requestAnimationFrame(() => {
            const r = target.getBoundingClientRect();
            if (!r.width || !r.height) {
                restoreCustomLogin();
                showError("Google 登录入口尚未就绪，请稍后重试");
                return;
            }
            browser.runtime.sendMessage({
                event: "request_tap",
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2)
            }).catch(() => {
                restoreCustomLogin();
                showError("无法打开 Google 登录，请重试");
            });
        });
        return true;
    }

    function restoreCustomLogin() {
        authHandoffActive = false;
        const stage = document.getElementById("tv-custom-login-stage");
        if (!stage) return;
        document.body.classList.add("tv-custom-login-active");
        stage.style.removeProperty("display");
        customLoginFocusIndex = currentLoginStep === "username" ? 2 : 0;
        updateCustomFocus();
    }

    function handleCustomAppleAuth() {
        console.log("[TvXAdapter] Triggering native Apple Auth...");
        const buttons = Array.from(document.querySelectorAll('#react-root [role="button"], div[role="dialog"] [role="button"]'));
        const appleBtn = buttons.find(b => b.textContent && b.textContent.includes("Apple"));
        if (appleBtn) {
            appleBtn.click();
        } else {
            showError("未能定位 Apple 登录入口，请重试");
        }
    }

    function isElementVisible(el) {
        if (!el) return false;
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    function checkNativeLoginProgression() {
        if (authHandoffActive) return;
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return;

        const nativePassword = dialog.querySelector('input[type="password"], input[name="password"]');
        const nativeUsername = dialog.querySelector('input[autocomplete="username"], input[name="text"]');

        if (usernameSubmissionPending && nativePassword && isElementVisible(nativePassword) && (!nativeUsername || !isElementVisible(nativeUsername)) && currentLoginStep === "username") {
            console.log("[TvXAdapter] Native DOM entered Password step! Transitioning custom TV UI...");
            currentLoginStep = "password";
            usernameSubmissionPending = false;

            const title = document.getElementById("tv-stage-title");
            const subtitle = document.getElementById("tv-stage-subtitle");
            const input = document.getElementById("tv-stage-input");
            const btnText = document.getElementById("tv-stage-btn-text");
            const divider = document.getElementById("tv-oauth-divider");
            const oauth = document.getElementById("tv-oauth-container");

            if (title) title.textContent = "输入你的密码";
            if (subtitle) subtitle.textContent = "验证你的 X 账号密码以继续";
            if (btnText) btnText.textContent = "登录";
            if (divider) divider.classList.add("tv-hidden");
            if (oauth) oauth.classList.add("tv-hidden");

            if (input) {
                input.value = "";
                input.type = "password";
                input.placeholder = "输入密码";
                input.focus();
            }

            customLoginFocusIndex = 0;
            updateCustomFocus();
        } else if (nativeUsername && isElementVisible(nativeUsername) && currentLoginStep === "password") {
            console.log("[TvXAdapter] Native DOM returned to Username step! Resetting custom TV UI...");
            currentLoginStep = "username";
            const stage = document.getElementById("tv-custom-login-stage");
            if (stage) stage.remove();
            mountCustomTvLogin();
        }

        // Detect if background native page returned an error
        const nativeAlert = document.querySelector('[role="alert"], [data-testid="toast"]');
        if (nativeAlert && nativeAlert.textContent.trim()) {
            showError(nativeAlert.textContent.trim());
        }
    }

    function showError(msg) {
        const errorBox = document.getElementById("tv-stage-error");
        if (errorBox) {
            errorBox.textContent = msg;
            errorBox.style.display = "block";
        }
    }

    /* =========================================================================
       Timeline Navigation Implementation
       ========================================================================= */

    function getArticles() {
        const list = Array.from(document.querySelectorAll(
            'article[data-testid="tweet"], article[role="article"], .timeline-card'
        ));
        return list.filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.height > 20;
        });
    }

    function statusLink(article) {
        if (!article) return null;
        if (!isHome() && window.TvXPostIdentity) return window.TvXPostIdentity.statusLink(article);
        const name = article.querySelector('[data-testid="User-Name"]');
        const links = Array.from((name || article).querySelectorAll('a[href*="/status/"]'));
        return links.find(link => {
            const href = link.getAttribute("href") || "";
            return /^\/[^/]+\/status\/\d+$/.test(href) && !!link.querySelector("time");
        }) || null;
    }

    function extractArticleAnchor(article) {
        const link = statusLink(article);
        if (link && !isHome() && window.TvXPostIdentity) return window.TvXPostIdentity.canonicalPath(link);
        return link ? new URL(link.getAttribute("href"), location.href).pathname : article.getAttribute("data-tweet-id");
    }

    function focusedArticle() {
        if (!lastAnchorId) return null;
        return getArticles().find(article => extractArticleAnchor(article) === lastAnchorId) || null;
    }

    function focusFirstVisibleArticle() {
        const articles = getArticles();
        const index = articles.findIndex(article => article.getBoundingClientRect().top >= -50 && extractArticleAnchor(article));
        if (index >= 0) focusArticleAtIndex(index);
    }

    function focusArticleAtIndex(index) {
        const articles = getArticles();
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
        if (isHome() && window.TvXReading) {
            if (changed) {
                target.querySelectorAll(".tv-reading-text, .tv-reading-attachment").forEach(node => { node.scrollTop = 0; });
            }
            window.TvXReading.focus(target);
        } else if (changed) TvNavigationRuntime.setFocus(target);
        if (changed) reportState();
    }

    function verifyOrRestoreFocus() {
        const articles = getArticles();
        const index = articles.findIndex(article => extractArticleAnchor(article) === lastAnchorId);
        if (index >= 0) focusArticleAtIndex(index);
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
            focusArticleAtIndex(target);
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
                focusArticleAtIndex(i);
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

    function handleActionKeyDown(event) {
        if (window.TvXActions?.key(event)) return;
        if (!event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey &&
            (event.key.toLowerCase() === "m" || event.key === "ContextMenu") &&
            !event.target.closest("input, textarea, [contenteditable=true]")) {
            if (menu()) { event.preventDefault(); event.stopImmediatePropagation(); }
        }
    }

    function menu() {
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
                if (link) { if (isHome()) homeScroll = pageScrollY(); link.click(); }
            },
            restore: () => { verifyOrRestoreFocus(); reportState(); }
        });
        reportState();
        return opened;
    }

    function move(direction) {
        if (window.TvXActions?.move(direction)) return;
        if (isLoginMode()) {
            const elements = getCustomInteractiveElements();
            if (elements.length === 0) return;

            if (direction === "down") {
                customLoginFocusIndex++;
                if (customLoginFocusIndex >= elements.length) customLoginFocusIndex = 0;
            } else if (direction === "up") {
                customLoginFocusIndex--;
                if (customLoginFocusIndex < 0) customLoginFocusIndex = elements.length - 1;
            }
            updateCustomFocus();
            return;
        }

        if (window.TvXDetail && isPostDetail()) {
            window.TvXDetail.update(true, statusLink);
            window.TvXDetail.move(direction);
            return;
        }
        movePost(direction);
    }

    function activate() {
        if (window.TvXActions?.activate()) return;
        if (isLoginMode()) {
            const elements = getCustomInteractiveElements();
            if (elements.length === 0 || customLoginFocusIndex >= elements.length) return;

            const target = elements[customLoginFocusIndex];
            console.log("[TvXAdapter] Activating custom login target:", target.id);

            if (target.tagName.toLowerCase() === "input") {
                target.focus();
                target.click();
            } else {
                target.click();
            }
            return;
        }

        if (window.TvXDetail && isPostDetail()) return;
        const current = focusedArticle();
        const link = statusLink(current);
        if (link) {
            cancelPendingMove();
            if (isHome()) homeScroll = pageScrollY();
            link.click();
        } else if (current && current.classList.contains("timeline-card")) {
            TvNavigationRuntime.clickElement(current);
        }
    }

    function handleBack() {
        console.log("[TvXAdapter] handleBack requested.");
        if (window.TvXActions?.close()) return { event: "backResult", handled: true };
        restoringHome = false;
        cancelPendingMove();
        const stage = document.getElementById("tv-custom-login-stage");
        if (stage && stage.style.display === "none") {
            restoreCustomLogin();
            return { event: "backResult", handled: true };
        }
        if (isLoginMode()) {
            if (currentLoginStep === "password") {
                const nativeBack = document.querySelector('div[role="dialog"] [aria-label="Back"], div[role="dialog"] [aria-label="返回"], div[role="dialog"] [data-testid="app-bar-back"]');
                if (nativeBack) {
                    console.log("[TvXAdapter] Clicking native Back button...");
                    nativeBack.click();
                }

                currentLoginStep = "username";
                const stage = document.getElementById("tv-custom-login-stage");
                if (stage) stage.remove();
                mountCustomTvLogin();
                return { event: "backResult", handled: true };
            }
            return { event: "backResult", handled: false };
        }

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
            window.history.back();
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
        const isLogin = isLoginMode();
        const isDetail = window.location.pathname.includes("/status/");
        const state = {
            event: "state",
            pageType: isLogin ? "login" : (isDetail ? "detail" : "timeline"),
            hasOverlay: isLogin || !!window.TvXActions?.isOpen(),
            canBack: isDetail || pageScrollY() > 100 || (isLogin && currentLoginStep === "password"),
            focusedIndex: isLogin ? customLoginFocusIndex : activeArticleIndex
        };
        console.log("[TvXAdapter] reportState:", JSON.stringify(state));
        try {
            browser.runtime.sendMessage(state).catch(() => {});
        } catch (e) {}
    }

    function unmount() {
        restoringHome = false;
        if (observer) observer.disconnect();
        observer = null;
        clearTimeout(initialTimer);
        clearTimeout(refreshTimer);
        initialTimer = null;
        refreshTimer = null;
        cancelPendingMove();
        window.removeEventListener("popstate", refreshPage);
        window.removeEventListener("resize", refreshPage);
        window.removeEventListener("keydown", handleLoginKeyDown, true);
        window.removeEventListener("keydown", handleActionKeyDown, true);
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
        reportState,
        restoreLogin: restoreCustomLogin,
        googleAuth: handleCustomGoogleAuth
    };
})();
