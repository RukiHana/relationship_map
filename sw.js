// sw.js — 오프라인 (계획서 §10 4단계)
//
// 「한 번 방문해 두면 컴퓨터와 아이패드 양쪽이 인터넷 없이도 열린다.」
//
// ★ **버전 관리가 여기로 옮겨온다**(§3).
//   그전까지는 `?v=` 를 주소에 실어 브라우저 캐시를 뚫었다. 서비스워커가 들어오면
//   캐시를 명시적으로 쥐게 되므로 그 규칙이 이쪽으로 온다.
//
//   버전은 **등록 주소에서 읽는다** — main.js 가 `sw.js?v=20260726f` 로 등록하고,
//   `bump.py` 가 그 한 줄도 같이 고친다. 등록 주소가 바뀌면 브라우저가 이 파일을
//   새 워커로 보고 다시 받는다. 그래서 버전 상수를 두 군데 적을 일이 없다.

const V = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = `charmap-${V}`;

// `?v=` 가 붙는 것들 — 한 버전 안에서는 절대 안 바뀌므로 캐시 우선으로 받아도 안전하다
const VERSIONED = [
  'src/style.css',
  'src/roles.json',
  'src/version.js',
  'src/parse.js',
  'src/serialize.js',
  'src/state.js',
  'src/model.js',
  'src/roles.js',
  'src/io.js',
  'src/ui_text.js',
  'src/ui_graph.js',
  'src/ui_card.js',
  'src/ui_dialog.js',
  'src/ui_roles.js',
  'src/ui_sheet.js',
  'src/main.js',
];

// 주소에 버전이 안 붙는 것들
const PLAIN = ['./', 'index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = [...PLAIN, ...VERSIONED.map((u) => `${u}?v=${V}`)];
    // 하나가 실패해도 나머지는 담는다 — 통째로 실패하면 오프라인이 아예 안 된다
    await Promise.allSettled(urls.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('charmap-') && k !== CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 남의 서버는 건드리지 않는다

  // **HTML 은 네트워크 우선.** 새로 배포한 index.html 을 놓치면 새 `?v=` 를 영영 못 본다
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) ?? (await caches.match('./')) ?? Response.error();
      }
    })());
    return;
  }

  // **버전이 박힌 자산은 캐시 우선.** 같은 주소면 내용이 같다는 게 `?v=` 규칙의 뜻이다
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      return hit ?? Response.error();
    }
  })());
});
