/** 研究界面视图：由真实任务、来源与报告投影填充。 */
export type ResearchScene = 'idle' | 'researching' | 'writing' | 'completed' | 'cancelled' | 'failed';

export type ResearchSourceView = {
  id: string;
  title: string;
  author: string;
  kind: 'answer' | 'article' | 'web';
  excerpt: string;
  context: string;
  dateLabel: string;
  url: string | null;
};

export type ResearchQueryView = {
  id: string;
  text: string;
  channel: 'zhihu' | 'web';
  status: 'pending' | 'succeeded' | 'failed';
  resultCount: number | null;
};

export type ResearchActivityView = {
  id: string;
  kind: 'planning' | 'searching' | 'reading' | 'analyzing' | 'writing';
  time: string;
  title: string;
  summary?: string;
  queries?: readonly ResearchQueryView[];
  sourceIds: readonly string[];
};

export type ResearchPlanItemView = {
  id: string;
  title: string;
  state: 'pending' | 'active' | 'complete';
  tag?: string;
  priority: 'high' | 'normal';
  closed: boolean;
};

export type ResearchUsagePairView = { used: number; max: number };

export type ResearchUsageView = {
  search: ResearchUsagePairView;
  model: ResearchUsagePairView;
  sources: ResearchUsagePairView;
};

export type ResearchAnswerView = { content: string; model: string };

export type ResearchReportMetaView = {
  completeness: 'sufficient' | 'partial';
  stopReason: string;
};

export type ResearchReportSectionView = {
  id: string;
  title: string;
  text: string;
  sourceIds: readonly string[];
};

export type ResearchViewModel = {
  scene: ResearchScene;
  question: string;
  title: string;
  activityLabel: string;
  searchCount: number;
  elapsedLabel: string;
  plan: readonly ResearchPlanItemView[];
  activities: readonly ResearchActivityView[];
  sources: readonly ResearchSourceView[];
  report: readonly ResearchReportSectionView[];
  outcomeNote?: string;
  stopping?: boolean;
  tier: 'pro' | 'ultra' | null;
  planVersion: number | null;
  usage: ResearchUsageView | null;
  /** Pro 档的直答快答；Ultra 为 null。 */
  answer: ResearchAnswerView | null;
  reportMeta: ResearchReportMetaView | null;
  limitations: readonly string[];
};
