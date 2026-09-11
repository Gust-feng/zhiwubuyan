import { ProductError } from "./errors.ts";

export type CallerIdentity = {
  accessSecret: string;
};

export type UserScope =
  | { kind: "caller_account" }
  | { kind: "authorized_user"; accessToken: string };

export type RequestIdentity = {
  caller: CallerIdentity;
  user?: UserScope;
};

export function callerFromSecret(accessSecret: string | undefined): CallerIdentity {
  const value = accessSecret?.trim();
  if (!value) {
    throw new ProductError("AUTH_REQUIRED", "缺少开放平台调用凭证。");
  }
  return { accessSecret: value };
}

export function identityHeaders(identity: RequestIdentity): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${identity.caller.accessSecret}`,
  };
  if (identity.user?.kind === "authorized_user") {
    const token = identity.user.accessToken.trim();
    if (!token) {
      throw new ProductError("AUTH_REQUIRED", "缺少已授权用户令牌。");
    }
    headers["X-OAuth-Token"] = token;
  }
  return headers;
}
