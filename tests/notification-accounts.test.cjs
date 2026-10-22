const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const cut=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const accountCode=cut('let accounts =','/* ---------- API ---------- */');
const dmCode=cut('const partKey =','const stripLead =');
const alertCode=cut('function alertKind(','function pushAlerts(');
const notificationCode=cut('const POP_TXT =','/* ---------- 홈 탭 ---------- */');
const pollingCode=cut('const seenKey =','/* ---------- 라우터 ---------- */');
const defer=()=>{let resolve,reject;return{promise:new Promise((r,j)=>{resolve=r;reject=j}),resolve:v=>resolve(v),reject:e=>reject(e)}};
const tick=()=>new Promise(setImmediate);
const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,2));assert.ok(predicate(),'asynchronous operation did not reach the expected phase');};
const hint=token=>createHash('sha256').update(token).digest('hex').slice(0,12);
const notice=(id='42',recipient='a',fields={})=>({id,type:'mention',account:{id:'peer'},status:{id:'100',account:{id:'peer'},content:'<p>본문</p>',visibility:'public',mentions:[{id:recipient}],in_reply_to_id:'99',in_reply_to_account_id:recipient,...fields}});
function fixture(handler=async p=>p.startsWith('/api/v1/notifications/')?notice():p.startsWith('/api/v1/notifications')?[]:{}){
 const accounts=['a','b'].map(id=>({id,acct:id+'@'+id+'.test',instance:id+'.test',token:'private-'+id}));
 const data=new Map([['ytt.accounts',accounts],['ytt.cur',0]]),calls=[],popups=[],events=[],badges=[],dm=[],checks=[],hidden=new Set();
 let ctx,now=100000;
 class Clock extends Date{static now(){return now;}}
 const location={hash:'#/home'},history={state:{d:0},replaceState(st,t,hash){this.state=st;location.hash=hash;},pushState(st,t,hash){this.state=st;location.hash=hash;}};
 const main={firstElementChild:null,replaceChildren(x){this.firstElementChild=x;}};
 ctx=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,AbortController,Date:Clock,Map,Set,Promise,Number,Object,Array,String,
  document:{hidden:false,querySelectorAll:()=>[]},window:{scrollY:100},location,history,navigator:{},cache:new Map(),setTimeout,clearTimeout,
  LS:{get:(k,d)=>data.has(k)?data.get(k):d,set:(k,v)=>data.set(k,v)},
  qs:p=>{const q=new URLSearchParams();for(const[k,v]of Object.entries(p))for(const x of Array.isArray(v)?v:[v])q.append(k,x);return q.toString()},
  cmpId:(a,b)=>BigInt(a)>BigInt(b)?1:BigInt(a)<BigInt(b)?-1:0,
  filterNotifications:(list,acc)=>list.filter(n=>n.status&&!hidden.has(acc.id+':'+n.status.id)),
  notificationAccount:acc=>acc.instance+':'+acc.id,
  alertPrefs:()=>({mention:true,dm:true,favourite:true,reblog:true,follow:true,status:true,quote:true}),
  recordDiag:(kind,fields)=>{events.push({kind,...fields});return events.length;},
  checkDm:()=>dm.push(vm.runInContext('cur().id',ctx)),verifyNotificationStatuses:(list,acc)=>checks.push(acc.id),
  setHeader:()=>{},setBadge:n=>badges.push(n),paintBadge:()=>{},updAppBadge:()=>{},
  $:selector=>selector==='#main'?main:{hidden:true,textContent:''},h:markup=>({_markup:markup}),
  toast:()=>{},rememberStatusData:()=>{},parse:()=>({name:location.hash.split('/')[1],arg:location.hash.split('/')[2]}),
  depthOf:()=>history.state.d,isHomeHash:s=>s==='#/home',homeTarget:()=>'#/home',nav:hash=>location.hash=hash,route:()=>{},
  checkPush:()=>{},showUpdate:()=>{},
  api:(p,opts={})=>{const acc=opts.acc||vm.runInContext('cur()',ctx);calls.push({p,...opts,acc});return Promise.resolve().then(()=>handler(p,{...opts,acc},calls.length));}
 });
 vm.runInContext(accountCode+dmCode+alertCode+notificationCode+pollingCode+'let curKey=null,freshNav=false;',ctx);
 ctx.popup=n=>popups.push(n);
 ctx.setBadge=n=>badges.push(n);
 return{ctx,accounts,data,calls,popups,events,badges,dm,checks,hidden,location,
  run:s=>vm.runInContext(s,ctx),
  select:i=>vm.runInContext('curIdx='+i+';saveAccounts()',ctx),
  poll:()=>vm.runInContext('checkNotif()',ctx),
  push:(id='42',who='a',expires=now+2000)=>{ctx.msg={id,hint:hint('private-'+who),expiresAt:expires};return vm.runInContext('handleVisiblePush(msg)',ctx)},
  time:t=>now=t,get now(){return now;}};
}

test('a late marker from A cannot overwrite B read position, next page, badge or notifications',async()=>{
 const gate=defer();const f=fixture((p,{acc})=>{
  if(p.startsWith('/api/v1/notifications?'))return[notice(acc.id==='a'?'900':'100',acc.id)];
  if(p.startsWith('/api/v1/markers?')&&acc.id==='a')return gate.promise;
  return{};
 });
 const old=f.poll();await tick();const oldCall=f.calls.find(c=>c.acc.id==='a'&&c.p.includes('markers?'));
 f.select(1);await f.poll();assert.equal(f.run('pollTop'),'100');assert.equal(oldCall.signal.aborted,true);
 const before=JSON.stringify([f.badges,f.dm,f.events]);gate.resolve({notifications:{last_read_id:'899'}});assert.equal(await old,false);
 assert.equal(f.data.get('ytt.seen.b@b.test'),'100');assert.equal(f.run('pollTop'),'100');assert.equal(JSON.stringify([f.badges,f.dm,f.events]),before);
 await f.poll();assert.match(f.calls.filter(c=>c.acc.id==='b'&&c.p.startsWith('/api/v1/notifications?')).at(-1).p,/since_id=100/);
 assert.ok(f.calls.filter(c=>c.acc.id==='a').every(c=>c.acc===f.accounts[0]));
});
test('switching A to B and back to A invalidates the original A run even with the same account object',async()=>{
 const gate=defer();let aMarkers=0;const f=fixture((p,{acc})=>{
  if(p.startsWith('/api/v1/notifications?'))return[notice(acc.id==='a'?'300':'100',acc.id)];
  if(p.startsWith('/api/v1/markers?')&&acc.id==='a'&&++aMarkers===1)return gate.promise;
  return{};
 });
 const old=f.poll();await tick();f.select(1);await f.poll();f.select(0);await f.poll();
 gate.resolve({notifications:{last_read_id:'999'}});await old;assert.equal(f.run('pollTop'),'300');assert.equal(f.data.get('ytt.seen.a@a.test'),'300');
});
test('a rejected old marker and a late old notification page cannot affect the new account',async()=>{
 for(const phase of ['page','marker']){
  const gate=defer();const f=fixture((p,{acc})=>{
   if(acc.id==='a'&&p.startsWith(phase==='page'?'/api/v1/notifications?':'/api/v1/markers?'))return gate.promise;
   if(p.startsWith('/api/v1/notifications?'))return[notice(acc.id==='a'?'900':'100',acc.id)];return{};
  });
  const old=f.poll();await tick();f.select(1);await f.poll();
  if(phase==='marker')gate.reject(new Error('cancelled'));else gate.resolve([notice('900')]);
  await old;assert.equal(f.run('pollTop'),'100');assert.equal(f.data.get('ytt.seen.b@b.test'),'100');
 }
});
test('poll triggers share one run and a later run is released after an error',async()=>{
 const gate=defer();let first=true;const f=fixture(p=>{if(p.startsWith('/api/v1/notifications?')&&first){first=false;return gate.promise;}return p.includes('notifications?')?[notice('101')]:{};});
 const a=f.poll(),b=f.poll();assert.equal(a,b);await tick();assert.equal(f.calls.length,1);gate.reject(new Error('offline'));assert.equal(await a,false);
 assert.equal(await f.poll(),true);assert.equal(f.run('pollTop'),'101');
});
test('read marker writes are pinned to their account and equal IDs in another account are not deduplicated',async()=>{
 const f=fixture(p=>p.includes('notifications?')?[notice('42')]:{});await f.poll();
 f.select(1);f.ctx.rows=[notice('42','b')];f.run('showNew(rows)');assert.equal(f.popups.length,1);
 f.run("markSeen('99',accounts[0])");await tick();const write=f.calls.find(c=>c.method==='POST'&&c.body.notifications.last_read_id==='99');
 assert.equal(write.acc,f.accounts[0]);assert.equal(f.data.get('ytt.seen.a@a.test'),'99');assert.equal(f.data.has('ytt.seen.b@b.test'),false);
});
test('saving unrelated account details preserves an active poll while token changes and logout cancel it',async()=>{
 const gate=defer(),f=fixture(()=>gate.promise),pending=f.poll();await tick();const signal=f.calls[0].signal;
 f.run("accounts[0].display_name='새 이름';saveAccounts()");assert.equal(signal.aborted,false);
 f.run("accounts[0].token='renewed';saveAccounts()");assert.equal(signal.aborted,true);
 const second=f.poll();await tick();const next=f.calls.at(-1).signal;f.run('accounts.splice(0);curIdx=0;saveAccounts()');assert.equal(next.aborted,true);
 gate.resolve([]);assert.equal(await pending,false);assert.equal(await second,false);
});
test('a visible A rejects B push without querying B or switching the selected account',async()=>{
 const f=fixture();assert.equal(await f.push('42','b'),false);assert.equal(f.calls.length,0);assert.equal(f.run('cur().id'),'a');assert.equal(f.popups.length,0);
});
test('a matching visible push displays the exact notification even during or after the initial poll',async()=>{
 for(const seeded of [false,true]){
  const f=fixture(p=>p.includes('notifications?')?[notice()]:p.includes('notifications/')?notice():{});
  if(seeded)await f.poll();assert.equal(await f.push(),true);assert.equal(f.popups.length,1);assert.equal(f.popups[0].id,'42');
  const detail=f.calls.find(c=>c.p==='/api/v1/notifications/42');assert.equal(detail.acc,f.accounts[0]);assert.ok(detail.timeout>0&&detail.timeout<2000);
  assert.equal(await f.push(),true);assert.equal(f.popups.length,1);assert.equal(f.calls.filter(c=>c.p==='/api/v1/notifications/42').length,1);
 }
});
test('concurrent deliveries of the same account and notification share their exact lookup',async()=>{
 const gate=defer(),f=fixture(p=>p.includes('notifications/')?gate.promise:[]);
 const a=f.push(),b=f.push();await until(()=>f.calls.length>0);assert.equal(f.calls.length,1);gate.resolve(notice());assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(f.popups.length,1);
});
test('a push arriving after polling already displayed its notification does not display it twice',async()=>{
 let row=notice('41');const f=fixture(p=>p.includes('notifications?')?[row]:p.includes('notifications/')?row:{});
 await f.poll();row=notice('42');await f.poll();assert.equal(f.popups.length,1);assert.equal(f.popups[0].id,'42');
 assert.equal(await f.push(),true);assert.equal(f.popups.length,1);assert.equal(await f.push(),true);assert.equal(f.popups.length,1);
});
test('a hidden page, expired push or malformed recipient cannot claim foreground delivery',async()=>{
 const f=fixture();f.ctx.document.hidden=true;assert.equal(await f.push(),false);f.ctx.document.hidden=false;
 assert.equal(await f.push('42','a',f.now),false);assert.equal(await f.push('42','a',f.now+10000),false);
 f.ctx.msg={id:'42',hint:'',expiresAt:f.now+2000};assert.equal(await f.run('handleVisiblePush(msg)'),false);assert.equal(f.calls.length,0);
});
test('account switch, hidden state or expired deadline before a push response prevents late popup and acknowledgement',async()=>{
 for(const change of [f=>f.select(1),f=>f.ctx.document.hidden=true,f=>f.time(f.now+2100)]){
  const gate=defer(),f=fixture(()=>gate.promise),pending=f.push();await until(()=>f.calls.length>0);change(f);gate.resolve(notice());assert.equal(await pending,false);assert.equal(f.popups.length,0);
 }
});
test('failed, mismatched and unsupported push lookups fall back without displaying another notification',async()=>{
 for(const result of [()=>{throw new Error('offline')},()=>({...notice(),id:'43'}),()=>({...notice(),type:'unsupported'}),()=>null]){
  const f=fixture(result);assert.equal(await f.push(),false);assert.equal(f.popups.length,0);
 }
});
test('hidden statuses and disabled alert kinds acknowledge intentional suppression without a system duplicate',async()=>{
 for(const hidden of [true,false]){
  const f=fixture();if(hidden)f.hidden.add('a:100');else f.ctx.alertPrefs=()=>({mention:false});
  assert.equal(await f.push(),true);assert.equal(f.popups.length,0);
 }
});
test('push message acknowledgement waits until the matching notification is actually handled',async()=>{
 const gate=defer(),f=fixture(()=>gate.promise),acks=[];f.ctx.ev={data:{type:'push',deliveryVersion:1,id:'42',hint:hint('private-a'),expiresAt:f.now+2000},ports:[{postMessage:m=>acks.push(m)}]};
 f.run('onSwMessage(ev)');await until(()=>f.calls.length>0);assert.equal(acks.length,0);gate.resolve(notice());await until(()=>acks.length>0);assert.equal(acks.length,1);assert.equal(acks[0].handled,true);
 assert.doesNotMatch(JSON.stringify(f.events),/private|a\.test|hint|\b42\b|\b100\b/);
});
test('real DM participants use the recipient before selection for public route helpers and group conversations',()=>{
 const f=fixture();f.ctx.n=notice('42','b',{visibility:'direct'});
 assert.equal(f.run('notifTarget(n,accounts[1])'),'#/chat/peer');assert.equal(f.run('cur().id'),'a');
 f.ctx.n.status.mentions.push({id:'third'});assert.equal(f.run('notifTarget(n,accounts[1])'),'#/chat/peer-third');
 f.ctx.n.status.account={id:'b'};f.ctx.n.status.mentions=[{id:'b'}];assert.equal(f.run('notifTarget(n,accounts[1])'),'#/chat/me');
 f.ctx.n=notice('42','b',{visibility:'direct'});f.ctx.n.status={id:'wrapper',reblog:f.ctx.n.status};assert.equal(f.run('notifTarget(n,accounts[1])'),'#/chat/peer');
});
