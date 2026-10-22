// 역극툿 서비스 워커: 앱 화면 파일만 캐시하고, 마스토돈 서버 요청은 건드리지 않음
const CACHE = 'ytt-v5';
const WORKER_VERSION = '2026-10-23.2';
const BADGES = ['dm', 'reply', 'mention', 'fav', 'boost', 'status', 'follow', 'quote', 'default'].map(k => `./badge-${k}.png`);
async function appClients(){
  const scope = new URL(self.registration.scope);
  const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
  return clients.filter(c => {
    try{ const url = new URL(c.url); return url.origin === scope.origin && url.pathname.startsWith(scope.pathname); }
    catch(e){ return false; }
  });
}
function exactNotificationId(value){
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}
function notificationTarget(n,meId = null){
  if (!['mention','status','favourite','reblog','quote','quoted_update','poll','update','follow','follow_request'].includes(n.type)) return {kind:'list',id:'-'};
  const s = n.status?.reblog || n.status;
  if (s){ const id = exactNotificationId(s.id); return id ? {kind:notificationDisplayType(n,meId) === 'mention' && s.visibility === 'direct' ? 'chat' : 'thread',id} : {kind:'list',id:'-'}; }
  if (['mention','favourite','reblog','status','quote','quoted_update','poll','update'].includes(n.type)) return {kind:'list',id:'-'};
  const id = ['follow','follow_request'].includes(n.type) && exactNotificationId(n.account?.id);
  return id ? {kind:'user',id} : {kind:'list',id:'-'};
}
function validNotificationTarget(target){
  return !!target && (target.kind === 'list' ? target.id === '-' : ['thread','chat','user','notification'].includes(target.kind) && !!exactNotificationId(target.id));
}
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', ...BADGES];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'ytt-meta').map(k => caches.delete(k)))));
  self.clients.claim();
});

// 같은 사이트 파일: 저장해 둔 것을 바로 보여 주고(빠르게 열림), 뒤에서 새 버전을 받아 둠.
// 앱 화면 파일이 바뀌었으면 열린 앱에 '새 버전이 있어요'를 알림
async function notifyUpdate() {
  const cs = await appClients();
  cs.forEach(c => c.postMessage({ type: 'update' }));
}
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isPage = e.request.mode === 'navigate';
    const key = isPage ? './' : e.request;
    const cached = await cache.match(key, { ignoreSearch: true });
    const before = cached ? cached.clone() : null;
    const net = fetch(e.request).then(async r => {
      if (r && r.ok) {
        await cache.put(key, r.clone());
        if (isPage && before) {
          const [oldText, newText] = await Promise.all([before.text(), r.clone().text()]);
          if (oldText !== newText) await notifyUpdate();
        }
      }
      return r;
    }).catch(() => null);
    if (cached) { e.waitUntil(net); return cached; }
    return (await net) || new Response('인터넷에 연결되어 있지 않아요', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});

// 앱이 새로고침할 때 '새 버전 있나?' 확인 부탁 → 화면 파일을 서버에서 새로 받아 비교
async function checkPage() {
  try {
    const cache = await caches.open(CACHE);
    const before = await cache.match('./', { ignoreSearch: true });
    const r = await fetch('./', { cache: 'no-store' });
    if (!r || !r.ok) return;
    const newText = await r.clone().text();
    const oldText = before ? await before.text() : null;
    await cache.put('./', r);
    if (oldText !== null && oldText !== newText) await notifyUpdate();
  } catch (_) {}
}
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'check') e.waitUntil(checkPage());
  if (e.data?.type === 'worker-info'){
    e.source?.postMessage({type:'worker-info',version:WORKER_VERSION,routeVersion:4});
    const task = sendPushDiagnostics(e.source); if (e.waitUntil) e.waitUntil(task);
  }
  if (e.data?.type === 'notification-open-claim' && e.ports?.[0]){
    const task = claimNotificationIntent(e.data.hash,e.source?.url).catch(() => false).then(accepted => e.ports[0].postMessage({type:'notification-open-claim',accepted}));
    e.waitUntil(task);
  }
});

/* 실제 클릭만 짧게 보관하고 확인·삭제를 같은 큐에서 처리한다. */
let notificationIntentTask = Promise.resolve();
function changeNotificationIntents(change){
  const task = notificationIntentTask.catch(() => {}).then(async () => {
    const cache = await caches.open('ytt-meta'), key = new URL('./ytt-notification-opens.json',self.registration.scope).href;
    const stored = await cache.match(key), data = stored ? await stored.json() : [], now = Date.now();
    const entries = (Array.isArray(data) ? data : []).filter(x => x && typeof x.hash === 'string' && Number.isFinite(x.at) && now >= x.at && now - x.at < 120000).slice(-20);
    const result = change(entries);
    await cache.put(key,new Response(JSON.stringify(entries.slice(-20)),{headers:{'Content-Type':'application/json'}}));
    return result;
  });
  notificationIntentTask = task;
  return task;
}
async function issueNotificationIntent(hash){
  const nonce = [...self.crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2,'0')).join('');
  const target = hash + '/' + nonce;
  await changeNotificationIntents(entries => entries.push({hash:target,at:Date.now()}));
  return target;
}
function claimNotificationIntent(hash,clientURL){
  try{
    const url = new URL(clientURL), scope = new URL(self.registration.scope);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return Promise.resolve(false);
  }catch(e){ return Promise.resolve(false); }
  if (typeof hash !== 'string' || !/^#\/notice\/[A-Za-z0-9_-]{1,128}\/(?:[a-f0-9]{12})?\/(?:thread|chat|user|list|notification)\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{32}$/.test(hash)) return Promise.resolve(false);
  return changeNotificationIntents(entries => {
    const i = entries.findIndex(x => x.hash === hash);
    if (i < 0) return false;
    entries.splice(i,1); return true;
  });
}

// 브라우저가 푸시 연결을 바꿨다면 열린 앱에 재등록을 부탁한다.
// 인증 토큰은 서비스 워커에 따로 저장하지 않는다. 앱이 닫혀 있으면 다음 실행 때 실제 등록을 점검한다.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const cs = await appClients();
    cs.forEach(c => c.postMessage({type:'push-repair'}));
  })());
});

// 어느 계정의 알림인지 앱이 알아볼 수 있게, 토큰 대신 토큰의 짧은 지문만 넘김
async function tokHint(t) {
  if (!t || !self.crypto || !crypto.subtle) return '';
  try {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return [...new Uint8Array(b)].slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
  } catch (_) { return ''; }
}

// 알림 내용을 종류별로 다르게 꾸미기 (쪽지·답글·멘션·좋아요·부스트·새 글·팔로우·인용)
const plainText = html => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/^(\s*@[\w.-]+(@[\w.-]+)?)+\s*/, '').trim();
function isReply(n) { return n.type === 'mention' && !!n.status && !!(n.status.in_reply_to_id || n.status.in_reply_to_account_id); }
function notificationDisplayType(n,meId){
  const s = n.status?.reblog || n.status;
  if (n.type !== 'status' || !s || meId === null || meId === undefined) return n.type;
  const toMe = s.in_reply_to_account_id !== null && s.in_reply_to_account_id !== undefined && String(s.in_reply_to_account_id) === String(meId);
  const mentioned = Array.isArray(s.mentions) && s.mentions.some(m => m?.id !== null && m?.id !== undefined && String(m.id) === String(meId));
  return toMe || mentioned ? 'mention' : n.type;
}
function describe(n, meId) {
  const name = (n.account && (n.account.display_name || n.account.username)) || '누군가';
  const s = n.status?.reblog || n.status;
  const type = notificationDisplayType(n,meId);
  const text = s ? (s.spoiler_text ? '⚠ ' + s.spoiler_text : (plainText(s.content) || (s.media_attachments && s.media_attachments.length ? '사진' : ''))) : '';
  const dm = type === 'mention' && s && s.visibility === 'direct';
  // 답글: 내 글에 단 답글 + 대화 속 답글(상대가 자기 글에 이어 쓰면서 나를 부른 경우 등)
  const reply = isReply({...n,type,status:s});
  if (dm) return { title: `${name} · 쪽지`, body: text, kind: 'dm' };
  if (reply) return { title: `${name} · 답글`, body: text, kind: 'reply' };
  const t = {
    mention: [`${name} · 멘션`, text],
    favourite: [`${name}님이 내 글을 좋아해요`, text],
    reblog: [`${name}님이 내 글을 부스트했어요`, text],
    status: [`${name} · 새 글`, text],
    follow: [`${name}님이 나를 팔로우했어요`, ''],
    follow_request: [`${name}님이 팔로우를 요청했어요`, ''],
    quote: [`${name}님이 내 글을 인용했어요`, text],
    quoted_update: [`${name}님이 내가 인용한 글을 수정했어요`, text],
    poll: ['투표가 끝났어요', text],
    update: [`${name}님이 글을 수정했어요`, text]
  }[type];
  return t ? { title: t[0], body: t[1], kind: type } : null;
}
// 상단 상태 표시줄에 뜨는 작은 아이콘: 종류마다 다르게
const BADGE_OF = { dm: 'dm', reply: 'reply', mention: 'mention', favourite: 'fav', reblog: 'boost', status: 'status', follow: 'follow', follow_request: 'follow', quote: 'quote', quoted_update: 'quote' };
const badgeFor = kind => `badge-${BADGE_OF[kind] || 'default'}.png`;
async function readAccounts() {
  try {
    const c = await caches.open('ytt-meta'), r = await c.match('./ytt-accounts.json');
    const list = r ? await r.json() : [];
    return Array.isArray(list) ? list : [];
  } catch (_) { return []; }
}
// 푸시의 mention만으로는 답글과 일반 멘션을 구분할 수 없다.
// 상세 조회는 전체 10초. 일시 실패는 한 번 재시도하고, 실패해도 알림은 표시한다.
async function describePush(d, acc, diagnostic) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      diagnostic.attempts = attempt + 1;
      try {
        const r = await fetch(`https://${acc.instance}/api/v1/notifications/${encodeURIComponent(d.notification_id)}`, {
          headers: { Authorization: 'Bearer ' + d.access_token }, signal: controller.signal
        });
        diagnostic.status = r.status;
        if (!r.ok) { diagnostic.outcome = 'http'; if (!attempt && r.status >= 500 && !controller.signal.aborted) continue; return null; }
        const n = await r.json();
        diagnostic.receivedType = safePushType(n?.type); diagnostic.typeMismatch = !!d.notification_type && n?.type !== d.notification_type; diagnostic.hasStatus = !!n?.status;
        if (!n || exactNotificationId(n.id) !== d.notification_id || (n.type === 'mention' && !n.status)){ diagnostic.outcome = 'invalid'; return null; }
        const described = describe(n,acc.id);
        const target = notificationTarget(n,acc.id);
        if (!described || target.kind === 'list'){ diagnostic.outcome = 'invalid'; return null; }
        diagnostic.outcome = 'ok'; diagnostic.displayKind = described.kind;
        return {...described,target};
      } catch (error) { diagnostic.outcome = controller.signal.aborted ? 'timeout' : error?.name === 'SyntaxError' ? 'invalid' : 'network'; if (controller.signal.aborted || attempt) return null; }
    }
  } finally { clearTimeout(timer); }
  return null;
}

function safePushType(type){ return ['mention','status','favourite','reblog','follow','follow_request','quote','quoted_update','poll','update','dm','reply'].includes(type) ? type : 'other'; }
/* 백그라운드의 실패 이유도 다음 실행 때 확인한다. 주소·번호·토큰·본문은 저장하지 않는다. */
let pushDiagnosticTask = Promise.resolve();
function recordPushDiagnostic(diagnostic){
  const task = pushDiagnosticTask.catch(() => {}).then(async () => {
    const cache = await caches.open('ytt-meta'), key = new URL('./ytt-push-diagnostics.json',self.registration.scope).href;
    const old = await cache.match(key); let entries = [];
    try{ entries = old ? await old.json() : []; }catch(e){}
    if (!Array.isArray(entries)) entries = [];
    entries.push({at:Date.now(),...diagnostic});
    await cache.put(key,new Response(JSON.stringify(entries.slice(-20)),{headers:{'Content-Type':'application/json'}}));
  });
  pushDiagnosticTask = task;
  return task.catch(() => {});
}
async function sendPushDiagnostics(client){
  try{
    const url = new URL(client?.url), scope = new URL(self.registration.scope);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
    await pushDiagnosticTask.catch(() => {});
    const cache = await caches.open('ytt-meta'), stored = await cache.match(new URL('./ytt-push-diagnostics.json',self.registration.scope).href);
    const entries = stored ? await stored.json() : [];
    if (Array.isArray(entries) && entries.length) client.postMessage({type:'push-diagnostics',entries:entries.slice(-20)});
  }catch(e){}
}

function askVisiblePush(client, id, hint){
  return new Promise(resolve => {
    const channel = new MessageChannel(); let settled = false;
    const done = handled => { if (settled) return; settled = true; clearTimeout(timer); channel.port1.close(); resolve(handled); };
    /* 화면은 기한 전까지만 처리하고, 전송 중인 확인 응답에는 100ms 여유를 둔다. */
    const expiresAt = Date.now() + 2000, timer = setTimeout(() => done(false),2100);
    channel.port1.onmessage = e => done(e.data?.type === 'push-handled' && e.data.handled === true);
    try{ client.postMessage({type:'push',deliveryVersion:1,id,hint,expiresAt},[channel.port2]); }catch(e){ done(false); }
  });
}
// 수신 계정의 열린 화면이 실제로 처리했을 때만 시스템 알림을 생략한다.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  const notificationId = exactNotificationId(d.notification_id);
  d.notification_id = notificationId;
  e.waitUntil((async () => {
    const cs = await appClients();
    const hint = await tokHint(d.access_token);
    if (hint && d.notification_id){
      const visible = cs.filter(c => c.visibilityState === 'visible').sort((a,b) => Number(!!b.focused) - Number(!!a.focused));
      for (const client of visible) if (await askVisiblePush(client,d.notification_id,hint).catch(() => false)) return;
    }
    // 미확인 미리보기는 종류·본문을 단정하지 않고, 누르면 정확한 알림 번호로 다시 확인한다.
    let title = '새 알림', body = '앱을 열어 알림을 확인해 주세요.', kind = 'other';
    let target = d.notification_id ? {kind:'notification',id:d.notification_id} : {kind:'list',id:'-'};
    const acc = (await readAccounts()).find(a => a && a.instance && a.hint && a.hint === hint);
    const diagnostic = {typeHint:safePushType(d.notification_type),receivedType:'other',displayKind:'other',outcome:'account-unknown',hasAccount:!!acc,status:0,attempts:0,typeMismatch:false,hasStatus:false};
    if (acc && d.notification_id && d.access_token) {
      const x = await describePush(d, acc,diagnostic);
      if (x) { title = x.title; body = x.body; kind = x.kind; target = x.target; }
    }
    await self.registration.showNotification(title, {
      body,
      icon: d.icon || 'icon-192.png',
      badge: badgeFor(kind),
      vibrate: [80, 40, 80],
      timestamp: Date.now(),
      tag: 'ytt-' + (hint || 'unmatched') + '-' + (d.notification_id || Date.now()),
      data: {id:d.notification_id || null,hint,routeVersion:4,workerVersion:WORKER_VERSION,target}
    });
    await recordPushDiagnostic(diagnostic);
  })());
});

// 알림을 누르면: 열려 있는 앱 창을 앞으로 가져와 그 알림 화면으로 이동.
// 뒤에 오래 있던 창은 멈춰 있어서 이동 요청을 못 받을 수 있음 → 1.5초 안에 '받았어요' 답이 없으면 그 창을 알림 주소로 새로 엶
function askOpen(c, hash) {
  return new Promise(res => {
    const ch = new MessageChannel();
    const done = ok => { clearTimeout(t); ch.port1.close(); res(ok); };
    const t = setTimeout(() => done(false), 1500);
    ch.port1.onmessage = e => done(e.data === 'ok');
    try { c.postMessage({ type: 'open', hash }, [ch.port2]); } catch (_) { done(false); }
  });
}
let notificationClickGeneration = 0, notificationClickTask = Promise.resolve();
self.addEventListener('notificationclick', e => {
  const click = ++notificationClickGeneration;
  e.notification.close();
  const data = e.notification.data || {}, id = exactNotificationId(data.id), hint = /^[a-f0-9]{12}$/.test(data.hint || '') ? data.hint : '';
  const valid = [2,3,4].includes(data.routeVersion) && validNotificationTarget(data.target);
  const recover = data.routeVersion === 4 && data.target?.kind === 'notification' && exactNotificationId(data.target.id) === id;
  const target = valid && (data.target.kind !== 'notification' || recover) ? data.target : {kind:'list',id:'-'};
  const baseHash = id ? `#/notice/${id}/${hint}/${target.kind}/${target.id}` : '#/notifications';
  const task = notificationClickTask.catch(() => {}).then(async () => {
    if (click !== notificationClickGeneration) return;
    let hash = baseHash;
    if (id){
      try{ hash = await issueNotificationIntent(baseHash); }
      catch(e){ hash = '#/notifications'; }
    }
    if (click !== notificationClickGeneration) return;
    const url = new URL('./' + hash,self.registration.scope).href;
    const cs = await appClients();
    if (click !== notificationClickGeneration) return;
    // 이 앱의 창 안에서 지금 보는 창 → 보이는 창 → 최근 창 순서로 고름
    const c = cs.find(x => x.focused) || cs.find(x => x.visibilityState === 'visible') || cs[0];
    if (!c) { await self.clients.openWindow(url); return; }
    try { await c.focus(); } catch (_) {}
    if (click !== notificationClickGeneration) return;
    const accepted = await askOpen(c, hash);
    if (accepted || click !== notificationClickGeneration) return;
    try { if (await c.navigate(url)) return; } catch (_) {}
    if (click !== notificationClickGeneration) return;
    await self.clients.openWindow(url);
  });
  notificationClickTask = task; e.waitUntil(task);
});


