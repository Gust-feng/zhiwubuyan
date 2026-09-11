export type ProductErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "UPSTREAM_ERROR"
  | "PROTOCOL_ERROR"
  | "INVALID_INPUT"
  | "ABORTED";

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
