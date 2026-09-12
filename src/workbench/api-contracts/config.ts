import type {
  ModelCapabilities as DomainModelCapabilities,
  ModelProviderModelCatalog as DomainModelProviderModelCatalog,
  ModelProviderPreset as DomainModelProviderPreset,
  SanitizedModelProviderConfig,
  SanitizedOrdinaryAgentPromptConfig,
  SanitizedSkillTriggerConfig,
} from "../domain/config/index.js";

export type ConfigResponse = {
  readonly ok?: boolean;
  readonly status?: "completed" | "failed";
  readonly product?: ProductInfo;
  readonly appearance?: AppearanceConfig;
  readonly config?: ModelProviderProfile;
  readonly profile?: ModelProviderProfile;
  readonly activeProfile?: ModelProviderProfile;
  readonly profiles?: readonly ModelProviderProfile[];
  readonly modelProviderOrder?: readonly string[];
  readonly modelCatalogs?: readonly ModelProviderModelCatalog[];
  readonly modelCapabilityProfiles?: readonly ModelCapabilityProfile[];
  readonly modelProviderMarket?: ModelProviderMarket;
  readonly ordinaryAgent?: OrdinaryAgentPromptConfig;
  readonly skillTrigger?: SkillTriggerConfig;
};

export type ModelProviderProfile = Partial<SanitizedModelProviderConfig>;
export type ModelCapabilities = Partial<DomainModelCapabilities>;
export type ModelProviderModelCatalog = DomainModelProviderModelCatalog;
export type ModelProviderPreset = DomainModelProviderPreset;

export type ModelCapabilityProfile = {
  readonly profileId: string;
  readonly providerKind: SanitizedModelProviderConfig["providerKind"];
  readonly protocolKind: SanitizedModelProviderConfig["protocolKind"];
  readonly model: string;
  readonly capabilities: DomainModelCapabilities;
};

export type ModelProviderMarket = {
  readonly presets: readonly DomainModelProviderPreset[];
};

export type ProductInfo = {
  readonly name: string;
  readonly version: string;
  readonly defaultEntry: string;
  readonly configDirectory: string;
  readonly productHome: string;
};

export type AppearanceConfig = {
  readonly source?: "builtin_panel_styles" | "user_config" | string;
  readonly themeLabel?: string;
  readonly densityLabel?: string;
  readonly colorScheme?: "light" | "dark" | string;
  readonly configurable?: boolean;
  readonly updatedAt?: string;
};

export type OrdinaryAgentPromptConfig = Partial<Omit<
  SanitizedOrdinaryAgentPromptConfig,
  "systemPromptVariant" | "variants"
>> & {
  readonly systemPromptVariant?: string;
  readonly variants?: readonly {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
  }[];
};
export type SkillTriggerMode = SanitizedSkillTriggerConfig["mode"];
export type SkillTriggerConfig = Partial<SanitizedSkillTriggerConfig>;

/**
 * 内置模型服务预设：研究模型的「一键填充」与领域定义共用同一份事实，界面不再各存一份。
 */
export { listBuiltinModelProviderPresets } from "../domain/config/index.js";

export type PanelConfigSnapshotResponse = ConfigResponse & {
  readonly ok: true;
  readonly status: "completed";
  readonly product: ProductInfo;
  readonly config: SanitizedModelProviderConfig;
  readonly profiles: readonly SanitizedModelProviderConfig[];
  readonly modelProviderOrder: readonly string[];
  readonly modelCatalogs: readonly DomainModelProviderModelCatalog[];
  readonly modelCapabilityProfiles: readonly ModelCapabilityProfile[];
  readonly modelProviderMarket: ModelProviderMarket;
  readonly ordinaryAgent: SanitizedOrdinaryAgentPromptConfig;
  readonly skillTrigger: SanitizedSkillTriggerConfig;
};
