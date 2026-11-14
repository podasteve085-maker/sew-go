/**
 * CouturPro — Moteur de synchronisation bidirectionnelle automatique (Sync Engine)
 * Exécute et réconcilie les opérations créées hors-ligne dès que le réseau est disponible.
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { deleteStorageFiles, uploadDataUrl } from "@/hooks/use-signed-url";
import {
  isMissingDbRoutine,
  parseCatalogRpcPayload,
  type OrderRow,
  type ClientRow,
  type AppointmentRow,
} from "@/lib/queries";
import type { OrderStatus } from "@/lib/domain";
import type { Json } from "@/integrations/supabase/types";
import {
  getPendingSyncQueue,
  getLocalItem,
  removeSyncQueueItem,
  updateSyncQueueItem,
  getSyncQueueCount,
  setLocalItem,
  deleteLocalItem,
  type SyncQueueItem,
} from "./offline-storage";
import { runResilientSync } from "./sync-resilience";

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
  if (typeof window === "undefined") return 0;
  if (!navigator.onLine) return 0;

  // Web Locks also prevents a second open tab from replaying the same queue.
  // The local flag below remains the fallback for browsers without this API.
  if (navigator.locks) {
    return navigator.locks.request(
      "couturpro-offline-sync",
      { mode: "exclusive", ifAvailable: true },
      (lock) => (lock ? runPendingSync() : Promise.resolve(0)),
    );
  }

  return runPendingSync();
}

async function runPendingSync(): Promise<number> {
  if (typeof window === "undefined" || isSyncing || !navigator.onLine) return 0;
  isSyncing = true;
  notifyListeners();

  const idMapping = new Map<string, string>();

  try {
    // 0. Synchronisation automatique des mots de passe mis à jour hors-ligne
    try {
      const { syncPendingOfflinePasswords } = await import("@/lib/offline-auth");
      await syncPendingOfflinePasswords();
    } catch (e) {
      console.warn("[Sync Engine] Erreur synchro mot de passe hors-ligne :", e);
    }

    // 1. Vérification rapide : file vide ?
    const queue = await getPendingSyncQueue();
    if (queue.length === 0) return 0;

    // 2. Orchestration résiliente : tri topologique, batch par lots, isolation
    //    multi-ateliers, continuation sur erreur non-réseau, journal de bord.
    const { synced, failed } = await runResilientSync(
      (item, mapping) => processSyncItem(item, mapping),
      idMapping,
    );

    if (synced > 0) {
      toast.success(
        synced === 1
          ? "1 modification hors-ligne synchronisée !"
          : `${synced} modifications hors-ligne synchronisées !`,
        {
          description:
            failed > 0
              ? `${synced} réussie(s), ${failed} en attente de reconnexion.`
              : "Vos données atelier sont à jour sur le serveur.",
        },
      );
    } else if (failed > 0) {
      console.info(`[Sync Engine] Cycle terminé — synchronisé : ${synced}, en attente : ${failed}.`);
    }

    if (queryInvalidator) {
      queryInvalidator();
    }

    return synced;
  } finally {
    isSyncing = false;
    notifyListeners();
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
        const cachedClients = upsertData["clients"];
        delete upsertData["clients"];
        delete upsertData["payments"];

        // 1. Remapper client_id si le client a été créé hors-ligne avec un tempId !
        if (upsertData["client_id"] && idMapping.has(upsertData["client_id"])) {
          upsertData["client_id"] = idMapping.get(upsertData["client_id"]);
        }

        // 2. S'assurer que delivered_to contient le nom du client (visible directement sur Supabase)
        if (!upsertData["delivered_to"] && upsertData["client_id"]) {
          try {
            const client = await getLocalItem<any>("clients", upsertData["client_id"]);
            if (client) {
              const cName = `${client.first_name || ""} ${client.last_name || ""}`.trim();
              if (cName) {
                upsertData["delivered_to"] = cName;
              }
            }
          } catch {}
        }

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
          // Préserver l'objet client pour l'affichage immédiat dans les cartes hors-ligne
          let resolvedClient = cachedClients;
          if (!resolvedClient && data.client_id) {
            try {
              const c = await getLocalItem<any>("clients", data.client_id);
              if (c) {
                resolvedClient = {
                  id: c.id,
                  first_name: c.first_name,
                  last_name: c.last_name,
                  phone: c.phone,
                  whatsapp: c.whatsapp,
                  city: c.city,
                  notes: c.notes,
                  gender: c.gender,
                };
              }
            } catch {}
          }
          const mergedOrder = {
            ...payload,
            ...data,
            clients: resolvedClient,
            delivered_to: data.delivered_to || upsertData["delivered_to"],
          };
          await setLocalItem("orders", mergedOrder);
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

    case "order_image": {
      if (item.action === "create" || item.action === "update") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const insertData: Record<string, any> = { ...payload };

        if (targetId && !targetId.startsWith("temp_")) {
          insertData["id"] = targetId;
        } else {
          delete insertData["id"];
        }

        // Remapper l'order_id s'il a été créé avec un tempId
        if (insertData["order_id"] && idMapping.has(insertData["order_id"])) {
          insertData["order_id"] = idMapping.get(insertData["order_id"]);
        }

        // Si la photo a été stockée en DataURL base64 hors-ligne, on la téléverse vers Supabase Storage
        if (typeof insertData["path"] === "string" && insertData["path"].startsWith("data:")) {
          const bizId = insertData["business_id"];
          if (bizId) {
            const uploadedPath = await uploadDataUrl(bizId, insertData["path"], "orders");
            if (uploadedPath) {
              insertData["path"] = uploadedPath;
            }
          }
        }

        const { data, error } = await supabase
          .from("order_images")
          .upsert(insertData as never, { onConflict: "id" })
          .select()
          .single();
        if (error) throw error;
        if (data) {
          if (id && id !== data.id) idMapping.set(id, data.id);
          await setLocalItem("order_images", data);
          if (id && id.startsWith("temp_")) {
            await deleteLocalItem("order_images", id);
          }
        }
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        const path = payload["path"] as string | undefined;
        const { error } = await supabase.from("order_images").delete().eq("id", targetId);
        if (error) throw error;
        await deleteLocalItem("order_images", targetId);
        if (path && !path.startsWith("data:")) {
          const { deleteStorageFiles } = await import("@/hooks/use-signed-url");
          deleteStorageFiles([path]).catch(() => {});
        }
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

        // Remapper l'order_id si la commande liée a été créée hors-ligne avec un tempId
        if (insertData["order_id"] && idMapping.has(insertData["order_id"])) {
          insertData["order_id"] = idMapping.get(insertData["order_id"]);
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
      if (item.action === "create" || item.action === "update") {
        const tempId = item.tempId || (payload["id"] as string);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const values = (payload["values"] as Array<Record<string, any>>) || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const setData: Record<string, any> = { ...payload };
        delete setData["values"];
        delete setData["clients"];

        // Remapper client_id si créé hors-ligne avec un tempId
        if (setData["client_id"] && idMapping.has(setData["client_id"])) {
          setData["client_id"] = idMapping.get(setData["client_id"]);
        }

        if (tempId && tempId.startsWith("temp_")) {
          delete setData["id"];
        }
        const { data: setRow, error: setError } = await supabase
          .from("measurement_sets")
          .upsert(setData as never, { onConflict: "id" })
          .select()
          .single();
        if (setError) throw setError;

        if (setRow?.id) {
          const bizId =
            setRow.business_id ||
            setData["business_id"] ||
            (await (await import("./queries")).currentBusinessId());

          const { error: deleteValuesError } = await supabase
            .from("measurement_values")
            .delete()
            .eq("set_id", setRow.id);
          if (deleteValuesError) throw deleteValuesError;

          if (values.length > 0) {
            const valuesToInsert = values.map((v) => ({
              business_id: bizId,
              set_id: setRow.id,
              name: v["name"],
              value: v["value"],
              unit: v["unit"] || "cm",
              position: typeof v["position"] === "number" ? v["position"] : 0,
            }));
            const { error: insertValuesError } = await supabase
              .from("measurement_values")
              .insert(valuesToInsert as never);
            if (insertValuesError) throw insertValuesError;
          }
        }

        if (tempId && setRow?.id) {
          if (tempId !== setRow.id) idMapping.set(tempId, setRow.id);
          if (tempId.startsWith("temp_")) {
            await deleteLocalItem("measurement_sets", tempId);
          }
          const localSet = await getLocalItem<Record<string, unknown>>("measurement_sets", tempId);
          await setLocalItem("measurement_sets", {
            ...localSet,
            ...setRow,
            id: setRow.id,
            measurement_values: values.map((v) => ({
              id: `val_${v["position"] ?? 0}`,
              name: v["name"],
              value: v["value"],
              unit: v["unit"] || "cm",
              position: typeof v["position"] === "number" ? v["position"] : 0,
            })),
          });
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
        const id = (payload["id"] as string) || item.tempId!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const insertData: Record<string, any> = { ...payload };
        delete insertData["clients"];

        // Remapper client_id si créé hors-ligne avec un tempId
        if (insertData["client_id"] && idMapping.has(insertData["client_id"])) {
          insertData["client_id"] = idMapping.get(insertData["client_id"]);
        }

        if (typeof insertData["id"] === "string" && insertData["id"].startsWith("temp_")) {
          delete insertData["id"];
        }
        const { data, error } = await supabase
          .from("appointments")
          .upsert(insertData as never, { onConflict: "id" })
          .select()
          .single();
        if (error) throw error;
        if (data) {
          if (id && id !== data.id) idMapping.set(id, data.id);
          await setLocalItem("appointments", data);
          if (id && id.startsWith("temp_")) {
            await deleteLocalItem("appointments", id);
          }
        }
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
        if (data) {
          // Persister dans IndexedDB ET localStorage pour disponibilite hors-ligne multi-appareils
          await setLocalItem("workshop_data", data);
          try {
            localStorage.setItem("couturpro_cached_business", JSON.stringify(data));
            localStorage.setItem("couturpro_current_business_id", String((data as Record<string, unknown>)["id"] ?? id));
          } catch { /* ignore */ }
        }
      }
      break;
    }

    case "catalog_model": {
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
        if (Array.isArray(upsertData["photo_paths"])) {
          const bizId = upsertData["business_id"] as string | undefined;
          const nextPaths: string[] = [];
          for (const photo of upsertData["photo_paths"] as unknown[]) {
            if (typeof photo === "string" && photo.startsWith("data:") && bizId) {
              const uploadedPath = await uploadDataUrl(bizId, photo, "catalog");
              nextPaths.push(uploadedPath || photo);
            } else if (typeof photo === "string") {
              nextPaths.push(photo);
            }
          }
          upsertData["photo_paths"] = nextPaths;
        }
        const rpc = await supabase.rpc("save_catalog_model", {
          p_model: upsertData as Json,
        });
        if (!rpc.error) {
          const saved = parseCatalogRpcPayload(rpc.data);
          const savedId = typeof saved?.["id"] === "string" ? saved["id"] : targetId;
          if (id && savedId && id !== savedId) idMapping.set(id, savedId);
          if (saved && savedId) {
            await setLocalItem("catalog_models", { ...saved, id: savedId });
          }
          if (id && id.startsWith("temp_")) {
            await deleteLocalItem("catalog_models", id);
          }
        } else if (isMissingDbRoutine(rpc.error)) {
          const { data, error } = await supabase
            .from("catalog_models")
            .upsert(upsertData as never, { onConflict: "id" })
            .select()
            .single();
          if (error) throw error;
          if (data) {
            if (id && id !== data.id) idMapping.set(id, data.id);
            await setLocalItem("catalog_models", data);
            if (id && id.startsWith("temp_")) {
              await deleteLocalItem("catalog_models", id);
            }
          }
        } else {
          throw rpc.error;
        }
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        const rpc = await supabase.rpc("delete_catalog_model", { p_model_id: targetId });
        if (rpc.error && !isMissingDbRoutine(rpc.error)) {
          throw rpc.error;
        }
        if (rpc.error) {
          const { error } = await supabase.from("catalog_models").delete().eq("id", targetId);
          if (error) throw error;
        }
        await deleteLocalItem("catalog_models", targetId);
        const rpcPayload = parseCatalogRpcPayload(rpc.data);
        const rpcPhotos = Array.isArray(rpcPayload?.["photo_paths"])
          ? (rpcPayload["photo_paths"] as string[])
          : undefined;
        const photoPaths = rpcPhotos ?? (payload["photo_paths"] as string[] | undefined) ?? [];
        if (photoPaths.length > 0) {
          await deleteStorageFiles(photoPaths);
        }
      }
      break;
    }

    case "expense": {
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

        const { data, error } = await supabase
          .from("expenses")
          .upsert(upsertData as never, { onConflict: "id" })
          .select()
          .single();
        if (error) throw error;
        if (data) {
          if (id && id !== data.id) idMapping.set(id, data.id);
          await setLocalItem("expenses", data);
          if (id && id.startsWith("temp_")) {
            await deleteLocalItem("expenses", id);
          }
        }
      } else if (item.action === "delete") {
        const id = (payload["id"] as string) || item.tempId!;
        const targetId = idMapping.get(id) || id;
        const { error } = await supabase.from("expenses").delete().eq("id", targetId);
        if (error) throw error;
        await deleteLocalItem("expenses", targetId);
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
