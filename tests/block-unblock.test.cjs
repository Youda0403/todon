const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('const blockUnblockJobs ='),html.indexOf('async function followBtn('));
const relation=(blocking=false)=>({id:'22',following:false,followed_by:false,requested:false,blocking});
function fixture(handler=async action=>relation(action==='block')){
  const calls=[],acc={id:'1',instance:'a.test',token:'private-a'},target={id:'22'};
  const context=vm.createContext({Promise,Map,Error,Object,String,encodeURIComponent,api:async(p,opt)=>{
    const action=p.split('/').at(-1);calls.push({path:p,action,...opt});return handler(action,opt,calls.length);
  }});
  vm.runInContext(source,context);
  return {calls,acc,target,run:(opts={})=>context.blockUnblock(target,acc,opts)};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(setImmediate);

test('one block-unblock operation ends unblocked with both follow directions disconnected',async()=>{
  const f=fixture(),r=await f.run();
  assert.deepEqual(f.calls.map(c=>c.action),['block','unblock']);assert.equal(r.blocking,false);assert.equal(r.following,false);assert.equal(r.followed_by,false);
  assert.ok(f.calls.every(c=>c.method==='POST'&&c.path.startsWith('/api/v1/accounts/22/')&&c.timeout===10000));
});
test('unblocking waits for the block request to settle',async()=>{
  const gate=deferred(),f=fixture(action=>action==='block'?gate.promise:relation());const task=f.run();await tick();
  assert.deepEqual(f.calls.map(c=>c.action),['block']);gate.resolve(relation(true));await task;assert.equal(f.calls[1].action,'unblock');
});
test('repeated clicks share one operation and later independent actions can run again',async()=>{
  const gate=deferred(),f=fixture(action=>action==='block'?gate.promise:relation());const a=f.run(),b=f.run();assert.equal(a,b);
  gate.resolve(relation(true));await a;assert.equal(f.calls.length,2);await f.run();assert.equal(f.calls.length,4);
});
test('an account or target change during the block cannot redirect the unblock to another account',async()=>{
  const gate=deferred(),f=fixture(action=>action==='block'?gate.promise:relation());const task=f.run();
  f.acc.instance='b.test';f.acc.id='2';f.acc.token='private-b';f.target.id='33';gate.resolve(relation(true));await task;
  assert.ok(f.calls.every(c=>c.acc.instance==='a.test'&&c.acc.id==='1'&&c.acc.token==='private-a'&&c.path.includes('/22/')));
});
test('a rejected block does not send an unnecessary unblock or report success',async()=>{
  for(const status of [401,403,404,429]){
    const f=fixture(async()=>{throw Object.assign(new Error('rejected'),{status});});await assert.rejects(f.run(),e=>e.status===status);
    assert.deepEqual(f.calls.map(c=>c.action),['block']);
  }
});
test('an uncertain block result still attempts to clear a block that may have reached the server',async()=>{
  for(const error of [Object.assign(new Error('timeout'),{code:'timeout'}),Object.assign(new Error('network'),{code:'network'}),Object.assign(new Error('server'),{status:500})]){
    const f=fixture(async action=>{if(action==='block')throw error;return relation();});assert.equal((await f.run()).blocking,false);
    assert.deepEqual(f.calls.map(c=>c.action),['block','unblock']);
  }
});
test('a temporary unblock failure retries only the unblock once',async()=>{
  let unblocks=0;const f=fixture(async action=>{if(action==='block')return relation(true);if(++unblocks===1)throw Object.assign(new Error('temporary'),{status:503});return relation();});
  await f.run();assert.deepEqual(f.calls.map(c=>c.action),['block','unblock','unblock']);
});
test('persistent unblock failures surface a retryable phase and manual recovery never blocks again',async()=>{
  let fail=true;const f=fixture(async action=>{if(action==='block')return relation(true);if(fail)throw new Error('offline');return relation();});
  await assert.rejects(f.run(),e=>e.phase==='unblock'&&/해제를 다시 시도/.test(e.message));assert.equal(f.calls.length,3);
  fail=false;await f.run({unblockOnly:true});assert.deepEqual(f.calls.map(c=>c.action),['block','unblock','unblock','unblock']);
});
test('an account already blocked can be unblocked without a new block request',async()=>{
  const f=fixture();await f.run({unblockOnly:true});assert.deepEqual(f.calls.map(c=>c.action),['unblock']);
});
test('an authorization rejection during unblock remains a recovery error without repeated writes',async()=>{
  const f=fixture(async action=>{if(action==='block')return relation(true);throw Object.assign(new Error('expired'),{status:401});});
  await assert.rejects(f.run(),e=>e.phase==='unblock'&&e.cause.status===401);assert.deepEqual(f.calls.map(c=>c.action),['block','unblock']);
});
test('missing, mismatched and still-blocked responses cannot count as a successful unblock',async()=>{
  for(const bad of [null,{...relation(),id:'33'},relation(true),{id:'22',blocking:false}]){
    const f=fixture(async action=>action==='block'?relation(true):bad);await assert.rejects(f.run(),e=>e.phase==='unblock');assert.equal(f.calls.length,3);
  }
});
test('malformed block responses still clear a potentially applied block',async()=>{
  const f=fixture(async action=>action==='block'?null:relation());await f.run();assert.deepEqual(f.calls.map(c=>c.action),['block','unblock']);
});
test('self and unsafe target IDs are rejected before any request',async()=>{
  for(const id of ['1','../other',9007199254740993,'']){const f=fixture();f.target.id=id;await assert.rejects(f.run());assert.equal(f.calls.length,0);}
});
