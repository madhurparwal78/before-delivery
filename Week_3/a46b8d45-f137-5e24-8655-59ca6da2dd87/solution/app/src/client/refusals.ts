import { FIELD_ERRORS, OWNER_REFUSALS, fill, pick, type OwnerRefusalCode } from "../shared/copy";
import type { Lang } from "../shared/types";
import type { ApiResult } from "./api";

export const ownerCopy = (code: OwnerRefusalCode, lang: Lang, number = 0): string => fill(pick(OWNER_REFUSALS[code], lang), { number });

/** The owner's copy for a refused request, in the owner's language. A request that never arrived reads as records unreachable. */
export function ownerRefusal(result: ApiResult<unknown>, lang: Lang, partNumber = 0): string {
  const code = result.error?.code;
  if (code && code in OWNER_REFUSALS) return ownerCopy(code as OwnerRefusalCode, lang, partNumber);
  if (code === "validation_failed" || code === "unsupported_media_type") return result.error?.message ?? "";
  return ownerCopy("database_unavailable", lang);
}

export const fieldError = (field: keyof typeof FIELD_ERRORS, lang: Lang): string => pick(FIELD_ERRORS[field], lang);

export function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
