import { queryOptions } from "@tanstack/react-query";
import { getJson } from "../api";
import type { UsageStatistics, UsageStatisticsResponse } from "../contracts/statistics";
import { workbenchQueryClient } from "../query-client";

export const usageStatisticsQuery = queryOptions({
  queryKey: ["runtime", "usage-statistics"] as const,
  queryFn: async ({ signal }): Promise<UsageStatistics> => {
    const response = await getJson<UsageStatisticsResponse>("/api/runtime/usage-statistics", { signal });
    return response.statistics;
  },
  retry: false,
  staleTime: 30_000,
});

export function preloadUsageStatistics(): void {
  void workbenchQueryClient.prefetchQuery(usageStatisticsQuery);
}

export function invalidateUsageStatistics(): void {
  void workbenchQueryClient.invalidateQueries({ queryKey: usageStatisticsQuery.queryKey });
}