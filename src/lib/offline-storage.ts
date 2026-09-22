/**
 * CouturPro — Gestionnaire de stockage local haute performance (IndexedDB natif)
 * Assure le fonctionnement 100% hors-ligne sur PC, Android et iOS.
 */

const DB_NAME = "couturpro_offline_v1";
const DB_VERSION = 1;

export type SyncQueueItem = {
  id: string; // UUID de l'action de synchronisation
  entity:
    | "client"
    | "order"
    | "payment"
    | "measurement_set"
    | "appointment"
    | "garment_type"
    | "catalog_model"
    | "business";
  action: "create" | "update" | "delete";
  payload: Record<string, unknown>;
  tempId?: string | undefined; // Si entité créée hors-ligne avec un ID temporaire
  createdAt: string; // ISO string
  status: "pending" | "syncing" | "failed";
  errorMessage?: string | undefined;
  retryCount: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB non supporté dans cet environnement"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Table Atelier / Métadonnées
      if (!db.objectStoreNames.contains("workshop_data")) {
        db.createObjectStore("workshop_data", { keyPath: "id" });
      }

      // 2. Clients
      if (!db.objectStoreNames.contains("clients")) {
        const clientStore = db.createObjectStore("clients", { keyPath: "id" });
        clientStore.createIndex("by_business", "business_id", { unique: false });
        clientStore.createIndex("by_name", "last_name", { unique: false });
      }

      // 3. Commandes
      if (!db.objectStoreNames.contains("orders")) {
        const orderStore = db.createObjectStore("orders", { keyPath: "id" });
        orderStore.createIndex("by_business", "business_id", { unique: false });
        orderStore.createIndex("by_client", "client_id", { unique: false });
        orderStore.createIndex("by_status", "status", { unique: false });
      }

      // 4. Paiements
      if (!db.objectStoreNames.contains("payments")) {
        const paymentStore = db.createObjectStore("payments", { keyPath: "id" });
        paymentStore.createIndex("by_order", "order_id", { unique: false });
      }

      // 5. Relevés de mesures
      if (!db.objectStoreNames.contains("measurement_sets")) {
        const measureStore = db.createObjectStore("measurement_sets", { keyPath: "id" });
        measureStore.createIndex("by_client", "client_id", { unique: false });
      }

      // 6. Rendez-vous
      if (!db.objectStoreNames.contains("appointments")) {
        const appointmentStore = db.createObjectStore("appointments", { keyPath: "id" });
        appointmentStore.createIndex("by_client", "client_id", { unique: false });
        appointmentStore.createIndex("by_date", "scheduled_date", { unique: false });
      }

      // 7. Types de vêtements & Lookbook
      if (!db.objectStoreNames.contains("garment_types")) {
        db.createObjectStore("garment_types", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("catalog_models")) {
        db.createObjectStore("catalog_models", { keyPath: "id" });
      }

      // 8. File d'attente de synchronisation ordonnée (FIFO)
      if (!db.objectStoreNames.contains("sync_queue")) {
        const queueStore = db.createObjectStore("sync_queue", { keyPath: "id" });
        queueStore.createIndex("by_created", "createdAt", { unique: false });
        queueStore.createIndex("by_status", "status", { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });

  return dbPromise;
}

// -----------------------------------------------------------------------------
// OPÉRATIONS GÉNÉRIQUES SUR LES STORES
// -----------------------------------------------------------------------------

export async function setLocalItem<T extends { id: string }>(
  storeName: string,
  item: T,
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function setLocalItems<T extends { id: string }>(
  storeName: string,
  items: T[],
): Promise<void> {
  if (!items || items.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalItem<T>(storeName: string, id: string): Promise<T | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllLocalItems<T>(storeName: string): Promise<T[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLocalItem(storeName: string, id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(storeName: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// -----------------------------------------------------------------------------
// GESTIONNAIRE DE LA FILE D'ATTENTE DE SYNCHRONISATION (SYNC QUEUE)
// -----------------------------------------------------------------------------

export async function addToSyncQueue(
  item: Omit<SyncQueueItem, "id" | "createdAt" | "status" | "retryCount">,
): Promise<SyncQueueItem> {
  const syncItem: SyncQueueItem = {
    ...item,
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    retryCount: 0,
  };

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_queue", "readwrite");
    const store = tx.objectStore("sync_queue");
    const req = store.put(syncItem);
    req.onsuccess = () => resolve(syncItem);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingSyncQueue(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_queue", "readonly");
    const store = tx.objectStore("sync_queue");
    const index = store.index("by_created");
    const req = index.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeSyncQueueItem(id: string): Promise<void> {
  return deleteLocalItem("sync_queue", id);
}

export async function updateSyncQueueItem(item: SyncQueueItem): Promise<void> {
  return setLocalItem("sync_queue", item);
}

export async function getSyncQueueCount(): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sync_queue", "readonly");
    const store = tx.objectStore("sync_queue");
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
