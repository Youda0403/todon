// 역극툿 서비스 워커: 앱 화면 파일만 캐시하고, 마스토돈 서버 요청은 건드리지 않음
const CACHE = 'ytt-v4';
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

// 같은 사이트 파일은 네트워크 우선(업데이트 바로 반영), 오프라인이면 캐시
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
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
  const reply = n.type === 'mention' && s && String(s.in_reply_to_account_id) === String(meId);
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

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { id, hint } = e.notification.data || {};
  const hash = id ? `#/open/${id}/${hint || ''}` : '#/notifications';
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if ('focus' in c) { await c.focus(); c.postMessage({ type: 'open', hash }); return; }
    }
    await self.clients.openWindow('./' + hash);
  })());
});
