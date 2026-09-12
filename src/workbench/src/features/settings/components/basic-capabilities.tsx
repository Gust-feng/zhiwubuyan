import React from "react";
import { MessageSquareText, RotateCcw, Save, Telescope } from "lucide-react";
import type { ConfigResponse } from "@api-contracts/config";
import {
  getDefaultResearchTier,
  getDefaultResearchWebSupplement,
  saveDefaultResearchTier,
  saveDefaultResearchWebSupplement,
  type ResearchDefaultTier,
} from "../../deep-research/research-preference";
import { CapabilitySettingsSection } from "./capability-section";
import { SettingsSelectControl } from "./select-control";

/**
 * 研究偏好：只设置研究入口的初始选择，单次研究仍可在入口覆盖。
 * Ultra 仅在桌面端可用，因此这两项对网页端用户没有实际作用。
 */
export function ResearchPreferenceSettings(): React.ReactElement {
  const [tier, setTier] = React.useState<ResearchDefaultTier>(() => getDefaultResearchTier());
  const [webSupplement, setWebSupplement] = React.useState<boolean>(() => getDefaultResearchWebSupplement());

  const changeTier = (value: string): void => {
    const next: ResearchDefaultTier = value === "ultra" ? "ultra" : "pro";
    setTier(next);
    saveDefaultResearchTier(next);
  };

  const changeWebSupplement = (): void => {
    const next = !webSupplement;
    setWebSupplement(next);
    saveDefaultResearchWebSupplement(next);
  };

  return (
    <CapabilitySettingsSection
      icon={<Telescope size={16} />}
      title="研究默认值"
    >
      <div className="capability-preference-list">
        <div className="capability-preference-row" aria-label="默认研究深度">
          <div className="capability-preference-copy">
            <strong>研究深度</strong>
            <span>Ultra 仅在桌面端可用；网页端会提示需要桌面版</span>
          </div>
          <SettingsSelectControl
            id="research-default-tier"
            ariaLabel="默认研究深度"
            value={tier}
            options={[
              { value: "pro", label: "Pro" },
              { value: "ultra", label: "Ultra" },
            ]}
            onChange={changeTier}
          />
        </div>
        <div className="capability-preference-row" aria-label="默认全网补证">
          <div className="capability-preference-copy">
            <strong>全网补证</strong>
            <span>在知乎公开讨论之外补充可核查的全网来源</span>
          </div>
          <button
            type="button"
            className="capability-toggle"
            aria-pressed={webSupplement}
            onClick={changeWebSupplement}
          >
            {webSupplement ? "开启" : "关闭"}
          </button>
        </div>
      </div>
    </CapabilitySettingsSection>
  );
}

export function OrdinaryAgentPromptSettings(props: {
  readonly config?: ConfigResponse;
  readonly systemPrompt: string;
  readonly setSystemPrompt: (value: string) => void;
  readonly saving?: boolean;
  readonly onSave: (systemPrompt: string) => Promise<void>;
  readonly onReset: () => Promise<void>;
}): React.ReactElement {
  const maxChars = props.config?.ordinaryAgent?.maxSystemPromptChars ?? 20_000;
  const normalized = props.systemPrompt.trim();
  const persistedPrompt = props.config?.ordinaryAgent?.systemPrompt;
  const configLoaded = props.config?.ordinaryAgent !== undefined;
  const dirty = persistedPrompt === undefined ? normalized.length > 0 : normalized !== persistedPrompt.trim();
  const canSave = configLoaded && dirty && normalized.length > 0 && normalized.length <= maxChars && props.saving !== true;
  const canReset = props.saving !== true && (dirty || props.config?.ordinaryAgent?.isDefault !== true);
  const stateLabel = configLoaded
    ? dirty
      ? "未保存"
      : props.config?.ordinaryAgent?.isDefault === true
        ? "默认"
        : "自定义"
    : "加载中";
  return (
    <CapabilitySettingsSection
      icon={<MessageSquareText size={16} />}
      title="系统提示词"
      busy={props.saving === true}
      actions={
        <>
          <button
            type="button"
            className="model-info-save-button"
            onClick={() => void props.onReset()}
            disabled={!canReset}
          >
            <RotateCcw size={14} />
            <span>恢复默认</span>
          </button>
          <button
            type="button"
            className="model-info-save-button"
            onClick={() => void props.onSave(props.systemPrompt)}
            disabled={!canSave}
          >
            <Save size={14} />
            <span>{props.saving ? "保存中" : "保存"}</span>
          </button>
        </>
      }
    >
      <label className="ordinary-agent-prompt-field">
        Agent
        <textarea
          value={props.systemPrompt}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          maxLength={maxChars}
          onChange={(event) => props.setSystemPrompt(event.target.value)}
          placeholder="输入系统提示词"
        />
      </label>
      <div className="ordinary-agent-prompt-meta">
        <span>{normalized.length}/{maxChars}</span>
        <span>{stateLabel}</span>
      </div>
    </CapabilitySettingsSection>
  );
}
