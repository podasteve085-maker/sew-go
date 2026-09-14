import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes : affichage instantané sans spinner
        gcTime: 1000 * 60 * 30, // 30 minutes de conservation en mémoire
        refetchOnWindowFocus: false, // pas de rechargement intempestif
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent", // préchargement au survol/toucher avant même le clic
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 1000 * 60 * 5,
  });

  return router;
};
