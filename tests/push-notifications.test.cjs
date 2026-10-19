const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const {webcrypto, createHash} = require('node:crypto');
const worker = fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const replyCode = /function isReply\(n\)\{[^\n]+\}/.exec(html)[0];
const token = 'fixture-token', hint = createHash('sha256').update(token).digest('hex').slice(0,12);
const account = {id:'1',instance:'server.test',hint};
const notice = (fields={}) => ({id:'42',type:'mention',account:{username:'other',display_name:'상대'},status:{id:'100',content:'<p>@me 답글 본문</p>',visibility:'public',in_reply_to_id:'99',in_reply_to_account_id:'1',...fields}});
const response = (status,n) => ({ok:status>=200&&status<300,status,json:async()=>n});
function fixture({metadata=[account],fetchNotification=async()=>response(200,notice()),fast=false,visible=false,cryptoError=false}={}){
  const events=new Map(),shown=[],calls=[],delays=[],messages=[];let cleared=0;
  const crypto=cryptoError?{subtle:{digest:async()=>{throw new Error('unavailable');}}}:webcrypto;
  const self={crypto,addEventListener:(name,fn)=>events.set(name,fn),
    clients:{matchAll:async()=>visible?[{url:'https://app.test/todon/',visibilityState:'visible',postMessage:m=>messages.push(m)}]:[]},
    registration:{scope:'https://app.test/todon/',showNotification:async(title,options)=>shown.push({title,...options})}};
  const context=vm.createContext({self,crypto,TextEncoder,Uint8Array,AbortController,URL,
    caches:{open:async()=>({match:async()=>({json:async()=>metadata})})},
    setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,fast?5:ms);},clearTimeout:id=>{cleared++;clearTimeout(id);},
    fetch:async(url,options)=>{calls.push({url,options});return fetchNotification(url,options);}});
  vm.runInContext(worker,context);
  return {context,shown,calls,delays,messages,get cleared(){return cleared;},
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
    assert.equal(f.calls.length,1);assert.equal(f.shown[0].badge,'badge-default.png');assert.equal(f.shown[0].title,'새 멘션·답글');assert.equal(f.shown[0].body,'답글 본문');
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
  for(const n of [null,{...notice(),id:'43'},{...notice(),type:'favourite'},{...notice(),status:null}]){
    const f=fixture({fetchNotification:async()=>response(200,n)});await f.push();assert.equal(f.shown[0].badge,'badge-default.png');
  }
});
test('a visible app receives the push signal without an extra system popup or detail request',async()=>{
  const f=fixture({visible:true});await f.push();assert.equal(f.calls.length,0);assert.equal(f.shown.length,0);assert.equal(f.messages[0].type,'push');
});
test('other raw notification types preserve their badges when details are unavailable',async()=>{
  for(const [type,badge] of [['favourite','fav'],['reblog','boost'],['follow','follow'],['quote','quote']]){
    const f=fixture({metadata:[]});await f.push({notification_type:type});assert.equal(f.shown[0].badge,'badge-'+badge+'.png');
  }
});

