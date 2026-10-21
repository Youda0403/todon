const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),worker=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const app=html.slice(html.indexOf('const POP_TXT ='),html.indexOf('/* ---------- 홈 탭 ---------- */'));
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
const fingerprint=token=>createHash('sha256').update(token).digest('hex').slice(0,12);
const notice=(id='42',statusId='100')=>({id,type:'mention',account:{id:'other'},status:{id:statusId,content:'private body',visibility:'public',in_reply_to_id:'99'}});
function fixture(handler=async()=>notice(),claimHandler=null){
 const accounts=['a','b'].map(id=>({id,acct:id+'@server.test',instance:'server.test',token:'private-'+id}));
 const calls=[],claims=[],claimed=new Set(),waiters=[],events=[],messages=[],navigations=[],saved=[],main={firstElementChild:{suspend(){this.stopped=true;}},replaceChildren(node){this.firstElementChild=node;}};
 class Channel{constructor(){const port1={onmessage:null,close(){}};this.port1=port1;this.port2={postMessage:data=>queueMicrotask(()=>port1.onmessage?.({data}))};}}
 const active={postMessage:async(m,ports)=>{claims.push(m.hash);const accepted=claimHandler?await claimHandler(m.hash):!claimed.has(m.hash);claimed.add(m.hash);ports[0].postMessage({type:'notification-open-claim',accepted});}};
 const location={hash:'#/home'},history={state:{d:0},replaceState(st,title,hash){this.state=st;location.hash=hash;},pushState(st,title,hash){this.state=st;location.hash=hash;}};
 const cache=new Map();let context;
 context=vm.createContext({accounts,crypto:webcrypto,TextEncoder,Uint8Array,AbortController,Number,Promise,location,history,cache,MessageChannel:Channel,queueMicrotask,setTimeout,clearTimeout,navigator:{serviceWorker:{getRegistration:async()=>({active})}},
  window:{scrollY:12},$:selector=>main,h:markup=>({_markup:markup}),setHeader:()=>{},setBadge:()=>{},
  saveAccounts:()=>saved.push(true),toast:text=>messages.push(text),cur:()=>accounts[vm.runInContext('curIdx',context)],
  filterNotifications:(list,acc)=>list.filter(n=>!n.hidden&&(!['mention','favourite'].includes(n.type)||n.status)),
  isDm:n=>n.status?.visibility==='direct',dmKeyOf:()=> 'dm-key',rememberStatusData:()=>{},
  depthOf:()=>history.state.d,isHomeHash:t=>t==='#/home',homeTarget:()=> '#/home',
  recordDiag:(kind,data)=>{events.push({kind,...data});return events.length;},
  route:()=>{if(!/^#\/(open|notice)\//.test(location.hash))vm.runInContext("cancelNotificationOpen('route')",context);navigations.push(location.hash);},
  nav:target=>{vm.runInContext("cancelNotificationOpen('navigation')",context);location.hash=target;navigations.push(target);},
  api:(p,opts)=>{calls.push({path:p,...opts});for(const w of waiters)if(calls.length>=w.n)w.resolve();return handler(p,opts);},
  checkNotif:()=>{},checkPush:()=>{},showUpdate:()=>{}});
 vm.runInContext('let curIdx=0,curKey="#/home",freshNav=false;'+app,context);
 let launches=0;
 return {context,accounts,calls,claims,waitForCalls:n=>calls.length>=n?Promise.resolve():new Promise(resolve=>waiters.push({n,resolve})),events,messages,navigations,saved,main,location,history,cache,run:s=>vm.runInContext(s,context),
  start:(id='42',hint=fingerprint(accounts[0].token),target={kind:'thread',id:'100'},opts={})=>{location.hash=target?'#/notice/'+id+'/'+hint+'/'+target.kind+'/'+target.id+(opts.receipt===false?'':'/'+(++launches).toString(16).padStart(32,'0')):'#/open/'+id+'/'+hint;context.id=id;context.hint=hint;context.target=target;if(opts.handoff||!target&&opts.handoff!==false)vm.runInContext('notificationHandoffHash=location.hash',context);return vm.runInContext('openNotif(id,hint,target)',context);}};
}
test('system click resolves the exact notified post rather than its parent and pins the recipient account',async()=>{
 const f=fixture(async()=>notice());await f.start('42',fingerprint(f.accounts[1].token));
 assert.equal(f.calls[0].acc,f.accounts[1]);assert.equal(f.location.hash,'#/thread/100');assert.equal(f.run('curIdx'),1);assert.equal(f.saved.length,1);
 assert.ok(f.events.some(e=>e.kind==='notification-navigation'&&e.target==='thread'));
});
test('waiting for a clicked notification replaces the previous thread with an explicit loading state',async()=>{
 const gate=defer();const f=fixture(()=>gate.promise),old=f.main.firstElementChild;const task=f.start();await tick();
 assert.equal(old.stopped,true);assert.match(f.main.firstElementChild._markup,/누른 알림/);assert.equal(f.run('curKey'),f.location.hash);
 gate.resolve(notice());await task;
});
test('a late first click cannot overwrite a second notification click',async()=>{
 const first=defer(),second=defer();const f=fixture(p=>p.endsWith('/42')?first.promise:second.promise);
 const a=f.start('42');await f.waitForCalls(1);const b=f.start('43',fingerprint('private-a'),{kind:'thread',id:'200'});await f.waitForCalls(2);assert.equal(f.calls[0].signal.aborted,true);
 second.resolve(notice('43','200'));await b;first.resolve(notice('42','100'));await a;
 assert.equal(f.location.hash,'#/thread/200');assert.deepEqual(f.navigations,['#/thread/200']);
});
test('a late notification response cannot replace the thread the user navigated to',async()=>{
 const gate=defer(),f=fixture(()=>gate.promise),task=f.start();await f.waitForCalls(1);f.run("nav('#/thread/999')");
 gate.resolve(notice());await task;assert.equal(f.location.hash,'#/thread/999');assert.ok(f.calls[0].signal.aborted);
});
test('a duplicate delivery of the same open route shares one lookup',async()=>{
 const gate=defer(),f=fixture(()=>gate.promise),first=f.start();assert.equal(first,f.run('openNotif(id,hint)'));await f.waitForCalls(1);assert.equal(f.calls.length,1);gate.resolve(notice());await first;
});
test('missing or unmatched account hints do not query the current account for a coincidentally equal notification ID',async()=>{
 for(const hint of ['', '000000000000','invalid']){const f=fixture();await f.start('42',hint);assert.equal(f.calls.length,0);assert.equal(f.location.hash,hint==='invalid'?'#/home':'#/notifications');assert.equal(f.run('curIdx'),0);}
});
test('mismatched notification IDs are rejected without opening the returned unrelated post',async()=>{
 const f=fixture(async()=>notice('43','999'));await f.start();assert.equal(f.location.hash,'#/notifications');assert.match(f.messages[0],/일치하지/);
});
test('opaque long string IDs stay exact and unsafe numeric IDs cannot select a rounded notification',async()=>{
 const id='123456789012345678901',f=fixture(async()=>notice(id,'98765432109876543210'));await f.start(id,fingerprint('private-a'),{kind:'thread',id:'98765432109876543210'});
 assert.ok(f.calls[0].path.endsWith(id));assert.equal(f.location.hash,'#/thread/98765432109876543210');
 const unsafe=fixture();await unsafe.start(9007199254740993);assert.equal(unsafe.calls.length,0);assert.equal(unsafe.location.hash,'#/notifications');
});
test('deleted notifications and unavailable statuses guide to the list while other temporary errors keep an explanation',async()=>{
 for(const result of ['deleted','hidden','missing']){
  const f=fixture(async()=>{if(result==='missing')throw Object.assign(new Error('missing'),{status:404});if(result==='hidden')return{...notice(),hidden:true};return{...notice(),status:null};});
  await f.start();assert.equal(f.location.hash,'#/notifications');assert.ok(f.messages.length);
 }
});
test('a logged-out recipient cannot be selected by a late lookup',async()=>{
 const gate=defer(),f=fixture(()=>gate.promise),task=f.start('42',fingerprint('private-b'));await f.waitForCalls(1);f.accounts.pop();gate.resolve(notice());await task;
 assert.equal(f.location.hash,'#/notifications');assert.equal(f.run('curIdx'),0);
});
test('handoff is acknowledged only after accepted navigation, and invalid hashes receive ignored',()=>{
 const f=fixture(),acks=[];f.context.ev={data:{type:'open',hash:'#/thread/999'},ports:[{postMessage:x=>acks.push(x)}]};f.run('onSwMessage(ev)');assert.deepEqual(acks,['ignored']);assert.deepEqual(f.navigations,[]);
 f.context.ev.data.hash='#/open/42/'+fingerprint('private-a');f.run('onSwMessage(ev)');assert.deepEqual(acks,['ignored','ok']);assert.equal(f.navigations.length,1);
});
test('click diagnostics contain only phases, flags, and destination kinds',async()=>{
 const f=fixture();await f.start();assert.doesNotMatch(JSON.stringify(f.events),/private|server\.test|\/open\/|\/thread\/|42|100/);
});
function workerFixture(clients=[],storage=new Map()){
 const handlers=new Map(),opened=[],navigated=[],messages=[],shown=[];
 class Channel{
  constructor(){const port1={onmessage:null,close(){}};this.port1=port1;this.port2={postMessage:data=>queueMicrotask(()=>port1.onmessage?.({data}))};}
 }
 const self={crypto:webcrypto,registration:{scope:'https://app.test/todon/',showNotification:async(...x)=>shown.push(x)},
  addEventListener:(name,fn)=>handlers.set(name,fn),clients:{matchAll:async()=>clients,openWindow:async url=>opened.push(url)}};
 const context=vm.createContext({self,crypto:webcrypto,URL,TextEncoder,Uint8Array,AbortController,MessageChannel:Channel,Promise,Number,queueMicrotask,Response,
  setTimeout:(fn,ms)=>setTimeout(fn,ms===1500?10:ms),clearTimeout,
  caches:{open:async()=>({match:async key=>storage.has(key)?new Response(storage.get(key)):undefined,put:async(key,response)=>storage.set(key,await response.text())})}});
 vm.runInContext(worker,context);
 return {opened,navigated,messages,shown,context,storage,claim:async(hash,url='https://app.test/todon/')=>{let task,accepted;handlers.get('message')({data:{type:'notification-open-claim',hash},source:{url},ports:[{postMessage:data=>accepted=data.accepted}],waitUntil:p=>task=p});await task;return accepted;},click:(id='42',hint=fingerprint('private-a'),target={kind:'thread',id:'100'},routeVersion=2)=>{let task;handlers.get('notificationclick')({notification:{data:{id,hint,...(target?{routeVersion,target}:{})},close(){}},waitUntil:p=>task=p});return task;},
  push:()=>{let task;handlers.get('push')({data:{json:()=>({notification_id:'42',notification_type:'mention'})},waitUntil:p=>task=p});return task;}};
}
test('an unrelated focused or visible app never receives this app notification clicks',async()=>{
 const other={url:'https://app.test/tower/',focused:true,visibilityState:'visible',postMessage(){throw new Error('wrong app');},focus(){throw new Error('wrong app');}};
 const seen=[],ours={url:'https://app.test/todon/#/thread/old',visibilityState:'hidden',focus:async()=>{},postMessage:(m,ports)=>{seen.push(m.hash);ports[0].postMessage('ok');}};
 const f=workerFixture([other,ours]);await f.click();assert.equal(seen.length,1);assert.equal(f.opened.length,0);
});
test('an unrelated visible app does not suppress an OS push notification',async()=>{
 const f=workerFixture([{url:'https://app.test/tower/',visibilityState:'visible',postMessage(){throw new Error('wrong app');}}]);await f.push();assert.equal(f.shown.length,1);
});
test('when there is no app window the worker opens the exact notification route',async()=>{
 const f=workerFixture([{url:'https://app.test/todon-other/',focused:true}]);await f.click('123456789012345678901');assert.equal(f.opened.length,1);assert.ok(f.opened[0].includes('/todon/#/notice/123456789012345678901/'));
});
test('an invalid handoff response triggers fallback navigation instead of pretending it opened',async()=>{
 const destinations=[],ours={url:'https://app.test/todon/',focus:async()=>{},postMessage:(m,ports)=>ports[0].postMessage('ignored'),navigate:async u=>{destinations.push(u);return true;}};
 const f=workerFixture([ours]);await f.click();assert.equal(destinations.length,1);assert.equal(f.opened.length,0);
});
test('a delayed first click is superseded before sending an old handoff or fallback navigation',async()=>{
 const gate=defer(),hashes=[];let focused=0;const ours={url:'https://app.test/todon/',focus:async()=>{if(++focused===1)await gate.promise;},postMessage:(m,ports)=>{hashes.push(m.hash);ports[0].postMessage('ok');}};
 const f=workerFixture([ours]),first=f.click('42');await tick();const second=f.click('43');gate.resolve();await Promise.all([first,second]);
 assert.equal(hashes.length,1);assert.ok(hashes[0].includes('/43/'));assert.equal(f.opened.length,0);
});
test('a late older fallback cannot finish after a newer click has navigated',async()=>{
 const gate=defer(),started=defer(),order=[];const ours={url:'https://app.test/todon/',focus:async()=>{},postMessage:(m,ports)=>ports[0].postMessage('ignored'),navigate:async u=>{if(u.includes('/42/')){started.resolve();await gate.promise;}order.push(u);return true;}};
 const f=workerFixture([ours]),first=f.click('42');await started.promise;const second=f.click('43');gate.resolve();await Promise.all([first,second]);
 assert.equal(order.length,2);assert.ok(order[1].includes('/43/'));
});

test('unsafe numeric push IDs cannot be used to open a rounded notification',async()=>{
 const f=workerFixture();await f.click(9007199254740993);assert.equal(f.opened[0],'https://app.test/todon/#/notifications');
});
test('a failed lookup opens the recipient account list rather than the previously active account list',async()=>{
 const f=fixture(async()=>{throw Object.assign(new Error('missing'),{status:404});});await f.start('42',fingerprint('private-b'));
 assert.equal(f.run('curIdx'),1);assert.equal(f.location.hash,'#/notifications');
});
test('an unsafe status ID returned by a notification cannot become an unrelated thread target',async()=>{
 const f=fixture(async()=>notice('42',9007199254740993));await f.start();assert.equal(f.location.hash,'#/notifications');
});

test('same notification ID with a different target cannot pass the displayed-post check',async()=>{
 const f=fixture(async()=>notice('42','999'));await f.start('42',fingerprint('private-a'),{kind:'thread',id:'100'});
 assert.equal(f.location.hash,'#/notifications');assert.ok(f.events.some(e=>e.kind==='notification-resolved'&&e.matched&&!e.targetMatched));assert.match(f.messages[0],/표시된 툿/);
});
test('old notifications without a captured target fail safely without looking up a guessed post',async()=>{
 const f=fixture();await f.start('42',fingerprint('private-a'),null);assert.equal(f.calls.length,0);assert.equal(f.location.hash,'#/notifications');assert.ok(f.events.some(e=>e.reason==='legacy'));
});
test('a fallback notification without verified details opens only the recipient list',async()=>{
 const f=fixture();await f.start('42',fingerprint('private-b'),{kind:'list',id:'-'});assert.equal(f.calls.length,0);assert.equal(f.run('curIdx'),1);assert.equal(f.location.hash,'#/notifications');
});
test('a DM is routed only when the captured target kind and post match',async()=>{
 const f=fixture(async()=>({...notice(),status:{...notice().status,visibility:'direct'}}));
 await f.start('42',fingerprint('private-a'),{kind:'chat',id:'100'});assert.equal(f.location.hash,'#/chat/dm-key');
 const mismatch=fixture(async()=>({...notice(),status:{...notice().status,visibility:'direct'}}));
 await mismatch.start();assert.equal(mismatch.location.hash,'#/notifications');
});
test('profile notifications are bound to the displayed actor',async()=>{
 const f=fixture(async()=>({id:'42',type:'follow',account:{id:'other'}}));await f.start('42',fingerprint('private-a'),{kind:'user',id:'other'});assert.equal(f.location.hash,'#/user/other');
});
test('boost wrappers use the displayed original post consistently for the captured target',async()=>{
 const n=notice('42','wrapper');n.status.reblog={...notice().status,id:'original'};const f=fixture(async()=>n);
 await f.start('42',fingerprint('private-a'),{kind:'thread',id:'original'});assert.equal(f.location.hash,'#/thread/original');
});
test('the new target-bearing route validates each path component',()=>{
 const f=fixture();assert.equal(f.run("notificationOpenTarget('#/notice/42/"+fingerprint('private-a')+"/thread/100').id"),'100');
 for(const hash of ['#/notice/42/'+fingerprint('private-a')+'/thread/100/extra','#/notice/42/'+fingerprint('private-a')+'/bad/100','#/notice/42/'+fingerprint('private-a')+'/list/100']){f.context.hash=hash;assert.equal(f.run('notificationOpenTarget(hash)'),null);}
});
test('a worker click forwards the captured target in a route understood only by the new protocol',async()=>{
 const f=workerFixture();await f.click('42',fingerprint('private-a'),{kind:'thread',id:'987654321012345678'});assert.match(f.opened[0],/\/thread\/987654321012345678\/[a-f0-9]{32}$/);assert.ok(f.opened[0].includes('#/notice/42/'));
});
test('old OS notification data is converted to a list destination by a new worker',async()=>{
 const f=workerFixture();await f.click('42',fingerprint('private-a'),null);assert.match(f.opened[0],/\/list\/-\/[a-f0-9]{32}$/);
});

test('a restored legacy notification URL starts at home without a lookup or account switch',async()=>{
 for(const target of [{kind:'thread',id:'100'},null]){
  const f=fixture();await f.start('42',fingerprint('private-b'),target,{receipt:false,handoff:false});
  assert.equal(f.location.hash,'#/home');assert.equal(f.calls.length,0);assert.equal(f.claims.length,0);assert.equal(f.run('curIdx'),0);assert.ok(f.events.some(e=>e.kind==='notification-launch'&&!e.verified&&e.source==='url'));
 }
});
test('a made-up or expired click receipt cannot open a notification or select its recipient',async()=>{
 const f=fixture(async()=>notice(),async()=>false);await f.start('42',fingerprint('private-b'));
 assert.equal(f.location.hash,'#/home');assert.equal(f.calls.length,0);assert.equal(f.run('curIdx'),0);assert.equal(f.claims.length,1);
});
test('discarding a restored notification resets the home history depth',async()=>{
 const f=fixture();f.history.state={d:3};await f.start('42',fingerprint('private-a'),{kind:'thread',id:'100'},{receipt:false,handoff:false});assert.equal(f.location.hash,'#/home');assert.equal(f.history.state.d,0);
});
test('an unavailable service worker cannot leave an unconfirmed launch waiting or open a post',async()=>{
 const f=fixture();f.context.navigator.serviceWorker.getRegistration=async()=>{throw new Error('unavailable');};await f.start();assert.equal(f.location.hash,'#/home');assert.equal(f.calls.length,0);
});
test('reloading a consumed notification address does not replay its lookup',async()=>{
 const f=fixture();let hash;const first=f.start();hash=f.location.hash;await first;assert.equal(f.calls.length,1);
 f.location.hash=hash;await f.run('openNotif(id,hint,target)');assert.equal(f.location.hash,'#/home');assert.equal(f.calls.length,1);assert.equal(f.claims.length,2);
});
test('two actual clicks on the same notification have independent one-use receipts',async()=>{
 const f=fixture();await f.start();await f.start();assert.equal(f.calls.length,2);assert.notEqual(f.claims[0],f.claims[1]);assert.equal(f.location.hash,'#/thread/100');
});
test('a live message from an old worker still opens its verified target but a restored URL does not',async()=>{
 const f=fixture();await f.start('42',fingerprint('private-a'),{kind:'thread',id:'100'},{receipt:false,handoff:true});assert.equal(f.calls.length,1);assert.equal(f.location.hash,'#/thread/100');assert.equal(f.claims.length,0);
});
test('leaving while a click is being confirmed prevents its late lookup and navigation',async()=>{
 const gate=defer(),f=fixture(async()=>notice(),()=>gate.promise),pending=f.start();await tick();f.run("nav('#/thread/999')");gate.resolve(true);await pending;
 assert.equal(f.calls.length,0);assert.equal(f.location.hash,'#/thread/999');
});
test('a newer click wins while the older click receipt is still being confirmed',async()=>{
 const gate=defer();let claims=0;const f=fixture(async()=>notice('43','200'),()=>++claims===1?gate.promise:Promise.resolve(true));
 const first=f.start();await tick();await f.start('43',fingerprint('private-a'),{kind:'thread',id:'200'});gate.resolve(true);await first;
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].path.endsWith('/43'));assert.equal(f.location.hash,'#/thread/200');
});
test('a worker-issued click receipt can be consumed once even after that worker restarts',async()=>{
 const f=workerFixture();await f.click();const hash=new URL(f.opened[0]).hash,restarted=workerFixture([],f.storage);
 assert.equal(await restarted.claim(hash),true);assert.equal(await restarted.claim(hash),false);
});
test('simultaneous claims cannot both consume one click',async()=>{
 const f=workerFixture();await f.click();const hash=new URL(f.opened[0]).hash,results=await Promise.all([f.claim(hash),f.claim(hash)]);assert.deepEqual(results,[true,false]);
});
test('unrelated apps and changed destinations cannot consume a valid receipt',async()=>{
 const f=workerFixture();await f.click();const hash=new URL(f.opened[0]).hash;
 assert.equal(await f.claim(hash,'https://app.test/tower/'),false);assert.equal(await f.claim(hash,'https://else.test/todon/'),false);assert.equal(await f.claim(hash.replace('/thread/100/','/thread/999/')),false);assert.equal(await f.claim(hash),true);
});
test('unclaimed click receipts expire rather than becoming reusable launch addresses',async()=>{
 const f=workerFixture();f.context.now=1000;vm.runInContext('Date.now=()=>now',f.context);await f.click();const hash=new URL(f.opened[0]).hash;f.context.now=121001;
 assert.equal(await f.claim(hash),false);assert.deepEqual(JSON.parse([...f.storage.values()][0]),[]);
});
test('pending click storage is bounded and contains no access tokens or status content',async()=>{
 const f=workerFixture();for(let i=0;i<25;i++)await f.click(String(i+1));const entries=JSON.parse([...f.storage.values()][0]);assert.equal(entries.length,20);assert.doesNotMatch(JSON.stringify(entries),/private-a|private body|content|access_token/);
});
test('a receipt persistence error opens the notification list without an unverified post route',async()=>{
 const storage=new Map();storage.set=()=>{throw new Error('storage unavailable');};const f=workerFixture([],storage);await f.click();assert.deepEqual(f.opened,['https://app.test/todon/#/notifications']);
});
test('the current route accepts a receipt only as an exact additional component',()=>{
 const f=fixture(),base='#/notice/42/'+fingerprint('private-a')+'/thread/100',nonce='a'.repeat(32);f.context.hash=base+'/'+nonce;
 assert.equal(f.run('notificationOpenRoute(hash).nonce'),nonce);assert.equal(f.run('notificationOpenTarget(hash).id'),'100');
 for(const hash of [base+'/'+nonce+'/extra',base+'/short',base+'/'+'A'.repeat(32)]){f.context.hash=hash;assert.equal(f.run('notificationOpenRoute(hash)'),null);}
});

test('a neutral preview uses the exact notification ID to recover the replied-to account and post',async()=>{
 const f=fixture();await f.start('42',fingerprint('private-b'),{kind:'notification',id:'42'});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/v1/notifications/42');assert.equal(f.calls[0].acc,f.accounts[1]);assert.equal(f.run('curIdx'),1);assert.equal(f.location.hash,'#/thread/100');assert.ok(f.events.some(e=>e.kind==='notification-resolved'&&e.recovered&&e.matched&&e.targetMatched));
});
test('recovering a neutral preview still requires an issued unconsumed click receipt',async()=>{
 for(const opts of [{receipt:false,handoff:false},{receipt:false,handoff:true}]){
  const f=fixture();await f.start('42',fingerprint('private-a'),{kind:'notification',id:'42'},opts);assert.equal(f.calls.length,0);assert.ok(['#/home','#/notifications'].includes(f.location.hash));
 }
 const f=fixture(async()=>notice(),async()=>false);await f.start('42',fingerprint('private-a'),{kind:'notification',id:'42'});assert.equal(f.calls.length,0);assert.equal(f.location.hash,'#/home');
});
test('a changed recovery notification ID is rejected before any API request',async()=>{
 const f=fixture();await f.start('42',fingerprint('private-a'),{kind:'notification',id:'43'});assert.equal(f.calls.length,0);assert.equal(f.location.hash,'#/notifications');
});
test('a mismatched recovered response cannot open its returned unrelated status',async()=>{
 const f=fixture(async()=>notice('43','999'));await f.start('42',fingerprint('private-a'),{kind:'notification',id:'42'});assert.equal(f.location.hash,'#/notifications');assert.ok(f.events.some(e=>e.kind==='notification-resolved'&&!e.matched));
});
test('recovery supports a verified private reply or follow notification without assuming a public thread',async()=>{
 for(const [n,target] of [[{...notice(),status:{...notice().status,visibility:'direct'}},'#/chat/dm-key'],[{id:'42',type:'follow',account:{id:'other'}},'#/user/other']]){
  const f=fixture(async()=>n);await f.start('42',fingerprint('private-a'),{kind:'notification',id:'42'});assert.equal(f.location.hash,target);
 }
});
test('missing status data and unsupported recovered event types guide to the list without a false deletion claim',async()=>{
 for(const n of [{...notice(),status:null},{...notice(),type:'unknown'},notice('42',9007199254740993)]){
  const f=fixture(async()=>n);await f.start('42',fingerprint('private-a'),{kind:'notification',id:'42'});assert.equal(f.location.hash,'#/notifications');assert.equal(f.messages.some(text=>/삭제/.test(text)),false);
 }
});
test('an API-confirmed deletion during recovery is handled while a temporary failure leaves a distinct explanation',async()=>{
 for(const status of [404,503]){const f=fixture(async()=>{throw Object.assign(new Error('Temporary server failure'),{status});});await f.start('42',fingerprint('private-a'),{kind:'notification',id:'42'});assert.equal(f.location.hash,'#/notifications');assert.equal(f.messages.some(text=>/삭제/.test(text)),status===404);}
});
test('a newer click or manual navigation cancels a pending recovery',async()=>{
 const gate=defer(),f=fixture(()=>gate.promise),pending=f.start('42',fingerprint('private-a'),{kind:'notification',id:'42'});await f.waitForCalls(1);f.run("nav('#/thread/999')");gate.resolve(notice());await pending;assert.equal(f.location.hash,'#/thread/999');assert.equal(f.calls[0].signal.aborted,true);
});
test('only the new preview protocol can request notification-ID recovery from a worker click',async()=>{
 for(const [version,allowed] of [[2,false],[3,false],[4,true]]){const f=workerFixture();await f.click('42',fingerprint('private-a'),{kind:'notification',id:'42'},version);assert.equal(f.opened[0].includes('/notification/42/'),allowed);}
 const wrong=workerFixture();await wrong.click('42',fingerprint('private-a'),{kind:'notification',id:'43'},4);assert.ok(wrong.opened[0].includes('/list/-/'));
});
test('new neutral preview recovery is one-use and cannot be replayed after the worker restarts',async()=>{
 const f=workerFixture();await f.click('42',fingerprint('private-a'),{kind:'notification',id:'42'},4);const hash=new URL(f.opened[0]).hash,restarted=workerFixture([],f.storage);assert.equal(await restarted.claim(hash),true);assert.equal(await restarted.claim(hash),false);
});
test('raw subscription events addressed to the recipient retain correct private-message navigation',async()=>{
 const n={...notice(),type:'status',status:{...notice().status,visibility:'direct',mentions:[{id:'b'}]}},f=fixture(async()=>n);await f.start('42',fingerprint('private-b'),{kind:'chat',id:'100'});assert.equal(f.location.hash,'#/chat/dm-key');
});
test('imported worker diagnostics are bounded, sanitized and deduplicated across version handshakes',()=>{
 const f=fixture(),entry={at:Date.now(),outcome:'http',status:503,attempts:2,typeHint:'status',receivedType:'other',displayKind:'other',hasAccount:true,hasStatus:false,typeMismatch:false,token:'secret',id:'42',body:'private body',url:'https://server.test/status/100'};
 f.context.entries=[entry];f.run('importPushDiagnostics(entries);importPushDiagnostics(entries)');assert.equal(f.events.filter(e=>e.kind==='push-preview').length,1);assert.doesNotMatch(JSON.stringify(f.events),/secret|private body|server\.test|"id"|"body"|"url"/);
 f.context.entries=Array.from({length:30},(_,i)=>({...entry,at:Date.now()-i-1}));f.run('importPushDiagnostics(entries)');assert.equal(f.events.filter(e=>e.kind==='push-preview').length,21);
});
