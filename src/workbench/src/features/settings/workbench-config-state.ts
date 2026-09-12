import { useMemo, useState } from "react";
import { useAppFormStateSync } from "./form-state-sync";
import type {
  ComposerReasoningEffort,
  VisibleAiMode,
} from "./config-projection";
import type { AppState } from "../../workbench/state";
import type { ChatModelOption } from "../../contracts/composer";
import type { ModelForm } from "./components/types";
import type { ModelProviderModelCatalog } from "@api-contracts/config";
import { modelOptionSupportsReasoningEffort, modelOptionsFromConfig, selectedModelOptionId } from "./model/options";

export type AppWorkbenchConfigState = {
  readonly aiMode: VisibleAiMode;
  readonly modelForm: ModelForm;
  readonly setModelForm: React.Dispatch<React.SetStateAction<ModelForm>>;
  readonly composerReasoningEffort: ComposerReasoningEffort;
  readonly setComposerReasoningEffort: React.Dispatch<React.SetStateAction<ComposerReasoningEffort>>;
  readonly composerSelectedModelId: string | undefined;
  readonly setComposerSelectedModelId: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly modelCatalogs: Record<string, ModelProviderModelCatalog>;
  readonly setModelCatalogs: React.Dispatch<React.SetStateAction<Record<string, ModelProviderModelCatalog>>>;
  readonly ordinaryAgentSystemPrompt: string;
  readonly setOrdinaryAgentSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  readonly modelOptions: readonly ChatModelOption[];
  readonly persistedSelectedModelId: string;
  readonly selectedModelId: string;
  readonly selectedModelSupportsReasoningEffort: boolean;
  readonly selectedModelContextWindowTokens?: number;
};

export function useAppWorkbenchConfigState(app: AppState): AppWorkbenchConfigState {
  const [aiMode, setAiMode] = useState<VisibleAiMode>("openai-responses");
  const [modelForm, setModelForm] = useState<ModelForm>({
    profileId: "",
    label: "",
    logoDataUrl: "",
    logoCleared: false,
    baseUrl: "",
    protocolKind: "openai_compatible_chat_completions",
    model: "",
    apiKey: "",
    apiKeyCleared: false,
  });
  const [composerReasoningEffort, setComposerReasoningEffort] = useState<ComposerReasoningEffort>("");
  const [composerSelectedModelId, setComposerSelectedModelId] = useState<string | undefined>(undefined);
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, ModelProviderModelCatalog>>({});
  const [ordinaryAgentSystemPrompt, setOrdinaryAgentSystemPrompt] = useState("");

  const modelOptions = useMemo(() => modelOptionsFromConfig(app.config, modelCatalogs), [app.config, modelCatalogs]);
  const persistedSelectedModelId = useMemo(
    () => selectedModelOptionId(app.config, modelOptions),
    [app.config, modelOptions],
  );
  const selectedModelId = useMemo(() => {
    if (composerSelectedModelId !== undefined && modelOptions.some((model) => model.id === composerSelectedModelId)) {
      return composerSelectedModelId;
    }
    return persistedSelectedModelId;
  }, [composerSelectedModelId, modelOptions, persistedSelectedModelId]);
  const selectedModelSupportsReasoningEffort = useMemo(
    () => modelOptionSupportsReasoningEffort(app.config, selectedModelId),
    [app.config, selectedModelId],
  );
  const selectedModelContextWindowTokens = useMemo(
    () => modelOptions.find((model) => model.id === selectedModelId)?.capabilities?.contextWindowTokens,
    [modelOptions, selectedModelId],
  );

  useAppFormStateSync({
    app,
    setAiMode,
    setModelForm,
    setOrdinaryAgentSystemPrompt,
    setModelCatalogs,
    composerSelectedModelId,
    setComposerSelectedModelId,
    persistedSelectedModelId,
    modelOptions,
    composerReasoningEffort,
    selectedModelSupportsReasoningEffort,
    setComposerReasoningEffort,
  });

  return {
    aiMode,
    modelForm,
    setModelForm,
    composerReasoningEffort,
    setComposerReasoningEffort,
    composerSelectedModelId,
    setComposerSelectedModelId,
    modelCatalogs,
    setModelCatalogs,
    ordinaryAgentSystemPrompt,
    setOrdinaryAgentSystemPrompt,
    modelOptions,
    persistedSelectedModelId,
    selectedModelId,
    selectedModelSupportsReasoningEffort,
    selectedModelContextWindowTokens,
  };
}