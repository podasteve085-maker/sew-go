/**
 * CouturPro — Service Worker (v4)
 * Architecture Offline-First pour artisans couturiers.
 *
 * Stratégies :
 * 1. Assets statiques (/assets/*, .js, .css, images, polices) : Cache-First avec mise en cache dynamique
 * 2. Navigations (documents HTML) : Network-First avec repli immédiat sur le Shell ("/") puis offline.html
 * 3. Données API (Supabase) : Laissées au SyncEngine / IndexedDB client
 */

const CACHE_NAME = "couturpro-v4";
const OFFLINE_FALLBACK = "/offline.html";

/** Ressources pré-mises en cache à l'installation (shell statique de base) */
const PRECACHE_ASSETS = [
  "/",
  "/dashboard",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

/* ─── Installation : Mise en cache du Shell de base ─────────────── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        await Promise.allSettled(
          PRECACHE_ASSETS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn("[PWA SW] Ressource non pré-cachée :", url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* ─── Activation : Nettoyage des anciennes versions de cache ─────── */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ─── Écoute des messages (forcer la mise à jour) ───────────────── */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* ─── Fetch : Routage intelligent selon le type de ressource ────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Ne pas intercepter les requêtes vers Supabase (gérées par IndexedDB + sync-engine)
  if (url.hostname.includes("supabase.co")) return;

  // 2. Ne pas intercepter les requêtes cross-origin non prévues (analytics, etc.)
  if (url.origin !== self.location.origin && !url.hostname.includes("fonts.g")) return;

  // 3. Ne pas intercepter les requêtes d'écriture (POST, PUT, DELETE, PATCH)
  if (request.method !== "GET") return;

  // ─── A. NAVIGATION (Chargement d'une page HTML) ─────────────────
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        // Mode hors-ligne direct : servir immédiatement le Shell sans tenter le réseau
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const cached =
            (await caches.match(request)) ||
            (await caches.match("/dashboard")) ||
            (await caches.match("/"));
          if (cached) return cached;
        }

        try {
          // Tenter le réseau avec un timeout de 2.5s max pour ne jamais bloquer WebKit/Safari
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Navigation network timeout")), 2500)
          );
          const networkResponse = await Promise.race([fetch(request), timeoutPromise]);

          if (networkResponse && networkResponse.status === 200) {
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
          }
          return networkResponse;
        } catch {
          // Hors-ligne ou réseau lent : servir le Shell SPA sans attendre
          const cachedUrl = await caches.match(request);
          if (cachedUrl) return cachedUrl;

          const cachedDashboard = await caches.match("/dashboard");
          if (cachedDashboard) return cachedDashboard;

          const cachedShell = await caches.match("/");
          if (cachedShell) return cachedShell;

          const offlinePage = await caches.match(OFFLINE_FALLBACK);
          if (offlinePage) return offlinePage;

          return new Response("Application hors ligne.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // ─── B. ASSETS STATIQUES (JS, CSS, Polices, Images locales) ─────
  // Les fichiers dans /assets/ sont hashés par Vite (immuables) -> Cache-First
  const isStaticAsset =
    url.pathname.startsWith("/assets/") ||
    url.pathname.match(/\.(js|css|woff2?|ttf|png|jpe?g|gif|svg|ico|webp)$/i);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Ressource trouvée dans le cache : retour instantané (0ms)
          return cached;
        }

        // Pas encore en cache : chercher sur le réseau et mettre en cache pour les prochaines fois
        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const cloned = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
            }
            return networkResponse;
          })
          .catch(() => {
            // Échec réseau et pas en cache : erreur réseau standard
            return new Response("", { status: 404, statusText: "Resource Not Found Offline" });
          });
      })
    );
    return;
  }

  // ─── C. AUTRES REQUÊTES GET : Network-First avec repli Cache ────
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response("", { status: 404, statusText: "Offline Not Found" });
      })
  );
});
