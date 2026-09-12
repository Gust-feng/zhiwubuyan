/**
 * 深度研究模型服务契约（桌面端专属配置）。
 * 深度研究只需要一个模型：一个 baseUrl + 模型 ID + 密钥，不做多厂商档案。
 * 密钥只在写入时上行一次，读取只回是否已配置。
 */

export type ResearchModelView = {
  readonly configured: boolean;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly providerLabel: string;
  /** 只表示是否已保存密钥，绝不回传密钥本身。 */
  readonly apiKeyConfigured: boolean;
  readonly updatedAt?: string;
};

export type ResearchModelStatus = {
  /** 当前运行面是否允许写入模型配置（仅桌面端为 true）。 */
  readonly configurable: boolean;
  readonly model: ResearchModelView;
};

export type SaveResearchModelInput = {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly providerLabel: string;
};
