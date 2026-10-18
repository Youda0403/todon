const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const code = html.slice(html.indexOf('const diagEvents ='), html.indexOf('/* ---------- 로그인 (OAuth)'));
function fixture(fetch, document){
  const context=vm.createContext({fetch,document,Date,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,hideUnavailableStatuses:()=>{},restoreAvailableStatuses:()=>{},cur:()=>({instance:'private.example',token:'private-token'})});
  vm.runInContext(code,context);
  return {run:s=>vm.runInContext(s,context),events:()=>JSON.parse(vm.runInContext('JSON.stringify(diagEvents)',context))};
}
const response=(status,data)=>({status,ok:status<400,text:async()=>JSON.stringify(data),json:async()=>data,headers:{get:()=>null}});
test('request timing contains categories and status without credentials, paths, or bodies',async()=>{
  const f=fixture(async()=>response(200,{content:'private response'}));
  await f.run("api('/api/v1/statuses/123/context?secret=private-query', {method:'POST', body:{status:'private draft'}})");
  const entry=f.events()[0];assert.equal(entry.api,'statuses/context');assert.equal(entry.method,'POST');assert.equal(entry.status,200);assert.ok(entry.ms>=0);
  assert.doesNotMatch(JSON.stringify(f.events()),/private|\/statuses\/123|secret|token/);
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
test('request groups and phases distinguish a single status, context, batch and account history without identifiers',async()=>{
  const f=fixture(async()=>response(200,{}));
  for(const p of ['/api/v1/statuses/123','/api/v1/statuses/123/context','/api/v1/statuses?id[]=123','/api/v1/accounts/456/statuses'])await f.run(`api(${JSON.stringify(p)},{trace:7})`);
  const events=f.events();assert.deepEqual(events.map(e=>e.operation),['status-single','thread-context','status-batch','account-posts']);
  assert.ok(events.every(e=>e.trace===7&&e.headersMs>=0&&e.bodyMs>=0&&e.decodeMs>=0&&e.outcome==='ok'));assert.equal(new Set(events.map(e=>e.seq)).size,4);
  assert.doesNotMatch(JSON.stringify(events),/\/statuses\/123|\/accounts\/456|private|token/);
  await f.run("api('/api/v1/statuses',{trace:'private-token'})");assert.equal(f.events().at(-1).trace,undefined);
});

test('request diagnostics record whether the page was hidden at start and completion',async()=>{
  const document={hidden:true};const f=fixture(async()=>{document.hidden=false;return response(200,{});},document);
  await f.run("api('/api/v1/statuses/123')");
  assert.equal(f.events()[0].hiddenStart,true);assert.equal(f.events()[0].hiddenEnd,false);
});
