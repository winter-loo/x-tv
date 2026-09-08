// Presentation only: annotate native X nodes, never move/replace React-owned content.
window.TvXReading = window.TvXReading || (function() {
    let header = null;
    let guidance = null;
    let status = null;
    let signature = "";
    let active = false;
    const formatted = new WeakMap();

    function mount() {
        if (header && header.isConnected) return;
        let style = document.getElementById("tv-x-reading-styles");
        if (!style) {
            style = document.createElement("link");
            style.id = "tv-x-reading-styles";
            style.rel = "stylesheet";
            style.href = browser.runtime.getURL("sites/x/reading.css");
            (document.head || document.documentElement).appendChild(style);
        }
        // CSS may finish after initial selection; its layout changes are not DOM mutations.
        if (!style.sheet) style.onload = () => {
            style.onload = null;
            if (active) focus(document.querySelector("article.tv-focused"));
        };
        header = document.createElement("div");
        header.id = "tv-reading-header";
        header.innerHTML = '<div id="tv-reading-logo" aria-label="X"></div><div id="tv-reading-tabs"></div><img id="tv-reading-account" alt="当前账号" hidden>';
        guidance = document.createElement("div");
        guidance.id = "tv-reading-guidance";
        status = document.createElement("div");
        status.id = "tv-reading-status";
        status.setAttribute("role", "status");
        document.body.append(header, guidance);
        signature = "";
    }

    function mark(article, node, kind) {
        if (!node || !article.contains(node)) return;
        node.classList.add("tv-reading-part", "tv-reading-" + kind);
        for (let parent = node.parentElement; parent && parent !== article; parent = parent.parentElement) {
            parent.classList.add("tv-reading-branch");
        }
    }

    function formatArticle(article, ownLink) {
        const name = article.querySelector('[data-testid="User-Name"]');
        const cover = article.querySelector('[data-testid="article-cover-image"]');
        let attachment = cover ? cover.parentElement : article.querySelector('[data-testid="card.wrapper"], [data-testid="videoPlayer"], [data-testid="tweetPhoto"]');
        if (!cover && attachment) {
            // Stop before a wrapper shared with the text/author/actions. Flattening
            // that wrapper would hide the media as an unmarked branch child.
            while (attachment.parentElement && attachment.parentElement !== article &&
                !attachment.parentElement.querySelector('[data-testid="User-Name"], [data-testid="tweetText"], [data-testid="reply"]')) {
                attachment = attachment.parentElement;
            }
        }
        const reply = article.querySelector('[data-testid="reply"]');
        const parts = [
            [article.querySelector('[data-testid="Tweet-User-Avatar"]'), "avatar"],
            [name, "name"],
            [article.querySelector('[data-testid="tweetText"]'), "text"],
            [attachment, "attachment"],
            [reply && reply.closest('[role="group"]'), "engagement"]
        ];
        const previous = formatted.get(article);
        if (ownLink && previous && article.classList.contains("tv-reading-card") &&
            parts.every(([node, kind], i) => node === previous.parts[i][0] && (!node || node.classList.contains("tv-reading-" + kind))) &&
            previous.branches.every(node => node.classList.contains("tv-reading-branch"))) return;
        // React can recycle the article and change its attachment structure.
        for (const node of article.querySelectorAll(".tv-reading-part, .tv-reading-branch")) {
            for (const cls of Array.from(node.classList)) {
                if (cls.startsWith("tv-reading-")) node.classList.remove(cls);
            }
        }
        if (article.classList.contains("tv-reading-card")) article.classList.remove("tv-reading-card");
        formatted.delete(article);
        if (!ownLink) return;
        for (let parent = article.parentElement; parent && parent.getAttribute("data-testid") !== "primaryColumn"; parent = parent.parentElement) {
            if (!parent.classList.contains("tv-reading-timeline-ancestor")) parent.classList.add("tv-reading-timeline-ancestor");
        }
        article.classList.add("tv-reading-card");
        parts.forEach(([node, kind]) => mark(article, node, kind));
        formatted.set(article, { parts, branches: Array.from(article.querySelectorAll(".tv-reading-branch")) });
    }

    function syncHeader() {
        const tabs = Array.from(document.querySelectorAll('[data-testid="primaryColumn"] [role="tab"]'));
        const account = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img');
        const logo = document.querySelector('header a[aria-label="X"] svg');
        const values = tabs.map(tab => ({ text: tab.textContent.trim(), selected: tab.getAttribute("aria-selected") === "true" }));
        const next = JSON.stringify([values, account && account.getAttribute("src"), !!logo]);
        if (next === signature) return;
        signature = next;
        const labels = { "For you": "为你推荐", "Following": "正在关注" };
        const tabsView = header.querySelector("#tv-reading-tabs");
        tabsView.replaceChildren(...values.map(tab => {
            const label = document.createElement("span");
            label.textContent = labels[tab.text] || tab.text;
            label.setAttribute("aria-current", String(tab.selected));
            return label;
        }));
        const avatar = header.querySelector("#tv-reading-account");
        if (account) avatar.src = account.getAttribute("src");
        avatar.hidden = !account;
        const logoView = header.querySelector("#tv-reading-logo");
        if (logo && !logoView.firstChild) logoView.appendChild(logo.cloneNode(true));
        // Hide the native sticky wrapper, not its contents: X can still update selected state.
        for (const tab of tabs) {
            const tablist = tab.closest('[role="tablist"]');
            let sticky = tablist;
            for (let n = tablist; n && n.getAttribute("data-testid") !== "primaryColumn"; n = n.parentElement) {
                if (getComputedStyle(n).position === "sticky") sticky = n;
            }
            if (sticky) sticky.classList.add("tv-native-header");
        }
    }

    function update(enabled, articles, findStatusLink) {
        active = enabled;
        if (document.body.classList.contains("tv-reading-active") !== active) document.body.classList.toggle("tv-reading-active", active);
        if (!active) {
            const style = document.getElementById("tv-x-reading-styles");
            if (style) style.onload = null;
            if (header) header.remove();
            if (guidance) guidance.remove();
            if (status) status.remove();
            return;
        }
        mount();
        articles.forEach(article => formatArticle(article, findStatusLink(article)));
        syncHeader();
        const column = document.querySelector('[data-testid="primaryColumn"]');
        const input = column && column.querySelector('[data-testid="tweetTextarea_0"]');
        let composer = input;
        if (composer) {
            while (composer.parentElement && composer.parentElement !== column && !composer.parentElement.querySelector("article")) composer = composer.parentElement;
        }
        // X first mounts the composer into an otherwise empty timeline wrapper,
        // then adds posts to that same wrapper. Reconcile the old annotation so
        // a wrapper that now contains posts can become measurable again.
        for (const previous of document.querySelectorAll(".tv-native-composer")) {
            if (previous !== composer) previous.classList.remove("tv-native-composer");
        }
        if (composer && !composer.classList.contains("tv-native-composer")) composer.classList.add("tv-native-composer");
        const recognized = articles.some(article => article.classList.contains("tv-reading-card"));
        if (!recognized && column) {
            if (!status.isConnected) column.appendChild(status);
            const message = articles.length ? "当前页面暂未识别为可浏览帖子" : (document.querySelector('[role="progressbar"]') ? "正在加载帖子…" : "暂无可浏览帖子，请稍后重试");
            if (status.textContent !== message) status.textContent = message;
        } else status.remove();
    }

    function focus(article) {
        if (!active || !article) return;
        const u = window.innerWidth / 1920;
        const delta = article.getBoundingClientRect().top - 192 * u;
        if (Math.abs(delta) > 1) article.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
        if (window.TvXCard?.isCardFocused()) {
            const text = "确认 阅读文章     ← 返回正文     ↑↓ 切换帖子     返回 退出";
            if (guidance.textContent !== text) guidance.textContent = text;
            return;
        }
        const overflow = Array.from(article.querySelectorAll(".tv-reading-text, .tv-reading-attachment"))
            .some(node => node.scrollHeight > node.clientHeight + 1);
        const media = article.querySelector('video, [data-testid="tweetPhoto"] img');
        const text = "↑↓ 切换帖子     确认 打开帖子" + (media ? "     → 图片 / 视频" + (overflow ? "     ← 翻阅正文" : "") : overflow ? "     ←→ 翻阅长内容" : "") + "     菜单 评论 / 喜欢     返回 回到顶部 / 退出";
        if (guidance.textContent !== text) guidance.textContent = text;
    }

    function scrollText(article, direction) {
        if (!article) return;
        if (direction === 'left' && article.querySelector('video, [data-testid="tweetPhoto"] img')) {
            const text = article.querySelector('.tv-reading-text');
            if (text) text.scrollTop = text.scrollTop + text.clientHeight >= text.scrollHeight - 1 ? 0 : text.scrollTop + text.clientHeight * .8;
            return;
        }
        for (const node of article.querySelectorAll(".tv-reading-text, .tv-reading-attachment")) {
            node.scrollBy({ top: (direction === "right" ? 1 : -1) * node.clientHeight * 0.8, behavior: "instant" });
        }
    }

    function waiting(message) {
        if (guidance && guidance.textContent !== message) guidance.textContent = message;
    }

    return { update, focus, scrollText, waiting };
})();
