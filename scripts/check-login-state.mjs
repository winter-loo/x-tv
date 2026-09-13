import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Reading classifies authentication; it no longer owns a parallel login form.
let state;
const elements = {
    'tv-x-styles': {},
};
const nativePassword = { offsetWidth: 100 };
const dialog = { querySelector: selector => selector.includes('password') ? nativePassword : null };
const context = {
    console: { log() {}, warn() {} },
    window: { location: { pathname: '/i/flow/login', href: 'https://x.com/i/flow/login' }, scrollY: 0, addEventListener() {} },
    document: {
        body: { classList: { add() {}, toggle() {}, contains() { return false; } } },
        getElementById: id => elements[id] || null,
        querySelectorAll: () => [],
        querySelector: selector => selector.includes('role="dialog"') ? dialog : null,
    },
    setTimeout: callback => callback(),
    browser: { runtime: { sendMessage: message => { state = message; return Promise.resolve(); } } },
};
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../app/src/main/assets/tv-extension/sites/x/adapter.js', import.meta.url), 'utf8'), context);
context.window.TvXAdapter.reportState();
assert.equal(state.pageType, 'login');
assert.equal(state.focusedIndex, -1, 'Reading must not maintain a fake login selection');
context.window.TvXAdapter.move('down');
assert.equal(state.event, 'login_required', 'Android owns login navigation');
console.log('PASS: reading delegates login to the native owner.');

context.window.location.pathname = '/home';
context.window.TvXAdapter.reportState();
assert.equal(state.hasOverlay, false, 'A loading or empty home page must not mount the login overlay');
context.window.location.pathname = '/settings';
context.window.TvXAdapter.reportState();
assert.equal(state.hasOverlay, false, 'An unrelated dialog must not be interpreted as login');
context.window.location.pathname = '/';
context.document.querySelector = selector => selector.includes('a[href=') ? {} : null;
context.window.TvXAdapter.reportState();
assert.equal(state.hasOverlay, true, 'A signed-out landing page with a login link must still show TV login');
context.window.location.pathname = '/home';
context.document.querySelector = selector => selector.includes('SideNav_AccountSwitcher_Button') ? {} : null;
context.window.TvXAdapter.reportState();
assert.equal(state.hasOverlay, false, 'Authenticated navigation must keep an empty timeline out of login mode');
console.log('PASS: loading, empty timeline, unrelated dialog, and signed-out landing page classification.');
