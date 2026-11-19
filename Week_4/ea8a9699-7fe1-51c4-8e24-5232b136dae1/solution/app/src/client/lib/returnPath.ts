// The return-path check (brief: Business rules > Return after sign-in), adapted from kit/modules/safe_redirect
// and narrowed to Rushes' own screens. The one place it is decided.
import type { Account } from "../../shared/api.js";

const SCREENS = [/^\/explore$/, /^\/@[a-z0-9-]{3,24}$/, /^\/c\/[0-9a-f-]{36}$/, /^\/w\/[a-z0-9-]+(\/.*)?$/];

/** `next` as read from the address (already decoded once by URLSearchParams). */
function safeReturn(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next[1] === "/" || next[1] === "\\") return null;
  if (next.includes("\\") || /%5c/i.test(next) || /%2f%2f/i.test(next) || /[\u0000-\u001f\u007f]/.test(next)) return null;
  const path = next.split(/[?#]/)[0] ?? "";
  return SCREENS.some((screen) => screen.test(path)) ? next : null;
}

/** Where an account lands when there is no honoured return page. */
export function landing(account: Account): string {
  const first = account.workspaces[0];
  return account.role === "follower" || !first ? "/explore" : `/w/${first.slug}`;
}

export const afterSignIn = (account: Account, next: string | null): string => safeReturn(next) ?? landing(account);
