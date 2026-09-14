export type ProductErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "UPSTREAM_ERROR"
  | "PROTOCOL_ERROR"
  | "INVALID_INPUT"
  | "ABORTED"
  /** 该研究档位在当前运行面未接通：请求本身合法，只是本侧不承接它。 */
  | "RESEARCH_TIER_UNAVAILABLE";

export class ProductError extends Error {
  readonly code: ProductErrorCode;
  readonly detail?: string;

  constructor(code: ProductErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ProductError";
    this.code = code;
    this.detail = detail;
  }
}

export function isProductError(error: unknown): error is ProductError {
  return error instanceof ProductError;
}
