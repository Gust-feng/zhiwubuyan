/** Neutral confirmation facts shared by tools and agent features. */
export type ConfirmationRiskLevel = "low" | "medium" | "high";

export type ConfirmationRequest = {
  readonly confirmationId: string;
  /** 用户确认的那次调用对应的稳定调用标识。 */
  readonly invocationId: string;
  readonly conversationId?: string;
  readonly title: string;
  readonly actionSummary: string;
  readonly consequence?: string;
  readonly affectedResources: readonly string[];
  readonly riskLevel: ConfirmationRiskLevel;
  readonly resumeAvailability?: "live" | "lost_after_restart";
  readonly requestedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
};

export type ConfirmationDecision = {
  readonly confirmationId: string;
  readonly decision: "approve_once" | "deny" | "guidance";
  readonly decidedAt: string;
  readonly guidance?: string;
};