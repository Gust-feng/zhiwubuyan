import React, { useEffect, useRef, useState } from "react";
import { CloudCog, Code2, Info, SlidersHorizontal, X } from "lucide-react";
import type { ConfigResponse } from "@api-contracts/config";
import type { SettingsGroup } from "./types";
import { OrdinaryAgentPromptSettings, ResearchPreferenceSettings } from "./basic-capabilities";
import { ResearchModelSettings } from "./research-model-settings";
import { DeveloperToolStatistics, preloadUsageStatistics } from "./usage-statistics";
import "./capability.css";

export type { ModelForm, SettingsGroup } from "./types";

export function SettingsDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGroup?: SettingsGroup;
  readonly config?: ConfigResponse;
  readonly ordinaryAgentSystemPrompt: string;
  readonly setOrdinaryAgentSystemPrompt: (value: string) => void;
  readonly developerModeEnabled: boolean;
  readonly onDeveloperModeChange: (enabled: boolean) => void;
  readonly savingOrdinaryAgentPrompt?: boolean;
  readonly onSaveOrdinaryAgentSystemPrompt: (systemPrompt: string) => Promise<void>;
  readonly onResetOrdinaryAgentSystemPrompt: () => Promise<void>;
}): React.ReactElement | null {
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("models");
  useEffect(() => {
    if (props.open) {
      setActiveGroup(props.initialGroup ?? "models");
    }
  }, [props.open, props.initialGroup]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  useEffect(() => {
    if (!props.open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [props.open]);

  useEffect(() => {
    if (!props.developerModeEnabled && DEVELOPER_SETTINGS_GROUPS.has(activeGroup)) {
      setActiveGroup("about");
    }
  }, [activeGroup, props.developerModeEnabled]);

  if (!props.open) return null;

  const visibleGroups = settingsGroupsForDeveloperMode(props.developerModeEnabled);
  const visibleActiveGroup = visibleGroups.some((group) => group.id === activeGroup)
    ? activeGroup
    : visibleGroups[0]?.id ?? "models";
  const activeInfo = visibleGroups.find((group) => group.id === visibleActiveGroup) ?? visibleGroups[0]!;
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <button type="button" className="settings-backdrop" aria-label="关闭设置" onClick={props.onClose} />
      <section className="settings-dialog">
        <aside className="settings-sidebar">
          <button type="button" className="settings-close-button" onClick={props.onClose} aria-label="关闭">
            <X size={16} />
          </button>
          <nav aria-label="设置分组">
            {visibleGroups.map((group) => (
              <button
                type="button"
                key={group.id}
                className={group.id === visibleActiveGroup ? "active" : ""}
                onClick={() => setActiveGroup(group.id)}
                onFocus={() => {
                  if (group.id === "developer") preloadUsageStatistics();
                }}
                onMouseEnter={() => {
                  if (group.id === "developer") preloadUsageStatistics();
                }}
              >
                {group.icon}
                <span>{group.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="settings-main">
          <header>
            <h2>{activeInfo.label}</h2>
          </header>
          <div className={`settings-content ${visibleActiveGroup === "models" ? "model-settings-content" : ""}`}>
            {visibleActiveGroup === "models" && (
              <div className="basic-capabilities-settings">
                <ResearchModelSettings />
              </div>
            )}
            {visibleActiveGroup === "researchPreferences" && (
              <div className="basic-capabilities-settings">
                <ResearchPreferenceSettings />
              </div>
            )}
            {visibleActiveGroup === "developer" && (
              <>
                <div className="basic-capabilities-settings developer-prompt-settings">
                  <OrdinaryAgentPromptSettings
                    config={props.config}
                    systemPrompt={props.ordinaryAgentSystemPrompt}
                    setSystemPrompt={props.setOrdinaryAgentSystemPrompt}
                    saving={props.savingOrdinaryAgentPrompt}
                    onSave={props.onSaveOrdinaryAgentSystemPrompt}
                    onReset={props.onResetOrdinaryAgentSystemPrompt}
                  />
                </div>
                <DeveloperToolStatistics />
              </>
            )}
            {visibleActiveGroup === "about" && (
              <AboutSettings
                config={props.config}
                developerModeEnabled={props.developerModeEnabled}
                onDeveloperModeChange={props.onDeveloperModeChange}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

const SETTINGS_GROUPS: readonly { readonly id: SettingsGroup; readonly label: string; readonly icon: React.ReactNode }[] = [
  { id: "models", label: "模型服务", icon: <CloudCog size={15} /> },
  { id: "researchPreferences", label: "研究偏好", icon: <SlidersHorizontal size={15} /> },
  { id: "developer", label: "开发者选项", icon: <Code2 size={15} /> },
  { id: "about", label: "关于", icon: <Info size={15} /> },
];

const DEVELOPER_SETTINGS_GROUPS: ReadonlySet<SettingsGroup> = new Set(["developer"]);

export function settingsGroupsForDeveloperMode(enabled: boolean): typeof SETTINGS_GROUPS {
  return enabled ? SETTINGS_GROUPS : SETTINGS_GROUPS.filter((group) => !DEVELOPER_SETTINGS_GROUPS.has(group.id));
}

const DEVELOPER_MODE_GESTURE_CLICKS = 7;
const DEVELOPER_MODE_GESTURE_WINDOW_MS = 2_000;

export function AboutSettings(props: {
  readonly config?: ConfigResponse;
  readonly developerModeEnabled: boolean;
  readonly onDeveloperModeChange: (enabled: boolean) => void;
}): React.ReactElement {
  const product = props.config?.product;
  const productName = product?.name ?? "知无不言";
  const version = product?.version ?? "未提供";
  const developerModeGesture = useRef({ count: 0, startedAt: 0 });

  const handleDeveloperModeGesture = (): void => {
    const now = Date.now();
    const previous = developerModeGesture.current;
    const continuesGesture = previous.count > 0 && now - previous.startedAt <= DEVELOPER_MODE_GESTURE_WINDOW_MS;
    const count = continuesGesture ? previous.count + 1 : 1;
    developerModeGesture.current = { count, startedAt: continuesGesture ? previous.startedAt : now };
    if (count < DEVELOPER_MODE_GESTURE_CLICKS) return;
    developerModeGesture.current = { count: 0, startedAt: 0 };
    props.onDeveloperModeChange(!props.developerModeEnabled);
  };

  return (
    <div className="about-settings">
      <section className="settings-card about-product-card">
        <div className="about-product-header">
          <div className="about-product-main">
            <span className="about-product-mark" aria-hidden="true">
              <img src="/favicon.svg" alt="" />
            </span>
            <div>
              <h3>{productName}</h3>
              <div className="about-product-tags">
                <button
                  type="button"
                  className="about-product-version"
                  aria-label={`版本 ${version}`}
                  onClick={handleDeveloperModeGesture}
                >
                  v{version}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}