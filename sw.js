// 역극툿 서비스 워커: 앱 화면 파일만 캐시하고, 마스토돈 서버 요청은 건드리지 않음
const CACHE = 'ytt-v2';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
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

// 휴대폰 알림: 앱이 화면에 떠 있으면 앱 안 팝업으로, 아니면 시스템 알림으로
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const vis = cs.find(c => c.visibilityState === 'visible');
    if (vis) { vis.postMessage({ type: 'push' }); return; }
    const hint = await tokHint(d.access_token);
    await self.registration.showNotification(d.title || '역극툿', {
      body: d.body || '',
      icon: d.icon || 'icon-192.png',
      badge: 'icon-192.png',
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
