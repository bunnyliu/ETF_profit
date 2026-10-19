'use strict';
const CACHE = 'etf-shell-v1';
const ASSETS = ['/static/style.css','/static/app.js','/static/pwa.js','/static/icon.svg','/static/icon-192.png','/static/icon-512.png','/static/offline.html'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('etf-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/static/offline.html')));
  } else if(ASSETS.includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  }
  // Portfolio, CSV, authentication responses and market data are never cached.
});
