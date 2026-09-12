import type React from "react";
import type { AppState } from "../../../workbench/state";
import type { ModelForm } from "../components/types";
import type { ModelProviderModelCatalog } from "@api-contracts/config";
import type { SubAgentDefinition } from "../../../contracts/sub-agents";
import type { SettingsControllerContext } from "./controller-types";
import type { VisibleAiMode } from "../config-projection";
import {
  refreshSubAgentCatalog,
  resetOrdinaryAgentSystemPrompt as resetOrdinaryAgentSystemPromptRequest,
  saveOrdinaryAgentSystemPrompt as saveOrdinaryAgentSystemPromptRequest,
} from "../config-actions";
import {
  createModelSettingsController,
  type ModelSettingsController,
} from "./model-controller";

export type AppSettingsController = ModelSettingsController & {
  readonly saveOrdinaryAgentSystemPrompt: (systemPrompt: string) => Promise<void>;
  readonly resetOrdinaryAgentSystemPrompt: () => Promise<void>;
  readonly refreshSubAgents: () => Promise<void>;
};

export type AppSettingsControllerOptions = {
  readonly app: AppState;
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly aiMode: VisibleAiMode;
  readonly modelForm: ModelForm;
  readonly setModelForm: React.Dispatch<React.SetStateAction<ModelForm>>;
  readonly setModelCatalogs: React.Dispatch<React.SetStateAction<Record<string, ModelProviderModelCatalog>>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly modelSaveQueueRef: React.MutableRefObject<Promise<void>>;
  readonly setSavingModel: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setSavingOrdinaryAgentPrompt: React.Dispatch<React.SetStateAction<boolean>>;
};

export function createAppSettingsController(options: AppSettingsControllerOptions): AppSettingsController {
  const context: SettingsControllerContext = {
    app: options.app,
    setApp: options.setApp,
    mountedRef: options.mountedRef,
  };
  const model = createModelSettingsController({
    ...context,
    aiMode: options.aiMode,
    modelForm: options.modelForm,
    setModelForm: options.setModelForm,
    setModelCatalogs: options.setModelCatalogs,
    modelSaveQueueRef: options.modelSaveQueueRef,
    setSavingModel: options.setSavingModel,
  });

  function reportError(message: string, error: unknown): void {
    if (options.mountedRef.current) {
      options.setApp((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : message,
      }));
    }
  }

  async function persistOrdinaryAgentPrompt(action: () => Promise<unknown>): Promise<void> {
    options.setSavingOrdinaryAgentPrompt(true);
    try {
      const response = await action();
      if (options.mountedRef.current && isConfigResponse(response)) {
        options.setApp((previous) => ({ ...previous, config: { ...previous.config, ...response } }));
      }
    } catch (error) {
      reportError("通用 Agent 设置保存失败。", error);
      throw error;
    } finally {
      if (options.mountedRef.current) options.setSavingOrdinaryAgentPrompt(false);
    }
  }

  function isConfigResponse(value: unknown): value is NonNullable<AppState["config"]> {
    return typeof value === "object" && value !== null;
  }

  return {
    ...model,
    saveOrdinaryAgentSystemPrompt: (systemPrompt) =>
      persistOrdinaryAgentPrompt(() => saveOrdinaryAgentSystemPromptRequest(systemPrompt)),
    resetOrdinaryAgentSystemPrompt: () =>
      persistOrdinaryAgentPrompt(() => resetOrdinaryAgentSystemPromptRequest()),
    refreshSubAgents: async () => {
      try {
        const subAgents = await refreshSubAgentCatalog();
        if (options.mountedRef.current) {
          options.setApp((previous) => ({ ...previous, subAgents }));
        }
      } catch (error) {
        reportError("子代理目录刷新失败。", error);
        throw error;
      }
    },
  };
}