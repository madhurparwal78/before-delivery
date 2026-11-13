export type Role = "quizmaster" | "marker" | "captain";

const DESK: Record<Role, string> = {
  quizmaster: "/quizmaster",
  marker: "/marker",
  captain: "/captain",
};

/** The one place that says which desk a role lands on. */
export function deskPath(role: Role): string {
  return DESK[role];
}

const ARCHIVE_PATH = "/archive";
export const SIGN_IN_PATH = "/sign-in";
export const PAGE_PATHS: readonly string[] = ["/", SIGN_IN_PATH, ...Object.values(DESK), ARCHIVE_PATH];

/** Which desk paths a role may open. The archive is open to the marker and the quizmaster. */
export function mayOpen(role: Role, path: string): boolean {
  if (path === ARCHIVE_PATH) return role !== "captain";
  return path === DESK[role];
}
