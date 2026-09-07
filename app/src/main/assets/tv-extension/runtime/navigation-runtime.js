// General TV Navigation Utilities
window.TvNavigationRuntime = (function() {
    const FOCUS_CLASS = "tv-focused";

    function setFocus(element) {
        // Remove existing focus
        const old = document.querySelectorAll("." + FOCUS_CLASS);
        old.forEach(el => el.classList.remove(FOCUS_CLASS));

        if (element) {
            element.classList.add(FOCUS_CLASS);
            scrollToElement(element);
        }
    }

    function scrollToElement(element) {
        if (!element) return;
        try {
            element.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "center"
            });
        } catch (e) {
            console.warn("[TvNavigationRuntime] scrollIntoView failed:", e);
        }
    }

    function clickElement(element) {
        if (!element) return false;
        try {
            element.focus();
            element.dispatchEvent(new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window
            }));
            return true;
        } catch (e) {
            console.error("[TvNavigationRuntime] clickElement error:", e);
            return false;
        }
    }

    function isInViewport(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= -rect.height &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + rect.height &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    return {
        setFocus,
        scrollToElement,
        clickElement,
        isInViewport,
        FOCUS_CLASS
    };
})();
