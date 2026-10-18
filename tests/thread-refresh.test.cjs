const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const code = html.slice(html.indexOf('function threadOrder('), html.indexOf('function userView('));
const defer = () => { let resolve, reject; const promise = new Promise((r,j) => { resolve=r; reject=j; }); return {promise,resolve,reject}; };
class Element {
  constructor(className=''){ this.className=className; this.children=[]; this.style={}; this.isConnected=false; this.attributes={}; }
  append(...nodes){ nodes.forEach(n=>{n.parent=this;this.children.push(n);}); }
  insertBefore(node,reference){ if(node.parent)node.remove();const i=this.children.indexOf(reference);node.parent=this;if(i<0)this.children.push(node);else this.children.splice(i,0,node); }
  prepend(...nodes){ nodes.forEach(n=>{n.parent=this;});this.children.unshift(...nodes); }
  replaceChildren(...nodes){ this.children=[];this.append(...nodes); }
  remove(){ if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this); }
  setAttribute(k,v){ this.attributes[k]=v; }
  set innerHTML(value){ this.children=[]; }
  querySelector(selector){ return this.children.find(n=>selector.startsWith('.') ? n.className.split(' ').includes(selector.slice(1)) : n.tagName===selector) || null; }
}
const status = (id, parent=null, author='a') => ({id, in_reply_to_id:parent, account:{id:author}});
function fixture(focusId='100', {seed=null,threadSeed=null,hidden={},handler:initialHandler}={}){
  const calls=[], toasts=[],events=[], signals=[]; let handler=initialHandler || (async p=>p.endsWith('/context')?{ancestors:[],descendants:[]}:status(focusId));
  let currentAccount={id:'me',instance:'server.test'};
  const context=vm.createContext({threadSeed,LS:{get:()=>hidden},unavailableKey:()=>'',
    readStatusSnapshot:()=>seed,forgetStatusSnapshots:()=>{},recordDiag:(kind,data)=>{events.push({kind,...data});return events.length;},
    document:{createElement:()=>new Element()}, Date, Map, Set, AbortController,cur:()=>currentAccount,nav:()=>{},
    window:{scrollY:40, scrollTo(){}},
    h:markup=>{const el=new Element(/class="([^"]+)/.exec(markup)?.[1] || '');el._markup=markup;if(markup.includes('<p>'))el.append(Object.assign(new Element(),{tagName:'p'}));if(markup.includes('<button'))el.append(Object.assign(new Element(),{tagName:'button'}));return el;},
    $:(selector,el)=>el.querySelector(selector),
    ic:()=>'', statusEl:st=>Object.assign(new Element('status'),{_st:st}), toast:s=>toasts.push(s),
    api:(p,opts)=>{ calls.push(p);signals.push(opts.signal);return handler(p,opts); }
  });
  vm.runInContext(code,context);
  const root=vm.runInContext(`threadView(${JSON.stringify(focusId)},threadSeed)`,context);
  return {root,calls,toasts,events,signals,setAccount:a=>{currentAccount=a;},respond:fn=>{handler=fn;},ids:()=>root.children.filter(c=>c._st).map(c=>c._st.id),
    replyCount:()=>Number(/답글 (\d+)개/.exec(root.querySelector('.thsec')?._markup||'')?.[1]||0)};
}
test('thread refreshes share the initial in-flight request', async()=>{
  const f=fixture(),a=f.root.refresh(),b=f.root.refresh();
  assert.equal(a,b); await a; assert.equal(f.calls.length,2); assert.deepEqual(f.ids(),['100']);
});
test('refresh preserves visible content and a failed refresh does not erase it', async()=>{
  const f=fixture(); await f.root.refresh(); const existing=f.root.children[0],gate=defer();
  f.respond(()=>gate.promise);const a=f.root.refresh(),b=f.root.refresh();
  assert.equal(a,b);assert.equal(f.calls.length,4);assert.equal(f.root.children[0],existing);
  gate.reject(new Error('temporary server error'));await a;
  assert.ok(f.root.children.includes(existing));assert.equal(f.root.querySelector('.err').attributes.role,'alert');assert.deepEqual(f.toasts,[]);
});
test('posting a reply displays the returned status without further API requests', async()=>{
  const f=fixture();await f.root.refresh();const calls=f.calls.length;
  assert.equal(f.root.onPosted(status('101','100')),true);
  assert.deepEqual(f.ids(),['100','101']);assert.equal(f.calls.length,calls);
  f.root.onPosted(status('101','100'));assert.deepEqual(f.ids(),['100','101']);
});
test('new replies follow their parent branch and unrelated posts stay out of the thread', async()=>{
  const f=fixture();await f.root.refresh();
  f.root.onPosted(status('101','100','b'));f.root.onPosted(status('102','100','c'));
  f.root.onPosted(status('103','101','b'));assert.deepEqual(f.ids(),['100','101','103','102']);assert.equal(f.replyCount(),2);
  f.root.onPosted(status('999'));assert.deepEqual(f.ids(),['100','101','103','102']);
});
test('the displayed reply count includes three direct branches and keeps every nested reply visible',async()=>{
  const f=fixture();await f.root.refresh();
  const replies=[status('101',100),status('111','101'),status('102','100'),status('121','102'),status('122','121'),status('103','100')];
  f.respond(async p=>p.endsWith('/context')?{ancestors:[],descendants:replies}:status('100'));
  await f.root.refresh();assert.equal(f.replyCount(),3);assert.deepEqual(f.ids(),['100','101','111','102','121','122','103']);
});
test('opening a reply counts only that post’s children rather than its ancestors or deeper descendants',async()=>{
  const f=fixture('102');await f.root.refresh();
  f.respond(async p=>p.endsWith('/context')?{ancestors:[status('100')],descendants:[status('121','102'),status('122','121')]}:status('102','100'));
  await f.root.refresh();assert.equal(f.replyCount(),1);assert.deepEqual(f.ids(),['100','102','121','122']);
});
test('a reply posted during an older refresh is retained until the server confirms it', async()=>{
  const f=fixture();await f.root.refresh();const gate=defer();
  f.respond(p=>p.endsWith('/context')?gate.promise:Promise.resolve(status('100')));
  const pending=f.root.refresh();f.root.onPosted(status('101','100'));
  gate.resolve({ancestors:[],descendants:[]});await pending;assert.deepEqual(f.ids(),['100','101']);
  f.respond(async p=>p.endsWith('/context')?{ancestors:[],descendants:[status('101','100')]}:status('100'));
  await f.root.refresh();assert.deepEqual(f.ids(),['100','101']);
});
test('post rendering preserves bottom space used to hold the focused post position', async()=>{
  const f=fixture();await f.root.refresh();f.root.querySelector('.tail').style.minHeight='400px';
  f.root.onPosted(status('101','100'));assert.equal(f.root.querySelector('.tail').style.minHeight,'400px');
});
test('deleted local replies are not restored when the thread renders another post', async()=>{
  const f=fixture();await f.root.refresh();f.root.onPosted(status('101','100'));
  f.root.forgetStatus('101');f.root.onPosted(status('102','100'));
  assert.deepEqual(f.ids(),['100','102']);assert.equal(f.replyCount(),1);
});
test('edited replies retain their current content when another post is inserted', async()=>{
  const f=fixture();await f.root.refresh();f.root.onPosted({...status('101','100'),content:'old'});
  f.root.updateStatus({...status('101','100'),content:'edited'});f.root.onPosted(status('102','100'));
  assert.equal(f.root.children.find(c=>c._st?.id==='101')._st.content,'edited');
});
test('a cached status that becomes unavailable is replaced by an alert instead of stale content',async()=>{
  const f=fixture();await f.root.refresh();f.respond(async()=>{throw Object.assign(new Error('이 툿은 삭제되었거나 지금 계정에서 볼 수 없어요.'),{code:'unavailable',status:404});});
  await f.root.refresh();assert.deepEqual(f.ids(),[]);assert.equal(f.root.querySelector('.err').attributes.role,'alert');
  f.respond(async p=>p.endsWith('/context')?{ancestors:[],descendants:[]}:status('100'));
  await f.root.refresh();assert.deepEqual(f.ids(),['100']);assert.equal(f.root.querySelector('.err'),null);
});
test('a clicked snapshot is readable before either request finishes and is still revalidated',async()=>{
  const body=defer(),thread=defer();
  const f=fixture('100',{seed:{...status('100'),content:'already received'},handler:p=>p.endsWith('/context')?thread.promise:body.promise});
  assert.deepEqual(f.ids(),['100']);assert.equal(f.calls.length,2);assert.equal(f.events.find(e=>e.kind==='thread-content').source,'snapshot');
  const done=f.root.refresh();body.resolve({...status('100'),content:'fresh'});await new Promise(setImmediate);
  assert.equal(f.root.children.find(c=>c._st)._st.content,'fresh');assert.ok(f.root.querySelector('.thread-wait'));
  thread.resolve({ancestors:[],descendants:[status('101','100')]});await done;
  assert.deepEqual(f.ids(),['100','101']);assert.equal(f.replyCount(),1);assert.equal(f.root.querySelector('.thread-wait'),null);
});
test('without a snapshot the main post is shown as soon as it arrives while context is pending',async()=>{
  const thread=defer();const f=fixture('100',{handler:async p=>p.endsWith('/context')?thread.promise:status('100')});
  const done=f.root.refresh();await new Promise(setImmediate);assert.deepEqual(f.ids(),['100']);assert.ok(f.root.querySelector('.thread-wait'));
  thread.resolve({ancestors:[],descendants:[status('101','100'),status('102','101')]});await done;
  assert.equal(f.replyCount(),1);assert.deepEqual(f.ids(),['100','101','102']);
});
test('context failure keeps the received post with persistent guidance and no endless spinner',async()=>{
  const f=fixture('100',{handler:async p=>{if(p.endsWith('/context'))throw new Error('context failed');return status('100');}});
  await f.root.refresh();assert.deepEqual(f.ids(),['100']);assert.equal(f.root.querySelector('.err').attributes.role,'alert');assert.equal(f.root.querySelector('.thread-wait'),null);
});
test('deletion or denied access clears the snapshot rather than leaving stale private content',async()=>{
  for(const error of [{status:404,code:'unavailable'},{status:401},{status:403}]){
    const f=fixture('100',{seed:status('100'),handler:async()=>{throw Object.assign(new Error('not available'),error);}});
    await f.root.refresh();assert.deepEqual(f.ids(),[]);assert.equal(f.root.querySelector('.err').attributes.role,'alert');
  }
});
test('leaving aborts requests and late old results cannot repaint or replace a resumed request',async()=>{
  const body=defer(),thread=defer(),nextBody=defer(),nextThread=defer();
  const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?thread.promise:body.promise});
  const old=f.root.refresh();f.root.suspend();assert.ok(f.signals.every(s=>s.aborted));
  f.respond(p=>p.endsWith('/context')?nextThread.promise:nextBody.promise);
  const current=f.root.resume();body.resolve(status('100'));thread.resolve({ancestors:[],descendants:[status('999','100')]});await old;
  assert.equal(current,f.root.refresh());assert.deepEqual(f.ids(),['100']);
  nextBody.resolve(status('100'));nextThread.resolve({ancestors:[],descendants:[status('101','100')]});await current;
  assert.deepEqual(f.ids(),['100','101']);assert.equal(f.root.querySelector('.err'),null);
});
test('a reply posted during the snapshot stage survives later body and context responses',async()=>{
  const body=defer(),thread=defer();const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?thread.promise:body.promise});
  const done=f.root.refresh();assert.equal(f.root.onPosted(status('101','100')),true);
  body.resolve(status('100'));thread.resolve({ancestors:[],descendants:[]});await done;
  assert.deepEqual(f.ids(),['100','101']);assert.equal(f.replyCount(),1);
});

test('a fast context displays replies with the received snapshot before slow status revalidation',async()=>{
  const body=defer(),thread=defer();
  const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?thread.promise:body.promise});
  const done=f.root.refresh();thread.resolve({ancestors:[],descendants:[status('101','100'),status('102','101')]});await new Promise(setImmediate);
  assert.deepEqual(f.ids(),['100','101','102']);assert.equal(f.replyCount(),1);
  assert.match(f.root.querySelector('.thread-wait')._markup,/본문의 최신 내용/);
  assert.equal(f.events.find(e=>e.kind==='thread-replies').source,'network');
  body.resolve({...status('100'),content:'fresh'});await done;
  assert.deepEqual(f.ids(),['100','101','102']);assert.equal(f.root.querySelector('.thread-wait'),null);
  assert.equal(f.root.children.find(c=>c._st?.id==='100')._st.content,'fresh');
});
test('context before a missing body is retained and displayed as soon as the body arrives',async()=>{
  const body=defer();const f=fixture('100',{handler:p=>p.endsWith('/context')?Promise.resolve({ancestors:[],descendants:[status('101','100')]}):body.promise});
  const done=f.root.refresh();await new Promise(setImmediate);assert.deepEqual(f.ids(),[]);assert.ok(f.root.querySelector('.thread-wait'));
  body.resolve(status('100'));await done;assert.deepEqual(f.ids(),['100','101']);assert.equal(f.root.querySelector('.thread-wait'),null);
});
test('a body timeout keeps the already received replies and retry replaces them with current data',async()=>{
  const body=defer();const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?Promise.resolve({ancestors:[],descendants:[status('101','100')]}):body.promise});
  const done=f.root.refresh();await new Promise(setImmediate);assert.deepEqual(f.ids(),['100','101']);
  body.reject(Object.assign(new Error('서버 응답이 없어 불러오기를 멈췄어요.'),{code:'timeout'}));await done;
  assert.deepEqual(f.ids(),['100','101']);assert.ok(f.root.querySelector('.err'));assert.equal(f.root.querySelector('.thread-wait'),null);
  assert.equal(f.events.find(e=>e.kind==='thread-error').phase,'status');
  f.respond(async p=>p.endsWith('/context')?{ancestors:[],descendants:[status('102','100')]}:status('100'));
  await f.root.refresh();assert.deepEqual(f.ids(),['100','102']);assert.equal(f.root.querySelector('.err'),null);
});
test('a context failure is shown immediately and a later body update preserves the alert',async()=>{
  const body=defer();const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?Promise.reject(new Error('답글 연결 오류')):body.promise});
  const done=f.root.refresh();await new Promise(setImmediate);assert.ok(f.root.querySelector('.err'));
  body.resolve({...status('100'),content:'fresh'});await done;
  assert.ok(f.root.querySelector('.err'));assert.equal(f.root.querySelector('.thread-wait'),null);assert.deepEqual(f.ids(),['100']);
});
test('a late unavailable or denied status clears replies that arrived first',async()=>{
  for(const error of [{status:404,code:'unavailable'},{status:401},{status:403}]){
    const body=defer();const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?Promise.resolve({ancestors:[],descendants:[status('101','100')]}):body.promise});
    const done=f.root.refresh();await new Promise(setImmediate);assert.deepEqual(f.ids(),['100','101']);
    body.reject(Object.assign(new Error('no access'),error));await done;
    assert.deepEqual(f.ids(),[]);assert.ok(f.root.querySelector('.err'));assert.equal(f.root.snapshotThread(),null);assert.equal(f.root.querySelector('.thread-wait'),null);
  }
});
test('returning after context-first cancellation still revalidates the unfinished body',async()=>{
  const body=defer();const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?Promise.resolve({ancestors:[],descendants:[status('101','100')]}):body.promise});
  const old=f.root.refresh();await new Promise(setImmediate);f.root.suspend();
  f.respond(async p=>p.endsWith('/context')?{ancestors:[],descendants:[status('102','100')]}:status('100'));
  const resumed=f.root.resume();assert.ok(resumed);await resumed;
  body.resolve(status('100'));await old;assert.deepEqual(f.ids(),['100','102']);assert.ok(f.signals.slice(0,2).every(s=>s.aborted));
});
test('posting between context arrival and body arrival preserves reply evidence across another stale refresh',async()=>{
  const body=defer();const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?Promise.resolve({ancestors:[],descendants:[]}):body.promise});
  const done=f.root.refresh();await new Promise(setImmediate);f.root.onPosted(status('101','100'));body.resolve(status('100'));await done;
  f.respond(async p=>p.endsWith('/context')?{ancestors:[],descendants:[]}:status('100'));
  await f.root.refresh();assert.deepEqual(f.ids(),['100','101']);assert.equal(f.replyCount(),1);
});
test('a repeated entry restores the previous full thread before its fresh requests settle',async()=>{
  const first=fixture('100',{handler:async p=>p.endsWith('/context')?{ancestors:[status('90')],descendants:[status('101','100')]}:status('100')});
  await first.root.refresh();const saved=first.root.snapshotThread();first.root.suspend();
  const gate=defer();const reopened=fixture('100',{threadSeed:saved,handler:()=>gate.promise});
  assert.deepEqual(reopened.ids(),['90','100','101']);assert.equal(reopened.calls.length,2);assert.equal(reopened.replyCount(),1);
  assert.equal(reopened.events.find(e=>e.kind==='thread-content').source,'view-cache');assert.equal(reopened.events.find(e=>e.kind==='thread-open').contextSnapshot,true);
  assert.match(reopened.root.querySelector('.thread-wait')._markup,/새 답글/);
  const done=reopened.root.refresh();gate.reject(new Error('temporary timeout'));await done;
  assert.deepEqual(reopened.ids(),['90','100','101']);assert.ok(reopened.root.querySelector('.err'));
});
test('thread exports are scoped to the active account and instance',async()=>{
  const f=fixture();await f.root.refresh();assert.ok(f.root.snapshotThread());
  f.setAccount({id:'another',instance:'server.test'});assert.equal(f.root.snapshotThread(),null);
  f.setAccount({id:'me',instance:'other.test'});assert.equal(f.root.snapshotThread(),null);
});
test('known unavailable posts are excluded from a re-entry snapshot including its local replies',async()=>{
  const hidden={};const f=fixture('100',{hidden});await f.root.refresh();f.root.onPosted(status('101','100'));f.root.onPosted(status('102','100'));
  hidden['101']=1;const saved=f.root.snapshotThread();assert.deepEqual(Array.from(saved.ctx.descendants,s=>s.id),['102']);assert.deepEqual(Array.from(saved.localPosts,([id])=>id),['102']);
  hidden['100']=1;assert.equal(f.root.snapshotThread(),null);
});
test('newly posted replies remain protected when a saved thread is restored against an older server response',async()=>{
  const first=fixture();await first.root.refresh();first.root.onPosted(status('101','100'));
  const reopened=fixture('100',{threadSeed:first.root.snapshotThread()});await reopened.root.refresh();
  assert.deepEqual(reopened.ids(),['100','101']);assert.equal(reopened.replyCount(),1);
});
test('malformed body and context responses end with guidance rather than an endless loader',async()=>{
  for(const phase of ['body','context']){
    const f=fixture('100',{seed:status('100'),handler:async p=>p.endsWith('/context')?phase==='context'?{}:{ancestors:[],descendants:[]}:phase==='body'?{}:status('100')});
    await f.root.refresh();assert.ok(f.root.querySelector('.err'));assert.equal(f.root.querySelector('.thread-wait'),null);assert.deepEqual(f.ids(),['100']);
  }
});
test('retrying an early phase error cancels the other pending read and starts fresh requests immediately',async()=>{
  const body=defer();const f=fixture('100',{seed:status('100'),handler:p=>p.endsWith('/context')?Promise.reject(new Error('context failed')):body.promise});
  const old=f.root.refresh();await new Promise(setImmediate);assert.ok(f.root.querySelector('.err'));
  f.respond(async p=>p.endsWith('/context')?{ancestors:[],descendants:[status('102','100')]}:status('100'));
  f.root.querySelector('.err').querySelector('button').onclick();const retried=f.root.refresh();
  assert.equal(f.calls.length,4);assert.ok(f.signals.slice(0,2).every(s=>s.aborted));await retried;
  body.resolve(status('100'));await old;assert.deepEqual(f.ids(),['100','102']);assert.equal(f.root.querySelector('.err'),null);
});
