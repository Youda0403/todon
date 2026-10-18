const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),vm = require('node:vm'),path = require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const code=html.slice(html.indexOf('const STATUS_NOTIFICATIONS ='),html.indexOf('function notifEl('));
const account={id:'a',instance:'server.test'},other={id:'b',instance:'server.test'};
const notice=(id,statusId,type='mention')=>({id,type,account:{id:'author'},status:statusId?{id:statusId,account:{id:'author'}}:null});
function fixture(handler=async()=>[]){
  const data=new Map(),calls=[],pruned=[],badges=[],pops=[],unread=new Map([['n1','10'],['n2','20'],['n3',null]]);
  const context=vm.createContext({Date,Map,Set,Object,Array,navigator:{onLine:true},cur:()=>account,unread,
    LS:{get:(k,d)=>structuredClone(data.has(k)?data.get(k):d),set:(k,v)=>data.set(k,structuredClone(v))},
    forgetStatusSnapshots:()=>{},cache:new Map([['a',{el:{_notificationAccount:'server.test:a',pruneNotifications:()=>pruned.push('a')}}],['b',{el:{_notificationAccount:'server.test:b',pruneNotifications:()=>pruned.push('b')}}]]),
    document:{querySelectorAll:()=>pops},setBadge:n=>badges.push(n),
    qs:obj=>Object.entries(obj).flatMap(([k,v])=>v.map(x=>encodeURIComponent(k)+'='+encodeURIComponent(x))).join('&'),
    api:async(p,opts)=>{calls.push({path:p,account:opts.acc.id});return handler(p,opts);}});
  vm.runInContext(code,context);context.a=account;context.b=other;
  return {data,calls,pruned,badges,pops,unread,context,run:s=>vm.runInContext(s,context),list:items=>{context.items=items;return vm.runInContext('filterNotifications(items,a)',context);}};
}
test('notifications without their required status disappear but follow notifications remain',()=>{
  const f=fixture();assert.deepEqual([...f.list([notice('1',null),notice('2',null,'favourite'),notice('3',null,'follow'),notice('4','10')])].map(n=>n.id),['3','4']);
});
test('hiding a missing status is scoped to its account and updates cached lists and badges',()=>{
  const f=fixture();f.run("hideUnavailableStatuses(['10'],a)");
  assert.deepEqual(f.pruned,['a']);assert.equal(f.unread.has('n1'),false);assert.deepEqual(f.badges,[2]);
  f.context.items=[notice('1','10')];assert.equal(f.run('filterNotifications(items,a).length'),0);assert.equal(f.run('filterNotifications(items,b).length'),1);
});
test('late cleanup for a switched account never removes the current account unread count',()=>{
  const f=fixture();f.run("hideUnavailableStatuses(['20'],b)");assert.deepEqual(f.pruned,['b']);assert.equal(f.unread.has('n2'),true);assert.deepEqual(f.badges,[]);
});
test('visible notification statuses are checked as one deduplicated request with a cooldown',async()=>{
  let resolve;const gate=new Promise(r=>resolve=r),f=fixture(()=>gate);f.context.items=[notice('1','10'),notice('2','10'),notice('3','20')];
  const first=f.run('verifyNotificationStatuses(items,a)'),second=f.run('verifyNotificationStatuses(items,a)');assert.equal(first,second);
  resolve([{id:'20',account:{}}]);await first;
  assert.equal(f.calls.length,1);assert.equal(f.list(f.context.items).length,1);
  await f.run('verifyNotificationStatuses(items,a)');assert.equal(f.calls.length,1);
});
test('temporary errors never hide notifications; unsupported bulk APIs stop further checks',async()=>{
  for(const status of [401,403,429,500,0]){
    const f=fixture(async()=>{throw Object.assign(new Error('temporary'),{status});});f.context.items=[notice('1','10')];
    await f.run('verifyNotificationStatuses(items,a)');assert.equal(f.list(f.context.items).length,1);assert.equal(f.data.size,0);
  }
  const f=fixture(async()=>{throw Object.assign(new Error('unsupported'),{status:404});});f.context.items=[notice('1','10')];
  await f.run('verifyNotificationStatuses(items,a)');f.context.items=[notice('2','20')];await f.run('verifyNotificationStatuses(items,a)');assert.equal(f.calls.length,1);assert.equal(f.data.size,0);
});
test('malformed or unrelated bulk responses cannot hide valid notifications',async()=>{
  for(const result of [{error:'bad'},[{}],[{id:'999',account:{}}]]){
    const f=fixture(async()=>result);f.context.items=[notice('1','10')];await f.run('verifyNotificationStatuses(items,a)');assert.equal(f.list(f.context.items).length,1);
  }
});
test('successful revalidation restores access without changing another account',async()=>{
  const f=fixture(async()=>[{id:'10',account:{}}]);f.run("hideUnavailableStatuses(['10'],a);hideUnavailableStatuses(['10'],b)");f.context.items=[notice('1','10')];
  await f.run('verifyNotificationStatuses(items,a)');assert.equal(f.run('filterNotifications(items,a).length'),1);assert.equal(f.run('filterNotifications(items,b).length'),0);
});
test('offline checks do no extra network work and the hidden list is bounded',async()=>{
  const f=fixture();f.context.navigator.onLine=false;f.context.items=[notice('1','10')];await f.run('verifyNotificationStatuses(items,a)');assert.equal(f.calls.length,0);
  f.run("hideUnavailableStatuses(Array.from({length:600},(_,i)=>String(i)),a)");assert.equal(Object.keys(f.data.get('ytt.unavailable.server.test:a')).length,500);
});
test('eighty notification statuses are verified in supported groups of twenty',async()=>{
  const f=fixture(async p=>new URL('https://server.test'+p).searchParams.getAll('id[]').map(id=>({id,account:{}})));
  f.context.items=Array.from({length:80},(_,i)=>notice('n'+i,String(i+1)));await f.run('verifyNotificationStatuses(items,a)');
  assert.equal(f.calls.length,4);assert.ok(f.calls.every(c=>new URL('https://server.test'+c.path).searchParams.getAll('id[]').length===20));assert.equal(f.list(f.context.items).length,80);
});
test('a rejected batch stops further background attempts without hiding valid notifications',async()=>{
  const f=fixture(async()=>{throw Object.assign(new Error('rejected'),{status:422});});f.context.items=[notice('1','10')];await f.run('verifyNotificationStatuses(items,a)');
  f.context.items=[notice('2','20')];await f.run('verifyNotificationStatuses(items,a)');assert.equal(f.calls.length,1);assert.equal(f.list(f.context.items).length,1);assert.equal(f.data.size,0);
});
