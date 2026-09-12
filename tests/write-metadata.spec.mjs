import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source = await readFile(new URL('../app/src/main/assets/tv-extension/sites/x/api-metadata.js',import.meta.url),'utf8');
function fixture({rotate=false}={}) {
    let listener, cookie='ct0=session-csrf', transactions=[];
    const definitions={};
    for(const name of ['FavoriteTweet','UnfavoriteTweet','CreateTweet','TweetResultByRestId','Likes','TweetDetail']) {
        definitions[name]={queryId:'current_query_123',operationName:name,
            metadata:{featureSwitches:['flag'],fieldToggles:['field']}};
    }
    const req=name=>name==='transaction'?{generate:async function(host,path,method) {
        // jf.x.com PATCH x-client-transaction-id: source markers used to locate the current implementation.
        transactions.push({host,path,method});
        if(rotate)cookie='ct0=rotated';
        return btoa('valid transaction identifier');
    }}:definitions[name];
    req.m={};
    for(const name of Object.keys(definitions)) req.m[name]=new Function('return {operationName:"'+name+'"}');
    req.m.transaction=function(){/* x-client-transaction-id jf.x.com PATCH */};
    const chunks=[];
    chunks.push=function(chunk){Array.prototype.push.call(this,chunk);chunk[2](req);};
    const window={wrappedJSObject:{webpackChunk_twitter_responsive_web:chunks}};window.top=window;
    const document={scripts:[{textContent:'window.__INITIAL_STATE__='+JSON.stringify({
        unrelated:'quoted } braces',featureSwitch:{defaultConfig:{flag:{value:false}},user:{config:{flag:{value:true}}},customOverrides:{}}
    })+';window.other=1'}]};
    Object.defineProperty(document,'cookie',{get:()=>cookie});
    runInNewContext(source,{window,document,location:{origin:'https://x.com'},crypto:{randomUUID:()=> 'fixture'},
        cloneInto:x=>x,atob,btoa,browser:{runtime:{onMessage:{addListener:fn=>listener=fn}}}});
    return {send:message=>listener(message),transactions,chunks};
}
test('metadata uses current definitions, current flags and distinct method/path signatures without sending a mutation',async()=>{
    const f=fixture();const result=await f.send({command:'apiPrepare',operation:'CreateTweet'});
    expect(result.error).toBeUndefined();
    expect(result.queries.CreateTweet.queryId).toBe('current_query_123');
    expect(result.queries.CreateTweet.features.flag).toBe(true);
    expect(result.queries.CreateTweet.fieldToggles.field).toBe(false);
    expect(f.transactions.map(t=>t.method)).toEqual(['POST','GET']);
    expect(f.transactions[0].path).toBe('/i/api/graphql/current_query_123/CreateTweet');
    expect(f.chunks).toHaveLength(0);
    expect(result).not.toHaveProperty('body');
    expect(result).not.toHaveProperty('authorization');
});
test('metadata rejects unsupported operations and a session rotating during preparation',async()=>{
    const f=fixture();expect(await f.send({command:'apiPrepare',operation:'DeleteTweet'})).toEqual({error:'invalid'});
    expect(f.transactions).toHaveLength(0);
    expect(f.send({command:'activate'})).toBeUndefined();
    const rotating=fixture({rotate:true});expect((await rotating.send({command:'apiPrepare',operation:'CreateTweet'})).error).toBe('not_ready');
});

test('a read operation is signed for GET and pulls in no companion query',async()=>{
    const f=fixture();const result=await f.send({command:'apiPrepare',operation:'Likes'});
    expect(result.error).toBeUndefined();
    expect(Object.keys(result.queries)).toEqual(['Likes']);
    expect(result.queries.Likes.queryId).toBe('current_query_123');
    expect(result.queries.Likes.features.flag).toBe(true);
    expect(f.transactions).toEqual([{host:'x.com',path:'/i/api/graphql/current_query_123/Likes',method:'GET'}]);
});

test('first-login detail metadata is available without visiting a post', async () => {
    const f=fixture();const result=await f.send({command:'apiPrepare',operation:'TweetDetail'});
    expect(Object.keys(result.queries)).toEqual(['TweetDetail']);
    expect(f.transactions).toEqual([{host:'x.com',path:'/i/api/graphql/current_query_123/TweetDetail',method:'GET'}]);
});
