const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const keyCode=html.slice(html.indexOf('function cardContentKey('),html.indexOf('/* 인용글 카드 */'));
const reconcile=html.slice(html.indexOf('function reconcileNotifications('),html.indexOf('/* ---------- 화면들 ---------- */'));
const feed=html.slice(html.indexOf('function feedView('),html.indexOf('/* ---------- 멘션 답장 관리:'));
const clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(setImmediate);
const notice=(id='100',statusId='200')=>({id,type:'status',account:{id:'99',display_name:'글쓴이'},status:{id:statusId,account:{id:'99'},content:'<p>본문과 인용 링크</p>',replies_count:0,favourites_count:1,quote:{state:'accepted',quoted_status_id:'300'}}});
const defer=()=>{let resolve,reject;return{promise:new Promise((r,j)=>{resolve=r;reject=j;}),resolve:v=>resolve(v),reject:e=>reject(e)};};
function fixture(handler){
  const calls=[],made=[],animations=[],checks=[],observers=[],hidden=new Set();
  class Node{
    constructor(fragment=false){this.children=[];this.dataset={};this.parentNode=null;this.fragment=fragment;this.parts={};}
    get childElementCount(){return this.children.length;} get isConnected(){return false;}
    set innerHTML(value){this.markup=value;this.replaceChildren();} get innerHTML(){return this.markup||'';}
    append(...nodes){for(const node of nodes){if(node.fragment){this.append(...node.children.slice());continue;}node.remove();node.parentNode=this;this.children.push(node);}}
    prepend(node){this.insertBefore(node,this.children[0]||null);}
    remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
    replaceChildren(...nodes){for(const node of this.children.slice())node.remove();this.append(...nodes);}
    insertBefore(node,anchor){node.remove();node.parentNode=this;const i=this.children.indexOf(anchor);this.children.splice(i<0?this.children.length:i,0,node);}
    querySelectorAll(selector){return selector==='.quote'&&this.quote?[this.quote]:[];}
    getBoundingClientRect(){return{top:10000,bottom:10100};}
    animate(){animations.push(this);}
  }
  const acc={id:'1',instance:'a.test'},ctx=vm.createContext({Map,Set,Promise,JSON,Object,Array,String,
    SYNC_KEYS:['favourited','reblogged','bookmarked','favourites_count','reblogs_count','replies_count'],
    document:{createElement:()=>new Node(),createDocumentFragment:()=>new Node(true)},
    cur:()=>acc,innerHeight:922,notificationAccount:a=>a.instance+':'+a.id,unavailableKey:()=>'',LS:{get:()=>Object.fromEntries([...hidden].map(id=>[id,true]))},
    filterNotifications:items=>items.filter(n=>n.status&&!hidden.has(n.status.id)),verifyNotificationStatuses:items=>checks.push(items),
    qs:params=>new URLSearchParams(params).toString(),cmpId:(a,b)=>Number(a)-Number(b),
    spinStart:()=>{},spinEnd:()=>{},toast:()=>{},updateTimes:()=>{},esc:x=>x,
    h:()=>new Node(),$: (selector,node)=>node.parts[selector]||(node.parts[selector]=new Node()),
    IntersectionObserver:class{constructor(fn){observers.push(fn);}observe(){}},
    api:async(p,opts)=>{calls.push(p);return handler(p,opts,calls.length);},
    notifEl:n=>{
      const el=new Node();el._notification=n;el._st=n.status;el.dataset.nid=n.id;el.dataset.sid=n.status.id;el.paints=0;
      el._paint=()=>el.paints++;
      el.quote={refreshes:0,getBoundingClientRect:()=>({top:200,bottom:300}),getClientRects:()=>[{}],_loadQuote:()=>el.quote.refreshes++};
      made.push(el);return el;
    }
  });
  vm.runInContext(keyCode+reconcile+feed,ctx);
  return{ctx,calls,made,animations,checks,observers,hidden,acc,key:data=>ctx.cardContentKey(data),open:()=>ctx.feedView('/api/v1/notifications',{kind:'notif'}),run:s=>vm.runInContext(s,ctx)};
}
test('content keys ignore object ordering and action counts but retain body, author and quote policy changes',()=>{
  const f=fixture(),a=notice(),b=clone(a);b.status={...Object.fromEntries(Object.entries(b.status).reverse()),favourites_count:5,favourited:true,bookmarked:true,replies_count:2};
  assert.equal(f.key(a),f.key(b));
  for(const mutate of [n=>n.status.content='edited',n=>n.account.display_name='new name',n=>n.status.quote.state='revoked',n=>n.status.quote.quoted_status_id='400',n=>n.status.filtered=[{filter:{filter_action:'hide'}}]]){
    const changed=clone(a);mutate(changed);assert.notEqual(f.key(a),f.key(changed));
  }
});
test('unchanged refresh preserves the same card and quoted DOM without animating the list',async()=>{
  const f=fixture(async()=>({data:[notice()],next:null})),root=f.open();await tick();
  const list=root.children[0],card=list.children[0],quote=card.quote;quote.expanded=true;
  await root.refresh();await root.refresh();
  assert.equal(list.children[0],card);assert.equal(card.quote,quote);assert.equal(quote.expanded,true);assert.equal(f.made.length,1);assert.equal(quote.refreshes,2);assert.equal(f.animations.length,0);
});
test('count-only changes paint existing buttons and retain the original status object used by actions',async()=>{
  const row=notice(),f=fixture(async()=>({data:[clone(row)]})),root=f.open();await tick();const card=root.children[0].children[0],captured=card._st;
  Object.assign(row.status,{favourites_count:5,favourited:true,replies_count:2,bookmarked:true});await root.refresh();
  assert.equal(root.children[0].children[0],card);assert.equal(card._st,captured);assert.equal(card._st.favourites_count,5);assert.equal(card._st.favourited,true);assert.equal(card._st.bookmarked,true);assert.equal(card.paints,1);
});
test('new, removed and reordered notifications update only the affected cards',async()=>{
  let rows=[notice('100','200'),notice('90','201')];const f=fixture(async()=>({data:clone(rows)})),root=f.open();await tick();const list=root.children[0],[first,second]=list.children;
  rows=[notice('110','202'),rows[1],rows[0]];await root.refresh();assert.deepEqual(list.children.slice(1),[second,first]);assert.equal(f.made.length,3);
  rows=[rows[0],rows[2]];await root.refresh();assert.equal(list.children[1],first);assert.equal(second.parentNode,null);assert.equal(f.made.length,3);
});
test('an edited post, a changed quote target or revoked quote cannot reuse the old quoted body',async()=>{
  for(const mutate of [n=>n.status.content='new body',n=>n.status.quote.quoted_status_id='500',n=>n.status.quote.state='revoked']){
    let row=notice();const f=fixture(async()=>({data:clone([row])})),root=f.open();await tick();const old=root.children[0].children[0];mutate(row);await root.refresh();
    assert.notEqual(root.children[0].children[0],old);assert.equal(old.parentNode,null);assert.equal(f.made.length,2);
  }
});
test('a slow or failed refresh keeps the displayed card and concurrent refreshes share the request',async()=>{
  const gate=defer(),f=fixture(async(p,o,n)=>n===1?{data:[notice()]}:gate.promise),root=f.open();await tick();const card=root.children[0].children[0];
  const task=root.refresh();assert.equal(task,root.refresh());assert.equal(root.children[0].children[0],card);gate.reject(new Error('timeout'));await task;
  assert.equal(root.children[0].children[0],card);assert.equal(f.made.length,1);assert.equal(f.calls.length,2);assert.equal(f.animations.length,0);
});
test('known unavailable notifications are removed during refresh and later pruning still works',async()=>{
  const f=fixture(async()=>({data:[notice(),notice('90','201')]})),root=f.open();await tick();const list=root.children[0],kept=list.children[1];
  f.hidden.add('200');await root.refresh();assert.deepEqual(list.children,[kept]);f.hidden.add('201');root.pruneNotifications();assert.equal(list.children.length,0);
});
test('pagination appends unique notifications and a reset retains the first-page cards',async()=>{
  const f=fixture(async p=>({data:p.includes('max_id=')?[notice('90','201')]:[notice()]})),root=f.open();await tick();const list=root.children[0],first=list.children[0];
  f.observers[0]([{isIntersecting:true}]);await tick();assert.equal(list.children.length,2);assert.equal(list.children[0],first);
  await root.refresh();assert.deepEqual(list.children,[first]);assert.equal(f.made.length,2);
});
test('background quote revalidation skips cards outside the viewport or hidden by a collapsed warning',async()=>{
  const f=fixture(async()=>({data:[notice()]})),root=f.open();await tick();const quote=root.children[0].children[0].quote;
  quote.getBoundingClientRect=()=>({top:5000,bottom:5100});await root.refresh();assert.equal(quote.refreshes,0);
  quote.getBoundingClientRect=()=>({top:0,bottom:0});quote.getClientRects=()=>[];await root.refresh();assert.equal(quote.refreshes,0);
});
