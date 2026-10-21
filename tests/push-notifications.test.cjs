const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const {webcrypto, createHash} = require('node:crypto');
const worker = fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const replyCode = /function isReply\(n\)\{[^\n]+\}/.exec(html)[0];
const displayCode = html.slice(html.indexOf('function notificationDisplayType('),html.indexOf('function exactNotificationId(',html.indexOf('function notificationDisplayType(')));
const token = 'fixture-token', hint = createHash('sha256').update(token).digest('hex').slice(0,12);
const account = {id:'1',instance:'server.test',hint};
const notice = (fields={}) => ({id:'42',type:'mention',account:{username:'other',display_name:'상대'},status:{id:'100',content:'<p>@me 답글 본문</p>',visibility:'public',in_reply_to_id:'99',in_reply_to_account_id:'1',...fields}});
const response = (status,n) => ({ok:status>=200&&status<300,status,json:async()=>n});
function fixture({metadata=[account],fetchNotification=async()=>response(200,notice()),fast=false,visible=false,cryptoError=false}={}){
  const events=new Map(),shown=[],calls=[],delays=[],messages=[],storage=new Map();let cleared=0;
  const crypto=cryptoError?{subtle:{digest:async()=>{throw new Error('unavailable');}}}:webcrypto;
  const self={crypto,addEventListener:(name,fn)=>events.set(name,fn),
    clients:{matchAll:async()=>visible?[{url:'https://app.test/todon/',visibilityState:'visible',postMessage:m=>messages.push(m)}]:[]},
    registration:{scope:'https://app.test/todon/',showNotification:async(title,options)=>shown.push({title,...options})}};
  const context=vm.createContext({self,crypto,TextEncoder,Uint8Array,AbortController,URL,Response,
    caches:{open:async()=>({match:async key=>key==='./ytt-accounts.json'?{json:async()=>metadata}:storage.has(key)?new Response(storage.get(key)):undefined,put:async(key,value)=>storage.set(key,await value.text())})},
    setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,fast?5:ms);},clearTimeout:id=>{cleared++;clearTimeout(id);},
    fetch:async(url,options)=>{calls.push({url,options});return fetchNotification(url,options);}});
  vm.runInContext(worker,context);
  return {context,events,shown,calls,delays,messages,storage,get cleared(){return cleared;},
    push:async(fields={})=>{let promise;events.get('push')({data:{json:()=>({access_token:token,notification_id:'42',notification_type:'mention',title:'상대 님의 멘션',body:'답글 본문',...fields})},waitUntil:p=>promise=p});await promise;}};
}
const untilAbort = signal => new Promise((resolve,reject)=>{
  const stop=()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}));
  if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
});
test('system replies use the reply badge even when one parent field is absent',async()=>{
  for(const fields of [{},{in_reply_to_id:null},{in_reply_to_account_id:null},{in_reply_to_account_id:'2'}]){
    const f=fixture({fetchNotification:async()=>response(200,notice(fields))});await f.push();
    assert.equal(f.shown.length,1);assert.equal(f.shown[0].badge,'badge-reply.png');assert.match(f.shown[0].title,/답글$/);
    assert.equal(f.shown[0].body,'답글 본문');assert.equal(f.shown[0].data.hint,hint);
    assert.equal(f.calls[0].options.headers.Authorization,'Bearer '+token);assert.equal(f.cleared,1);
  }
});
test('the app and worker agree on reply classification without guessing from body mentions',()=>{
  const f=fixture(),app=vm.createContext({});vm.runInContext(replyCode,app);
  const cases=[notice(),notice({in_reply_to_id:null}),notice({in_reply_to_account_id:null}),notice({in_reply_to_account_id:'2'}),notice({in_reply_to_id:null,in_reply_to_account_id:null}),{...notice(),type:'favourite'},{type:'mention',status:null}];
  for(const n of cases){f.context.n=n;app.n=n;assert.equal(vm.runInContext('isReply(n)',app),vm.runInContext('isReply(n)',f.context));}
  app.n=cases[0];assert.equal(vm.runInContext('isReply(n)',app),true);app.n=cases[4];assert.equal(vm.runInContext('isReply(n)',app),false);
});
test('confirmed standalone mentions retain @ and direct replies retain the private-message badge',async()=>{
  for(const [fields,badge,title] of [[{in_reply_to_id:null,in_reply_to_account_id:null},'badge-mention.png',/멘션$/],[{visibility:'direct'},'badge-dm.png',/쪽지$/]]){
    const f=fixture({fetchNotification:async()=>response(200,notice(fields))});await f.push();assert.equal(f.shown[0].badge,badge);assert.match(f.shown[0].title,title);
  }
});
test('temporary server and network errors get one retry within the same deadline',async()=>{
  for(const first of [()=>response(503,{}),()=>{throw new Error('network');}]){
    let attempts=0;const f=fixture({fetchNotification:async()=>++attempts===1?first():response(200,notice())});await f.push();
    assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.signal,f.calls[1].options.signal);
    assert.deepEqual(f.delays,[10000]);assert.equal(f.shown[0].badge,'badge-reply.png');
  }
});
test('auth, missing and rate-limit errors deliver a neutral notification without retries or a false @',async()=>{
  for(const status of [401,403,404,410,429]){
    const f=fixture({fetchNotification:async()=>response(status,{})});await f.push();
    assert.equal(f.calls.length,1);assert.equal(f.shown[0].badge,'badge-default.png');assert.equal(f.shown[0].title,'새 알림');assert.equal(f.shown[0].body,'앱을 열어 알림을 확인해 주세요.');
    assert.equal(f.shown[0].data.id,'42');assert.equal(f.cleared,1);
  }
});
test('slow headers and slow bodies stop at ten seconds and still deliver the push',async()=>{
  for(const fetchNotification of [async(url,opts)=>untilAbort(opts.signal),async(url,opts)=>({...response(200,{}),json:()=>untilAbort(opts.signal)})]){
    const f=fixture({fetchNotification,fast:true});await f.push();
    assert.deepEqual(f.delays,[10000]);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal.aborted,true);
    assert.equal(f.shown[0].badge,'badge-default.png');assert.equal(f.cleared,1);
  }
});
test('missing account metadata or a failed token fingerprint never sends a token to another account server',async()=>{
  for(const options of [{metadata:[]},{metadata:null},{metadata:{}},{metadata:[null]},{metadata:[{...account,hint:'different',instance:'other.test'}]},{cryptoError:true}]){
    const f=fixture(options);await f.push();assert.equal(f.calls.length,0);assert.equal(f.shown.length,1);assert.equal(f.shown[0].badge,'badge-default.png');
  }
});
test('invalid or mismatched notification details cannot turn the fallback into a false @',async()=>{
  for(const n of [null,{...notice(),id:'43'},{...notice(),status:null},{...notice(),type:'__proto__'}]){
    const f=fixture({fetchNotification:async()=>response(200,n)});await f.push();assert.equal(f.shown[0].badge,'badge-default.png');
  }
});
test('a visible app receives the push signal without an extra system popup or detail request',async()=>{
  const f=fixture({visible:true});await f.push();assert.equal(f.calls.length,0);assert.equal(f.shown.length,0);assert.equal(f.messages[0].type,'push');
});
test('unverified raw types and titles cannot label a fallback as a new post or another specific event',async()=>{
  for(const type of ['mention','status','favourite','reblog','follow','quote']){
    const f=fixture({metadata:[]});await f.push({notification_type:type,title:'상대 · 새 글',body:'unverified post body'});assert.equal(f.shown[0].badge,'badge-default.png');assert.equal(f.shown[0].title,'새 알림');assert.doesNotMatch(f.shown[0].body,/unverified|새 글/);
  }
});


test('notification preview and click target come from the same verified response',async()=>{
 const f=fixture();await f.push();const shown=f.shown[0];
 assert.equal(shown.data.routeVersion,4);assert.equal(shown.data.target.kind,'thread');assert.equal(shown.data.target.id,'100');assert.equal(shown.body,'답글 본문');
 assert.equal(shown.data.workerVersion,'2026-10-21.1');assert.ok(shown.tag.includes(hint));assert.doesNotMatch(JSON.stringify(shown.data),/fixture-token|content|본문/);
});
test('failed detail lookup never attaches an unverified status to the fallback preview',async()=>{
 const f=fixture({fetchNotification:async()=>response(503,{})});await f.push();assert.equal(f.shown[0].data.target.kind,'notification');assert.equal(f.shown[0].data.target.id,'42');assert.notEqual(f.shown[0].data.target.id,'100');
});
test('two accounts with an equal notification ID cannot replace each other through one notification tag',async()=>{
 const f=fixture({metadata:[]});await f.push();await f.push({access_token:'another-private-token'});
 assert.notEqual(f.shown[0].tag,f.shown[1].tag);assert.equal(f.shown[0].data.id,f.shown[1].data.id);
});
test('a boost wrapper previews and targets the original status together',async()=>{
 const n=notice();n.status={...n.status,id:'wrapper',content:'',reblog:{...n.status,id:'original',content:'<p>original body</p>'}};
 const f=fixture({fetchNotification:async()=>response(200,n)});await f.push();assert.equal(f.shown[0].body,'original body');assert.equal(f.shown[0].data.target.id,'original');
});
test('worker version handshake reports the running worker protocol without credentials',()=>{
 const f=fixture(),messages=[];f.events.get('message')({data:{type:'worker-info'},source:{postMessage:m=>messages.push(m)}});
 assert.equal(messages[0].version,'2026-10-21.1');assert.equal(messages[0].routeVersion,4);assert.doesNotMatch(JSON.stringify(messages),/token|server.test/);
});

test('a matching notification response supplies the displayed kind even if the raw push hint differs',async()=>{
 const f=fixture();await f.push({notification_type:'status',title:'상대 · 새 글'});assert.match(f.shown[0].title,/답글$/);assert.equal(f.shown[0].badge,'badge-reply.png');assert.equal(f.shown[0].data.target.id,'100');
 const diag=JSON.parse([...f.storage.values()][0])[0];assert.equal(diag.typeHint,'status');assert.equal(diag.receivedType,'mention');assert.equal(diag.typeMismatch,true);assert.equal(diag.outcome,'ok');
});
test('a subscribed new-post notification explicitly addressed to this account displays as a reply or mention',async()=>{
 for(const [fields,title,badge] of [[{},/답글$/,'reply'],[{in_reply_to_id:null,in_reply_to_account_id:null,mentions:[{id:'1'}]},/멘션$/,'mention'],[{visibility:'direct',mentions:[{id:'1'}]},/쪽지$/,'dm']]){
  const n={...notice(fields),type:'status'},f=fixture({fetchNotification:async()=>response(200,n)});await f.push({notification_type:'status'});assert.match(f.shown[0].title,title);assert.equal(f.shown[0].badge,'badge-'+badge+'.png');assert.equal(f.shown[0].data.target.kind,badge==='dm'?'chat':'thread');
 }
});
test('body text, mentions of another user, and replies to other users do not become recipient mentions',async()=>{
 for(const fields of [{in_reply_to_account_id:'2',mentions:[{id:'2'}]},{in_reply_to_account_id:null,in_reply_to_id:null,mentions:[]},{in_reply_to_account_id:null,mentions:[{},null]}]){
  const n={...notice({...fields,content:'<p>@me this is only body text</p>'}),type:'status'},f=fixture({fetchNotification:async()=>response(200,n)});await f.push({notification_type:'status'});assert.match(f.shown[0].title,/새 글$/);assert.equal(f.shown[0].badge,'badge-status.png');
 }
});
test('the app and worker use the same explicit recipient metadata for display classification',()=>{
 const f=fixture(),app=vm.createContext({});vm.runInContext(displayCode,app);
 const cases=[notice(),{...notice(),type:'status'},{...notice({in_reply_to_account_id:null,mentions:[{id:'1'}]}),type:'status'},{...notice({in_reply_to_account_id:'2',mentions:[{id:'2'}]}),type:'status'},{...notice(),type:'favourite'}];
 for(const n of cases)for(const id of ['1','2',null]){f.context.n=n;f.context.meId=id;app.n=n;app.meId=id;assert.equal(vm.runInContext('notificationDisplayType(n,meId)',app),vm.runInContext('notificationDisplayType(n,meId)',f.context));}
});
test('background failures are saved as bounded categories without target IDs, token, URL or body',async()=>{
 const f=fixture({fetchNotification:async()=>response(503,{})});for(let i=0;i<25;i++)await f.push();const entries=JSON.parse([...f.storage.values()][0]);assert.equal(entries.length,20);assert.equal(entries.at(-1).outcome,'http');assert.equal(entries.at(-1).status,503);assert.equal(entries.at(-1).attempts,2);assert.doesNotMatch(JSON.stringify(entries),/fixture-token|server\.test|notification_id|\/notifications|"target"|"hint"|답글 본문/);
});
test('background failure categories distinguish unavailable account, deadline and HTTP rejection',async()=>{
 for(const [options,outcome] of [[{metadata:[]},'account-unknown'],[{fetchNotification:async(u,o)=>untilAbort(o.signal),fast:true},'timeout'],[{fetchNotification:async()=>response(401,{})},'http']]){
  const f=fixture(options);await f.push();const entry=JSON.parse([...f.storage.values()][0])[0];assert.equal(entry.outcome,outcome);
 }
});
test('worker diagnostics are delivered only to a client within this app scope',async()=>{
 const f=fixture();await f.push();const received=[];
 for(const url of ['https://app.test/tower/','https://else.test/todon/','https://app.test/todon/']){let pending;f.events.get('message')({data:{type:'worker-info'},source:{url,postMessage:m=>received.push({url,...m})},waitUntil:p=>pending=p});await pending;}
 assert.equal(received.filter(m=>m.type==='push-diagnostics').length,1);assert.equal(received.find(m=>m.type==='push-diagnostics').url,'https://app.test/todon/');
});
