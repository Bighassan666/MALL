// Akwaaba Mall service worker: app shell works offline; catalog/config fall back to the last copy.
const VERSION = 'akw-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon-32.png', '/fonts/archivo.woff2', '/fonts/figtree.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(async (c) => { await c.addAll(SHELL); await Promise.all(['/api/catalog', '/api/config'].map((u) => c.add(u).catch(() => {}))); }).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/admin')) return;
  if (url.pathname === '/api/catalog' || url.pathname === '/api/config') { // network first, cached fallback
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); return r; }).catch(() => caches.match(req)));
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // orders, tracking, accounts: always live
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); } return r; }).catch(() => hit || caches.match('/index.html'));
    return hit || net; // stale-while-revalidate
  }));
});
