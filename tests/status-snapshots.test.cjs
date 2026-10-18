const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const code=html.slice(html.indexOf('const statusSnapshots ='),html.indexOf('function requestOperation('));
const a={id:'a',instance:'server.test'},b={id:'b',instance:'server.test'},other={id:'a',instance:'other.test'};
const status=id=>({id:String(id),account:{id:'author'},content:'received content'});
function fixture(){let now=0;class Clock extends Date{static now(){return now;}}const hidden=new Map();const ctx=vm.createContext({Date:Clock,Map,LS:{get:(k,d)=>hidden.get(k)||d},a,b,other});vm.runInContext(code,ctx);return {ctx,hidden,advance:ms=>now+=ms,run:s=>vm.runInContext(s,ctx),remember:(data,acc='a')=>{ctx.data=data;vm.runInContext(`rememberStatusData(data,${acc})`,ctx);}};}
test('timeline, notification and context responses provide the already received body',()=>{
  const f=fixture();f.remember([status(1),{status:status(2)}]);f.remember({ancestors:[status(3)],descendants:[status(4)]});
  for(const id of [1,2,3,4])assert.equal(f.run(`readStatusSnapshot('${id}',a).content`),'received content');
});
test('identical IDs in different accounts or servers cannot disclose another account’s cached body',()=>{
  const f=fixture();f.remember(status(1));assert.equal(f.run("readStatusSnapshot('1',b)"),null);assert.equal(f.run("readStatusSnapshot('1',other)"),null);
});
test('snapshots expire and remain bounded; clicking an older visible card can warm it again',()=>{
  const f=fixture();f.remember(Array.from({length:220},(_,i)=>status(i)));assert.equal(f.run('statusSnapshots.size'),200);assert.equal(f.run("readStatusSnapshot('1',a)"),null);
  f.remember(status(1));assert.ok(f.run("readStatusSnapshot('1',a)"));f.advance(300001);assert.equal(f.run("readStatusSnapshot('1',a)"),null);
});
test('known unavailable statuses are not displayed and deletion invalidation respects server boundaries',()=>{
  const f=fixture();for(const acc of ['a','b','other'])f.remember(status(1),acc);
  f.hidden.set('ytt.unavailable.server.test:a',{'1':1});assert.equal(f.run("readStatusSnapshot('1',a)"),null);
  f.run("forgetStatusSnapshots('1',a,true)");assert.equal(f.run("readStatusSnapshot('1',b)"),null);assert.ok(f.run("readStatusSnapshot('1',other)"));
});
test('account records and incomplete objects cannot become status snapshots',()=>{
  const f=fixture();f.remember([{id:'1',username:'user'},{id:'2',content:'no author'},{id:'3',account:{id:'user'}}]);assert.equal(f.run('statusSnapshots.size'),0);
});
