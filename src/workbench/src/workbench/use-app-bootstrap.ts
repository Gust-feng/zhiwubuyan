import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { applyAppBootstrap, loadAppBootstrap } from "../shell/bootstrap";
import type { AppState } from "./state";

export type AppBootstrapLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "retrying" }
  | { readonly status: "error"; readonly message: string };

export type AppBootstrapController = {
  readonly state: AppBootstrapLoadState;
  readonly retry: () => void;
};

const READY: AppBootstrapLoadState = { status: "ready" };

/**
 * 启动数据没有需要预取的真实接口，写入默认值后就绪。
 * 状态通道保留原形状：后续接入真实的配置或会话接口时，加载与重试按同样契约恢复。
 */
export function useAppBootstrap(input: {
  readonly mountedRef: MutableRefObject<boolean>;
  readonly setApp: Dispatch<SetStateAction<AppState>>;
}): AppBootstrapController {
  const apply = useCallback((): void => {
    input.setApp((previous) => applyAppBootstrap(previous, loadAppBootstrap()));
  }, [input.setApp]);

  useEffect(() => {
    apply();
  }, [apply]);

  return { state: READY, retry: apply };
}
