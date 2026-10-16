const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const code = html.slice(html.indexOf('const diagEvents ='), html.indexOf('/* ---------- 로그인 (OAuth)'));
function fixture(fetch){
  const context=vm.createContext({fetch,Date,URL,URLSearchParams,cur:()=>({instance:'private.example',token:'private-token'})});
  vm.runInContext(code,context);
  return {run:s=>vm.runInContext(s,context),events:()=>JSON.parse(vm.runInContext('JSON.stringify(diagEvents)',context))};
}
const response=(status,data)=>({status,ok:status<400,text:async()=>JSON.stringify(data),json:async()=>data,headers:{get:()=>null}});
test('request timing contains categories and status without credentials, paths, or bodies',async()=>{
  const f=fixture(async()=>response(200,{content:'private response'}));
  await f.run("api('/api/v1/statuses/123/context?secret=private-query', {method:'POST', body:{status:'private draft'}})");
  const entry=f.events()[0];assert.equal(entry.api,'statuses/context');assert.equal(entry.method,'POST');assert.equal(entry.status,200);assert.ok(entry.ms>=0);
  assert.doesNotMatch(JSON.stringify(f.events()),/private|123|secret|token/);
});
test('HTTP errors and network failures are timed while preserving errors',async()=>{
  for(const status of [401,429,503]){
    const f=fixture(async()=>response(status,{error:'temporary'}));
    await assert.rejects(f.run("api('/api/v1/statuses')"));assert.equal(f.events()[0].status,status);
  }
  const f=fixture(async()=>{throw new Error('network');});
  await assert.rejects(f.run("api('/api/v1/statuses')"));assert.equal(f.events()[0].status,0);
});
test('diagnostic memory stays bounded',()=>{
  const f=fixture(async()=>response(200,{}));
  f.run("for(let i=0;i<100;i++) recordDiag('fixture', {number:i})");
  assert.equal(f.events().length,80);assert.equal(f.events()[0].number,20);
});
