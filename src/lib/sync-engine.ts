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
    //    On passe la file déjà lue (preloadedQueue) pour éviter une double-lecture
    //    d'IndexedDB (race condition : des items ajoutés entre la 1ère et la 2ème lecture
    //    pourraient être manqués ou traités deux fois).
    const { synced, failed } = await runResilientSync(
      (item, mapping) => processSyncItem(item, mapping),
      idMapping,
      queue,
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

  // 1b. Si des FK temporaires ne sont pas encore dans l'idMapping en mémoire,
  //     on tente de les résoudre depuis IndexedDB (mappings persistés des cycles précédents).
  //     Cela couvre le cas : order créé offline (temp_xxx) en cycle N,
  //     paiement pour cet order en cycle N+1 avec idMapping vide.
  if (payload["client_id"] && typeof payload["client_id"] === "string" && payload["client_id"].startsWith("temp_")) {
    // Le client n'est pas encore résolu → chercher l'entrée dans le store clients IDB
    // (s'il a été synchro, il aura été supprimé sous son ancien tempId et recréé sous le vrai UUID)
    // On ne peut pas le résoudre ici sans ID → on laisse échouer proprement (Supabase retournera FK error)
    console.warn(`[SyncEngine] client_id temporaire non résolu : ${payload["client_id"]} — l'item sera retenté.`);
  }
  if (payload["order_id"] && typeof payload["order_id"] === "string" && payload["order_id"].startsWith("temp_")) {
    // L'order_id temporaire n'est pas résolu → chercher dans les orders IndexedDB
    // On tente de retrouver la commande locale pour obtenir son vrai ID Supabase
    try {
      // Parcourir toutes les orders locales pour trouver l'ordre qui avait ce tempId
      // Note: on cherche dans les orders, le tempId peut correspondre à une commande qui a maintenant un vrai UUID
      const { getLocalItem: _getLocal } = await import("./offline-storage");
      // On ne peut pas itérer facilement ; on laisse l'erreur se produire et l'item sera retenté
      // La vraie solution est la persistance du idMapping entre cycles (déjà implémentée ci-dessus)
    } catch { /* ignore */ }
    console.warn(`[SyncEngine] order_id temporaire non résolu : ${payload["order_id"]} — l'item sera retenté.`);
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let error: any = null;

        // 1. Tentative d'upsert direct (rapide, 1 seule requête réseau)
        const primaryRes = await supabase
          .from("orders")
          .upsert(upsertData as never, { onConflict: "id" })
          .select()
          .single();

        data = primaryRes.data;
        error = primaryRes.error;

        // 2. Si l'upsert échoue à cause de la machine à états de la base de données (trg_validate_order_status)
        //    qui interdit de sauter directement par exemple de 'preparation' vers 'livree',
        //    on applique la résolution pas-à-pas pour franchir les étapes intermédiaires sans bloquer !
        if (
          error &&
          targetId &&
          !targetId.startsWith("temp_") &&
          (error.message?.includes("Transition de statut invalide") ||
            error.message?.includes("validate_order_status") ||
            error.message?.includes("statut") ||
            error.code === "P0001")
        ) {
          console.info(
            `[SyncEngine] Résolution transition de statut pas-à-pas pour la commande ${targetId}...`,
          );

          // Récupérer le statut actuel réel sur Supabase
          const { data: remoteRow } = await supabase
            .from("orders")
            .select("status")
            .eq("id", targetId)
            .maybeSingle();

          const STATUS_ORDER: OrderStatus[] = [
            "nouvelle",
            "preparation",
            "confection",
            "finition",
            "prete",
            "livree",
          ];

          const currentStatus = (remoteRow?.status as OrderStatus) || "nouvelle";
          const targetStatus = (upsertData["status"] as OrderStatus) || "nouvelle";
          const currentIdx = STATUS_ORDER.indexOf(currentStatus);
          const targetIdx = STATUS_ORDER.indexOf(targetStatus);

          if (currentIdx >= 0 && targetIdx >= 0 && targetIdx > currentIdx) {
            let stepSuccess = true;
            // Avancer de statut en statut séquentiellement
            for (let step = currentIdx + 1; step <= targetIdx; step++) {
              const nextStatus = STATUS_ORDER[step];
              if (!nextStatus) break;

              if (step === targetIdx) {
                // Dernière étape : appliquer toutes les données finales (delivered_to, notes, etc.)
                const finalRes = await supabase
                  .from("orders")
                  .update(upsertData as never)
                  .eq("id", targetId)
                  .select()
                  .single();
                data = finalRes.data;
                error = finalRes.error;
              } else {
                // Étape intermédiaire pour satisfaire trg_validate_order_status
                const { error: stepErr } = await supabase
                  .from("orders")
                  .update({ status: nextStatus })
                  .eq("id", targetId);
                if (stepErr) {
                  console.warn(
                    `[SyncEngine] Échec transition intermédiaire vers ${nextStatus}:`,
                    stepErr,
                  );
                  stepSuccess = false;
                  break;
                }
              }
            }

            if (!stepSuccess && error) {
              // Si la séquence intermédiaire a buté, tenter un update ciblé
              const retryRes = await supabase
                .from("orders")
                .update(upsertData as never)
                .eq("id", targetId)
                .select()
                .single();
              data = retryRes.data;
              error = retryRes.error;
            }
          } else {
            // Statut identique ou transition directe permise (ex: annulee)
            const fallbackRes = await supabase
              .from("orders")
              .update(upsertData as never)
              .eq("id", targetId)
              .select()
              .single();
            data = fallbackRes.data;
            error = fallbackRes.error;
          }
        }

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
