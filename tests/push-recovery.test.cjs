const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const apiCode = html.slice(html.indexOf('async function api('), html.indexOf('/* ---------- 로그인 (OAuth)'));
const pushCode = html.slice(html.indexOf('const pushState ='), html.indexOf('const POP_TXT ='));
const key = Buffer.from([1, 2, 3]).toString('base64url');
const otherKey = Buffer.from([4, 5, 6]).toString('base64url');
const endpoint = 'https://push.example/current';
const allAlerts = {mention:true, favourite:true, reblog:true, follow:true, follow_request:true, status:true, quote:true, quoted_update:true, poll:true, update:false};
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
function fixture(opts = {}){
  const accounts = ['a','b'].map(n => ({acct:n + '@server.example', username:n, instance:'server.example', token:'token-' + n, id:n}));
  const data = new Map([
    ['ytt.accounts', accounts],
    ['ytt.push', opts.enabled === false ? {} : Object.fromEntries(accounts.map(a => [a.acct, true]))]
  ]);
  const calls = [], rows = new Map();
  accounts.forEach(a => rows.set(a.token, {endpoint, server_key:key, alerts:{...allAlerts}}));
  let sub = opts.noBrowser ? null : makeSub(endpoint, opts.oldKey || key, opts.expired ? 1 : null);
  let subscribes = 0, unsubscribes = 0, permissions = 0;
  function makeSub(url, publicKey, expirationTime = null){
    return {expirationTime, options:{applicationServerKey:Buffer.from(publicKey, 'base64url')},
      toJSON:() => ({endpoint:url, keys:{p256dh:'public-p256dh', auth:'test-auth'}}),
      unsubscribe:async () => { unsubscribes++; sub = null; return true; }};
  }
  const manager = {
    getSubscription:async () => sub,
    subscribe:async options => {
      subscribes++;
      if (opts.subscribeError) throw Object.assign(new Error('browser refused'), {name:opts.subscribeError});
      sub = makeSub('https://push.example/renewed-' + subscribes, Buffer.from(options.applicationServerKey).toString('base64url'));
      return sub;
    }
  };
  const clone = v => structuredClone(v);
  const context = vm.createContext({
    accounts, cur:() => accounts[0], location:{protocol:'https:'}, isIOS:false, isStandalone:true, pushAlerts:() => ({...allAlerts}),
    LS:{get:(k, fallback) => clone(data.has(k) ? data.get(k) : fallback), set:(k,v) => data.set(k,clone(v))},
    document:{hidden:false, querySelectorAll:() => []}, window:{PushManager:function(){}, Notification:function(){}},
    navigator:{onLine:opts.offline ? false : true, serviceWorker:{ready:Promise.resolve({pushManager:manager})}},
    Notification:{permission:opts.permission || 'granted', requestPermission:async () => { permissions++; return opts.permissionGate ? opts.permissionGate.promise : 'granted'; }},
    btoa:s => Buffer.from(s,'binary').toString('base64'), atob:s => Buffer.from(s,'base64').toString('binary'),
    Uint8Array, AbortController, URL, setTimeout, clearTimeout, Date,
    fetch:async (url, options) => {
      const method = options.method || 'GET', token = options.headers.Authorization.slice(7);
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({url, method, token, body, signal:options.signal});
      if (opts.intercept){ const result = await opts.intercept({url, method, token, body}); if (result) return response(result.status, result.body); }
      if (url.endsWith('/api/v2/instance')) return response(200, {configuration:{vapid:{public_key:opts.serverKey || key}}});
      if (method === 'GET') return rows.has(token) ? response(200, rows.get(token)) : response(404, {error:'Record not found'});
      if (method === 'DELETE'){ rows.delete(token); return response(200, {}); }
      if (method === 'POST') rows.set(token, {endpoint:body.subscription.endpoint, server_key:opts.serverKey || key, alerts:body.data.alerts});
      if (method === 'PUT') rows.get(token).alerts = body.data.alerts;
      return response(200, rows.get(token));
    }
  });
  function response(status, body){ return {status, ok:status>=200 && status<300, text:async () => JSON.stringify(body), json:async () => body}; }
  vm.runInContext(apiCode + pushCode, context);
  return {context, data, rows, calls, accounts, run:s => vm.runInContext(s, context),
    get subscribed(){return subscribes;}, get unsubscribed(){return unsubscribes;}, get permissions(){return permissions;}, get sub(){return sub;}};
}
test('healthy registrations: checks both accounts without replacing or prompting', async () => {
  const f=fixture(); await f.run('checkPush({force:true})');
  assert.equal(f.calls.length,2); assert.ok(f.calls.every(c=>c.method==='GET' && c.signal));
  assert.equal(f.subscribed,0); assert.equal(f.unsubscribed,0); assert.equal(f.permissions,0);
  assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].state,'ok');
});
test('server lost all registrations: renews browser once and restores enabled accounts', async () => {
  const f=fixture(); f.rows.clear(); await f.run('checkPush({force:true})');
  assert.equal(f.subscribed,1); assert.equal(f.unsubscribed,1); assert.equal(f.rows.size,2);
  assert.ok([...f.rows.values()].every(r=>r.endpoint==='https://push.example/renewed-1'));
  assert.ok(f.calls.filter(c=>c.method==='POST').every(c=>c.body.subscription.standard===true));
  assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].reason,'server_missing');
});
test('one account lost registration: preserves healthy shared browser connection', async () => {
  const f=fixture(); f.rows.delete('token-b'); await f.run('checkPush({force:true})');
  assert.equal(f.subscribed,0); assert.equal(f.unsubscribed,0);
  assert.deepEqual(f.calls.filter(c=>c.method==='POST').map(c=>c.token),['token-b']);
  assert.equal(f.rows.get('token-b').endpoint,endpoint);
});
test('browser lost registration: restores all accounts to one new endpoint', async () => {
  const f=fixture({noBrowser:true}); await f.run('checkPush({force:true})');
  assert.equal(f.subscribed,1); assert.equal(f.calls.filter(c=>c.method==='POST').length,2);
  assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].reason,'browser_missing');
});
test('expired browser subscription: replaces before registering', async () => {
  const f=fixture({expired:true}); await f.run('checkPush({force:true})');
  assert.equal(f.unsubscribed,1); assert.equal(f.subscribed,1);
  assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].reason,'browser_expired');
});
test('browser endpoint changed: posts new address without unsubscribing it', async () => {
  const f=fixture(); f.rows.forEach(r=>r.endpoint='https://push.example/obsolete');
  await f.run('checkPush({force:true})'); assert.equal(f.unsubscribed,0);
  assert.ok([...f.rows.values()].every(r=>r.endpoint===endpoint));
  assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].reason,'browser_changed');
});
test('server key changed: resubscribes with new key', async () => {
  const f=fixture({serverKey:otherKey}); f.rows.forEach(r=>r.server_key=otherKey);
  await f.run('checkPush({force:true})'); assert.equal(f.subscribed,1);
  assert.equal(Buffer.from(f.sub.options.applicationServerKey).toString('base64url'),otherKey);
});
test('disabled notifications remain disabled without network calls', async () => {
  const f=fixture({enabled:false}); await f.run('checkPush({force:true})');
  assert.equal(f.calls.length,0); assert.equal(f.permissions,0); assert.equal(f.subscribed,0);
});
test('only enabled accounts are repaired', async () => {
  const f=fixture(); f.data.set('ytt.push', {[f.accounts[0].acct]:true}); f.rows.clear();
  await f.run('checkPush({force:true})'); assert.ok(f.calls.every(c=>c.token==='token-a'));
  assert.equal(f.rows.size,1); assert.equal(f.data.get('ytt.push')[f.accounts[1].acct],undefined);
});
test('revoked permission does not prompt or reset preferences', async () => {
  const f=fixture({permission:'denied'}); await f.run('checkPush({force:true})');
  assert.equal(f.calls.length,0); assert.equal(f.permissions,0);
  assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].reason,'permission');
  assert.equal(f.data.get('ytt.push')[f.accounts[0].acct],true);
});
test('offline check is deferred without destructive requests', async () => {
  const f=fixture({offline:true}); await f.run('checkPush({force:true})');
  assert.equal(f.calls.length,0); assert.equal(f.unsubscribed,0);
  f.context.navigator.onLine=true; await f.run('checkPush({force:true})');
  assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].state,'ok');
});
test('401 and 429 are reported without rotating a working connection', async () => {
  for (const status of [401,429,503]){
    const f=fixture({intercept:async()=>({status,body:{error:'temporary'}})});
    await f.run('checkPush({force:true})');
    assert.equal(f.subscribed,0); assert.equal(f.unsubscribed,0); assert.ok(f.calls.every(c=>c.method==='GET'));
    assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].status,status);
  }
});
test('multiple automatic triggers share a queue and do not retry immediately', async () => {
  const f=fixture(); await f.run('Promise.all([checkPush(),checkPush(),checkPush()])');
  assert.equal(f.calls.length,2); assert.equal(f.subscribed,0);
});
test('cooldown skips automatic checks before reading storage or requesting locks', async () => {
  const f=fixture(); let locks=0;
  f.context.navigator.locks={request:async(name,fn)=>{ locks++; return fn(); }};
  await f.run('checkPush()');
  let reads=0; const get=f.context.LS.get;
  f.context.LS.get=(...args)=>{ reads++; return get(...args); };
  await f.run('Promise.all([checkPush(),checkPush(),checkPush()])');
  assert.equal(reads,0); assert.equal(locks,1); assert.equal(f.calls.length,2);
  await f.run('checkPush({force:true})');
  assert.equal(locks,2); assert.equal(f.calls.length,4);
});
test('hidden automatic checks skip storage and locks without blocking explicit repairs', async () => {
  const f=fixture(); let reads=0,locks=0; const get=f.context.LS.get;
  f.context.document.hidden=true;
  f.context.LS.get=(...args)=>{ reads++; return get(...args); };
  f.context.navigator.locks={request:async(name,fn)=>{ locks++; return fn(); }};
  await f.run('checkPush()');
  assert.equal(reads,0); assert.equal(locks,0); assert.equal(f.calls.length,0);
  await f.run('checkPush({force:true})');
  assert.equal(locks,1); assert.equal(f.calls.length,2);
});
test('notification preference changes update server without rotating browser', async () => {
  const f=fixture(); f.rows.forEach(r=>r.alerts.mention=false);
  await f.run('updatePushAlerts()'); assert.equal(f.calls.filter(c=>c.method==='PUT').length,2);
  assert.ok([...f.rows.values()].every(r=>r.alerts.mention)); assert.equal(f.subscribed,0);
});
test('turning off during a repair wins over the in-flight registration', async () => {
  const gate=defer(), started=defer();
  const f=fixture({intercept:async({method})=>{if(method==='POST'){started.resolve();await gate.promise;}}});
  f.rows.clear(); const repair=f.run('checkPush({force:true})'); await started.promise;
  const off=f.run('disablePush()'); gate.resolve(); await Promise.all([repair,off]);
  assert.deepEqual(f.data.get('ytt.push'),{}); assert.equal(f.rows.size,0); assert.equal(f.sub,null);
});
test('turning off while an enable permission request waits cancels enable', async () => {
  const gate=defer(), f=fixture({permissionGate:gate});
  const enable=f.run('enablePush()'); await f.run('disablePush()'); gate.resolve('granted'); await enable;
  assert.deepEqual(f.data.get('ytt.push'),{}); assert.equal(f.subscribed,0);
});
test('automatic subscription refusal surfaces a retry button state without a permission prompt', async () => {
  const f=fixture({noBrowser:true,subscribeError:'NotAllowedError'}); await f.run('checkPush({force:true})');
  assert.equal(f.permissions,0); assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].reason,'retry');
});
test('connection log has causes and status, never credentials or endpoint', async () => {
  const f=fixture(); f.rows.clear(); await f.run('checkPush({force:true})');
  const log=JSON.stringify(f.data.get('ytt.push.log')); assert.ok(log.includes('server_missing'));
  for(const forbidden of ['token-a','token-b','test-auth','push.example','p256dh']) assert.ok(!log.includes(forbidden));
});
test('a failed POST keeps the opt-in and is retried on a later connection check', async () => {
  let fail=true;
  const f=fixture({intercept:async({method})=>method==='POST' && fail ? {status:503,body:{error:'unavailable'}} : null});
  f.rows.clear(); await f.run('checkPush({force:true})');
  assert.equal(f.data.get('ytt.push')[f.accounts[0].acct],true);
  assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].state,'error');
  fail=false; await f.run('checkPush({force:true})');
  assert.equal(f.rows.size,2); assert.equal(f.data.get('ytt.push.health')[f.accounts[0].acct].state,'ok');
});
test('an account removed in another window is not re-registered', async () => {
  const f=fixture(); f.data.set('ytt.accounts',[]); await f.run('checkPush({force:true})');
  assert.equal(f.calls.length,0); assert.equal(f.subscribed,0);
});
test('uses the browser lock when available', async () => {
  const f=fixture(); let locks=0;
  f.context.navigator.locks={request:async(name,fn)=>{assert.equal(name,'ytt-push');locks++;return fn();}};
  await f.run('checkPush({force:true})'); assert.equal(locks,1); assert.equal(f.calls.length,2);
});
test('service worker signals subscription changes without persisting credentials', async () => {
  const events=new Map(), messages=[];
  const self={addEventListener:(n,fn)=>events.set(n,fn),clients:{matchAll:async()=>[{postMessage:m=>messages.push(m)}]}};
  const context=vm.createContext({self});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),context);
  let promise; events.get('pushsubscriptionchange')({waitUntil:p=>promise=p}); await promise;
  assert.equal(messages.length,1); assert.equal(messages[0].type,'push-repair');
  assert.equal(vm.runInContext("describe({type:'mention',account:{username:'a'},status:{content:'hi',in_reply_to_id:'1',in_reply_to_account_id:'a'}},'b').kind",context),'reply');
});
