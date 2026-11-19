// Where the browser goes after sign-in, and the sign-in draft a screen keeps when its session ends.
import type { Role } from "./api";

export const LANDING: Record<Role, string> = { coordinator: "/office", volunteer: "/desk", member: "/account" };

const SCREENS: Array<{ path: RegExp; roles: readonly Role[] }> = [
  { path: /^\/$/, roles: ["coordinator", "volunteer", "member"] },
  { path: /^\/loans\/\d+$/, roles: ["coordinator", "volunteer", "member"] },
  { path: /^\/fees\/\d+$/, roles: ["coordinator", "volunteer", "member"] },
  { path: /^\/account$/, roles: ["member"] },
  { path: /^\/desk$/, roles: ["coordinator", "volunteer"] },
  { path: /^\/office$/, roles: ["coordinator"] },
];

/** The sign-in `next` is followed only for the Pegboard or a published screen the role may use. */
export function afterSignIn(next: string | null, role: Role): string {
  if (next === null) return LANDING[role];
  let path: string;
  try {
    path = decodeURIComponent(next);
  } catch {
    return LANDING[role];
  }
  if (!path.startsWith("/") || path[1] === "/" || path[1] === "\\" || /[?#]|^\/\w+:/.test(path)) return LANDING[role];
  const screen = SCREENS.find((s) => s.path.test(path));
  return screen && screen.roles.includes(role) ? path : LANDING[role];
}

export const signInAgainHref = (path: string) => `/signin?next=${encodeURIComponent(path)}`;

export interface Draft {
  path: string;
  userId: number;
  fields: Record<string, string>;
  hours?: Record<string, { open: boolean; opens: string; closes: string }>;
  reason?: string;
  loanId?: number;
  toolId?: number;
}

const KEY = "pegworth-draft";

export function keepDraft(draft: Draft): void {
  sessionStorage.setItem(KEY, JSON.stringify(draft));
}

/** Reads and deletes the draft when it belongs to this path and user. */
export function takeDraft(path: string, userId: number): Draft | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  const draft = JSON.parse(raw) as Draft;
  if (draft.path !== path || draft.userId !== userId) return null;
  sessionStorage.removeItem(KEY);
  return draft;
}

/** After a sign-in, a draft for a different user or another landing path is deleted unused. */
export function settleDraft(destination: string, userId: number): void {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return;
  const draft = JSON.parse(raw) as Draft;
  if (draft.path !== destination || draft.userId !== userId) sessionStorage.removeItem(KEY);
}
