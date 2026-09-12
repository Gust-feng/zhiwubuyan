import { QueryClient } from "@tanstack/react-query";

export const workbenchQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});