// The signed-out route is known before X downloads its application bundle. Build
// the TV login shell at document_start so the native cover does not wait for X's
// React login dialog. adapter.js binds behavior and synchronizes the native form.
window.TvXLoginStage = window.TvXLoginStage || (() => {
    const markup = `
        <div class="tv-login-card">
            <svg class="tv-login-logo" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 24.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            <h1 id="tv-stage-title" class="tv-login-title">登录 X (Twitter)</h1>
            <p id="tv-stage-subtitle" class="tv-login-subtitle">Android TV 大屏专享控制台</p>

            <div id="tv-stage-error" class="tv-error-badge"></div>

            <div class="tv-form-container">
                <div class="tv-input-wrapper">
                    <input id="tv-stage-input" class="tv-login-input tv-custom-focused" type="text" placeholder="输入用户名、邮箱或手机号" autocomplete="off" />
                </div>

                <button id="tv-stage-next-btn" class="tv-btn tv-btn-primary">
                    <span id="tv-stage-btn-text">下一步</span>
                </button>

                <button id="tv-stage-assist-btn" class="tv-btn tv-btn-oauth">手机 / 电脑辅助登录</button>

                <div id="tv-oauth-divider" class="tv-login-divider">
                    <span>或通过快捷方式继续</span>
                </div>

                <div id="tv-oauth-container" style="display:flex;flex-direction:column;gap:10px;width:100%">
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
        </div>`;

    function mount(parent = document.body || document.documentElement) {
        if (!parent) return null;
        let stage = document.getElementById("tv-custom-login-stage");
        if (!stage) {
            stage = document.createElement("div");
            stage.id = "tv-custom-login-stage";
            stage.dataset.mountedReadyState = document.readyState;
            stage.innerHTML = markup;
        }
        if (stage.parentNode !== parent) parent.appendChild(stage);
        return stage;
    }

    return {mount};
})();
