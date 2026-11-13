import type { ErrorBody, Rule } from "../shared/api.ts";

// The one error shape of the API (brief: API / Error shape). Every refusal is built here.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Omit<ErrorBody, "error" | "message">;

  constructor(status: number, code: string, message: string, extra: Omit<ErrorBody, "error" | "message"> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): ErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function notFound(message = "Nothing is here.", code = "not_found"): ApiError {
  return new ApiError(404, code, message);
}

export function invalid(fields: Record<string, string>): ApiError {
  const first = Object.values(fields)[0] ?? "The request is not valid.";
  return new ApiError(422, "validation", first, { fields });
}

export function rulesBroken(rules: Rule[], prefix: string): ApiError {
  return new ApiError(422, "rules_broken", `${prefix}: ${rules.map((rule) => rule.message).join("; ")}.`, { rules });
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}
