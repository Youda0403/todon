const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const view = html.slice(html.indexOf('function mentionsView(){'),html.indexOf('/* 답글 순서:'));
const state = view.slice(view.indexOf('  let items ='),view.indexOf('  function card('));
const loader = view.slice(view.indexOf('  /* 목록과 동시에 답장 기록을'),view.indexOf("  bar.querySelectorAll('.mqseg button').forEach(b => { b.onclick"));
const lifecycle = view.slice(view.indexOf('  root.suspend ='),view.indexOf('  root.refresh ='));
const now = Date.parse('2026-10-18T06:00:00Z'), hour = 60*60*1000;
const at = hours => new Date(now-hours*hour).toISOString();
const notice = (id,hours,fields={}) => ({id:String(id),type:'mention',created_at:at(hours),status:{id:'s'+id,created_at:at(hours),visibility:'public'},...fields});
const page = (data,next=null) => ({data,next});
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(handler, saved={done:[],replied:[]}){
  const calls=[],renders=[],checks=[];
  class Clock extends Date {static now(){return now;}}
  const context=vm.createContext({Date:Clock,Number,Promise,Set,Math,AbortController,
    recordDiag:()=>1,
    qs:obj=>{const q=new URLSearchParams();for(const [key,v] of Object.entries(obj))for(const x of Array.isArray(v)?v:[v])q.append(key,x);return q.toString();},
    filterNotifications:list=>list.filter(n=>!n.hidden),isDm:n=>n.status?.visibility==='direct',
    mqStore:()=>saved,
    verifyNotificationStatuses:data=>checks.push(data.map(n=>n.id)),paintMore:()=>{},
    redraw:keep=>renders.push({keep,ids:[...vm.runInContext('items.map(n=>n.id)',context)],loading:vm.runInContext('loading',context)}),
    api:async(p,opts)=>{calls.push({path:p,account:opts.acc.id,signal:opts.signal});return handler(p,opts);}});
  vm.runInContext(`
    const me={id:'me',instance:'server.test'}; const root={};
    ${state}
    ${loader}
    ${lifecycle}
  `,context);
  return {calls,renders,checks,run:s=>vm.runInContext(s,context),get:()=>JSON.parse(vm.runInContext('JSON.stringify({ids:items.map(n=>n.id),mine:[...mine],end,loading,loadError,nextPath,oldestReceived,recentCutoff,checking,replyError})',context))};
}
async function settleReplies(f){
  // The list promise completes independently; wait for the actual reply-history worker in tests that inspect classification.
  for(let i=0;i<100 && f.run('replyTask !== null');i++) await f.run('replyTask');
}
const isNotices = p=>p.startsWith('/api/v1/notifications');
test('initial load follows every page through three days without scrolling or another click',async()=>{
  let i=0;
  const rows=[notice(100,5),notice(90,26),notice(80,60),notice(70,75)];
  const f=fixture(async p=>isNotices(p)?page([rows[i++]],'/api/v1/notifications?max_id='+i):page([]));
  await f.run('loadMore(true)');
  assert.deepEqual(f.get().ids,['100','90','80','70']);assert.equal(i,4);assert.equal(f.get().end,false);
  assert.ok(f.renders.some(r=>r.ids.length===1&&r.loading));assert.ok(f.get().oldestReceived<f.get().recentCutoff);
});
test('the exact 72-hour boundary is included before automatic loading stops',async()=>{
  const rows=[notice(100,1),notice(90,72),notice(80,72+1/3600000)];let i=0;
  const f=fixture(async p=>isNotices(p)?page([rows[i++]],'/api/v1/notifications?max_id='+i):page([]));
  await f.run('loadMore(true)');assert.deepEqual(f.get().ids,['100','90','80']);assert.equal(i,3);
});
test('pages containing only direct, hidden or missing statuses do not cut the date range short',async()=>{
  const pages=[page([notice(100,1,{status:{id:'dm',visibility:'direct'}})],'/api/v1/notifications?page=2'),page([notice(90,30,{status:null}),notice(89,31,{hidden:true})],'/api/v1/notifications?page=3'),page([notice(80,60),notice(70,80)],'/api/v1/notifications?page=4')];let i=0;
  const f=fixture(async p=>isNotices(p)?pages[i++]:page([]));await f.run('loadMore(true)');
  assert.deepEqual(f.get().ids,['80','70']);assert.equal(i,3);assert.equal(f.get().loadError,null);
});
test('max_id fallback handles servers with no exposed Link header or a smaller page limit',async()=>{
  const f=fixture(async p=>{
    if(!isNotices(p))return page([]);
    const id=new URL('https://server.test'+p).searchParams.get('max_id');
    return !id?page([notice(100,1)]):id==='100'?page([notice(90,50)]):page([notice(80,80)]);
  });
  await f.run('loadMore(true)');assert.deepEqual(f.get().ids,['100','90','80']);assert.equal(f.calls.filter(c=>isNotices(c.path)).length,3);
});
test('short and empty histories end at the server end instead of looping',async()=>{
  for(const rows of [[],[notice(100,2)]]){
    let i=0;const f=fixture(async p=>isNotices(p)?page(i++?[]:rows):page([]));await f.run('loadMore(true)');
    assert.equal(f.get().end,true);assert.equal(f.get().loading,false);assert.equal(f.get().loadError,null);assert.ok(i<=2);
  }
});
test('already loaded pages stay visible during a slower older page and concurrent refresh calls are shared',async()=>{
  const gate=deferred(),started=deferred();let i=0;
  const f=fixture(async p=>{if(!isNotices(p))return page([]);if(!i++){return page([notice(100,2)],'/api/v1/notifications?page=2');}started.resolve();return gate.promise;});
  const first=f.run('loadMore(true)');await started.promise;
  assert.deepEqual(f.get().ids,['100']);assert.equal(first,f.run('loadMore(true)'));assert.equal(first,f.run('loadMore()'));
  gate.resolve(page([notice(90,80)],'/api/v1/notifications?page=3'));await first;
  assert.deepEqual(f.get().ids,['100','90']);assert.equal(f.calls.filter(c=>isNotices(c.path)).length,2);
});
test('an older-page error keeps results and retry resumes the three-day scan from that page',async()=>{
  let fail=true,i=0;
  const f=fixture(async p=>{if(!isNotices(p))return page([]);i++;if(!p.includes('page='))return page([notice(100,1)],'/api/v1/notifications?page=2');if(fail)throw new Error('temporary');return page([notice(90,80)],'/api/v1/notifications?page=3');});
  await f.run('loadMore(true)');assert.deepEqual(f.get().ids,['100']);assert.equal(f.get().loadError.reset,false);assert.equal(f.get().loadError.recent,true);
  fail=false;await f.run('loadMore(loadError.reset,loadError.recent)');assert.deepEqual(f.get().ids,['100','90']);assert.equal(f.get().loadError,null);assert.equal(i,3);
});
test('a repeated server page produces guidance without an infinite loop or a false end-of-history claim',async()=>{
  const f=fixture(async p=>isNotices(p)?page([notice(100,1)],'/api/v1/notifications?page=2'):page([]));
  await f.run('loadMore(true)');assert.deepEqual(f.get().ids,['100']);assert.equal(f.calls.filter(c=>isNotices(c.path)).length,2);assert.equal(f.get().end,false);assert.match(f.get().loadError.message,/더 오래된 멘션/);
});
test('reply detection scans past ten account pages rather than misclassifying an older reply as unanswered',async()=>{
  let minePages=0,noticePages=0;
  const f=fixture(async p=>{
    if(isNotices(p))return page(noticePages++?[]:[notice(100,60),notice(90,80)]);
    const i=minePages++;
    return page(Array.from({length:40},(_,j)=>({id:String(1000-i*40-j),created_at:at(i===10&&j===39?85:i*5),in_reply_to_id:i===10&&j===0?'s100':null})),`/api/v1/accounts/me/statuses?max_id=${1000-i*40-39}`);
  });
  await f.run('loadMore(true)');await settleReplies(f);assert.equal(minePages,11);assert.ok(f.get().mine.includes('s100'));assert.deepEqual(f.get().ids,['100','90']);assert.equal(f.run('stOf(items[0])'),'replied');
});
test('reply-history failure preserves visible mentions and retry resumes only the failed history page',async()=>{
  let fail=true,own=0;
  const f=fixture(async p=>{
    if(isNotices(p))return page([notice(100,80),notice(90,81)]);
    own++;if(!p.includes('max_id='))return page([{id:'20',created_at:at(10),in_reply_to_id:'s100'}],'/api/v1/accounts/me/statuses?max_id=20');
    if(fail)throw new Error('history unavailable');return page([]);
  });
  await f.run('loadMore(true)');await settleReplies(f);
  assert.deepEqual(f.get().ids,['100','90']);assert.equal(f.get().loadError,null);assert.equal(f.get().replyError,'history unavailable');
  assert.equal(f.run('stOf(items[0])'),'replied');assert.equal(f.run('stOf(items[1])'),'checking');
  fail=false;await f.run('replyError=null;checkReplies(replyTarget)');await settleReplies(f);
  assert.equal(f.get().replyError,null);assert.equal(f.run('stOf(items[1])'),'todo');assert.equal(own,3);
  assert.equal(f.calls.filter(c=>isNotices(c.path)).length,1);
});
test('manual loading remains available beyond the automatic three-day range and fetches one page',async()=>{
  let i=0;const f=fixture(async p=>isNotices(p)?page([notice(100-i,i++?110:80)],'/api/v1/notifications?max_id='+i):page([]));
  await f.run('loadMore(true)');assert.equal(i,1);await f.run('loadMore()');assert.equal(i,2);assert.deepEqual(f.get().ids,['100','99']);
});
test('malformed and repeated reply history leaves honest checking states and a retry error',async()=>{
  for(const data of [{error:'invalid'},[{id:'20',created_at:at(1)}]]){
    const f=fixture(async p=>isNotices(p)?page([notice(100,80)]):page(data));await f.run('loadMore(true)');await settleReplies(f);
    assert.deepEqual(f.get().ids,['100']);assert.equal(f.get().loadError,null);assert.match(f.get().replyError,/답장 기록/);
    assert.equal(f.run('stOf(items[0])'),'checking');assert.ok(f.calls.length<=3);
  }
});
test('all three days of notifications display while the first own-history request is still pending',async()=>{
  const gate=deferred();let i=0;
  const f=fixture(async p=>isNotices(p)?page([notice(100-i,i++?80:2)],'/api/v1/notifications?page='+i):gate.promise);
  await f.run('loadMore(true)');
  assert.deepEqual(f.get().ids,['100','99']);assert.equal(f.get().loading,false);assert.equal(f.get().checking,true);
  assert.equal(f.run('stOf(items[0])'),'checking');assert.equal(f.run('stOf(items[1])'),'checking');
  assert.ok(f.renders.some(r=>r.ids.length===1&&r.loading));assert.equal(f.calls.filter(c=>!isNotices(c.path)).length,1);
  gate.resolve(page([]));await settleReplies(f);assert.equal(f.run('stOf(items[0])'),'todo');
});
test('reply history starts alongside the first notifications request rather than after its response',async()=>{
  const notices=deferred(),own=deferred();
  const f=fixture(p=>isNotices(p)?notices.promise:own.promise);
  const task=f.run('loadMore(true)');
  assert.equal(f.calls.length,2);assert.ok(f.calls.some(c=>isNotices(c.path)));assert.ok(f.calls.some(c=>!isNotices(c.path)));
  notices.resolve(page([notice(100,80)]));await task;assert.deepEqual(f.get().ids,['100']);
  own.resolve(page([]));await settleReplies(f);
});
test('each own-history page classifies only covered mentions, and positive reply evidence applies immediately',async()=>{
  const first=deferred(),second=deferred();let own=0;
  const f=fixture(p=>isNotices(p)?page([notice(100,2),notice(90,60),notice(80,80)]):++own===1?first.promise:second.promise);
  await f.run('loadMore(true)');assert.equal(f.run('items.map(stOf).join()'),'checking,checking,checking');
  first.resolve(page([{id:'20',created_at:at(10),in_reply_to_id:'s90'}],'/api/v1/accounts/me/statuses?max_id=20'));
  for(let i=0;i<10&&own<2;i++)await Promise.resolve();
  assert.equal(f.run('items.map(stOf).join()'),'todo,replied,checking');
  second.resolve(page([{id:'10',created_at:at(85)}]));await settleReplies(f);
  assert.equal(f.run('items.map(stOf).join()'),'todo,replied,todo');
});
test('local replied and skipped decisions remain known while unscanned mentions are checking',async()=>{
  const gate=deferred();const f=fixture(p=>isNotices(p)?page([notice(100,1),notice(90,2),notice(80,80)]):gate.promise,{replied:['s100'],done:['s90']});
  await f.run('loadMore(true)');assert.equal(f.run('items.map(stOf).join()'),'replied,done,checking');
  gate.resolve(page([]));await settleReplies(f);
});
test('reply coverage uses the post date, including a notification delivered later',async()=>{
  const gate=deferred();let own=0;
  const n=notice(100,80,{status:{id:'s100',created_at:at(100),visibility:'public'}});
  const f=fixture(p=>isNotices(p)?page([n]):++own===1?page([{id:'20',created_at:at(90)}]):gate.promise);
  await f.run('loadMore(true)');assert.equal(f.run('stOf(items[0])'),'checking');
  gate.resolve(page([{id:'10',created_at:at(105),in_reply_to_id:'s100'}]));await settleReplies(f);assert.equal(f.run('stOf(items[0])'),'replied');
});
test('notification pages continue even after history fails and never call unknown mentions unanswered',async()=>{
  let i=0;const f=fixture(p=>isNotices(p)?page([notice(100-i,i++?80:2)],'/api/v1/notifications?page='+i):Promise.reject(new Error('temporary history')));
  await f.run('loadMore(true)');await settleReplies(f);
  assert.deepEqual(f.get().ids,['100','99']);assert.equal(f.get().loadError,null);assert.equal(f.get().replyError,'temporary history');
  assert.equal(f.run('items.map(stOf).join()'),'checking,checking');
});
test('leaving aborts both workers and resume preserves pages while ignoring their old responses',async()=>{
  const oldNotices=deferred(),oldOwn=deferred(),newNotices=deferred(),newOwn=deferred();let notifications=0,own=0;
  const f=fixture(p=>isNotices(p)?++notifications===1?oldNotices.promise:newNotices.promise:++own===1?oldOwn.promise:newOwn.promise);
  const stale=f.run('loadMore(true)');f.run('root.suspend()');assert.ok(f.calls.every(c=>c.signal.aborted));
  f.run('root.resume()');const resumed=f.run('loadTask');assert.ok(resumed);assert.equal(f.calls.length,4);
  oldNotices.resolve(page([notice(200,80)]));oldOwn.resolve(page([{id:'old',created_at:at(100),in_reply_to_id:'s100'}]));await stale;
  assert.equal(f.run('loadTask'),resumed);assert.deepEqual(f.get().ids,[]);assert.deepEqual(f.get().mine,[]);
  newNotices.resolve(page([notice(100,80)]));newOwn.resolve(page([]));await resumed;await settleReplies(f);
  assert.deepEqual(f.get().ids,['100']);assert.equal(f.run('stOf(items[0])'),'todo');
});
test('resuming an interrupted older notification page keeps existing results and continues the range',async()=>{
  const old=deferred();let notifications=0;
  const f=fixture(p=>!isNotices(p)?page([]):++notifications===1?page([notice(100,1)],'/api/v1/notifications?page=2'):notifications===2?old.promise:page([notice(90,80)]));
  const pending=f.run('loadMore(true)');for(let i=0;i<10&&notifications<2;i++)await Promise.resolve();
  assert.deepEqual(f.get().ids,['100']);f.run('root.suspend();root.resume()');const resumed=f.run('loadTask');
  old.resolve(page([notice(200,90)]));await pending;await resumed;
  assert.deepEqual(f.get().ids,['100','90']);assert.ok(f.calls.filter(c=>isNotices(c.path)).slice(1).every(c=>c.path.includes('page=2')));
});
test('refresh rechecks new replies from other apps while sharing concurrent refresh calls',async()=>{
  let replied=false;
  const f=fixture(p=>isNotices(p)?page([notice(100,80)]):page(replied?[{id:'30',created_at:at(85),in_reply_to_id:'s100'}]:[]));
  await f.run('loadMore(true)');await settleReplies(f);assert.equal(f.run('stOf(items[0])'),'todo');
  replied=true;const task=f.run('loadMore(true)');assert.equal(task,f.run('loadMore(true)'));await task;await settleReplies(f);
  assert.equal(f.run('stOf(items[0])'),'replied');
});
test('an empty mentions history does not trigger a full multi-page own-post scan',async()=>{
  const gate=deferred();let own=0;
  const f=fixture(p=>isNotices(p)?gate.promise:(own++,page([{id:String(own),created_at:at(1)}],'/api/v1/accounts/me/statuses?max_id='+own)));
  const task=f.run('loadMore(true)');await settleReplies(f);assert.equal(own,1);
  gate.resolve(page([]));await task;await settleReplies(f);assert.equal(own,1);
});
