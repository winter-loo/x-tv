import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { mount, post, activate, move, back } from './fixtures/timeline.mjs';

test('remote DOM keys still open the selected post when the native port is unavailable', async ({page}) => {
 await mount(page,[post({id:'101'}),post({id:'102'})]);
 await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 await expect(page).toHaveURL('https://x.com/fixture/status/102');
});

test('edited home timestamps retain identity and open canonical detail', async ({page}) => {
 await mount(page,[post({id:'101'}).replace('/status/101"','/status/101/history"')]);
 await activate(page);
 await expect(page).toHaveURL('https://x.com/fixture/status/101');
});

test('right selects images; OK opens viewer; Back restores the same post without navigation', async ({page}) => {
 const media='<div data-testid="tweetPhoto"><img alt="Photo" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>';
 await mount(page,[post().replace('<div role="group">',media+'<div role="group">')]);
 await move(page,'right');
 await expect(page.locator('[data-tv-media-selected]')).toHaveCount(1);
 await activate(page);
 await expect(page.locator('#tv-media-viewer')).toBeVisible();
 await back(page);
 await expect(page.locator('#tv-media-viewer')).toHaveCount(0);
 await expect(page).toHaveURL('https://x.com/home');
 await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id','101');
});


test('video plays, pauses, seeks, enters full screen and returns without replacing its native node', async ({page}) => {
 const bytes = await readFile(new URL('./fixtures/remote-video.webm', import.meta.url));
 await page.route('https://media.test/**', route => route.fulfill({body:bytes,contentType:'video/webm'}));
 await mount(page,[post().replace('<div role="group">','<div data-testid="videoPlayer"><video muted preload="auto" src="https://media.test/clip.webm"></video></div><div role="group">')]);
 await page.locator('video').evaluate(node => { node.load(); window.originalVideo = node; });
 await page.keyboard.press('ArrowRight');
 await page.keyboard.press('Enter');
 await expect(page.locator('#tv-media-controls')).toBeVisible();
 await expect.poll(() => page.locator('video').evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
 await page.keyboard.press('Enter');
 await expect.poll(() => page.locator('video').evaluate(v => v.paused)).toBe(true);
 await page.keyboard.press('ArrowRight');
 await page.keyboard.press('Enter');
 await expect(page.locator('video')).toHaveClass(/tv-media-fullscreen/);
 await expect.poll(() => page.locator('video').evaluate(v => [Math.round(v.getBoundingClientRect().width - innerWidth), Math.round(v.getBoundingClientRect().height - innerHeight)] )).toEqual([0,0]);
 await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
 await page.keyboard.press('ArrowRight');
 await page.keyboard.press('ArrowRight');
 await page.keyboard.press('Enter');
 await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(9);
 await page.keyboard.press('Escape');
 await expect(page.locator('video')).not.toHaveClass(/tv-media-fullscreen/);
 await expect(page.locator('#tv-media-controls')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('#tv-media-controls')).toHaveCount(0);
 expect(await page.evaluate(() => document.querySelector('video') === window.originalVideo)).toBe(true);
 await expect(page).toHaveURL('https://x.com/home');
});

test('native composer stays concealed until delayed reading CSS is ready', async ({page}) => {
 const mounting = mount(page,[post()],'<div data-testid="tweetTextarea_0">What is happening?</div>',{styleDelay:1500,boot:true});
 await page.waitForFunction(() => document.documentElement.classList.contains('tv-x-boot'));
 await expect(page.getByTestId('tweetTextarea_0')).toBeHidden();
 await mounting;
 await expect(page.locator('html')).not.toHaveClass(/tv-x-boot/);
 await expect(page.getByTestId('tweetTextarea_0')).toBeHidden();
 await expect(page.locator('article.tv-focused')).toBeVisible();
});

test('recycled media closes safely instead of controlling a different post', async ({page}) => {
 const photo = '<div data-testid="tweetPhoto"><img alt="Photo" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>';
 await mount(page,[post().replace('<div role="group">',photo+'<div role="group">')]);
 await move(page,'right'); await activate(page);
 await page.locator('#timeline').evaluate((node,html) => node.innerHTML = html,post({id:'102'}));
 await expect(page.locator('#tv-media-viewer')).toHaveCount(0);
 await activate(page);
 await expect(page).toHaveURL('https://x.com/home');
});

test('background replaces a half-open native port and keeps a responsive one', async () => {
 const {runInNewContext} = await import('node:vm');
 const source = await readFile(new URL('../app/src/main/assets/tv-extension/runtime/background.js',import.meta.url),'utf8');
 let now=0, heartbeat; const ports=[];
 const listener = () => ({addListener(){}});
 const browser = {
  runtime:{onMessage:listener(),connectNative(){
   const port={messages:[],disconnected:false,onMessage:{addListener(fn){port.receive=fn;}},onDisconnect:listener(),postMessage(msg){port.messages.push(msg);},disconnect(){port.disconnected=true;}};
   ports.push(port); return port;
  }},
  tabs:{onActivated:listener(),onUpdated:listener(),onRemoved:listener(),query:async()=>[]}
 };
 runInNewContext(source,{browser,console:{log(){},warn(){},error(){}},Date:{now:()=>now},setInterval(fn){heartbeat=fn;},setTimeout(){}});
 expect(ports).toHaveLength(1);
 now=7000; heartbeat();
 expect(ports[0].disconnected).toBe(true);
 expect(ports).toHaveLength(2);
 now=12000; ports[1].receive({command:'pong'}); heartbeat();
 expect(ports).toHaveLength(2);
 expect(ports[1].messages.at(-1).event).toBe('ping');
});

test('home loading status is not readiness and cannot expose a late native composer', async ({page}) => {
 const mounting=mount(page,[], '<div role="progressbar"></div>',{boot:true});
 await page.waitForFunction(() => !!document.getElementById('tv-reading-status'));
 await page.waitForTimeout(600); // Cover must outlive the scheduled readiness frames.
 await expect(page.locator('html')).toHaveClass(/tv-x-boot/);
 await page.locator('[data-testid="primaryColumn"]').evaluate(node => node.insertAdjacentHTML('afterbegin','<div data-testid="tweetTextarea_0">What is happening?</div>'));
 await expect(page.getByTestId('tweetTextarea_0')).toBeHidden();
 await page.locator('#timeline').evaluate((node,html)=>node.innerHTML=html,post());
 await mounting;
 await expect(page.locator('html')).not.toHaveClass(/tv-x-boot/);
 await expect(page.locator('article.tv-focused')).toBeVisible();
});

test('media selection follows the same post when X replaces its DOM after Back', async ({page}) => {
 const photo='<div data-testid="tweetPhoto"><img alt="Photo" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>';
 const html=post().replace('<div role="group">',photo+'<div role="group">');
 await mount(page,[html]); await move(page,'right');
 await page.locator('#timeline').evaluate((node,html)=>node.innerHTML=html,html);
 await expect(page.locator('[data-tv-media-selected]')).toHaveCount(1);
 await activate(page);
 await expect(page.locator('#tv-media-viewer')).toBeVisible();
});

test('Back survives a second virtual-list scroll restoration after the original post first appears', async ({page}) => {
 const original=post()+post({id:'102'})+post({id:'103'})+post({id:'104'});
 await mount(page,[original]);await move(page,'down');await move(page,'down');
 await activate(page);await expect(page).toHaveURL('https://x.com/fixture/status/103');
 await back(page);await expect(page).toHaveURL('https://x.com/home');
 await expect(page.locator('[data-fixture-id="103"]')).toHaveClass(/tv-focused/);
 await page.evaluate(html=>{
   const timeline=document.querySelector('#timeline');
   window.scrollTo(0,0);
   timeline.innerHTML='<div style="height:5000px">Virtual rows pending</div>';
   const restore=()=>{if(scrollY>1000){timeline.innerHTML=html;removeEventListener('scroll',restore);}};
   addEventListener('scroll',restore);
 },original);
 await expect(page.locator('[data-fixture-id="103"]')).toHaveClass(/tv-focused/);
 await expect.poll(()=>page.locator('[data-fixture-id="103"]').evaluate(n=>Math.round(n.getBoundingClientRect().top))).toBe(192);
});


test('composer arriving before posts cannot permanently hide their shared container', async ({page}) => {
 await mount(page,[]);
 await page.locator('#timeline').evaluate(node => node.innerHTML='<div id="composer-only"><div data-testid="tweetTextarea_0">What is happening?</div></div>');
 await expect(page.getByTestId('tweetTextarea_0')).toBeHidden();
 await page.locator('#timeline').evaluate((node,html)=>node.insertAdjacentHTML('beforeend',html),post());
 await expect(page.locator('article.tv-focused')).toBeVisible();
});


test('a late native viewport scroll retains the selected post after Back has settled', async ({page}) => {
 await mount(page,[post()+post({id:'102'})+post({id:'103'})+post({id:'104'})]);
 await move(page,'down');await move(page,'down');await activate(page);await back(page);
 await expect(page.locator('[data-fixture-id="103"]')).toHaveClass(/tv-focused/);
 await page.waitForTimeout(1800);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect.poll(()=>page.locator('[data-fixture-id="103"]').evaluate(n=>Math.round(n.getBoundingClientRect().top))).toBe(192);
});


test('detail uses the existing X router and document for remote OK and Back', async ({page}) => {
 await mount(page,[post()+post({id:'102'})]);await move(page,'down');
 const origin=await page.evaluate(()=>performance.timeOrigin);
 await activate(page);
 await expect(page).toHaveURL('https://x.com/fixture/status/102');
 await expect(page.locator('article.tv-detail-post')).toBeVisible();
 expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);
 await back(page);
 await expect(page).toHaveURL('https://x.com/home');
 await expect(page.locator('[data-fixture-id="102"]')).toHaveClass(/tv-focused/);
 expect(await page.evaluate(()=>performance.timeOrigin)).toBe(origin);
});
