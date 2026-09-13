import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const html=await readFile('app/src/main/assets/login-assist.html','utf8');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=','base64');

test('QR invitation pairs automatically and the phone keyboard edits the TV focus in order',async({page})=>{
    const inputs=[],pairs=[];let revoked=false;
    await page.route('https://assist.test/**',async route=>{
        const req=route.request(),path=new URL(req.url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:html});
        if(path==='/pair'){pairs.push(req.postDataJSON());return route.fulfill({contentType:'application/json',body:'{"token":"test-session"}'});}
        expect(req.headers().authorization).toBe('Bearer test-session');
        if(revoked)return route.fulfill({status:410,body:''});
        if(path==='/frame')return route.fulfill({contentType:'image/png',body:pixel});
        if(path==='/input')inputs.push(req.postDataJSON());
        return route.fulfill({contentType:'application/json',body:'{}'});
    });

    await page.goto('https://assist.test/#code=12345678');
    await expect(page.locator('#remote')).toBeVisible();
    expect(pairs).toEqual([{code:'12345678'}]);
    expect(new URL(page.url()).hash).toBe('');
    await expect(page.locator('#pair')).toBeHidden();

    await page.locator('#screen').evaluate(img=>img.style.height='300px');
    const box=await page.locator('#screen').boundingBox();
    await page.mouse.click(box.x+box.width*.25,box.y+box.height*.25);
    await expect(page.locator('#text')).toBeFocused();
    await expect.poll(()=>inputs.length).toBe(1);
    expect(inputs[0].kind).toBe('tap');
    expect(inputs[0].x).toBeCloseTo(.25,2);
    expect(inputs[0].y).toBeCloseTo(.25,2);

    await page.locator('#text').fill('fixture input');
    await expect.poll(()=>inputs.length).toBe(2);
    expect(inputs[1]).toEqual({kind:'edit',delete:0,text:'fixture input'});
    await page.locator('#text').press('Backspace');
    await expect.poll(()=>inputs.length).toBe(3);
    expect(inputs[2]).toEqual({kind:'edit',delete:1,text:''});
    await page.locator('#text').press('Enter');
    await expect.poll(()=>inputs.length).toBe(4);
    expect(inputs[3]).toEqual({kind:'key',key:'Enter'});
    await expect(page.locator('#text')).toHaveValue('');
    await expect(page.locator('#text')).toBeFocused();
    expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);

    revoked=true;
    await expect(page.locator('#remote')).toBeHidden();
    await expect(page.locator('#screen')).not.toHaveAttribute('src');
});

test('IME composition sends only the chosen text instead of intermediate candidates',async({page})=>{
    const inputs=[];
    await page.route('https://assist.test/**',async route=>{
        const req=route.request(),path=new URL(req.url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:html});
        if(path==='/pair')return route.fulfill({contentType:'application/json',body:'{"token":"test-session"}'});
        if(path==='/frame')return route.fulfill({contentType:'image/png',body:pixel});
        if(path==='/input')inputs.push(req.postDataJSON());
        return route.fulfill({contentType:'application/json',body:'{}'});
    });
    await page.goto('https://assist.test/#code=12345678');
    await expect(page.locator('#remote')).toBeVisible();
    await page.locator('#text').evaluate(input=>{
        input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
        input.value='zh';
        input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'zh',inputType:'insertCompositionText',isComposing:true}));
        input.value='中文';
        input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'中文',inputType:'insertCompositionText',isComposing:true}));
        input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'}));
    });
    await expect.poll(()=>inputs.length).toBe(1);
    expect(inputs).toEqual([{kind:'edit',delete:0,text:'中文'}]);
});

test('failed live sync keeps the draft and error visible across frame refreshes',async({page})=>{
    let frames=0;
    await page.route('https://assist.test/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:html});
        if(path==='/pair')return route.fulfill({contentType:'application/json',body:'{"token":"test-session"}'});
        if(path==='/frame'){frames++;return route.fulfill({contentType:'image/png',body:pixel});}
        return route.fulfill({status:503,body:''});
    });
    await page.goto('https://assist.test/#code=12345678');
    await expect(page.locator('#remote')).toBeVisible();
    await page.locator('#text').fill('tvx.input.check@example.com');
    await expect(page.locator('#text')).toHaveValue('tvx.input.check@example.com');
    await expect(page.locator('#action-status')).toContainText('同步中断');
    const before=frames;
    await expect.poll(()=>frames).toBeGreaterThan(before+1);
    await expect(page.locator('#action-status')).toContainText('同步中断');
});

test('manual code entry remains available when there is no QR invitation',async({page})=>{
    let paired;
    await page.route('https://assist.test/**',async route=>{
        const req=route.request(),path=new URL(req.url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:html});
        if(path==='/pair'){paired=req.postDataJSON();return route.fulfill({contentType:'application/json',body:'{"token":"test-session"}'});}
        if(path==='/frame')return route.fulfill({contentType:'image/png',body:pixel});
        return route.fulfill({contentType:'application/json',body:'{}'});
    });
    await page.goto('https://assist.test/');
    await expect(page.locator('#pair')).toBeVisible();
    await page.locator('#code').fill('87654321');
    await page.getByRole('button',{name:'连接投影仪'}).click();
    await expect(page.locator('#remote')).toBeVisible();
    expect(paired).toEqual({code:'87654321'});
});
