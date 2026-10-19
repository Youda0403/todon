const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),worker=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const app=html.slice(html.indexOf('const POP_TXT ='),html.indexOf('/* ---------- 홈 탭 ---------- */'));
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
const tick=()=>new Promise(setImmediate);
const fingerprint=token=>createHash('sha256').update(token).digest('hex').slice(0,12);
const notice=(id='42',statusId='100')=>({id,type:'mention',account:{id:'other'},status:{id:statusId,content:'private body',visibility:'public',in_reply_to_id:'99'}});
function fixture(handler=async()=>notice()){
 const accounts=['a','b'].map(id=>({id,acct:id+'@server.test',instance:'server.test',token:'private-'+id}));
 const calls=[],waiters=[],events=[],messages=[],navigations=[],saved=[],main={firstElementChild:{suspend(){this.stopped=true;}},replaceChildren(node){this.firstElementChild=node;}};
 const location={hash:'#/home'},history={state:{d:0},replaceState(st,title,hash){this.state=st;location.hash=hash;},pushState(st,title,hash){this.state=st;location.hash=hash;}};
 const cache=new Map();let context;
 context=vm.createContext({accounts,crypto:webcrypto,TextEncoder,Uint8Array,AbortController,Number,Promise,location,history,cache,
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
 return {context,accounts,calls,waitForCalls:n=>calls.length>=n?Promise.resolve():new Promise(resolve=>waiters.push({n,resolve})),events,messages,navigations,saved,main,location,history,cache,run:s=>vm.runInContext(s,context),
  start:(id='42',hint=fingerprint(accounts[0].token),target={kind:'thread',id:'100'})=>{location.hash=target?'#/notice/'+id+'/'+hint+'/'+target.kind+'/'+target.id:'#/open/'+id+'/'+hint;context.id=id;context.hint=hint;context.target=target;return vm.runInContext('openNotif(id,hint,target)',context);}};
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
 for(const hint of ['', '000000000000','invalid']){const f=fixture();await f.start('42',hint);assert.equal(f.calls.length,0);assert.equal(f.location.hash,'#/notifications');assert.equal(f.run('curIdx'),0);}
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
function workerFixture(clients=[]){
 const handlers=new Map(),opened=[],navigated=[],messages=[],shown=[];
 class Channel{
  constructor(){const port1={onmessage:null,close(){}};this.port1=port1;this.port2={postMessage:data=>queueMicrotask(()=>port1.onmessage?.({data}))};}
 }
 const self={crypto:webcrypto,registration:{scope:'https://app.test/todon/',showNotification:async(...x)=>shown.push(x)},
  addEventListener:(name,fn)=>handlers.set(name,fn),clients:{matchAll:async()=>clients,openWindow:async url=>opened.push(url)}};
 const context=vm.createContext({self,crypto:webcrypto,URL,TextEncoder,Uint8Array,AbortController,MessageChannel:Channel,Promise,Number,queueMicrotask,
  setTimeout:(fn,ms)=>setTimeout(fn,ms===1500?10:ms),clearTimeout,
  caches:{open:async()=>({match:async()=>({json:async()=>[]})})}});
 vm.runInContext(worker,context);
 return {opened,navigated,messages,shown,context,click:(id='42',hint=fingerprint('private-a'),target={kind:'thread',id:'100'})=>{let task;handlers.get('notificationclick')({notification:{data:{id,hint,...(target?{routeVersion:2,target}:{})},close(){}},waitUntil:p=>task=p});return task;},
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
 const f=workerFixture();await f.click('42',fingerprint('private-a'),{kind:'thread',id:'987654321012345678'});assert.ok(f.opened[0].endsWith('/thread/987654321012345678'));assert.ok(f.opened[0].includes('#/notice/42/'));
});
test('old OS notification data is converted to a list destination by a new worker',async()=>{
 const f=workerFixture();await f.click('42',fingerprint('private-a'),null);assert.ok(f.opened[0].endsWith('/list/-'));
});
