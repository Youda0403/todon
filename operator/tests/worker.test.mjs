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
test('story lifecycle is independent of the bot switch and reports pause, resume and cancellation',async()=>{
  const e=env();await account(e);const original=globalThis.fetch,posts=[];
  globalThis.fetch=async(url,opt)=>url.includes('/notifications')?Response.json([]):(posts.push(JSON.parse(opt.body)),Response.json({id:'p'+posts.length}));
  try{
    const scheduled=await worker.fetch(request('/api/story','POST',{title:'공지',start:new Date(Date.now()+60000).toISOString(),scenes:[{accountId:'bot',delay:0,text:'공지 본문',visibility:'unlisted'}]}),e);
    assert.equal(scheduled.status,200);const {group}=await scheduled.json();
    await tick(e,{scheduled:true});assert.equal(posts.length,0);
    let state=await(await worker.fetch(request('/api/state'),e)).json();assert.ok(state.runtime.lastCron);assert.equal(state.config.paused,true);assert.equal(state.stories[0].pausable,1);
    assert.equal((await worker.fetch(request('/api/story/control','POST',{group,action:'pause'}),e)).status,200);
    assert.equal((await worker.fetch(request('/api/story/control','POST',{group,action:'pause'}),e)).status,400);
    state=await(await worker.fetch(request('/api/state'),e)).json();assert.equal(state.stories[0].held,1);assert.equal(state.stories[0].pausable,0);
    await worker.fetch(request('/api/story/control','POST',{group,action:'resume'}),e);
    assert.ok(e.DB.sql.prepare('SELECT due FROM outbox').get().due>Date.now()+50000);
    config(e,[]);e.DB.sql.prepare('UPDATE outbox SET due=?').run(Date.now()-1000);await tick(e);assert.equal(posts.length,1);await tick(e);assert.equal(posts.length,1);
    state=await(await worker.fetch(request('/api/state'),e)).json();assert.equal(state.stories[0].sent,1);assert.equal(state.stories[0].cancellable,0);
    const second=await(await worker.fetch(request('/api/story','POST',{title:'취소할 공지',start:new Date(Date.now()+60000).toISOString(),scenes:[{accountId:'bot',delay:0,text:'취소',visibility:'private'}]}),e)).json();
    await worker.fetch(request('/api/story/control','POST',{group:second.group,action:'cancel'}),e);state=await(await worker.fetch(request('/api/state'),e)).json();assert.equal(state.stories.find(s=>s.group_id===second.group).cancelled,1);
    e.DB.sql.prepare('UPDATE outbox SET due=?').run(Date.now()-1000);await tick(e);assert.equal(posts.length,1);
  }finally{globalThis.fetch=original;}
});
test('scheduled stories send even when mention polling is disabled for their account',async()=>{
  const e=env();await account(e);config(e,[]);
  e.DB.sql.prepare('INSERT INTO outbox(id,account_id,body,due,group_id) VALUES(?,?,?,?,?)').run('g:0000','bot','{"status":"공지"}',Date.now()-1000,'g');
  const original=globalThis.fetch,calls=[];globalThis.fetch=async(url)=>{calls.push(url.includes('/notifications')?'poll':'post');return Response.json(url.includes('/notifications')?[]:{id:'p'});};
  try{e.DB.sql.prepare('UPDATE accounts SET active=0').run();await tick(e);assert.deepEqual(calls,['post']);e.DB.sql.prepare('UPDATE accounts SET active=1').run();await tick(e);assert.deepEqual(calls,['post','poll']);}finally{globalThis.fetch=original;}
});
test('retry timing cannot reorder scenes and uncertain sends keep the idempotency key',async()=>{
  const e=env();await account(e);config(e,[]);
  for(let i=0;i<2;i++)e.DB.sql.prepare('INSERT INTO outbox(id,account_id,body,due,group_id) VALUES(?,?,?,?,?)').run('g:000'+i,'bot',JSON.stringify({status:'scene'+i}),Date.now()-10000+i,'g');
  const original=globalThis.fetch,calls=[];let fail=true;globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);calls.push({text:JSON.parse(opt.body).status,key:opt.headers['Idempotency-Key']});if(fail)throw Error('timeout');return Response.json({id:'p'});};
  try{await tick(e);await tick(e);assert.equal(calls.length,1);assert.equal((await worker.fetch(request('/api/story/control','POST',{group:'g',action:'pause'}),e)).status,200);assert.equal(e.DB.sql.prepare("SELECT state FROM outbox WHERE id='g:0000'").get().state,'pending');await worker.fetch(request('/api/story/control','POST',{group:'g',action:'resume'}),e);fail=false;e.DB.sql.prepare('UPDATE outbox SET due=?').run(Date.now()-1000);await tick(e);await tick(e);assert.deepEqual(calls.map(c=>c.text),['scene0','scene0','scene1']);assert.equal(calls[0].key,calls[1].key);}finally{globalThis.fetch=original;}
});
test('queue state keeps old pending items and complete group counts beyond the recent history window',async()=>{
  const e=env();await account(e);
  const put=e.DB.sql.prepare('INSERT INTO outbox(id,account_id,body,due,group_id,state) VALUES(?,?,?,?,?,?)');
  put.run('old:0000','bot','{}',1,'old','pending');for(let i=0;i<120;i++)put.run('done:'+i,'bot','{}',1000+i,'done','sent');
  const s=await(await worker.fetch(request('/api/state'),e)).json();assert.ok(s.outbox.find(o=>o.id==='old:0000'));assert.equal(s.stories.find(g=>g.group_id==='done').sent,120);
});
test('sending one announcement is immediate, private by default, idempotent and cannot drain other work',async()=>{
  const e=env();await account(e);await worker.fetch(request('/api/state'),e);
  e.DB.sql.prepare('INSERT INTO outbox(id,account_id,body,due,group_id) VALUES(?,?,?,?,?)').run('other:0000','bot','{"status":"other story"}',Date.now()-1000,'other');
  e.DB.sql.prepare('INSERT INTO outbox(id,account_id,body,due) VALUES(?,?,?,?)').run('reply','bot','{"status":"bot reply"}',Date.now()-1000);
  e.DB.sql.prepare('UPDATE accounts SET active=0').run();
  const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,opt)=>{calls.push({url,body:JSON.parse(opt.body)});return Response.json({id:'posted'});};
  try{
    const body={requestId:crypto.randomUUID(),accountId:'bot',text:'지금 보낼 공지'};
    let response=await worker.fetch(request('/api/announcement','POST',body),e);assert.equal(response.status,200);assert.equal((await response.json()).state,'sent');
    await worker.fetch(request('/api/announcement','POST',body),e);assert.equal(calls.length,1);assert.equal(calls[0].body.visibility,'private');assert.equal(calls[0].body.status,'지금 보낼 공지');
    assert.equal(e.DB.sql.prepare("SELECT state FROM outbox WHERE id='other:0000'").get().state,'pending');assert.equal(e.DB.sql.prepare("SELECT state FROM outbox WHERE id='reply'").get().state,'pending');assert.equal(JSON.parse(e.DB.sql.prepare('SELECT value FROM settings').get().value).paused,true);
  }finally{globalThis.fetch=original;}
});
test('a scheduled announcement waits for its explicit time, and checking a group never sends other groups',async()=>{
  const e=env();await account(e);const original=globalThis.fetch,posts=[];globalThis.fetch=async(_url,opt)=>{posts.push(JSON.parse(opt.body));return Response.json({id:'p'});};
  try{const body={requestId:crypto.randomUUID(),accountId:'bot',text:'나중 공지',at:new Date(Date.now()+3600000).toISOString()};const {group}=await(await worker.fetch(request('/api/announcement','POST',body),e)).json();assert.equal(posts.length,0);
    await worker.fetch(request('/api/group/check','POST',{group}),e);assert.equal(posts.length,0);
    e.DB.sql.prepare('UPDATE outbox SET due=?').run(Date.now()-1000);await worker.fetch(request('/api/tick','POST'),e);assert.equal(posts.length,0);
    await worker.fetch(request('/api/group/check','POST',{group}),e);assert.equal(posts.length,1);
  }finally{globalThis.fetch=original;}
});
test('migration retains stopped legacy schedules; enabling bots does not resume them',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO outbox(id,account_id,body,due,group_id) VALUES(?,?,?,?,?)').run('old:0000','bot','{"status":"old"}',Date.now()-1000,'old');
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>url.includes('/notifications')?Response.json([]):(posts.push(opt.body),Response.json({id:'p'}));
  try{let s=await(await worker.fetch(request('/api/state'),e)).json();assert.equal(s.outbox[0].state,'held');assert.equal(s.config.executionVersion,2);assert.equal((await worker.fetch(request('/api/bots/control','POST',{paused:false}),e)).status,200);await tick(e);assert.equal(posts.length,0);assert.equal(e.DB.sql.prepare('SELECT state FROM outbox').get().state,'held');}finally{globalThis.fetch=original;}
});
test('recipe awards and deductions are atomic and a repeated mention cannot craft twice',async()=>{
  const e=env();await account(e);const r={...example('craft','bot'),enabled:true,cooldown:0};config(e,[r]);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,inventory,stats) VALUES(?,?,?,?,?)').run('runner','runner@planet.moe','러너','{"약초":4,"물":2}','{}');
  const original=globalThis.fetch;globalThis.fetch=async url=>url.includes('/notifications')?Response.json([{id:'101',type:'mention',account:{id:'runner'},created_at:new Date().toISOString(),status:{id:'recipe-command',content:'[회복약 제작]',visibility:'private'}}]):Response.json({id:'p'});
  try{await tick(e);await tick(e);const inv=JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants').get().inventory);assert.equal(inv.회복약,1);assert.equal(inv.약초,2);assert.equal(inv.물,1);assert.equal(e.DB.sql.prepare('SELECT COUNT(*) AS n FROM audit').get().n,1);}finally{globalThis.fetch=original;}
});

test('investigations persist separately per runner; ordinary commands and waiting preserve progress and start-only limits',async()=>{
  const e=env();await account(e);
  for(const runner of ['a','b'])e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run(runner,runner+'@planet.moe',runner,'{"체력":50}');
  const r={...example('dialogue','bot'),enabled:true,dailyLimit:1,cooldown:86400},check={...example('check','bot'),enabled:true,cooldown:0};
  config(e,[r,check]);let sequence=0;const original=globalThis.fetch,posts=[];
  const step=async(actor,text)=>{const n=++sequence;e.DB.sql.prepare('INSERT INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)').run('dialog-job-'+n,'bot',actor,JSON.stringify({text:'<p>@bot '+text+'</p>',statusId:'status-'+n,visibility:'public'}),Date.now()+n);await tick({...e});};
  const session=actor=>JSON.parse(e.DB.sql.prepare('SELECT value FROM runtime WHERE key=?').get('dialog:bot:'+actor).value);
  globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body));return Response.json({id:'posted-'+posts.length});};
  try{
    await step('a',r.keyword);await step('b',r.keyword);
    await step('a','벌집');assert.equal(session('a').sceneId,'start');
    await step('a','숲으로 가겠습니다.');await step('b','3번');
    assert.equal(session('a').sceneId,'forest');assert.equal(session('b').sceneId,'sea');
    await step('a','확인');assert.equal(session('a').sceneId,'forest');assert.match(posts.at(-1).status,/가방/);
    await step('a',r.keyword);assert.equal(session('a').status,'active');assert.equal(session('a').sceneId,'forest');
    await step('a','2');
    assert.equal(session('a').status,'ended');assert.equal(session('a').sceneId,'grass');
    assert.equal(JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants WHERE id=?').get('a').inventory).약초,1);
    const usage=e.DB.sql.prepare('SELECT count FROM usage WHERE rule_id=? AND actor_id=?').get(r.id,'a');assert.equal(usage.count,1);
    await step('a','풀숲');await step('a',r.keyword);
    assert.equal(session('a').sceneId,'grass');assert.match(posts.at(-1).status,/시작할 수 있는 조사 횟수/);
    assert.equal(JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants WHERE id=?').get('a').inventory).약초,1);
    assert.ok(posts.every(p=>p.visibility==='private'));
    const state=await(await worker.fetch(request('/api/state'),e)).json();assert.equal(JSON.parse(state.runtime['dialog:bot:a']).sceneId,'grass');
    const before=posts.length;await tick(e);assert.equal(posts.length,before);
  }finally{globalThis.fetch=original;}
});
test('scene progress, rewards, job completion and replies commit atomically',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run('runner','runner@planet.moe','러너','{}');
  const r={...example('dialogue','bot'),enabled:true};config(e,[r]);
  e.DB.sql.prepare('INSERT INTO runtime(key,value) VALUES(?,?)').run('dialog:bot:runner',JSON.stringify({ruleId:r.id,sceneId:'forest',status:'active',visited:['start','forest']}));
  e.DB.sql.prepare('INSERT INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)').run('atomic-dialog','bot','runner',JSON.stringify({text:'풀숲',statusId:'command',visibility:'private'}),Date.now());
  e.DB.sql.exec("CREATE TRIGGER fail_dialog BEFORE INSERT ON runtime WHEN NEW.key='dialog:bot:runner' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body));return Response.json({id:'posted'});};
  try{
    await tick(e);assert.equal(posts.length,0);
    assert.equal(JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants').get().inventory).약초,undefined);
    assert.equal(JSON.parse(e.DB.sql.prepare("SELECT value FROM runtime WHERE key='dialog:bot:runner'").get().value).sceneId,'forest');
    assert.equal(e.DB.sql.prepare('SELECT state FROM jobs').get().state,'error');assert.equal(e.DB.sql.prepare('SELECT COUNT(*) AS n FROM audit').get().n,0);
    e.DB.sql.exec("DROP TRIGGER fail_dialog; UPDATE jobs SET state='pending'");
    await tick(e);await tick(e);
    assert.equal(JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants').get().inventory).약초,1);
    assert.equal(posts.length,1);assert.equal(e.DB.sql.prepare('SELECT COUNT(*) AS n FROM audit').get().n,1);
  }finally{globalThis.fetch=original;}
});
test('26 runner investigations drain within the query budget and keep exactly one reward per run',async()=>{
  const e=env();await account(e);const r={...example('dialogue','bot'),enabled:true};config(e,[r]);
  for(let i=0;i<26;i++){
    const who='runner-'+i;e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run(who,who+'@planet.moe',who,'{}');
    e.DB.sql.prepare('INSERT INTO runtime(key,value) VALUES(?,?)').run('dialog:bot:'+who,JSON.stringify({ruleId:r.id,sceneId:'forest',status:'active',visited:['start','forest']}));
    for(let j=0;j<2;j++)e.DB.sql.prepare('INSERT INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)').run(`choice-${i}-${j}`,'bot',who,JSON.stringify({text:'풀숲',statusId:`status-${i}-${j}`,visibility:'private'}),Date.now()+i*2+j);
  }
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body));return Response.json({id:'post-'+posts.length});};
  try{
    for(let i=0;i<45;i++)await tick(e);
    assert.equal(e.DB.sql.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='pending' OR state='error'").get().n,0);
    for(const row of e.DB.sql.prepare('SELECT inventory FROM participants').all())assert.equal(JSON.parse(row.inventory).약초,1);
    assert.equal(posts.length,26);assert.equal(e.DB.sql.prepare('SELECT COUNT(*) AS n FROM audit').get().n,26);
    assert.equal(e.DB.sql.prepare("SELECT value FROM runtime WHERE key='tickError'").get().value,'');
  }finally{globalThis.fetch=original;}
});


test('catalog items save through the API, are usable during an investigation, and cannot consume twice',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats,inventory) VALUES(?,?,?,?,?)').run('runner','runner@planet.moe','러너','{}','{"회복약":1}');
  const initial=await(await worker.fetch(request('/api/state'),e)).json();const r={...example('dialogue','bot'),enabled:true};
  initial.config.paused=false;initial.config.fields={HP:100};initial.config.rules=[r];initial.config.items=[{id:'potion',name:'회복약',description:'회복',usable:true,consume:true,keyword:'[회복약 사용]',text:'회복 후 HP {HP}',effects:[{type:'stat',key:'HP',amount:10}]}];
  assert.equal((await worker.fetch(request('/api/config','PUT',initial.config),e)).status,200);
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body));return Response.json({id:'posted-'+posts.length});};
  const job=async(id,text)=>{e.DB.sql.prepare('INSERT INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)').run(id,'bot','runner',JSON.stringify({text,statusId:id,visibility:'private'}),Date.now());await tick(e);};
  try{
    await job('start',r.keyword);await job('use','[회복약 사용]');await tick(e);
    assert.equal(JSON.parse(e.DB.sql.prepare('SELECT stats FROM participants').get().stats).HP,110);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants').get().inventory).회복약,0);
    assert.equal(JSON.parse(e.DB.sql.prepare("SELECT value FROM runtime WHERE key='dialog:bot:runner'").get().value).sceneId,'start');
    assert.match(posts.at(-1).status,/회복 후 HP 110/);const count=posts.length;await tick(e);assert.equal(posts.length,count);
    await job('use-again','[회복약 사용]');assert.match(posts.at(-1).status,/부족/);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT stats FROM participants').get().stats).HP,110);
  }finally{globalThis.fetch=original;}
});
test('the Worker rejects hidden choice keywords and reveals them after an operator changes inventory',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run('runner','runner@planet.moe','러너','{}');
  const r={...example('dialogue','bot'),enabled:true};r.dialogue.scenes[0].choices[0].conditions=[{target:'item',key:'열쇠',op:'>=',amount:1}];config(e,[r]);
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body));return Response.json({id:'posted-'+posts.length});};
  const job=async(id,text)=>{e.DB.sql.prepare('INSERT INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)').run(id,'bot','runner',JSON.stringify({text,statusId:id,visibility:'private'}),Date.now());await tick(e);};
  try{
    await job('start',r.keyword);assert.ok(!posts.at(-1).status.includes('1. 숲'));assert.match(posts.at(-1).status,/1\. 동굴/);
    await job('cheat','숲');assert.equal(JSON.parse(e.DB.sql.prepare("SELECT value FROM runtime WHERE key='dialog:bot:runner'").get().value).sceneId,'start');
    e.DB.sql.prepare('UPDATE participants SET inventory=?').run('{"열쇠":1}');await job('valid','숲');assert.equal(JSON.parse(e.DB.sql.prepare("SELECT value FROM runtime WHERE key='dialog:bot:runner'").get().value).sceneId,'forest');
  }finally{globalThis.fetch=original;}
});

test('passive stats and caps are consistent across bot commands, state views and operator edits',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats,inventory) VALUES(?,?,?,?,?)').run('runner','runner@planet.moe','러너','{"HP":90,"힘":5}','{"부적":1,"회복약":1}');
  const initial=await(await worker.fetch(request('/api/state'),e)).json();initial.config.paused=false;initial.config.fields={HP:100,힘:5};initial.config.statMaxes={HP:100,힘:10};initial.config.rules=[{...example('check','bot'),enabled:true,cooldown:0}];
  initial.config.items=[{id:'charm',name:'부적',description:'',usable:false,text:'',keyword:'',effects:[],passive:true,passiveStack:'once',passiveEffects:[{key:'힘',target:'stat',amount:2}]},{id:'heal',name:'회복약',description:'',usable:true,consume:true,text:'HP {HP} / 힘 {힘}',keyword:'[회복약]',effects:[{type:'stat',key:'HP',amount:30}]}];
  assert.equal((await worker.fetch(request('/api/config','PUT',initial.config),e)).status,200);
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body));return Response.json({id:'post-'+posts.length});};
  const job=async(id,text)=>{e.DB.sql.prepare('INSERT INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)').run(id,'bot','runner',JSON.stringify({text,statusId:id,visibility:'private'}),Date.now());await tick(e);};
  try{
    await job('check1','확인');await job('check2','확인');assert.match(posts.at(-1).status,/힘: 7/);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT stats FROM participants').get().stats).힘,5);
    await job('heal','[회복약]');assert.match(posts.at(-1).status,/HP 100 \/ 힘 7/);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT stats FROM participants').get().stats).HP,100);
    const state=await(await worker.fetch(request('/api/state'),e)).json(),p=state.participants[0];assert.equal(p.stats.힘,7);assert.equal(p.baseStats.힘,5);assert.equal(p.statMaxes.HP,100);
    assert.equal((await worker.fetch(request('/api/participant','PUT',{...p,stats:{HP:999,힘:5},inventory:{부적:0}}),e)).status,200);
    const after=await(await worker.fetch(request('/api/state'),e)).json();assert.equal(after.participants[0].stats.힘,5);assert.equal(after.participants[0].stats.HP,100);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT stats FROM participants').get().stats).HP,100);
  }finally{globalThis.fetch=original;}
});
test('a short alias advances its displayed choice through the server while hidden aliases remain unavailable',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats) VALUES(?,?,?,?)').run('runner','runner@planet.moe','러너','{}');
  const r={...example('dialogue','bot'),enabled:true};r.dialogue.scenes[0].choices[0]={keyword:'칼로 벗긴다',keywords:['칼','벗기기'],next:'forest',conditions:[]};config(e,[r]);
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body));return Response.json({id:'post-'+posts.length});};
  const job=async(id,text)=>{e.DB.sql.prepare('INSERT INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)').run(id,'bot','runner',JSON.stringify({text,statusId:id,visibility:'private'}),Date.now());await tick(e);};
  try{await job('start',r.keyword);assert.match(posts.at(-1).status,/1\. 칼로 벗긴다/);await job('choose','칼');assert.equal(JSON.parse(e.DB.sql.prepare("SELECT value FROM runtime WHERE key='dialog:bot:runner'").get().value).sceneId,'forest');}finally{globalThis.fetch=original;}
});
test('registered recipes save and execute atomically through automatic commands, and descriptions can be read from the bag',async()=>{
  const e=env();await account(e);e.DB.sql.prepare('INSERT INTO participants(id,acct,name,stats,inventory) VALUES(?,?,?,?,?)').run('runner','runner@planet.moe','러너','{"힘":2}','{"돌":1,"마른 풀":1}');
  const initial=await(await worker.fetch(request('/api/state'),e)).json();initial.config.paused=false;initial.config.fields={힘:2};initial.config.rules=[];
  initial.config.items=['돌','마른 풀','불씨'].map((name,n)=>({id:'resource-'+n,name,description:name+' 설명',usable:false,text:'',effects:[]}));
  initial.config.recipes=[{id:'fire',name:'불 피우기',callable:true,keyword:'[불 피우기]',ingredients:[{key:'돌',amount:1,consume:false},{key:'마른 풀',amount:1,consume:true}],conditions:[{target:'stat',key:'힘',op:'>=',amount:3}],chance:100,consumeOnFail:true,effects:[{type:'item',key:'불씨',amount:1}],successText:'불을 피웠습니다.',failureText:'실패했습니다.'}];
  assert.equal((await worker.fetch(request('/api/config','PUT',initial.config),e)).status,200);
  const original=globalThis.fetch,posts=[];globalThis.fetch=async(url,opt)=>{if(url.includes('/notifications'))return Response.json([]);posts.push(JSON.parse(opt.body));return Response.json({id:'post-'+posts.length});};
  const job=async(id,text)=>{e.DB.sql.prepare('INSERT INTO jobs(id,account_id,actor_id,payload,created) VALUES(?,?,?,?,?)').run(id,'bot','runner',JSON.stringify({text,statusId:id,visibility:'private'}),Date.now());await tick(e);};
  try{
    await job('low-stat','[불 피우기]');assert.match(posts.at(-1).status,/힘: 2/);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants').get().inventory)['마른 풀'],1);
    e.DB.sql.prepare('UPDATE participants SET stats=?').run('{"힘":3}');await job('craft','[불 피우기]');const inv=JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants').get().inventory);assert.equal(inv.돌,1);assert.equal(inv['마른 풀'],0);assert.equal(inv.불씨,1);assert.match(posts.at(-1).status,/불씨 설명/);assert.equal(posts.at(-1).visibility,'private');
    const count=posts.length;await tick(e);assert.equal(posts.length,count);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants').get().inventory).불씨,1);
    await job('inspect','[설명 불씨]');assert.match(posts.at(-1).status,/불씨 설명/);await job('again','[불 피우기]');assert.match(posts.at(-1).status,/조건이 부족/);assert.equal(JSON.parse(e.DB.sql.prepare('SELECT inventory FROM participants').get().inventory).불씨,1);
  }finally{globalThis.fetch=original;}
});
test('saving invalid recipes or removing a referenced recipe is rejected without overwriting settings',async()=>{
  const e=env(),initial=await(await worker.fetch(request('/api/state'),e)).json();initial.config.recipes=[{id:'bad',name:'잘못된 레시피',callable:true,keyword:'[조합]',ingredients:[],conditions:[],chance:100,consumeOnFail:false,effects:[],successText:'성공',failureText:'실패'}];
  assert.equal((await worker.fetch(request('/api/config','PUT',initial.config),e)).status,400);
  initial.config.recipes=[];initial.config.rules=[{...example('check'),blocks:[{type:'runRecipe',recipeId:'deleted'}]}];assert.equal((await worker.fetch(request('/api/config','PUT',initial.config),e)).status,400);
  const current=await(await worker.fetch(request('/api/state'),e)).json();assert.equal(current.config.revision,initial.config.revision);assert.ok(!current.config.rules.some(r=>r.blocks?.some(b=>b.type==='runRecipe')));
});
