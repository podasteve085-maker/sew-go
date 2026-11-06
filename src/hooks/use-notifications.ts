import { useMemo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, fetchOrders } from "@/lib/queries";
import { useBusiness } from "@/hooks/use-business";
import { getTodayStr } from "@/lib/notifications";
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
  const [calendarDate, setCalendarDate] = useState(getTodayStr);

  // Recompute date-sensitive reminders when the local calendar day changes.
  const notifications: AppNotification[] = useMemo(() => {
    return generateReminders(appointments, orders, atelierName, calendarDate);
    // localStorage dismissals are outside query data; refreshKey invalidates that derived list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, orders, atelierName, calendarDate, refreshKey]);

  // Déclenchement automatique des notifications système (bannière push téléphone)
  useEffect(() => {
    if (notifications.length > 0) {
      dispatchScheduledReminders(notifications).catch(() => {});
    }
  }, [notifications]);

  // Recalculates day-before/day-of reminders at midnight and when the app returns
  // from the background. The server push job remains responsible while it is closed.
  useEffect(() => {
    const checkCalendarDate = () => {
      const currentDate = getTodayStr();
      setCalendarDate((previousDate) =>
        previousDate === currentDate ? previousDate : currentDate,
      );
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkCalendarDate();
    };
    const timer = window.setInterval(checkCalendarDate, 60_000);
    window.addEventListener("focus", checkCalendarDate);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkCalendarDate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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
