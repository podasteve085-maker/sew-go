import { useMemo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, fetchOrders } from "@/lib/queries";
import { useBusiness } from "@/hooks/use-business";
import {
  generateReminders,
  dispatchScheduledReminders,
  type AppNotification,
} from "@/lib/notifications";

export function useNotifications() {
  const { data: business } = useBusiness();

  const appointmentsQuery = useQuery({
    queryKey: ["appointments"],
    queryFn: () => fetchAppointments(),
    staleTime: 60 * 1000,
  });

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => fetchOrders(),
    staleTime: 60 * 1000,
  });

  const appointments = appointmentsQuery.data ?? [];
  const orders = ordersQuery.data ?? [];
  const atelierName = business?.name ?? "Notre atelier";

  const [refreshKey, setRefreshKey] = useState(0);

  // Calcul instantané des rappels (Jour J, Veille, Retards)
  const notifications: AppNotification[] = useMemo(() => {
    return generateReminders(appointments, orders, atelierName);
  }, [appointments, orders, atelierName, refreshKey]);

  // Déclenchement automatique des notifications système (bannière push téléphone)
  useEffect(() => {
    if (notifications.length > 0) {
      dispatchScheduledReminders(notifications).catch(() => {});
    }
  }, [notifications]);

  const todayCount = notifications.filter((n) => n.timing === "today").length;
  const tomorrowCount = notifications.filter((n) => n.timing === "tomorrow").length;
  const overdueCount = notifications.filter((n) => n.timing === "overdue").length;

  return {
    notifications,
    todayCount,
    tomorrowCount,
    overdueCount,
    totalCount: notifications.length,
    isLoading: appointmentsQuery.isLoading || ordersQuery.isLoading,
    refetch: () => {
      appointmentsQuery.refetch();
      ordersQuery.refetch();
      setRefreshKey((k) => k + 1);
    },
  };
}
