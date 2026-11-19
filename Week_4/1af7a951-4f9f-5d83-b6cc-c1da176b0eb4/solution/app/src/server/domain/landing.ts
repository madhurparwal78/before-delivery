// Sign-in landing: where the browser goes after sign-in for a requested `next`.

const SCREEN = { dreamer: "/logbook", coach: "/coach" } as const;

/** `next` is honoured only when it is a single-slash path to the role's own screen; otherwise the role's screen. */
export function landing(role: "dreamer" | "coach", next: string | null): string {
  const screen = SCREEN[role];
  if (next === null || !next.startsWith("/") || next[1] === "/" || next[1] === "\\" || next.includes("\\")) return screen;
  const pathEnd = next.search(/[?#]/);
  const path = pathEnd === -1 ? next : next.slice(0, pathEnd);
  const beforeQuery = next.includes("?") ? next.slice(0, next.indexOf("?")) : next;
  if (beforeQuery.includes(":") || path !== screen) return screen;
  if (role === "dreamer" || pathEnd === -1 || next[pathEnd] !== "?") return screen;
  const query = next.slice(pathEnd);
  const fragment = query.indexOf("#");
  return screen + (fragment === -1 ? query : query.slice(0, fragment));
}
