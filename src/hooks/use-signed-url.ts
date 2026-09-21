import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const BUCKET = "atelier";

/** Génère un UUID v4 compatible avec tous les navigateurs (Safari iOS inclus). */
function uuid(): string {
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

/** Lien temporaire pour afficher un fichier privé du stockage. */
export function useSignedUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["signed-url", path],
    enabled: !!path,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path as string, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export type ImageCompressionOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
};

/**
 * Compresse et optimise une image côté client (WebP / JPEG haute efficacité)
 * Réduit les photos de smartphones de 4-10 Mo à 20-70 Ko avant téléversement.
 */
export async function compressImage(
  file: File,
  options: ImageCompressionOptions = {}
): Promise<{ blob: Blob; ext: string; contentType: string }> {
  if (!file.type.startsWith("image/") || file.type.includes("svg")) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    return { blob: file, ext, contentType: file.type || "application/octet-stream" };
  }

  const { maxWidth = 1200, maxHeight = 1200, quality = 0.8 } = options;

  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      resolve({ blob: file, ext: file.name.split(".").pop()?.toLowerCase() || "jpg", contentType: file.type });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
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
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ blob: file, ext: file.name.split(".").pop()?.toLowerCase() || "jpg", contentType: file.type });
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        // Export WebP prioritaire (98% des navigateurs modernes)
        canvas.toBlob(
          (webpBlob) => {
            if (webpBlob && (webpBlob.size < file.size || file.size > 80_000)) {
              resolve({
                blob: webpBlob,
                ext: "webp",
                contentType: "image/webp",
              });
            } else {
              // Fallback JPEG
              canvas.toBlob(
                (jpegBlob) => {
                  if (jpegBlob && (jpegBlob.size < file.size || file.size > 80_000)) {
                    resolve({
                      blob: jpegBlob,
                      ext: "jpg",
                      contentType: "image/jpeg",
                    });
                  } else {
                    resolve({ blob: file, ext: file.name.split(".").pop()?.toLowerCase() || "jpg", contentType: file.type });
                  }
                },
                "image/jpeg",
                quality
              );
            }
          },
          "image/webp",
          quality
        );
      };
      img.onerror = () => {
        resolve({ blob: file, ext: file.name.split(".").pop()?.toLowerCase() || "jpg", contentType: file.type });
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      resolve({ blob: file, ext: file.name.split(".").pop()?.toLowerCase() || "jpg", contentType: file.type });
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadImage(businessId: string, file: File, folder: string) {
  // Ajustement précis selon le dossier pour économie d'espace maximale :
  // - "atelier" (logo) ou "clients" (avatar) : format compact 400x400
  // - "orders" ou "catalog" : format haute définition équilibré 1280x1280
  const isAvatarOrLogo = folder === "atelier" || folder === "clients";
  const compressionConfig: ImageCompressionOptions = isAvatarOrLogo
    ? { maxWidth: 400, maxHeight: 400, quality: 0.82 }
    : { maxWidth: 1280, maxHeight: 1280, quality: 0.78 };

  const { blob, ext, contentType } = await compressImage(file, compressionConfig);
  const path = `${businessId}/${folder}/${uuid()}.${ext}`;

  // Cache immutable 1 an : le navigateur ne retélécharge jamais une photo existante (0 egress)
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    cacheControl: "31536000, public, immutable",
    contentType,
    upsert: false,
  });
  if (error) throw error;
  return path;
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

