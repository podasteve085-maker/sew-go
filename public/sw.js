/**
 * CouturPro — Service Worker (v8)
 * Architecture Offline-First pour artisans couturiers.
 *
 * Stratégies :
 * 1. Assets statiques (/assets/*, .js, .css, images, polices) : Cache-First avec mise en cache dynamique
 * 2. Navigations (documents HTML) : Network-First avec repli immédiat sur le Shell ("/") puis offline.html
 * 3. Chunks Vite : découverte et pré-cache à l'installation + résilience hors-ligne
 * 4. Images Supabase Storage : Cache binaire local dans couturpro-images-v1
 * 5. Données API (Supabase) : Laissées au SyncEngine / IndexedDB client
 */

const CACHE_NAME = "couturpro-v8";
const IMAGES_CACHE_NAME = "couturpro-images-v1";
const OFFLINE_FALLBACK = "/offline.html";

/** Ressources pré-mises en cache à l'installation (shell statique de base) */
const PRECACHE_ASSETS = [
  "/",
  "/dashboard",
  "/clients",
  "/mesures",
  "/commandes",
  "/commandes/nouvelle",
  "/rendez-vous",
  "/catalogue",
  "/statistiques",
  "/atelier",
  "/abonnement",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

/**
 * Extrait les URLs des chunks JS, CSS et polices depuis le HTML d'une page
 */
function extractAssetUrlsFromHtml(html) {
  const urls = new Set();
  if (!html || typeof html !== "string") return [];

  // Balises script (module ou standard)
  const scriptRegex = /<script[^>]+src=["'](\/assets\/[^"']+)["']/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1]) urls.add(match[1].split("?")[0]);
  }

  // Balises link stylesheet ou modulepreload
  const linkRegex = /<link[^>]+href=["'](\/assets\/[^"']+)["']/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    if (match[1]) urls.add(match[1].split("?")[0]);
  }

  return Array.from(urls);
}

/* ─── Installation : Mise en cache du Shell de base et des Chunks ─ */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // 1. Pré-cacher les pages principales
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "no-cache" });
            if (response && response.ok) {
              await cache.put(url, response.clone());

              // Si c'est du HTML, extraire et pré-cacher immédiatement ses scripts et styles
              const contentType = response.headers.get("content-type") || "";
              if (contentType.includes("text/html")) {
                const text = await response.text();
                const assetUrls = extractAssetUrlsFromHtml(text);
                if (assetUrls.length > 0) {
                  await Promise.allSettled(
                    assetUrls.map(async (assetUrl) => {
                      try {
                        const assetRes = await fetch(assetUrl, { cache: "default" });
                        if (assetRes && assetRes.ok) {
                          await cache.put(assetUrl, assetRes);
                        }
                      } catch {
                        // ignore asset fetch failure
                      }
                    })
                  );
                }
              }
            }
          } catch (err) {
            console.warn("[PWA SW] Ressource non pré-cachée :", url, err);
          }
        })
      );

      // Passer immédiatement au Service Worker actif
      await self.skipWaiting();
    })()
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
            .filter((key) => key !== CACHE_NAME && key !== IMAGES_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ─── Écoute des messages (forcer la mise à jour / précache) ─────── */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "PRECACHE_URLS" && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) =>
        Promise.allSettled(
          event.data.urls.map(async (u) => {
            try {
              const res = await fetch(u);
              if (res && res.ok) await cache.put(u, res);
            } catch {
              // ignore
            }
          })
        )
      )
    );
  }
});

/* ─── Fetch : Routage intelligent selon le type de ressource ────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Requêtes Supabase Storage (images catalogue, commandes, ateliers) -> Cache-First
  const isSupabaseStorageImage =
    url.hostname.includes("supabase.co") &&
    url.pathname.includes("/storage/v1/object/") &&
    request.method === "GET";

  if (isSupabaseStorageImage) {
    event.respondWith(
      (async () => {
        const cleanPathname = url.origin + url.pathname;
        const storageKey = new Request(cleanPathname);
        const imagesCache = await caches.open(IMAGES_CACHE_NAME);

        // Recherche par Request ou par URL nettoyée
        let cachedResponse = await imagesCache.match(storageKey);
        if (!cachedResponse) {
          cachedResponse = await imagesCache.match(cleanPathname);
        }

        if (cachedResponse) {
          // Rafraîchissement silencieux en arrière-plan si en ligne
          if (typeof navigator !== "undefined" && navigator.onLine) {
            fetch(request)
              .then((netRes) => {
                if (netRes && netRes.ok) {
                  imagesCache.put(storageKey, netRes.clone());
                  imagesCache.put(cleanPathname, netRes.clone());
                }
              })
              .catch(() => {});
          }
          return cachedResponse;
        }

        try {
          const netRes = await fetch(request);
          if (netRes && netRes.ok) {
            imagesCache.put(storageKey, netRes.clone());
            imagesCache.put(cleanPathname, netRes.clone());
          }
          return netRes;
        } catch {
          return cachedResponse || new Response("", { status: 408 });
        }
      })()
    );
    return;
  }

  // 1b. Requêtes locales simulées pour image-cache binaire
  if (url.hostname === "couturpro-local-cache" && request.method === "GET") {
    event.respondWith(
      (async () => {
        const imagesCache = await caches.open(IMAGES_CACHE_NAME);
        const matched = await imagesCache.match(request);
        if (matched) return matched;
        return new Response("", { status: 404 });
      })()
    );
    return;
  }

  // 1c. Ne pas intercepter les requêtes API/Auth vers Supabase (gérées par IndexedDB + sync-engine)
  if (url.hostname.includes("supabase.co")) return;

  // 2. Ne pas intercepter les requêtes cross-origin non prévues (analytics, etc.)
  if (url.origin !== self.location.origin && !url.hostname.includes("fonts.g")) return;

  // 3. Ne pas intercepter les requêtes d'écriture (POST, PUT, DELETE, PATCH)
  if (request.method !== "GET") return;

  // ─── A. NAVIGATION (Chargement d'une page HTML) ─────────────────
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        // En mode hors-ligne direct : servir immédiatement le Shell sans tenter le réseau
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const cached =
            (await caches.match(request)) ||
            (await caches.match(url.pathname)) ||
            (await caches.match("/dashboard")) ||
            (await caches.match("/"));
          if (cached) return cached;
        }

        try {
          // Tenter le réseau avec un timeout de 2.5s max pour réactivité immédiate
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Navigation network timeout")), 2500)
          );
          const networkResponse = await Promise.race([fetch(request), timeoutPromise]);

          if (networkResponse && networkResponse.status === 200) {
            const cloned = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, cloned);
              cache.put(url.pathname, networkResponse.clone());
            });
          }
          return networkResponse;
        } catch {
          // Hors-ligne ou réseau lent : servir le Shell SPA correspondant ou le shell racine
          const cachedUrl = (await caches.match(request)) || (await caches.match(url.pathname));
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
      (async () => {
        // 1. Chercher dans le cache avec la requête exacte ou le pathname propre
        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match(request)) || (await cache.match(url.pathname));
        if (cached) {
          return cached;
        }

        // 2. Pas encore en cache : chercher sur le réseau et persister
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            const cloned = networkResponse.clone();
            cache.put(request, cloned);
            cache.put(url.pathname, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // 3. Échec réseau (hors-ligne) : si c'est un chunk JS et qu'on ne l'a pas,
          // ne jamais renvoyer une 404 qui ferait crasher l'app,
          // vérifier si une version proche existe dans le cache
          const keys = await cache.keys();
          const baseName = url.pathname.split("/").pop()?.split("-")[0]; // ex: 'statistiques'
          if (baseName && baseName.length > 2) {
            const matchedKey = keys.find((k) => k.url.includes(baseName));
            if (matchedKey) {
              const matchedRes = await cache.match(matchedKey);
              if (matchedRes) return matchedRes;
            }
          }

          return new Response("", { status: 404, statusText: "Resource Not Found Offline" });
        }
      })()
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
        const cached = (await caches.match(request)) || (await caches.match(url.pathname));
        if (cached) return cached;
        return new Response("", { status: 404, statusText: "Offline Not Found" });
      })
  );
});

/* ─── D. GESTION DES NOTIFICATIONS SYSTÈME (Rappels RDV & Livraisons) ── */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
