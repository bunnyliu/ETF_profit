'use strict';
const CACHE = 'etf-pages-v1';
const BASE = new URL('./', self.location.href);
const ASSETS = ['./','./index.html','./style.css','./app.mjs','./portfolio.mjs','./market.mjs','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
const URLS = ASSETS.map(path => new URL(path, BASE).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('etf-pages-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(new URL('./index.html', BASE).href)));
  } else if (URLS.includes(url.href)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  }
  // Market requests bypass the worker cache. Last successful data is stored with
  // its original collection timestamp by the page, and shown as old when offline.
});
