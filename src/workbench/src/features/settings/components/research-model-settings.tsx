import React from "react";
import { Check, CloudCog, Lock, Save } from "lucide-react";
import { listBuiltinModelProviderPresets } from "@api-contracts/config";
import { getJson, postJson } from "../../../api";
import { CapabilitySettingsSection } from "./capability-section";
import "./research-model.css";

/**
 * 模型服务（单一研究模型）：深度研究只用一个模型，配置一项 baseUrl + 模型 ID + 密钥即可。
 * 仅在桌面端可写；网页端渲染锁定态并引导下载，写入一律由后端按运行面拒绝。
 * 密钥只在上行写入时出现一次，读取只回是否已配置。
 */

type ResearchModelView = {
  readonly configured: boolean;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly providerLabel: string;
  readonly apiKeyConfigured: boolean;
  readonly updatedAt?: string;
};

type ResearchModelStatus = {
  readonly configurable: boolean;
  readonly model: ResearchModelView;
};

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: ResearchModelStatus }
  | { readonly kind: "error"; readonly message: string };

export function ResearchModelSettings(): React.ReactElement {
  const [load, setLoad] = React.useState<LoadState>({ kind: "loading" });
  const [baseUrl, setBaseUrl] = React.useState("");
  const [modelId, setModelId] = React.useState("");
  const [providerLabel, setProviderLabel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const applyView = React.useCallback((status: ResearchModelStatus): void => {
    setLoad({ kind: "ready", status });
    setBaseUrl(status.model.baseUrl);
    setModelId(status.model.modelId);
    setProviderLabel(status.model.providerLabel);
    setApiKey("");
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await getJson<{ ok: true; data: ResearchModelStatus }>("/api/research-model");
        if (!cancelled) applyView(response.data);
      } catch (cause) {
        if (!cancelled) {
          setLoad({
            kind: "error",
            message: cause instanceof Error ? cause.message : "无法读取模型配置。",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyView]);

  if (load.kind === "loading") {
    return (
      <CapabilitySettingsSection icon={<CloudCog size={16} />} title="模型服务" busy>
        <div className="capability-empty">正在读取模型配置…</div>
      </CapabilitySettingsSection>
    );
  }

  if (load.kind === "error") {
    return (
      <CapabilitySettingsSection icon={<CloudCog size={16} />} title="模型服务">
        <div className="capability-empty" role="alert">{load.message}</div>
      </CapabilitySettingsSection>
    );
  }

  if (!load.status.configurable) {
    return (
      <CapabilitySettingsSection icon={<CloudCog size={16} />} title="模型服务">
        <div className="research-model-locked" role="note">
          <Lock size={16} aria-hidden />
          <div>
            <strong>模型服务仅在桌面版可配置</strong>
            <span>深度研究需要你自备模型 API。下载桌面版后在这里填写地址、模型与密钥，配置只保存在本机。</span>
          </div>
        </div>
      </CapabilitySettingsSection>
    );
  }

  const dirty = apiKey.trim().length > 0
    || baseUrl.trim() !== load.status.model.baseUrl
    || modelId.trim() !== load.status.model.modelId
    || providerLabel.trim() !== load.status.model.providerLabel;
  const canSave = dirty
    && baseUrl.trim().length > 0
    && modelId.trim().length > 0
    && (apiKey.trim().length > 0 || load.status.model.apiKeyConfigured)
    && !saving;

  const fillPreset = (presetId: string): void => {
    const preset = listBuiltinModelProviderPresets().find((item) => item.presetId === presetId);
    if (preset === undefined) return;
    setBaseUrl(preset.baseUrl);
    setModelId(preset.defaultModel ?? "");
    setProviderLabel(preset.vendor ?? preset.label);
    setNotice(`已填入 ${preset.label} 的默认地址，模型可在其开放平台按需修改。`);
    setError(null);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setNotice(null);
    setError(null);
    const keepApiKey = apiKey.trim().length === 0 && load.status.model.apiKeyConfigured;
    try {
      const response = await postJson<{ ok: true; data: ResearchModelStatus }>("/api/research-model", {
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        providerLabel: providerLabel.trim(),
        // 密钥留空且已有密钥时显式声明沿用，避免把已存密钥覆盖成空。
        apiKey: keepApiKey ? undefined : apiKey.trim(),
        keepApiKey,
      });
      applyView(response.data);
      setNotice("模型配置已保存，新的研究任务立即使用该模型。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型配置保存失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CapabilitySettingsSection
      icon={<CloudCog size={16} />}
      title="模型服务"
      busy={saving}
      actions={
        <button
          type="button"
          className="model-info-save-button"
          onClick={() => void save()}
          disabled={!canSave}
        >
          <Save size={14} />
          <span>{saving ? "保存中" : "保存"}</span>
        </button>
      }
    >
      <p className="research-model-note">
        深度研究使用你自备的模型 API；配置保存在本机，不随账号同步。
      </p>
      {load.status.model.configured && (
        <p className="research-model-configured">
          <Check size={14} aria-hidden />
          已配置{load.status.model.updatedAt === undefined ? "" : ` · 更新于 ${formatTime(load.status.model.updatedAt)}`}
        </p>
      )}
      <div className="research-model-presets" role="group" aria-label="常用模型服务">
        {listBuiltinModelProviderPresets().map((preset) => (
          <button
            key={preset.presetId}
            type="button"
            className="research-model-preset"
            onClick={() => fillPreset(preset.presetId)}
            disabled={saving}
          >
            <span>{preset.label}</span>
            <small>{preset.regionLabel ?? ""}</small>
          </button>
        ))}
      </div>
      <div className="research-model-grid">
        <label className="model-info-field model-info-field-wide">
          接口地址
          <input
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={saving}
          />
        </label>
        <label className="model-info-field">
          模型 ID
          <input
            type="text"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            placeholder="模型名称"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={saving}
          />
        </label>
        <label className="model-info-field">
          供应方名称
          <input
            type="text"
            value={providerLabel}
            onChange={(event) => setProviderLabel(event.target.value)}
            placeholder="用于在任务里标注模型来源"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={saving}
          />
        </label>
        <label className="model-info-field model-info-field-wide">
          API 密钥
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={load.status.model.apiKeyConfigured ? "已保存，留空表示不修改" : "粘贴你的 API 密钥"}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            disabled={saving}
          />
        </label>
      </div>
      {notice !== null && <p className="research-model-notice" role="status">{notice}</p>}
      {error !== null && <p className="research-model-error" role="alert">{error}</p>}
    </CapabilitySettingsSection>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
