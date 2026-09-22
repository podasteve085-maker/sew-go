/**
 * CouturPro — Service Worker
 * Stratégie : Network-First avec fallback sur cache.
 * Conçu pour les connexions intermittentes (Afrique de l'Ouest, 2G/3G).
 */

const CACHE_NAME = "couturpro-v1";
const OFFLINE_FALLBACK = "/offline.html";

/** Ressources pré-mises en cache à l'installation (shell statique) */
const PRECACHE_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

/* ─── Installation ─────────────────────────────────────────────── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        // Met en cache chaque ressource individuellement pour qu'une ressource manquante n'annule pas l'installation
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

/* ─── Activation / Nettoyage des anciens caches ─────────────────── */
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

/* ─── Fetch : Network-First avec fallback cache ─────────────────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ne pas intercepter les requêtes vers Supabase (API, Auth, Storage)
  if (url.hostname.includes("supabase.co")) return;
  // Ne pas intercepter les requêtes cross-origin (analytics, fonts CDN ok côté browser)
  if (url.origin !== self.location.origin && !url.hostname.includes("fonts.g")) return;
  // Ne pas intercepter les requêtes non-GET
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Mettre à jour le cache en arrière-plan si la réponse est valide
        if (networkResponse && networkResponse.status === 200) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return networkResponse;
      })
      .catch(async () => {
        // Réseau absent : essayer le cache
        const cached = await caches.match(request);
        if (cached) return cached;

        // Pour les navigations (HTML), renvoyer le shell de l'application ("/") ou la page de secours
        if (request.mode === "navigate") {
          const cachedShell = await caches.match("/");
          if (cachedShell) return cachedShell;
          const offlinePage = await caches.match(OFFLINE_FALLBACK);
          if (offlinePage) return offlinePage;
        }

        // Sinon réponse vide avec statut 503
        return new Response("Hors ligne — ressource non disponible.", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
  );
});
