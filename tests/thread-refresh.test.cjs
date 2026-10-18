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
  prepend(...nodes){ nodes.forEach(n=>{n.parent=this;});this.children.unshift(...nodes); }
  replaceChildren(...nodes){ this.children=[];this.append(...nodes); }
  remove(){ if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this); }
  setAttribute(k,v){ this.attributes[k]=v; }
  set innerHTML(value){ this.children=[]; }
  querySelector(selector){ return this.children.find(n=>'.'+n.className===selector || n.tagName===selector) || null; }
}
const status = (id, parent=null, author='a') => ({id, in_reply_to_id:parent, account:{id:author}});
function fixture(focusId='100'){
  const calls=[], toasts=[]; let handler=async p=>p.endsWith('/context')?{ancestors:[],descendants:[]}:status(focusId);
  const context=vm.createContext({
    document:{createElement:()=>new Element()}, Date, Map, Set, AbortController,cur:()=>({id:'me',instance:'server.test'}),nav:()=>{},
    window:{scrollY:40, scrollTo(){}},
    h:markup=>{const el=new Element(/class="([^"]+)/.exec(markup)?.[1] || '');el._markup=markup;if(markup.includes('<p>'))el.append(Object.assign(new Element(),{tagName:'p'}));if(markup.includes('<button'))el.append(Object.assign(new Element(),{tagName:'button'}));return el;},
    $:(selector,el)=>el.querySelector(selector),
    ic:()=>'', statusEl:st=>Object.assign(new Element('status'),{_st:st}), toast:s=>toasts.push(s),
    api:p=>{ calls.push(p); return handler(p); }
  });
  vm.runInContext(code,context);
  const root=vm.runInContext(`threadView(${JSON.stringify(focusId)})`,context);
  return {root,calls,toasts,respond:fn=>{handler=fn;},ids:()=>root.children.filter(c=>c._st).map(c=>c._st.id),
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
