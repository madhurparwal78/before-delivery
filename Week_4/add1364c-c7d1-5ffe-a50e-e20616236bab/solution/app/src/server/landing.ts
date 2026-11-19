import type { Db } from "./db.js";
import type { PersonRow, Role } from "./model.js";
import { visibleVaultIds } from "./visibility.js";
import { now } from "./clock.js";

const DESK: Role[] = ["office_manager", "managing_partner"];

/** Who may open each desk route. The routes outside this table are `/`, `/sign-in` and `/desk/vaults/<id>`. */
const DESK_ROUTES: Record<string, readonly Role[]> = {
  "/desk": ["office_manager", "managing_partner", "staff_accountant", "outside_bookkeeper"],
  "/rotations": DESK,
  "/reviews": DESK,
  "/people": DESK,
  "/travel": ["staff_accountant", "outside_bookkeeper"],
  "/billing": DESK,
  "/health": DESK,
  "/import": ["office_manager"],
  "/audit": DESK,
};

const PUBLIC_ROUTES = ["/", "/sign-in"];

export function isKnownPath(path: string): boolean {
  return PUBLIC_ROUTES.includes(path) || path in DESK_ROUTES || /^\/desk\/vaults\/[^/]+$/.test(path);
}

function safeNext(next: unknown, role: Role, visible: string[]): string | null {
  if (typeof next !== "string" || next.length > 300) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000- \u007f]/.test(next)) return null;
  const path = next.split(/[?#]/, 1)[0] ?? "";
  const allowed = DESK_ROUTES[path];
  if (allowed) return allowed.includes(role) ? next : null;
  const vault = /^\/desk\/vaults\/([^/]+)$/.exec(path);
  return vault && visible.includes(decodeURIComponent(vault[1] ?? "")) ? next : null;
}

/** Where a person lands after signing in: a safe `next`, else the first visible vault, else the drawer. */
export async function landingFor(db: Db, person: PersonRow, next: unknown): Promise<string> {
  const visible = await visibleVaultIds(db, person, now());
  const chosen = safeNext(next, person.role, visible);
  if (chosen) return chosen;
  const first = visible[0];
  return first ? `/desk/vaults/${first}` : "/desk";
}
