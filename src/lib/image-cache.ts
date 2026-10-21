/**
 * CouturPro — Cache d'images binaire local persistant (Cache API)
 * Permet l'affichage 100 % hors-ligne du catalogue, des photos de commandes,
 * des avatars clients et du logo atelier même sans connexion internet.
 */

const CACHE_NAME = "couturpro-images-v1";
const inMemoryBlobUrls = new Map<string, string>();

/**
 * Normalise un chemin de fichier pour servir de clé de cache stable
 */
export function normalizeCacheKey(path: string): string {
  // Retirer les query params si présents (tokens signés)
  const cleanPath = path.split("?")[0].replace(/^\/+/, "");
  return `https://couturpro-local-cache/${cleanPath}`;
}

/**
 * Vérifie si la Cache API est supportée
 */
function isCacheApiSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

/**
 * Télécharge et met en cache le binaire d'une image depuis son URL signée ou publique
 */
export async function cacheImage(storagePath: string, imageUrl: string): Promise<boolean> {
  if (!storagePath || !imageUrl) return false;
  // Ne pas mettre en cache les data: URLs (déjà embarquées)
  if (storagePath.startsWith("data:") || imageUrl.startsWith("data:")) return false;

  try {
    const key = normalizeCacheKey(storagePath);
    const res = await fetch(imageUrl, { mode: "cors", cache: "default" });
    if (!res.ok) return false;

    const blob = await res.blob();
    if (blob.size === 0) return false;

    if (isCacheApiSupported()) {
      const cache = await caches.open(CACHE_NAME);
      const responseToCache = new Response(blob, {
        headers: {
          "Content-Type": blob.type || "image/webp",
          "Content-Length": String(blob.size),
          "X-Cached-At": Date.now().toString(),
        },
      });
      await cache.put(key, responseToCache);
    }

    // Garder également un blob URL mémoire pour un accès synchrone ultra rapide
    const prev = inMemoryBlobUrls.get(key);
    if (prev) {
      try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
    }
    inMemoryBlobUrls.set(key, URL.createObjectURL(blob));
    return true;
  } catch {
    return false;
  }
}

/**
 * Récupère l'image depuis le cache local sous forme d'Object URL (blob:...)
 */
export async function getCachedImageUrl(storagePath: string): Promise<string | null> {
  if (!storagePath) return null;
  if (storagePath.startsWith("data:")) return storagePath;

  const key = normalizeCacheKey(storagePath);

  // 1. Vérification mémoire RAM rapide
  if (inMemoryBlobUrls.has(key)) {
    return inMemoryBlobUrls.get(key)!;
  }

  // 2. Vérification Cache API
  if (isCacheApiSupported()) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const matched = await cache.match(key);
      if (matched) {
        const blob = await matched.blob();
        if (blob && blob.size > 0) {
          const blobUrl = URL.createObjectURL(blob);
          inMemoryBlobUrls.set(key, blobUrl);
          return blobUrl;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Supprime une image du cache local
 */
export async function removeCachedImage(storagePath: string): Promise<void> {
  if (!storagePath) return;
  const key = normalizeCacheKey(storagePath);
  const mem = inMemoryBlobUrls.get(key);
  if (mem) {
    try { URL.revokeObjectURL(mem); } catch { /* ignore */ }
    inMemoryBlobUrls.delete(key);
  }
  if (isCacheApiSupported()) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(key);
    } catch {
      // ignore
    }
  }
}
