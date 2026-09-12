import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const html=await readFile('app/src/main/assets/login-assist.html','utf8');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=','base64');
test('paired remote sends scaled clicks and clears text; revoked access removes the frame',async({page})=>{
    const inputs=[];let revoked=false;
    await page.route('https://assist.test/**',async route=>{
        const req=route.request(),path=new URL(req.url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:html});
        if(path==='/pair')return route.fulfill({contentType:'application/json',body:'{"token":"test-session"}'});
        expect(req.headers().authorization).toBe('Bearer test-session');
        if(revoked)return route.fulfill({status:410,body:''});
        if(path==='/frame')return route.fulfill({contentType:'image/png',body:pixel});
        if(path==='/input')inputs.push(req.postDataJSON());
        return route.fulfill({contentType:'application/json',body:'{}'});
    });
    await page.goto('https://assist.test/');await page.locator('#code').fill('12345678');
    await page.getByRole('button',{name:'连接投影仪'}).click();
    await expect(page.locator('#status')).toContainText('点击画面');
    const bounds=await page.locator('#screen').boundingBox();
    await page.locator('#screen').evaluate(img=>img.style.height='300px');
    const box=await page.locator('#screen').boundingBox();
    await page.mouse.click(box.x+box.width*.25,box.y+box.height*.25);
    await expect.poll(()=>inputs.length).toBe(1);expect(inputs[0].kind).toBe('tap');expect(inputs[0].x).toBeCloseTo(.25,2);expect(inputs[0].y).toBeCloseTo(.25,2);
    await page.locator('#text').fill('fixture input');await page.getByRole('button',{name:'发送文字'}).click();
    await expect.poll(()=>inputs.length).toBe(2);expect(inputs[1]).toEqual({kind:'text',text:'fixture input'});
    await expect(page.locator('#text')).toHaveValue('');
    expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);
    revoked=true;await expect(page.locator('#remote')).toBeHidden();
    await expect(page.locator('#screen')).not.toHaveAttribute('src');
});

test('failed text submission keeps the draft and error visible across frame refreshes', async ({ page }) => {
    let frames=0;
    await page.route('https://assist.test/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:html});
        if(path==='/pair')return route.fulfill({contentType:'application/json',body:'{"token":"test-session"}'});
        if(path==='/frame'){frames++;return route.fulfill({contentType:'image/png',body:pixel});}
        return route.fulfill({status:503,body:''});
    });
    await page.goto('https://assist.test/');await page.locator('#code').fill('12345678');
    await page.getByRole('button',{name:'连接投影仪'}).click();
    await expect(page.locator('#remote')).toBeVisible();
    await page.locator('#text').fill('tvx.input.check@example.com');
    await page.getByRole('button',{name:'发送文字'}).click();
    await expect(page.locator('#text')).toHaveValue('tvx.input.check@example.com');
    const before=frames;await expect.poll(()=>frames).toBeGreaterThan(before+1);
    await expect(page.getByRole('status').last()).toContainText('未确认');
});
