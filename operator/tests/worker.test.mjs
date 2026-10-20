import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker,{tick} from '../src/worker.mjs';
import {example} from '../public/engine.mjs';
function d1(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const prepare=(text,args=[])=>({bind(...values){return prepare(text,values);},async first(){return sql.prepare(text).get(...args)||null;},async all(){return {results:sql.prepare(text).all(...args)};},async run(){return sql.prepare(text).run(...args);}});
  return {sql,prepare,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
const secret='test-only-secret-that-is-never-a-real-credential';
function env(){return {ADMIN_KEY:secret,DB:d1(),MASTODON_HOST:'planet.moe',ASSETS:{fetch:()=>new Response('practice')}};}
function request(path,method='GET',body,key=secret){return new Request('https://ops.example'+path,{method,headers:{Authorization:'Bearer '+key},body:body?JSON.stringify(body):undefined});}
async function seal(token){const iv=crypto.getRandomValues(new Uint8Array(12));const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));const key=await crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt']);const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(token)));return Buffer.from(iv).toString('base64')+'.'+Buffer.from(data).toString('base64');}
async function account(e){e.DB.sql.prepare('INSERT INTO accounts(id,label,acct,token,cursor) VALUES(?,?,?,?,?)').run('bot','총괄','bot@planet.moe',await seal('test-token'),'100');}
function config(e,rules){const c=JSON.parse(e.DB.sql.prepare('SELECT value FROM settings').get().value);c.paused=false;c.rules=rules;e.DB.sql.prepare('UPDATE settings SET value=?').run(JSON.stringify(c));}
test('API rejects unauthorized access and does not expose stored tokens',async()=>{
  const e=env();await account(e);
  assert.equal((await worker.fetch(request('/api/state','GET',null,'wrong'),e)).status,401);
  const response=await worker.fetch(request('/api/state'),e),body=await response.text();assert.equal(response.status,200);assert.ok(!body.includes('test-token'));assert.ok(!body.includes('token'));
  const backup=await(await worker.fetch(request('/api/export'),e)).text();assert.ok(!backup.includes('test-token'));
});
test('config revision prevents overwriting newer settings',async()=>{
  const e=env();const state=await(await worker.fetch(request('/api/state'),e)).json();
  assert.equal((await worker.fetch(request('/api/config','PUT',state.config),e)).status,200);
  assert.equal((await worker.fetch(request('/api/config','PUT',state.config),e)).status,409);
});
test('a saved dice verdict rule posts both the number and matching result through the bot queue',async()=>{
  const e=env();await account(e);
  e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run('runner','runner@planet.moe','루시아','{}');
  const state=await(await worker.fetch(request('/api/state'),e)).json();
  state.config.paused=false;state.config.rules=[{...example('dice','bot'),enabled:true}];
  assert.equal((await worker.fetch(request('/api/config','PUT',state.config),e)).status,200);
  const original=globalThis.fetch,posts=[];
  globalThis.fetch=async(url,opt)=>{
    if(url.includes('/notifications'))return Response.json([{id:'101',type:'mention',account:{id:'runner'},created_at:new Date().toISOString(),status:{id:'dice-command',content:'<p>@bot [주사위]</p>',visibility:'direct'}}]);
    posts.push(JSON.parse(opt.body));return Response.json({id:'posted-dice'});
  };
  try{
    await tick(e);
    assert.equal(posts.length,1);
    const match=posts[0].status.match(/루시아 · 1d100\n(\d+) \/ (어려운 성공|성공|실패|대실패)/);
    assert.ok(match);
    const value=Number(match[1]);assert.ok(value>=1&&value<=100);
    assert.equal(match[2],value<=25?'어려운 성공':value<=50?'성공':value<=75?'실패':'대실패');
    assert.equal(posts[0].visibility,'direct');
    assert.equal(posts[0].in_reply_to_id,'dice-command');
  }finally{globalThis.fetch=original;}
});
test('account OAuth completes with Workers-compatible fetch options and encrypted credentials',async()=>{
  const e=env(),original=globalThis.fetch,calls=[];
  const clientSecret='test-oauth-client-secret',accessToken='test-oauth-access-token';
  globalThis.fetch=async(url,opt)=>{
    // Workers rejects this mode before sending a request; Node's fetch accepts it.
    if(opt.redirect==='error')throw new TypeError('Unsupported redirect mode: error');
    assert.equal(opt.redirect,'manual');
    assert.equal(new URL(url).origin,'https://planet.moe');
    calls.push(new URL(url).pathname);
    if(url.endsWith('/api/v1/apps')){
      const body=JSON.parse(opt.body);
      assert.equal(body.redirect_uris,'https://ops.example/oauth/callback');
      assert.equal(body.scopes,'read:accounts read:notifications write:statuses');
      return Response.json({client_id:'test-client',client_secret:clientSecret});
    }
    if(url.endsWith('/oauth/token')){
      assert.equal(JSON.parse(opt.body).client_secret,clientSecret);
      return Response.json({access_token:accessToken});
    }
    assert.equal(opt.headers.Authorization,url.endsWith('/api/v2/instance')?undefined:'Bearer '+accessToken);
    if(url.endsWith('/verify_credentials'))return Response.json({id:'bot',username:'bot',acct:'bot',display_name:'총괄'});
    if(url.includes('/notifications'))return Response.json([{id:'100'}]);
    if(url.endsWith('/api/v2/instance'))return Response.json({configuration:{statuses:{max_characters:500}}});
    throw Error('Unexpected request');
  };
  try{
    const start=await worker.fetch(request('/api/oauth/start','POST'),e);
    assert.equal(start.status,200);
    const auth=new URL((await start.json()).url),state=auth.searchParams.get('state');
    assert.equal(auth.origin,'https://planet.moe');
    assert.equal(auth.pathname,'/oauth/authorize');
    assert.ok(state);
    assert.ok(!e.DB.sql.prepare('SELECT payload FROM oauth').get().payload.includes(clientSecret));
    const callback='/oauth/callback?'+new URLSearchParams({state,code:'test-code'});
    const connected=await worker.fetch(request(callback),e);
    assert.equal(connected.status,303);
    assert.equal(connected.headers.get('Location'),'https://ops.example/?connected=1#accounts');
    const saved=e.DB.sql.prepare('SELECT * FROM accounts').get();
    assert.equal(saved.acct,'bot@planet.moe');
    assert.equal(saved.cursor,'100');
    assert.ok(!saved.token.includes(accessToken));
    assert.equal(e.DB.sql.prepare('SELECT COUNT(*) AS n FROM oauth').get().n,0);
    assert.equal(calls.length,5);
    assert.equal((await worker.fetch(request(callback),e)).status,400);
    assert.equal(calls.length,5);
  }finally{globalThis.fetch=original;}
});
test('Mastodon redirects are rejected without forwarding OAuth credentials to another host',async()=>{
  const original=globalThis.fetch;
  try{
    for(const redirectAt of ['registration','token'])for(const status of [301,302,303,307,308]){
      const e=env(),calls=[];
      globalThis.fetch=async(url,opt)=>{
        assert.equal(opt.redirect,'manual');
        assert.equal(new URL(url).origin,'https://planet.moe');
        calls.push(url);
        if(redirectAt==='token'&&url.endsWith('/api/v1/apps'))return Response.json({client_id:'test-client',client_secret:'private-client-secret'});
        return new Response(null,{status,headers:{Location:'https://other.example/collect?secret=never-show-this'}});
      };
      let response=await worker.fetch(request('/api/oauth/start','POST'),e);
      if(redirectAt==='token'){
        assert.equal(response.status,200);
        const state=new URL((await response.json()).url).searchParams.get('state');
        response=await worker.fetch(request('/oauth/callback?'+new URLSearchParams({state,code:'private-code'})),e);
      }
      assert.equal(response.status,502);
      const body=await response.text();
      assert.match(body,/다른 주소/);
      assert.ok(!body.includes('never-show-this'));
      assert.ok(!body.includes('private-client-secret'));
      assert.equal(calls.length,redirectAt==='token'?2:1);
      assert.equal(e.DB.sql.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,0);
    }
  }finally{globalThis.fetch=original;}
});
test('repeated polling cannot award an item twice, and unregistered people are ignored',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run('runner','runner@planet.moe','러너','{"체력":50}');
  const rule={...example('check','bot'),enabled:true,keyword:'지급',blocks:[{type:'item',key:'열쇠',amount:1},{type:'reply',text:'열쇠 지급 완료'}]};config(e,[rule]);
  const original=globalThis.fetch,posts=[];
  globalThis.fetch=async(url,opt)=>{
    if(url.includes('/notifications'))return Response.json([{id:'101',type:'mention',account:{id:'runner'},created_at:new Date().toISOString(),status:{id:'s1',content:'<p>@bot 지급</p>',visibility:'public'}},{id:'102',type:'mention',account:{id:'stranger'},created_at:new Date().toISOString(),status:{id:'s2',content:'지급',visibility:'public'}}]);
    posts.push(JSON.parse(opt.body));return Response.json({id:'posted'});
  };
  try{await tick(e);await tick(e);const p=e.DB.sql.prepare('SELECT inventory FROM participants').get();assert.equal(JSON.parse(p.inventory).열쇠,1);assert.equal(posts.length,1);assert.equal(posts[0].visibility,'private');assert.equal(e.DB.sql.prepare('SELECT COUNT(*) AS n FROM audit').get().n,1);}finally{globalThis.fetch=original;}
});
test('failed item update never consumes inventory or acknowledges a partially applied job',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run('runner','runner@planet.moe','러너','{"체력":50}');
  const rule={...example('check','bot'),enabled:true,keyword:'실패',blocks:[{type:'stat',key:'체력',amount:10},{type:'item',key:'없는물건',amount:-1}]};config(e,[rule]);
  const original=globalThis.fetch;globalThis.fetch=async()=>Response.json([{id:'101',type:'mention',account:{id:'runner'},created_at:new Date().toISOString(),status:{id:'s1',content:'실패',visibility:'private'}}]);
  try{await tick(e);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT stats FROM participants').get().stats).체력,50);assert.equal(e.DB.sql.prepare('SELECT state FROM jobs').get().state,'error');}finally{globalThis.fetch=original;}
});
test('26 simultaneous runner commands are drained without missing or duplicating awards',async()=>{
  const e=env();await account(e);const notifications=[];
  for(let i=0;i<26;i++){const a='r'+i;e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run(a,a+'@planet.moe',a,'{}');notifications.push({id:String(101+i),type:'mention',account:{id:a},created_at:new Date().toISOString(),status:{id:'s'+i,content:'지급',visibility:'private'}});}
  config(e,[{...example('check','bot'),enabled:true,keyword:'지급',blocks:[{type:'item',key:'동전',amount:1},{type:'reply',text:'완료'}]}]);
  const original=globalThis.fetch,posted=[];globalThis.fetch=async(url,opt)=>{
    if(!url.includes('/notifications')){posted.push(opt.headers['Idempotency-Key']);return Response.json({id:'p'+posted.length});}
    const u=new URL(url),min=Number(u.searchParams.get('since_id')||0),max=Number(u.searchParams.get('max_id')||1e9);
    const candidates=notifications.filter(n=>Number(n.id)>min&&Number(n.id)<max).sort((a,b)=>Number(b.id)-Number(a.id)),page=candidates.slice(0,10);
    const next=new URL(u);if(page.length)next.searchParams.set('max_id',page.at(-1).id);
    return Response.json(page,{headers:candidates.length>10?{Link:'<'+next.href+'>; rel="next"'}:{}});
  };
  try{for(let i=0;i<20;i++)await tick(e);assert.equal(posted.length,26);assert.equal(new Set(posted).size,26);assert.equal(e.DB.sql.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='done'").get().n,26);for(const r of e.DB.sql.prepare('SELECT inventory FROM participants').all())assert.equal(JSON.parse(r.inventory).동전,1);}finally{globalThis.fetch=original;}
});
test('a failed story scene blocks later scenes and a paused app sends nothing',async()=>{
  const e=env();await account(e);config(e,[]);
  for(let i=0;i<2;i++)e.DB.sql.prepare('INSERT INTO outbox(id,account_id,body,due,group_id) VALUES(?,?,?,?,?)').run('g:000'+i,'bot',JSON.stringify({status:'scene'+i}),Date.now()-10000+i,'g');
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body).status);return new Response('{}',{status:503});};
  try{await tick(e);assert.deepEqual(posts,['scene0']);const c=JSON.parse(e.DB.sql.prepare('SELECT value FROM settings').get().value);c.paused=true;e.DB.sql.prepare('UPDATE settings SET value=?').run(JSON.stringify(c));await tick(e);assert.deepEqual(posts,['scene0']);}finally{globalThis.fetch=original;}
});
