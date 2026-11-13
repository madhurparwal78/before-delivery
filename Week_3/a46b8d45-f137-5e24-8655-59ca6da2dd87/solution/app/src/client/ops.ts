import { OPS_REFUSALS } from "../shared/copy";
import { navigate } from "./router";
import { showAlert } from "./messages";
import type { ApiResult } from "./api";

/** The operator's refusal copy comes from the server's own message; an unreachable server reads as records unreachable. */
export function opsRefusal(result: ApiResult<unknown>): string {
  return result.error?.message ?? OPS_REFUSALS.database_unavailable;
}

/** Opening any operator page without a live session goes to sign-in. Returns true when it did. */
export function leaveIfSignedOut(result: ApiResult<unknown>): boolean {
  if (result.status !== 401) return false;
  navigate("/ops/sign-in", true);
  return true;
}

export function refuse(result: ApiResult<unknown>): void {
  if (!leaveIfSignedOut(result)) showAlert(opsRefusal(result));
}
