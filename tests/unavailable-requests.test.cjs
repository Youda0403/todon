const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const code = html.slice(html.indexOf('async function api('),html.indexOf('/* ---------- 로그인 (OAuth)'));
const response = (status,data) => ({status,ok:status>=200&&status<300,json:async()=>data,text:async()=>JSON.stringify(data),headers:{get:()=>null}});
function fixture(fetch, fast=false){
  const hidden=[],restored=[],delays=[];let cleared=0;
  const context=vm.createContext({fetch,AbortController,Date,URL,
    setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,fast?Math.min(ms,5):ms);},clearTimeout:id=>{cleared++;clearTimeout(id);},
    cur:()=>({id:'a',instance:'test',token:'secret'}),recordDiag:()=>{},
    hideUnavailableStatuses:(ids,a)=>hidden.push({ids:[...ids],account:a.id}),restoreAvailableStatuses:ids=>restored.push([...ids])});
  vm.runInContext(code,context);
  return {run:s=>vm.runInContext(s,context),hidden,restored,delays,get cleared(){return cleared;}};
}
const untilAbort=signal=>new Promise((resolve,reject)=>{
  const stop=()=>reject(Object.assign(new Error('abort'),{name:'AbortError'}));
  if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
});
test('unresponsive reads abort after the 10-second budget and release their timer',async()=>{
  const f=fixture((url,opts)=>untilAbort(opts.signal),true);
  await assert.rejects(f.run("api('/api/v1/statuses/10')"),e=>e.code==='timeout'&&/불러오기를 멈췄어요/.test(e.message));
  assert.deepEqual(f.delays,[10000]);assert.equal(f.cleared,1);assert.equal(f.hidden.length,0);
});
test('the timeout also covers a stalled response body',async()=>{
  const f=fixture(async(url,opts)=>({...response(200,{}),text:()=>untilAbort(opts.signal)}),true);
  await assert.rejects(f.run("api('/api/v1/statuses/10')"),e=>e.code==='timeout');assert.equal(f.hidden.length,0);
});
test('callers can cancel reads without classifying cancellation as missing content',async()=>{
  const f=fixture((url,opts)=>untilAbort(opts.signal));
  const promise=f.run("globalThis.abortRequest=new AbortController();api('/api/v1/statuses/10',{signal:abortRequest.signal})");
  f.run('abortRequest.abort()');await assert.rejects(promise,e=>e.code==='aborted'&&e.name==='AbortError');assert.equal(f.hidden.length,0);assert.equal(f.cleared,1);
});
test('confirmed API 404 and 410 status reads hide only that status for the requesting account',async()=>{
  for(const status of [404,410]){
    const f=fixture(async()=>response(status,{error:'Record not found'}));
    await assert.rejects(f.run("api('/api/v1/statuses/10')"),e=>e.code==='unavailable'&&e.statusId==='10'&&/삭제|볼 수 없어요/.test(e.message));
    assert.deepEqual(f.hidden,[{ids:['10'],account:'a'}]);
  }
});
test('an HTML 404 from an unavailable server never hides notifications',async()=>{
  const f=fixture(async()=>({...response(404,{}),json:async()=>{throw new SyntaxError('HTML');}}));
  await assert.rejects(f.run("api('/api/v1/statuses/10')"),e=>e.status===404&&e.code!=='unavailable');assert.equal(f.hidden.length,0);
});
test('context endpoints and failed writes do not classify their parent status as deleted',async()=>{
  const f=fixture(async()=>response(404,{error:'Record not found'}));
  await assert.rejects(f.run("api('/api/v1/statuses/10/context')"));
  await assert.rejects(f.run("api('/api/v1/statuses/10',{method:'PUT'})"));
  assert.equal(f.hidden.length,0);assert.deepEqual(f.delays,[10000,60000]);
});
test('auth, rate limits, network errors and invalid responses keep notifications',async()=>{
  for(const status of [401,403,429,500,503]){
    const f=fixture(async()=>response(status,{error:'temporary'}));
    await assert.rejects(f.run("api('/api/v1/statuses/10')"),e=>e.status===status&&e.code!=='unavailable');assert.equal(f.hidden.length,0);
  }
  const network=fixture(async()=>{throw new Error('DNS');});
  await assert.rejects(network.run("api('/api/v1/statuses/10')"),e=>e.code==='network');assert.equal(network.hidden.length,0);
  const invalid=fixture(async()=>({...response(200,{}),text:async()=>'<html>gone</html>'}));
  await assert.rejects(invalid.run("api('/api/v1/statuses/10')"),e=>e.code==='invalid_response');assert.equal(invalid.hidden.length,0);
});
test('successful reads restore a previously unavailable status and preserve normal data',async()=>{
  const f=fixture(async()=>response(200,{id:'10',content:'ok'}));
  assert.equal((await f.run("api('/api/v1/statuses/10')")).id,'10');assert.deepEqual(f.restored,[['10']]);assert.equal(f.cleared,1);
});
test('writes and media have longer budgets and preserve uncertain-result wording',async()=>{
  const f=fixture((url,opts)=>untilAbort(opts.signal),true);
  await assert.rejects(f.run("api('/api/v1/statuses',{method:'POST',body:{status:'draft'}})"),e=>e.code==='timeout'&&/반영 여부/.test(e.message));
  await assert.rejects(f.run("api('/api/v2/media',{method:'POST',form:{}})"),e=>e.code==='timeout');assert.deepEqual(f.delays,[60000,120000]);
});
