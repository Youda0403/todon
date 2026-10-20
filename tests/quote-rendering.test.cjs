const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function quoteStatusURL('),html.indexOf('function linkedQuote('));
const status=(id='200',url='https://a.test/@author/'+id)=>({id,account:{id:'99'},content:'<p>quoted content</p>',url,uri:url});
const defer=()=>{let resolve,reject;return{promise:new Promise((r,j)=>{resolve=r;reject=j;}),resolve:v=>resolve(v),reject:e=>reject(e)};};
const tick=()=>new Promise(setImmediate);
function fixture(handler=async()=>status()){
  const calls=[],acc={id:'1',instance:'a.test',token:'private-a'};let now=0;
  class Clock extends Date{static now(){return now;}}
  const ctx=vm.createContext({URL,URLSearchParams,Promise,Map,Date:Clock,Number,String,Object,Error,Array,encodeURIComponent,
    qs:x=>new URLSearchParams(x).toString(),api:async(p,opt)=>{calls.push({path:p,...opt});return handler(p,opt,calls.length);}});
  vm.runInContext(source,ctx);
  return{ctx,calls,acc,parse:v=>ctx.quoteStatusURL(v),fetch:(target,me=acc)=>ctx.fetchQuotedStatus(target,me),load:(target,me=acc,opts)=>ctx.loadQuotedStatus(target,me,opts),advance:ms=>now+=ms};
}
test('Mastodon post URLs keep exact long IDs and normalize tracking, fragments and trailing slashes',()=>{
  const f=fixture();for(const url of ['https://a.test/@author/117471234567890123','https://a.test/users/author/statuses/117471234567890123','https://a.test/web/statuses/117471234567890123/?ref=x#y']){
    const parsed=f.parse(url);assert.equal(parsed.id,'117471234567890123');assert.equal(parsed.origin,'https://a.test');assert.doesNotMatch(parsed.url,/[?#]/);
  }
});
test('profile, hashtag, article, unsafe and unrelated URLs are not guessed to be quoted posts',()=>{
  const f=fixture();for(const url of ['https://a.test/@author','https://a.test/tags/123','https://a.test/@author/article','https://a.test/@author/123/edit','https://a.test/123','http://a.test/@author/123','javascript:alert(1)','https://token@a.test/@author/123','not a URL'])assert.equal(f.parse(url),null,url);
});
test('URL matching accepts canonical URI aliases but never equals a post on a different server',()=>{
  const f=fixture();assert.equal(f.ctx.sameQuoteURL('https://a.test/@old/200?x=y','https://a.test/users/new/statuses/200'),true);assert.equal(f.ctx.sameQuoteURL('https://a.test/@a/200','https://b.test/@a/200'),false);
});
test('embedded and shallow quotes retain their authorization state and exact target IDs',()=>{
  const f=fixture(),embedded=status();assert.equal(f.ctx.quoteInfo(embedded).status,embedded);
  assert.equal(f.ctx.quoteInfo({state:'accepted',quoted_status:embedded}).status,embedded);assert.equal(f.ctx.quoteInfo({state:'accepted',quoted_status_id:'12345678901234567890'}).id,'12345678901234567890');
  for(const state of ['pending','rejected','revoked','deleted','unauthorized','blocked_account','muted_account','unknown'])assert.equal(f.ctx.quoteInfo({state,quoted_status_id:'200'}).state,state);
});
test('local URLs and shallow quote IDs request the exact status using the viewing account',async()=>{
  const f=fixture();await f.fetch({url:'https://a.test/@author/200'});await f.fetch({id:'200'});assert.ok(f.calls.every(c=>c.path==='/api/v1/statuses/200'&&c.acc===f.acc));
});
test('foreign URLs resolve through the viewing server and use the returned local status ID',async()=>{
  const foreign='https://remote.test/@author/800',f=fixture(async()=>({statuses:[status('900',foreign)]}));
  const s=await f.fetch({url:foreign});assert.equal(s.id,'900');const p=new URL(f.calls[0].path,'https://a.test');assert.equal(p.pathname,'/api/v2/search');assert.equal(p.searchParams.get('q'),foreign);assert.equal(p.searchParams.get('resolve'),'true');assert.equal(p.searchParams.get('type'),'statuses');assert.equal(f.calls[0].acc,f.acc);
});
test('an unrelated search result cannot substitute a different quoted post',async()=>{
  const f=fixture(async()=>({statuses:[status('900','https://remote.test/@a/801')]}));await assert.rejects(f.fetch({url:'https://remote.test/@a/800'}),e=>e.code==='quote_unavailable');
  const exact=fixture(async()=>({statuses:[status('999','https://wrong.test/@a/800'),status('900','https://remote.test/users/a/statuses/800')]}));assert.equal((await exact.fetch({url:'https://remote.test/@a/800'})).id,'900');
});
test('missing, malformed and mismatched local responses never become quote cards',async()=>{
  for(const bad of [null,status('201'),{id:'200',content:'no account'},status(9007199254740993)]){const f=fixture(async()=>bad);await assert.rejects(f.fetch({id:'200'}),e=>e.code==='quote_unavailable');}
});
test('unsafe shallow IDs fail before making requests',async()=>{
  const f=fixture();for(const id of ['../other',9007199254740993])await assert.rejects(f.fetch({id}));assert.equal(f.calls.length,0);
});
test('duplicate URLs, local aliases and native IDs share one lookup',async()=>{
  const gate=defer(),f=fixture(()=>gate.promise);const a=f.load({url:'https://a.test/@a/200'}),b=f.load({id:'200'}),c=f.load({url:'https://a.test/users/a/statuses/200'});assert.equal(a,b);assert.equal(a,c);gate.resolve(status());await a;assert.equal(f.calls.length,1);
});
test('lookup results stay separated by account and instance',async()=>{
  const f=fixture();await f.load({id:'200'});await f.load({id:'200'},{...f.acc,id:'2'});await f.load({id:'200'},{...f.acc,instance:'b.test'});assert.equal(f.calls.length,3);
});
test('only two quote requests run at once and queued work starts as soon as one finishes',async()=>{
  const gates=[defer(),defer(),defer()],f=fixture((p,o,n)=>gates[n-1].promise);const jobs=['200','201','202'].map(id=>f.load({id}));await tick();assert.equal(f.calls.length,2);gates[0].resolve(status('200'));await tick();assert.equal(f.calls.length,3);gates[1].resolve(status('201'));gates[2].resolve(status('202'));await Promise.all(jobs);assert.equal(vm.runInContext('activeQuoteLookups',f.ctx),0);
});
test('queued requests retain the original account even if that account object changes',async()=>{
  const gates=[defer(),defer(),defer()],f=fixture((p,o,n)=>gates[n-1].promise),jobs=['200','201','202'].map(id=>f.load({id}));f.acc.instance='other.test';f.acc.token='new-token';gates[0].resolve(status('200'));await tick();assert.ok(f.calls.every(c=>c.acc.instance==='a.test'&&c.acc.token==='private-a'));gates[1].resolve(status('201'));gates[2].resolve(status('202'));await Promise.all(jobs);
});
test('successful lookup caching expires rather than retaining old quote bodies indefinitely',async()=>{
  const f=fixture();await f.load({id:'200'});await f.load({id:'200'});assert.equal(f.calls.length,1);f.advance(30001);await f.load({id:'200'});assert.equal(f.calls.length,2);
});
test('temporary failures have a short cooldown and a manual retry can immediately recover',async()=>{
  let failed=true;const f=fixture(async()=>{if(failed)throw new Error('offline');return status();});await assert.rejects(f.load({id:'200'}));await assert.rejects(f.load({id:'200'}));assert.equal(f.calls.length,1);failed=false;await f.load({id:'200'},f.acc,{retry:true});assert.equal(f.calls.length,2);
  failed=true;await assert.rejects(f.load({id:'201'}));f.advance(10001);await assert.rejects(f.load({id:'201'}));assert.equal(f.calls.length,4);
});
test('completed lookup storage remains bounded',async()=>{
  const f=fixture(async p=>status(p.split('/').at(-1)));for(let i=0;i<130;i++)await f.load({id:String(i+200)});assert.equal(vm.runInContext('quoteLookups.size',f.ctx),100);
});
test('a failed request releases its queue slot so other quotes can continue loading',async()=>{
  const gate=defer(),f=fixture(async(p,o,n)=>{if(n===1)return gate.promise;return status(p.split('/').at(-1));});const a=f.load({id:'200'}),caught=assert.rejects(a),b=f.load({id:'201'}),c=f.load({id:'202'});gate.reject(new Error('timeout'));await Promise.all([caught,b,c]);assert.equal(f.calls.length,3);assert.equal(vm.runInContext('activeQuoteLookups',f.ctx),0);
});
test('wrapper responses use the displayed original only after validating the requested wrapper',async()=>{
  const f=fixture(async()=>({...status('200'),reblog:status('201')}));assert.equal((await f.fetch({id:'200'})).id,'201');
});
