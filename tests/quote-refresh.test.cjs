const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const keyCode=html.slice(html.indexOf('function cardContentKey('),html.indexOf('/* 인용글 카드 */'));
const code=html.slice(html.indexOf('function loadingQuote('),html.indexOf('function quoteEl('));
const status=()=>({id:'300',account:{id:'99'},content:'<p>원문</p>',favourites_count:1});
const defer=()=>{let resolve,reject;return{promise:new Promise((r,j)=>{resolve=r;reject=j;}),resolve:v=>resolve(v),reject:e=>reject(e)};};
function fixture(handler=async()=>status()){
  const acc={id:'1',instance:'a.test',token:'private-a'},calls=[],diagnostics=[],bodies=[],hidden={};let current=acc;
  const container={node:null};
  class Node{
    constructor(){this.isConnected=false;this.buttons=[];this.label={textContent:''};this.events={};}
    addEventListener(type,fn){this.events[type]=fn;}
    querySelectorAll(selector){return selector==='button'?this.buttons:[];}
    append(node){this.buttons.push(node);node.remove=()=>{this.buttons=this.buttons.filter(b=>b!==node);};}
    replaceWith(next){assert.equal(container.node,this);this.isConnected=false;next.isConnected=true;container.node=next;}
  }
  const ctx=vm.createContext({Object,Array,JSON,String,
    SYNC_KEYS:['favourited','reblogged','bookmarked','favourites_count','reblogs_count','replies_count'],
    cur:()=>current,LS:{get:()=>hidden},unavailableKey:()=>'',recordDiag:(kind,data)=>diagnostics.push({kind,...data}),
    h:()=>new Node(),$:(_,node)=>node.label,
    loadQuotedStatus:async(target,me,opts)=>{calls.push({target,me,opts});return handler(target,me,opts,calls.length);},
    quoteBody:(s,opts)=>{const node=new Node();node.status=s;node.options=opts;bodies.push(node);return node;},
    IntersectionObserver:class{observe(){}disconnect(){}}
  });
  vm.runInContext(keyCode+code,ctx);
  const box=ctx.loadingQuote({id:'300'},acc);box.isConnected=true;container.node=box;
  return{acc,calls,diagnostics,bodies,hidden,container,box,load:()=>container.node._loadQuote(),switchAccount:()=>current={...acc,id:'2'}};
}
test('an unchanged or count-only quote response preserves the exact node and expanded media state',async()=>{
  const f=fixture(async(t,a,o,n)=>({...status(),favourites_count:n}));await f.load();const card=f.container.node;card.expanded=true;
  await f.load();assert.equal(f.container.node,card);assert.equal(card.expanded,true);assert.equal(f.bodies.length,1);
});
test('a slow refresh keeps the completed quote visible and does not start duplicate lookups',async()=>{
  const gate=defer(),f=fixture(async(t,a,o,n)=>n===1?status():gate.promise);await f.load();const card=f.container.node;
  const pending=f.load();await f.load();assert.equal(f.calls.length,2);assert.equal(f.container.node,card);gate.resolve(status());await pending;assert.equal(f.container.node,card);
});
test('changed quoted content is replaced only after the new body arrives',async()=>{
  const gate=defer(),f=fixture(async(t,a,o,n)=>n===1?status():gate.promise);await f.load();const old=f.container.node;
  const pending=f.load();assert.equal(f.container.node,old);gate.resolve({...status(),content:'<p>수정됨</p>'});await pending;assert.notEqual(f.container.node,old);assert.equal(f.container.node.status.content,'<p>수정됨</p>');
});
test('temporary network or server failures retain the last successfully displayed quote',async()=>{
  for(const statusCode of [0,429,503]){
    const f=fixture(async(t,a,o,n)=>{if(n>1)throw Object.assign(new Error('temporary'),{status:statusCode});return status();});await f.load();const card=f.container.node;await f.load();
    assert.equal(f.container.node,card);assert.equal(f.diagnostics.at(-1).outcome,'error');
  }
});
test('deletion, lost authorization and unverifiable quote responses remove the old body and allow retry',async()=>{
  for(const failure of [{status:401},{status:403},{status:404},{status:410},{code:'quote_unavailable'}]){
    const f=fixture(async(t,a,o,n)=>{if(n===2)throw Object.assign(new Error('unavailable'),failure);return status();});await f.load();const old=f.container.node;await f.load();
    assert.equal(f.container.node,f.box);assert.equal(old.isConnected,false);assert.match(f.box.label.textContent,/볼 수 없|삭제/);assert.equal(f.box.buttons.length,1);
    f.box.buttons[0].onclick({stopPropagation(){}});await new Promise(setImmediate);assert.notEqual(f.container.node,f.box);assert.equal(f.calls.at(-1).opts.retry,true);
  }
});
test('an initially failed quote still offers guidance and does not accumulate retry buttons',async()=>{
  const f=fixture(async()=>{throw new Error('offline');});await f.load();await f.load();assert.equal(f.box.buttons.length,1);assert.match(f.box.label.textContent,/다시 시도/);
});
test('late results cannot repaint a disconnected card or a different signed-in account',async()=>{
  for(const action of [f=>f.container.node.isConnected=false,f=>f.switchAccount()]){
    const gate=defer(),f=fixture(()=>gate.promise),pending=f.load();action(f);gate.resolve(status());await pending;assert.equal(f.bodies.length,0);assert.equal(f.container.node,f.box);
  }
});
test('a known unavailable quote is rerendered even when its cached status is otherwise unchanged',async()=>{
  const f=fixture();await f.load();const old=f.container.node;f.hidden['300']=true;await f.load();assert.notEqual(f.container.node,old);assert.equal(f.bodies.length,2);
});
test('explicitly revealing a filtered quote retains revalidation on the newly displayed node',async()=>{
  const f=fixture();await f.load();const old=f.container.node,next={...old,isConnected:false};old.replaceWith(next);old.options.onReplace(next);
  assert.equal(typeof next._loadQuote,'function');await next._loadQuote();assert.equal(f.calls.length,2);assert.equal(f.container.node,next);
});
test('quote refresh diagnostics do not include account credentials, target IDs or bodies',async()=>{
  const f=fixture();await f.load();assert.doesNotMatch(JSON.stringify(f.diagnostics),/private-a|a\.test|300|원문/);
});
