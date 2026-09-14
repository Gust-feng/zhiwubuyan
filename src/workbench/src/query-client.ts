import { QueryClient } from "@tanstack/react-query";

/**
 * 工作台查询缓存：默认不重试，避免额度类接口在失败时被自动放大成多次上游调用。
 * staleTime 只给短窗口：挂载/切页时复用刚取到的数据，不把明显过期的结果当新的展示。
 * 轮询频率仍由各查询自己声明（研究任务必须保持秒级刷新）。
 */
export const workbenchQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});
