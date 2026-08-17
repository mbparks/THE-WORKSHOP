const CACHE='workshop-v7.0.5';
const SHELL=['/','/index.html','/styles.css','/app.js','/manifest.webmanifest','/icon.svg','/workshop-mark.svg','/icon-192.png','/icon-512.png','/icon-maskable-192.png','/icon-maskable-512.png','/apple-touch-icon.png','/favicon.ico','/safari-pinned-tab.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/uploads/')||u.pathname.startsWith('/gearhead-files/')||u.pathname.startsWith('/gearhead-media/'))return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put('/index.html',copy))}return r}).catch(()=>caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>{
    const fresh=fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>cached);
    return cached||fresh;
  }));
});
