type AppointmentSnapshot = {
  id: string;
  updated_at?: string | null;
};

type PendingAppointmentMutation = {
  entity: string;
  action: string;
  payload?: Record<string, unknown>;
  tempId?: string | undefined;
};

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Combines fresh server rows with local state and pending offline writes.
 * Pending writes always win; otherwise a newer local update wins over a
 * server response that may have started before the write was synchronized.
 */
export function reconcileAppointmentRows<T extends AppointmentSnapshot>(
  serverRows: T[],
  localRows: T[],
  queue: PendingAppointmentMutation[],
): T[] {
  const pendingById = new Map<string, Record<string, unknown>>();
  const pendingDeleteIds = new Set<string>();

  for (const item of queue) {
    if (item.entity !== "appointment") continue;
    const id = typeof item.payload?.["id"] === "string" ? item.payload["id"] : item.tempId;
    if (!id) continue;

    if (item.action === "delete") {
      pendingDeleteIds.add(id);
      pendingById.delete(id);
    } else if (!pendingDeleteIds.has(id) && item.payload) {
      pendingById.set(id, item.payload);
    }
  }

  const localById = new Map(localRows.map((appointment) => [appointment.id, appointment]));
  const serverIds = new Set(serverRows.map((appointment) => appointment.id));
  const merged = serverRows
    .filter((appointment) => !pendingDeleteIds.has(appointment.id))
    .map((serverRow) => {
      const localRow = localById.get(serverRow.id);
      const pending = pendingById.get(serverRow.id);
      const localTimestamp = parseTimestamp(localRow?.updated_at);
      const serverTimestamp = parseTimestamp(serverRow.updated_at);
      const localIsNewer =
        localRow &&
        localTimestamp !== null &&
        (serverTimestamp === null || localTimestamp > serverTimestamp);
      const base = localIsNewer ? { ...serverRow, ...localRow } : serverRow;
      return pending ? ({ ...base, ...localRow, ...pending } as T) : base;
    });

  merged.push(
    ...localRows.filter(
      (localRow) => !serverIds.has(localRow.id) && !pendingDeleteIds.has(localRow.id),
    ),
  );
  return merged;
}
