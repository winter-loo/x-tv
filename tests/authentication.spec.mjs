import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {mount} from './fixtures/timeline.mjs';

const attempt='11111111-1111-4111-8111-111111111111';
const assets=new URL('../app/src/main/assets/tv-extension/',import.meta.url);
async function nativePage(page) {
    await page.route('**/*', route => route.fulfill({contentType:'text/html',body:
        '<html><body><div id="react-root"><form><label>Username<input name="username_or_email"></label><button type="button">Continue</button></form></div></body></html>'}));
    await page.addInitScript(() => {
        window.messages=[];window.handlers=[];
        window.browser={runtime:{sendMessage:m=>{window.messages.push(m);return Promise.resolve();},
            onMessage:{addListener:f=>window.handlers.push(f)},getURL:path=>'/extension/'+path}};
    });
    for(const path of ['sites/x/auth-page.js','sites/x/bootstrap.js','sites/x/adapter.js','runtime/content.js'])
        await page.addInitScript({content:await readFile(new URL(path,assets),'utf8')});
    await page.goto('https://x.com/i/flow/login#tvx-auth='+attempt);
}

test('authentication tab keeps the real form through redirects and reloads without mounting reader or proxy login',async({page})=>{
    await nativePage(page);
    await expect(page.locator('#react-root input')).toBeVisible();
    expect(await page.evaluate(()=>!!window.TvXAdapter)).toBe(false);
    await expect(page.locator('html')).not.toHaveClass(/tv-x-boot/);
    await expect(page.locator('#tv-custom-login-stage')).toHaveCount(0);
    await page.goto('https://x.com/i/jf/onboarding/web?mode=login');
    await expect(page.locator('#react-root input')).toBeVisible();
    expect(await page.evaluate(()=>window.TvXAuthPage.attempt)).toBe(attempt);
    await page.reload();
    await expect(page.locator('#react-root input')).toBeVisible();
    expect(await page.evaluate(()=>!!window.TvXAdapter)).toBe(false);
    const prevented=await page.evaluate(()=>{
        const key=new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});
        window.dispatchEvent(key);return key.defaultPrevented;
    });
    expect(prevented).toBe(false);
});

test('authentication reports actual navigation, ignores retired attempts, and never treats a ready form as signed in',async({page})=>{
    await nativePage(page);
    await expect.poll(()=>page.evaluate(()=>window.messages.some(m=>m.event==='auth_state'&&m.pageReady))).toBe(true);
    expect(await page.evaluate(()=>window.messages.some(m=>m.authenticated))).toBe(false);
    const count=await page.evaluate(async()=>{
        const before=window.messages.length;
        for(const handler of window.handlers)await handler({command:'authState',attempt:'22222222-2222-4222-8222-222222222222'});
        return window.messages.length-before;
    });
    expect(count).toBe(0);
    await page.evaluate(()=>{
        const account=document.createElement('button');account.dataset.testid='SideNav_AccountSwitcher_Button';
        document.querySelector('#react-root').replaceChildren(account);
    });
    await expect.poll(()=>page.evaluate(()=>window.messages.some(m=>m.event==='auth_state'&&m.authenticated))).toBe(true);
    expect(await page.evaluate(()=>window.messages.filter(m=>m.event==='auth_state').every(m=>m.attempt===window.TvXAuthPage.attempt))).toBe(true);
});

test('signed-out reading page asks Android for login once and never adds a fake form',async({page})=>{
    await mount(page,[]);
    await page.evaluate(()=>{
        window.loginRequests=[];
        window.browser.runtime.sendMessage=m=>{window.loginRequests.push(m);return Promise.resolve();};
        document.querySelector('header').remove();
        document.querySelector('#react-root').innerHTML='<input name="username_or_email">';
        history.replaceState({},'','/');
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect.poll(()=>page.evaluate(()=>window.loginRequests.filter(m=>m.event==='login_required').length)).toBe(1);
    await page.evaluate(()=>{for(let i=0;i<20;i++)document.querySelector('#react-root').appendChild(document.createElement('span'));});
    await page.waitForTimeout(200);
    expect(await page.evaluate(()=>window.loginRequests.filter(m=>m.event==='login_required').length)).toBe(1);
    await expect(page.locator('#tv-custom-login-stage')).toHaveCount(0);
});

test('Google activation waits for its iframe load, not merely DOM insertion',async({page})=>{
    await nativePage(page);
    let release;
    const blocked=new Promise(resolve=>release=resolve);
    await page.route('https://accounts.google.com/gsi/button*',async route=>{
        await blocked;await route.fulfill({contentType:'text/html',body:'<button>Google</button>'});
    });
    await page.evaluate(()=>{
        const frame=document.createElement('iframe');frame.src='https://accounts.google.com/gsi/button?test=1';
        document.body.appendChild(frame);
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(()=>window.messages.some(m=>m.googleReady))).toBe(false);
    expect(await page.evaluate(async()=>{
        for(const handler of window.handlers){const r=await handler({command:'authGoogle',attempt:window.TvXAuthPage.attempt});if(r)return r.opened;}
    })).toBe(false);
    release();
    await expect.poll(()=>page.evaluate(()=>window.messages.some(m=>m.googleReady))).toBe(true);
    await page.evaluate(async()=>{
        for(const handler of window.handlers)await handler({command:'authGoogle',attempt:window.TvXAuthPage.attempt});
    });
    await expect.poll(()=>page.evaluate(()=>window.messages.filter(m=>m.event==='auth_tap').length)).toBe(1);
});

test('Google inline account confirmation receives focus without automatically consenting',async({page})=>{
    await nativePage(page);
    await page.evaluate(()=>{
        const prompt=document.createElement('iframe');prompt.src='https://accounts.google.com/gsi/iframe/select?test=1';
        prompt.id='google-confirmation';document.body.appendChild(prompt);
    });
    await expect.poll(()=>page.evaluate(()=>window.messages.some(m=>m.googlePrompt))).toBe(true);
    await page.evaluate(async()=>{
        for(const handler of window.handlers)await handler({command:'authGoogle',attempt:window.TvXAuthPage.attempt});
    });
    expect(await page.evaluate(()=>document.activeElement.id)).toBe('google-confirmation');
    expect(await page.evaluate(()=>window.messages.some(m=>m.event==='auth_tap'))).toBe(false);
    expect(await page.evaluate(()=>window.messages.some(m=>m.authenticated))).toBe(false);
});

test('Google confirmation becoming visible after iframe load updates the native owner',async({page})=>{
    await nativePage(page);
    await page.evaluate(()=>{
        const frame=document.createElement('iframe');frame.src='https://accounts.google.com/gsi/iframe/select?test=2';
        frame.style.display='none';frame.id='delayed-google';document.body.appendChild(frame);
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(()=>window.messages.some(m=>m.googlePrompt))).toBe(false);
    await page.evaluate(()=>document.getElementById('delayed-google').style.display='block');
    await expect.poll(()=>page.evaluate(()=>window.messages.some(m=>m.googlePrompt))).toBe(true);
});
