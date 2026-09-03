import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // DB metadata rarely changes under us; refetch is explicit.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
