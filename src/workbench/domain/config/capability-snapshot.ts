export type CapabilitySkillMetadataValue = string | number | boolean | readonly string[];

export type CapabilitySkillCompatibility = Readonly<Record<string, string | readonly string[]>>;

export type CapabilitySkillProvenanceValue = string | number | boolean | null | readonly (string | number | boolean | null)[];

export type CapabilitySkillProvenance = Readonly<Record<string, CapabilitySkillProvenanceValue>>;

export type CapabilitySkillResourceIndexItem = {
  readonly kind: "script" | "reference" | "asset";
  readonly name: string;
  readonly relativePath?: string;
  readonly sourcePath: string;
  readonly contentHash?: string;
  readonly byteLength?: number;
  readonly loadError?: string;
};

export type CapabilitySkillValidationStatus = "valid" | "invalid" | "load_error";

export type CapabilitySkillCatalogItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly sourcePath: string;
  readonly triggers: readonly string[];
  readonly lastUsedAt?: string;
  readonly summary?: string;
  readonly category?: string;
  readonly sourceKind?: "project" | "user" | "plugin" | "admin" | "custom";
  readonly sourceRootId?: string;
  readonly sourcePrecedence?: number;
  readonly stateKey?: string;
  readonly version?: string;
  readonly provenance?: CapabilitySkillProvenance;
  readonly whenToUse?: string;
  readonly disableModelInvocation?: boolean;
  readonly userInvocable?: boolean;
  readonly license?: string;
  readonly compatibility?: CapabilitySkillCompatibility;
  readonly metadata?: Readonly<Record<string, CapabilitySkillMetadataValue>>;
  readonly allowedTools?: readonly string[];
  readonly resources?: readonly CapabilitySkillResourceIndexItem[];
  readonly contentHash?: string;
  readonly bodyHash?: string;
  readonly loadError?: string;
  readonly validationStatus?: CapabilitySkillValidationStatus;
  readonly validationErrors?: readonly string[];
};

export type RunEnabledSkill = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggers: readonly string[];
  readonly summary?: string;
  readonly category?: string;
  readonly sourceKind?: "project" | "user" | "plugin" | "admin" | "custom";
  readonly sourceRootId?: string;
  readonly sourcePrecedence?: number;
  readonly stateKey?: string;
  readonly version?: string;
  readonly provenance?: CapabilitySkillProvenance;
  readonly whenToUse?: string;
  readonly disableModelInvocation?: boolean;
  readonly userInvocable?: boolean;
  readonly metadata?: Readonly<Record<string, CapabilitySkillMetadataValue>>;
  readonly allowedTools?: readonly string[];
  readonly contentHash?: string;
  readonly bodyHash?: string;
};
