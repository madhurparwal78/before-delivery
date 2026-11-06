// The return-address rule (brief: Business rules › Return address), adapted from
// kit/modules/safe_redirect. The server decides `redirect` with it; the browser uses it to build
// `/sign-in?next=`.

import type { Role } from "./domain.js";

/** Each role's home: where sign-in lands when no return address is honoured. */
export const ROLE_HOME: Record<Role, string> = {
  concierge: "/bays",
  care_technician: "/round",
  workshop_lead: "/jobs",
  house_manager: "/board",
  owner: "/portal",
};

const CONTROL = /[\u0000-\u001f\u007f]/;

/** The decoded `next` when the brief honours it, otherwise null. */
export function honouredReturnAddress(next: unknown): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return null;
  }
  for (const candidate of [next, decoded]) {
    if (!candidate.startsWith("/")) return null;
    const second = candidate.charAt(1);
    if (second === "" || second === "/" || second === "\\") return null;
    if (candidate.includes("\\") || CONTROL.test(candidate)) return null;
  }
  const path = decoded.split(/[?#]/, 1)[0] ?? "";
  if (path === "/api" || path.startsWith("/api/") || path === "/sign-in" || path.startsWith("/sign-in/")) return null;
  return next;
}

/** The sign-in address that brings the user back to `pathAndQuery`. */
export function signInAddress(pathAndQuery: string): string {
  return `/sign-in?next=${encodeURIComponent(pathAndQuery)}`;
}
