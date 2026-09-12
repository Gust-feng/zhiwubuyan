import type { OrdinaryAgentPromptSettings, SkillTriggerSettings } from "./agent-settings.js";

import type {

  ModelCapabilityOverrideSettings,

  ModelProviderModelCatalog,

  ModelProviderProfileSettings,

} from "./model-settings.js";



export type LocalSettings = {
  readonly version: 1;
  readonly activeModelProfileId: string;
  readonly modelProfiles: readonly ModelProviderProfileSettings[];
  readonly modelProviderOrder?: readonly string[];
  readonly modelCatalogs?: readonly ModelProviderModelCatalog[];
  readonly modelCapabilityOverrides?: readonly ModelCapabilityOverrideSettings[];
  readonly ordinaryAgent?: OrdinaryAgentPromptSettings;
  readonly skillTrigger?: SkillTriggerSettings;
  readonly updatedAt: string;
};

export type SettingsStore = {
  readSettings(): Promise<unknown | undefined>;
  writeSettings(settings: LocalSettings): Promise<void>;
  /** Moves an incompatible settings document aside before the owner recreates defaults. */
  quarantineInvalidSettings?(): Promise<string | undefined>;
};

export type SecretMetadata = {
  readonly configured: boolean;
  readonly updatedAt?: string;
};

export type LocalDevSecretStore = {
  getMetadata(secretRef: string): Promise<SecretMetadata>;
  readSecret(secretRef: string): Promise<string | undefined>;
  writeSecret(secretRef: string, value: string): Promise<SecretMetadata>;
  deleteSecret(secretRef: string): Promise<SecretMetadata>;
};
