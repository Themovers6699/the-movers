// Minimal service worker so phones and tablets can install The Movers as an app.
// It deliberately caches NOTHING: every request goes to the network, so crews always get the latest version
// and no customer data is ever stored by the worker. (Offline mode was decided against for v1.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* no respondWith: the browser handles every request normally */ });
