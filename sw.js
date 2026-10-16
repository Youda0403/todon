// 역극툿 서비스 워커: 앱 화면 파일만 캐시하고, 마스토돈 서버 요청은 건드리지 않음
const CACHE = 'ytt-v5';
const BADGES = ['dm', 'reply', 'mention', 'fav', 'boost', 'status', 'follow', 'quote', 'default'].map(k => `./badge-${k}.png`);
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
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
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
});

// 브라우저가 푸시 연결을 바꿨다면 열린 앱에 재등록을 부탁한다.
// 인증 토큰은 서비스 워커에 따로 저장하지 않는다. 앱이 닫혀 있으면 다음 실행 때 실제 등록을 점검한다.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    cs.forEach(c => c.postMessage({type:'push-repair'}));
  })());
});

// 어느 계정의 알림인지 앱이 알아볼 수 있게, 토큰 대신 토큰의 짧은 지문만 넘김
async function tokHint(t) {
  if (!t || !self.crypto || !crypto.subtle) return '';
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
}

// 알림 내용을 종류별로 다르게 꾸미기 (쪽지·답글·멘션·좋아요·부스트·새 글·팔로우·인용)
const plainText = html => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/^(\s*@[\w.-]+(@[\w.-]+)?)+\s*/, '').trim();
function describe(n, meId) {
  const name = (n.account && (n.account.display_name || n.account.username)) || '누군가';
  const s = n.status;
  const text = s ? (s.spoiler_text ? '⚠ ' + s.spoiler_text : (plainText(s.content) || (s.media_attachments && s.media_attachments.length ? '사진' : ''))) : '';
  const dm = n.type === 'mention' && s && s.visibility === 'direct';
  // 답글: 내 글에 단 답글 + 대화 속 답글(상대가 자기 글에 이어 쓰면서 나를 부른 경우 등)
  const reply = n.type === 'mention' && s && !!s.in_reply_to_id;
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
  }[n.type];
  return t ? { title: t[0], body: t[1], kind: n.type } : null;
}
// 상단 상태 표시줄에 뜨는 작은 아이콘: 종류마다 다르게
const BADGE_OF = { dm: 'dm', reply: 'reply', mention: 'mention', favourite: 'fav', reblog: 'boost', status: 'status', follow: 'follow', follow_request: 'follow', quote: 'quote', quoted_update: 'quote' };
const badgeFor = kind => `badge-${BADGE_OF[kind] || 'default'}.png`;
async function readAccounts() {
  try { const c = await caches.open('ytt-meta'); const r = await c.match('./ytt-accounts.json'); return r ? await r.json() : []; } catch (_) { return []; }
}

// 휴대폰 알림: 앱이 화면에 떠 있으면 앱 안 팝업으로, 아니면 시스템 알림으로
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const vis = cs.find(c => c.visibilityState === 'visible');
    if (vis) { vis.postMessage({ type: 'push' }); return; }
    const hint = await tokHint(d.access_token);
    let title = d.title || '역극툿', body = d.body || '', kind = d.notification_type || 'other';
    const acc = (await readAccounts()).find(a => a.hint && a.hint === hint);
    if (acc && d.notification_id && d.access_token) {
      try {
        const r = await fetch(`https://${acc.instance}/api/v1/notifications/${d.notification_id}`, { headers: { Authorization: 'Bearer ' + d.access_token } });
        if (r.ok) { const x = describe(await r.json(), acc.id); if (x) { title = x.title; body = x.body; kind = x.kind; } }
      } catch (_) {}
    }
    await self.registration.showNotification(title, {
      body,
      icon: d.icon || 'icon-192.png',
      badge: badgeFor(kind),
      vibrate: [80, 40, 80],
      timestamp: Date.now(),
      tag: 'ytt-' + (d.notification_id || Date.now()),
      data: { id: d.notification_id || null, hint }
    });
  })());
});

// 알림을 누르면: 열려 있는 앱 창을 앞으로 가져와 그 알림 화면으로 이동.
// 뒤에 오래 있던 창은 멈춰 있어서 이동 요청을 못 받을 수 있음 → 1.5초 안에 '받았어요' 답이 없으면 그 창을 알림 주소로 새로 엶
function askOpen(c, hash) {
  return new Promise(res => {
    const ch = new MessageChannel();
    const done = ok => { clearTimeout(t); ch.port1.close(); res(ok); };
    const t = setTimeout(() => done(false), 1500);
    ch.port1.onmessage = () => done(true);
    try { c.postMessage({ type: 'open', hash }, [ch.port2]); } catch (_) { done(false); }
  });
}
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { id, hint } = e.notification.data || {};
  const hash = id ? `#/open/${id}/${hint || ''}` : '#/notifications';
  const url = new URL('./' + hash, self.registration.scope).href;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 지금 보고 있는 창 → 화면에 떠 있는 창 → 가장 최근에 쓴 창 순서로 고름
    const c = cs.find(x => x.focused) || cs.find(x => x.visibilityState === 'visible') || cs[0];
    if (!c) { await self.clients.openWindow(url); return; }
    try { await c.focus(); } catch (_) {}
    if (await askOpen(c, hash)) return;
    try { if (await c.navigate(url)) return; } catch (_) {}
    await self.clients.openWindow(url);
  })());
});

