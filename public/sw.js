// Service worker: без него ссылка без интернета открывалась белым экраном.
// Стратегия разная для разных файлов, и это принципиально:
//   - index.html — СЕТЬ ПЕРВОЙ, откат на кеш. Иначе после моего деплоя человек
//     бесконечно видел бы старую версию из кеша.
//   - /assets/*.js и картинки — КЕШ ПЕРВЫМ. В их именах хеш содержимого, поэтому
//     файл неизменен: если имя то же — содержимое то же, ходить в сеть незачем.
// Чужие домены не трогаем: паки спектров тянутся с raw.githubusercontent и
// должны обновляться сами, кешировать их здесь нельзя.

const CACHE = "nepokerist-ranges-v1";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./favicon.png"];

// Достаём из index.html адреса собранных файлов. Их имена содержат хеш и
// заранее неизвестны, а полагаться на то, что они осядут в кеше «сами» при
// первой загрузке, нельзя: страница успевает скачать бандл РАНЬШЕ, чем
// воркер активируется, и он этот запрос просто не видит. Тогда офлайн
// держится только на HTTP-кеше браузера и умирает вместе с ним.
async function precacheBuiltAssets(cache) {
  try {
    const response = await fetch("./index.html", { cache: "no-store" });
    if (!response.ok) return;
    const html = await response.text();
    const urls = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => m[1]);
    await Promise.allSettled(urls.map((url) => cache.add(url)));
  } catch {
    // без сети на установке — не беда, доберём при следующем визите
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll падает целиком, если хоть один файл не скачался, — кладём по одному
      await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
      await precacheBuiltAssets(cache);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // паки с GitHub — мимо кеша

  const isHashedAsset = url.pathname.includes("/assets/");
  const isNavigation = request.mode === "navigate";

  if (isHashedAsset) {
    // кеш первым: имя с хешем гарантирует неизменность содержимого
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  if (isNavigation || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    // сеть первой, чтобы свежая версия приходила сразу; без сети — из кеша
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // остальное (иконки, манифест): из кеша, иначе из сети
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
