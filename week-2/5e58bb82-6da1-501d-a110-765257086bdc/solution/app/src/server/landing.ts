// The safe-return and landing rule, decided once for sign-in, last-screen records and the browser's next.
import type { Db } from "./db.js";
import { one } from "./db.js";
import type { MissionRecord, UserRecord } from "./records.js";

export type Role = "principal_surveyor" | "launch_technician" | "client_reviewer";

const HOMES: Record<Role, string> = {
  principal_surveyor: "/fleet",
  launch_technician: "/launch",
  client_reviewer: "/surveys",
};

const STAFF = new Set<Role>(["principal_surveyor", "launch_technician"]);
const ID = "[A-Za-z0-9_-]+";

type Screen = { pattern: RegExp; roles: (role: Role) => boolean; record?: "mission" | "vessel" | "survey" };

const SCREENS: Screen[] = [
  { pattern: /^\/fleet$/, roles: (r) => STAFF.has(r) },
  { pattern: new RegExp(`^/fleet/(${ID})$`), roles: (r) => STAFF.has(r), record: "vessel" },
  { pattern: /^\/missions$/, roles: (r) => STAFF.has(r) },
  { pattern: /^\/missions\/new$/, roles: (r) => r === "principal_surveyor" },
  { pattern: new RegExp(`^/missions/(?!new$)(${ID})$`), roles: (r) => STAFF.has(r), record: "mission" },
  { pattern: new RegExp(`^/missions/(${ID})/plan$`), roles: (r) => STAFF.has(r), record: "mission" },
  { pattern: new RegExp(`^/missions/(${ID})/history$`), roles: (r) => STAFF.has(r), record: "mission" },
  { pattern: /^\/launch$/, roles: (r) => STAFF.has(r) },
  { pattern: /^\/flags$/, roles: (r) => STAFF.has(r) },
  { pattern: /^\/surveys$/, roles: (r) => r === "client_reviewer" },
  { pattern: new RegExp(`^/surveys/(${ID})$`), roles: (r) => r === "client_reviewer", record: "survey" },
];

const CONTROL = /[\u0000-\u001f\u007f]/;

const leadsSafely = (p: string) => p.startsWith("/") && p[1] !== "/" && p[1] !== "\\";

/**
 * A path is safe for a user when it starts with exactly one `/`, still does after one percent-decoding,
 * carries no control character, and names a screen the role may open (a survey of their own organisation).
 * `qualify` adds the last-screen condition: a mission address only while the mission is open.
 */
export async function safeFor(db: Db, user: UserRecord, path: unknown, qualify = false): Promise<boolean> {
  if (typeof path !== "string" || !leadsSafely(path) || CONTROL.test(path)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (!leadsSafely(decoded) || CONTROL.test(decoded)) return false;
  const screenPath = path.split("?")[0];
  for (const screen of SCREENS) {
    const match = screen.pattern.exec(screenPath);
    if (!match) continue;
    if (!screen.roles(user.role)) return false;
    const id = match[1];
    if (screen.record === "vessel") return !!(await one(db, "SELECT 1 FROM vessels WHERE id = $1", [id]));
    if (screen.record === "mission") {
      const m = await one<Pick<MissionRecord, "status">>(db, "SELECT status FROM missions WHERE id = $1", [id]);
      return !!m && (!qualify || ["Planned", "Launched", "Surveying", "Recovering"].includes(m.status));
    }
    if (screen.record === "survey") {
      return !!(await one(db, "SELECT 1 FROM missions WHERE id = $1 AND client_org_id = $2", [id, user.client_org_id]));
    }
    return true;
  }
  return false;
}

/** Landing: a safe `next` as given; an unsafe one the home; without one the qualifying last screen or the home. */
export async function landing(db: Db, user: UserRecord, next: unknown): Promise<string> {
  const home = HOMES[user.role];
  if (next !== undefined && next !== null) return (await safeFor(db, user, next)) ? (next as string) : home;
  if (user.last_screen && (await safeFor(db, user, user.last_screen, true))) return user.last_screen;
  return home;
}
