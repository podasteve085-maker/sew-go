import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cacheImage, getCachedImageUrl, cacheBlob } from "@/lib/image-cache";

export const BUCKET = "atelier";

/** Génère un UUID v4 compatible avec tous les navigateurs (Safari iOS inclus). */
export function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback universel (Math.random) pour Safari iOS < 15.4 ou contexte non-HTTPS
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Récupère l'URL signée en ligne ou le blob du cache hors-ligne. */
export async function getSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (
    path.startsWith("data:") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("blob:")
  ) {
    return path;
  }

  // 1. D'abord vérifier le cache binaire local (accès instantané 0ms hors-ligne et en ligne)
  const cached = await getCachedImageUrl(path);
  if (cached) return cached;

  // 2. Si en ligne : tenter createSignedUrl, puis getPublicUrl pour TOUS les dossiers
  const isOnline = typeof navigator === "undefined" || navigator.onLine;
  if (isOnline) {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60);
      if (!error && data?.signedUrl) {
        cacheImage(path, data.signedUrl).catch(() => {});
        return data.signedUrl;
      }
    } catch {
      // Repli
    }

    // Repli getPublicUrl pour tous les dossiers (clients, atelier, orders, catalog)
    try {
      const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (publicData?.publicUrl) {
        cacheImage(path, publicData.publicUrl).catch(() => {});
        return publicData.publicUrl;
      }
    } catch {
      // Repli
    }
  }

  return null;

}

/** Lien temporaire pour afficher un fichier privé du stockage avec fallback hors-ligne. */
export function useSignedUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["signed-url", path],
    enabled: !!path,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const url = await getSignedUrl(path);
      if (!url) throw new Error("Image indisponible");
      return url;
    },
  });
}

export type ImageCompressionOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
};

/**
 * Compresse et optimise une image côté client (WebP / JPEG haute efficacité).
 * Réduit les photos de smartphones (jusqu'à 35 Mo) à 20-90 Ko avant téléversement.
 * Protège le stockage Supabase et réduit considérablement l'espace IndexedDB hors-ligne.
 */
export async function compressImage(
  file: File,
  options: ImageCompressionOptions = {},
): Promise<{ blob: Blob; ext: string; contentType: string }> {
  const rawType = (file.type || "").toLowerCase();
  const isImageMime = rawType.startsWith("image/") || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(file.name);
  if (!isImageMime) {
    throw new Error("Type de fichier non autorisé. Seules les images sont acceptées.");
  }

  // Accepte jusqu'à 35 Mo pour ne pas bloquer les photos 48MP/RAW de smartphones
  if (file.size > 35 * 1024 * 1024) {
    throw new Error("L'image est trop volumineuse (maximum 35 Mo).");
  }

  const { maxWidth = 1400, maxHeight = 1400, quality = 0.82 } = options;

  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      resolve({
        blob: file,
        ext: file.name.split(".").pop()?.toLowerCase() || "jpg",
        contentType: file.type || "image/jpeg",
      });
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    const cleanup = () => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignorer si déjà révoqué
      }
    };

    img.onload = () => {
      try {
        let { width, height } = img;

        // Calcul des dimensions proportionnelles
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve({
            blob: file,
            ext: file.name.split(".").pop()?.toLowerCase() || "jpg",
            contentType: file.type || "image/jpeg",
          });
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        cleanup();

        // 1. Export WebP prioritaire (support universel moderne, compression optimale)
        canvas.toBlob(
          (webpBlob) => {
            if (webpBlob && webpBlob.size > 0 && webpBlob.size <= file.size) {
              resolve({
                blob: webpBlob,
                ext: "webp",
                contentType: "image/webp",
              });
            } else if (webpBlob && webpBlob.size > 0 && file.size <= 60_000) {
              // Si le fichier source était déjà très petit (<60 Ko), conserver WebP standardisé
              resolve({
                blob: webpBlob,
                ext: "webp",
                contentType: "image/webp",
              });
            } else {
              // 2. Repli JPEG haute qualité
              canvas.toBlob(
                (jpegBlob) => {
                  if (jpegBlob && jpegBlob.size > 0) {
                    resolve({
                      blob: jpegBlob,
                      ext: "jpg",
                      contentType: "image/jpeg",
                    });
                  } else {
                    resolve({
                      blob: file,
                      ext: file.name.split(".").pop()?.toLowerCase() || "jpg",
                      contentType: file.type || "image/jpeg",
                    });
                  }
                },
                "image/jpeg",
                quality,
              );
            }
          },
          "image/webp",
          quality,
        );
      } catch {
        cleanup();
        resolve({
          blob: file,
          ext: file.name.split(".").pop()?.toLowerCase() || "jpg",
          contentType: file.type || "image/jpeg",
        });
      }
    };

    img.onerror = () => {
      cleanup();
      resolve({
        blob: file,
        ext: file.name.split(".").pop()?.toLowerCase() || "jpg",
        contentType: file.type || "image/jpeg",
      });
    };

    img.src = objectUrl;
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/** Téléverse un DataURL (repli hors-ligne) vers le bucket atelier. */
export async function uploadDataUrl(
  businessId: string,
  dataUrl: string,
  folder: string,
): Promise<string | null> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = blob.type.includes("webp")
      ? "webp"
      : blob.type.includes("png")
        ? "png"
        : "jpg";
    const path = `${businessId}/${folder}/${uuid()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      cacheControl: "31536000, public, immutable",
      contentType: blob.type || "image/jpeg",
      upsert: false,
    });
    if (error) return null;
    cacheBlob(path, blob).catch(() => {});
    return path;

  } catch {
    return null;
  }
}

export async function materializeStoragePaths(
  businessId: string,
  paths: string[],
  folder: string,
): Promise<string[]> {
  const next: string[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || !path) continue;
    if (path.startsWith("data:")) {
      const uploaded = await uploadDataUrl(businessId, path, folder);
      next.push(uploaded || path);
    } else {
      next.push(path);
    }
  }
  return next;
}

export async function uploadImage(businessId: string, file: File, folder: string): Promise<string> {
  // Sécurisation stricte contre le path traversal
  const safeBusinessId = businessId.replace(/[^a-zA-Z0-9_-]/g, "");
  const allowedFolders = ["atelier", "clients", "orders", "catalog"];
  const safeFolder = allowedFolders.includes(folder) ? folder : "misc";

  // Profils de compression adaptatifs haute efficacité :
  // - "atelier" (logo) ou "clients" (avatar) : format compact 400x400 (15-30 Ko)
  // - "orders" (croquis, tissus, confections) : 1400x1400, qualité 0.80 (50-80 Ko)
  // - "catalog" (photos modèles lookbook) : 2048x2048, qualité 0.86 (rendu ultra-net et cristallin des wax, broderies et coutures fines, ~100-180 Ko)
  const isAvatarOrLogo = safeFolder === "atelier" || safeFolder === "clients";
  const isCatalog = safeFolder === "catalog";
  const compressionConfig: ImageCompressionOptions = isAvatarOrLogo
    ? { maxWidth: 400, maxHeight: 400, quality: 0.82 }
    : isCatalog
      ? { maxWidth: 2048, maxHeight: 2048, quality: 0.86 }
      : { maxWidth: 1400, maxHeight: 1400, quality: 0.80 };

  const { blob, ext, contentType } = await compressImage(file, compressionConfig);

  // Si formellement hors-ligne : convertir immédiatement le blob compressé en DataURL
  // Grâce à la compression préalable, le DataURL fait ~60 Ko au lieu de 12 Mo, protégeant IndexedDB
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  if (!isOnline) {
    return await blobToDataUrl(blob);
  }

  const path = `${safeBusinessId}/${safeFolder}/${uuid()}.${ext}`;

  try {
    // Cache immutable 1 an : le navigateur ne retélécharge jamais une photo existante (0 egress)
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      cacheControl: "31536000, public, immutable",
      contentType,
      upsert: false,
    });
    if (!error) {
      // Mettre immédiatement en cache local pour offline
      cacheBlob(path, blob).catch(() => {});
      return path;
    }
  } catch {
    // Échec réseau ou micro-coupure : repli sur le DataURL local
  }


  // Fallback universel : retourner le DataURL local compressé pour affichage et sauvegarde immédiate
  return await blobToDataUrl(blob);
}

/**
 * Supprime des fichiers physiques dans Supabase Storage
 * Empêche l'accumulation de fichiers orphelins pour préserver le quota gratuit.
 */
export async function deleteStorageFiles(paths: (string | null | undefined)[]) {
  const cleanPaths = paths.filter((p): p is string => Boolean(p && !p.startsWith("http") && !p.startsWith("data:")));
  if (cleanPaths.length === 0) return;
  try {
    const { error } = await supabase.storage.from(BUCKET).remove(cleanPaths);
    if (error) {
      console.warn("[deleteStorageFiles warning]", error.message);
    }
  } catch (err) {
    console.warn("[deleteStorageFiles catch]", err);
  }
}

export async function deleteStorageFile(path: string | null | undefined) {
  if (!path) return;
  await deleteStorageFiles([path]);
}

