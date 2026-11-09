/* Keeps the pilot page and its fonts so Fiyesi opens with no signal after the first visit. It never caches shop records: those live on the phone, not on the network. */
'use strict';
const CACHE='fiyesi-pilot-site-v5',PAGE=['./','./index.html','./manifest.webmanifest','./ui/favicon-32.png','./ui/apple-touch-icon.png','./ui/icon-192.png','./ui/icon-512.png','./ui/icon-maskable-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PAGE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('fiyesi-pilot-site-')&&x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
const FONT=u=>u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 if(FONT(u)){e.respondWith(caches.open(CACHE).then(c=>c.match(r).then(hit=>hit||fetch(r).then(res=>{c.put(r,res.clone());return res;}).catch(()=>hit))));return;}
 if(u.origin!==self.location.origin)return;
 // The page itself: show what is saved at once, and fetch a fresh copy for the next open.
 e.respondWith(caches.open(CACHE).then(c=>c.match(r,{ignoreSearch:true}).then(hit=>{const net=fetch(r).then(res=>{if(res.ok)c.put(r,res.clone());return res;}).catch(()=>hit);return hit||net;})));
});
