/**
 * CouturPro — Moteur de synchronisation bidirectionnelle automatique (Sync Engine)
 * Exécute et réconcilie les opérations créées hors-ligne dès que le réseau est disponible.
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getPendingSyncQueue,
  removeSyncQueueItem,
  updateSyncQueueItem,
  getSyncQueueCount,
  setLocalItem,
  deleteLocalItem,
  type SyncQueueItem,
} from "./offline-storage";

type SyncListener = () => void;
const listeners = new Set<SyncListener>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

let isSyncing = false;
let queryInvalidator: (() => void) | null = null;

export function registerQueryInvalidator(fn: () => void) {
  queryInvalidator = fn;
}

/**
 * Lance le cycle de synchronisation des modifications en attente.
 * Exécution séquentielle FIFO pour respecter l'ordre des créations (Client -> Commande -> Paiement).
 */
export async function syncPendingMutations(): Promise<number> {
  if (typeof window === "undefined" || isSyncing) return 0;
  if (!navigator.onLine) return 0;

  const queue = await getPendingSyncQueue();
  if (queue.length === 0) return 0;

  isSyncing = true;
  notifyListeners();

  const idMapping = new Map<string, string>();
  let syncedCount = 0;

  try {
    for (const item of queue) {
      try {
        await processSyncItem(item, idMapping);
        await removeSyncQueueItem(item.id);
        syncedCount++;
      } catch (err: unknown) {
        console.error(`[Sync Engine] Échec sur l'action ${item.id} (${item.entity}) :`, err);
        // En cas d'erreur réseau transitoire, on stoppe la file pour ne pas désynchroniser les dépendances
        if (!navigator.onLine) break;

        const currentRetries = (item.retryCount || 0) + 1;
        const errMsg = err instanceof Error ? err.message : String(err);

        // Si l'erreur est fatale (clé étrangère absente, entité orpheline, ou > 3 échecs en ligne)
        // on retire l'élément empoisonné pour ne pas bloquer indéfiniment l'interface et le badge
        if (
          currentRetries >= 3 ||
          errMsg.includes("foreign key") ||
          errMsg.includes("Paiement sans business_id") ||
          errMsg.includes("not found")
        ) {
          console.warn(`[Sync Engine] Action défectueuse retirée de la file : ${item.id} (${item.entity}) :`, errMsg);
          await removeSyncQueueItem(item.id);
        } else {
          await updateSyncQueueItem({
            ...item,
            retryCount: currentRetries,
            status: "failed",
            errorMessage: errMsg,
          });
        }
      }
    }

    if (syncedCount > 0) {
      toast.success(
        syncedCount === 1
          ? "1 modification hors-ligne synchronisée !"
          : `${syncedCount} modifications hors-ligne synchronisées !`,
        { description: "Vos données atelier sont à jour sur le serveur." },
      );
    }
    if (queryInvalidator) {
      queryInvalidator();
    }
  } finally {
    isSyncing = false;
    notifyListeners();
  }

  return syncedCount;
}

async function uploadDataUrl(businessId: string, dataUrl: string, folder: string): Promise<string | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = blob.type.includes("webp") ? "webp" : blob.type.includes("png") ? "png" : "jpg";
    const path = `${businessId}/${folder}/${Math.random().toString(36).slice(2, 10)}_${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from("atelier").upload(path, blob, {
      cacheControl: "31536000, public, immutable",
      contentType: blob.type || "image/jpeg",
      upsert: false,
    });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * Traite une mutation unitaire et met à jour la table de mappage des identifiants temporaires.
 */
async function processSyncItem(
  item: SyncQueueItem,
  idMapping: Map<string, string>,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = { ...item.payload };

  // 1. Remplacement des clés étrangères temporaires par les vrais IDs Supabase
  if (payload["client_id"] && typeof payload["client_id"] === "string" && idMapping.has(payload["client_id"])) {
    payload["client_id"] = idMapping.get(payload["client_id"])!;
  }
  if (payload["order_id"] && typeof payload["order_id"] === "string" && idMapping.has(payload["order_id"])) {
    payload["order_id"] = idMapping.get(payload["order_id"])!;
  }
  if (payload["set_id"] && typeof payload["set_id"] === "string" && idMapping.has(payload["set_id"])) {
    payload["set_id"] = idMapping.get(payload["set_id"])!;
  }

  // 2. Traitement selon l'entité
  switch (item.entity) {
    case "client": {
      if (item.action === "create" || item.action === "update") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upsertData: Record<string, any> = { ...payload };

        if (targetId && !targetId.startsWith("temp_")) {
          upsertData["id"] = targetId;
        } else {
          delete upsertData["id"];
        }

        // Si la photo a été stockée en DataURL base64 hors-ligne, on la téléverse vers Supabase Storage
        if (typeof upsertData["photo_url"] === "string" && upsertData["photo_url"].startsWith("data:")) {
          const bizId = upsertData["business_id"];
          if (bizId) {
            const uploadedPath = await uploadDataUrl(bizId, upsertData["photo_url"], "clients");
            if (uploadedPath) {
              upsertData["photo_url"] = uploadedPath;
            }
          }
        }

        const { data, error } = await supabase
          .from("clients")
          .upsert(upsertData as never, { onConflict: "id" })
          .select()
          .single();
        if (error) throw error;
        if (data) {
          if (id && id !== data.id) idMapping.set(id, data.id);
          await setLocalItem("clients", data);
          if (id && id.startsWith("temp_")) {
            await deleteLocalItem("clients", id);
          }
        }
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        const { error } = await supabase.from("clients").delete().eq("id", targetId);
        if (error) throw error;
        await deleteLocalItem("clients", targetId);
      }
      break;
    }

    case "order": {
      if (item.action === "create" || item.action === "update") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upsertData: Record<string, any> = { ...payload };
        delete upsertData["clients"];
        delete upsertData["payments"];

        if (targetId && !targetId.startsWith("temp_")) {
          upsertData["id"] = targetId;
        } else {
          delete upsertData["id"];
        }

        const { data, error } = await supabase
          .from("orders")
          .upsert(upsertData as never, { onConflict: "id" })
          .select()
          .single();
        if (error) throw error;
        if (data) {
          if (id && id !== data.id) idMapping.set(id, data.id);
          await setLocalItem("orders", data);
          if (id && id.startsWith("temp_")) {
            await deleteLocalItem("orders", id);
          }
        }
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        const { error } = await supabase.from("orders").delete().eq("id", targetId);
        if (error) throw error;
        await deleteLocalItem("orders", targetId);
      }
      break;
    }

    case "payment": {
      if (item.action === "create") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const insertData: Record<string, any> = { ...payload };
        if (typeof insertData["id"] === "string" && insertData["id"].startsWith("temp_")) {
          delete insertData["id"];
        }

        // 1. S'assurer que business_id est toujours présent
        if (!insertData["business_id"]) {
          try {
            const { currentBusinessId } = await import("./queries");
            insertData["business_id"] = await currentBusinessId();
          } catch {
            // ignore
          }
        }

        // 2. Si toujours absent, le déduire depuis la commande liée
        if (!insertData["business_id"] && insertData["order_id"]) {
          try {
            const { data: ord } = await supabase
              .from("orders")
              .select("business_id")
              .eq("id", insertData["order_id"])
              .maybeSingle();
            if (ord?.business_id) {
              insertData["business_id"] = ord.business_id;
            }
          } catch {
            // ignore
          }
        }

        if (!insertData["business_id"]) {
          throw new Error("Paiement sans business_id valide");
        }

        const { data, error } = await supabase
          .from("payments")
          .upsert(insertData as never, { onConflict: "id" })
          .select()
          .single();
        if (error) throw error;
        if (data) await setLocalItem("payments", data);
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        const { error } = await supabase.from("payments").delete().eq("id", targetId);
        if (error) throw error;
        await deleteLocalItem("payments", targetId);
      }
      break;
    }

    case "measurement_set": {
      if (item.action === "create") {
        const tempId = item.tempId || (payload["id"] as string);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const values = (payload["values"] as Array<Record<string, any>>) || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const setData: Record<string, any> = { ...payload };
        delete setData["values"];
        if (tempId && tempId.startsWith("temp_")) {
          delete setData["id"];
        }
        const { data: setRow, error: setError } = await supabase
          .from("measurement_sets")
          .upsert(setData as never, { onConflict: "id" })
          .select()
          .single();
        if (setError) throw setError;

        if (values.length > 0 && setRow?.id) {
          await supabase.from("measurement_values").delete().eq("set_id", setRow.id);
          const valuesToInsert = values.map((v) => ({
            set_id: setRow.id,
            name: v["name"],
            value: v["value"],
            unit: v["unit"] || "cm",
            position: v["position"] || 0,
          }));
          await supabase.from("measurement_values").insert(valuesToInsert as never);
        }

        if (tempId && setRow?.id) {
          idMapping.set(tempId, setRow.id);
          await deleteLocalItem("measurement_sets", tempId);
          await setLocalItem("measurement_sets", setRow);
        }
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        await supabase.from("measurement_values").delete().eq("set_id", targetId);
        const { error } = await supabase.from("measurement_sets").delete().eq("id", targetId);
        if (error) throw error;
        await deleteLocalItem("measurement_sets", targetId);
      }
      break;
    }

    case "appointment": {
      if (item.action === "create" || item.action === "update") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const insertData: Record<string, any> = { ...payload };
        delete insertData["clients"];
        if (typeof insertData["id"] === "string" && insertData["id"].startsWith("temp_")) {
          delete insertData["id"];
        }
        const { data, error } = await supabase
          .from("appointments")
          .upsert(insertData as never, { onConflict: "id" })
          .select()
          .single();
        if (error) throw error;
        if (data) await setLocalItem("appointments", data);
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        const { error } = await supabase.from("appointments").delete().eq("id", targetId);
        if (error) throw error;
        await deleteLocalItem("appointments", targetId);
      }
      break;
    }

    case "garment_type": {
      if (item.action === "create") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const insertData: Record<string, any> = { ...payload };
        if (typeof insertData["id"] === "string" && insertData["id"].startsWith("temp_")) {
          delete insertData["id"];
        }
        const { data, error } = await supabase.from("garment_types").insert(insertData as never).select().single();
        if (error) throw error;
        if (data) await setLocalItem("garment_types", data);
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const { error } = await supabase.from("garment_types").delete().eq("id", id);
        if (error) throw error;
        await deleteLocalItem("garment_types", id);
      }
      break;
    }

    case "business": {
      if (item.action === "update") {
        const id = payload["id"] as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, any> = { ...payload };
        delete updateData["id"];
        const { data, error } = await supabase.from("businesses").update(updateData as never).eq("id", id).select().single();
        if (error) throw error;
        if (data) await setLocalItem("workshop_data", data);
      }
      break;
    }
  }
}

/**
 * Hook React pour observer l'état du réseau et de la synchronisation en direct.
 */
export function useSyncStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [pendingCount, setPendingCount] = useState(0);

  const refreshCount = async () => {
    try {
      const count = await getSyncQueueCount();
      setPendingCount(count);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      setIsOnline(true);
      // Dès le retour de la connexion, lancer automatiquement la synchronisation
      syncPendingMutations();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Enregistrer l'écouteur de changements de file
    listeners.add(refreshCount);
    refreshCount();

    // Polling léger toutes les 15s si des actions sont en attente
    const interval = setInterval(() => {
      if (navigator.onLine) {
        syncPendingMutations();
      }
      refreshCount();
    }, 15000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      listeners.delete(refreshCount);
      clearInterval(interval);
    };
  }, []);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    syncNow: () => syncPendingMutations(),
  };
}
