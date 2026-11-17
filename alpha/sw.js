/* pilot.fiyesi.com is retired (owner, 17 Nov 2026). This worker replaces the old ones, clears every cache it kept and lets go, so phones fetch the page that sends them to alpha.fiyesi.com. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.registration.unregister();for(const c of await self.clients.matchAll({type:'window'}))c.navigate(c.url);})()));
