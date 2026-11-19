import type { Db } from "./db.js";
import { isDesk, type PersonRow } from "./model.js";
import { localMinute, utcIso } from "./office-time.js";
import { termRunning } from "./visibility.js";

interface TravelRow {
  id: string;
  person_id: string;
  starts_at: Date;
  ends_at: Date;
}

type PersonStatus = "invited" | "active" | "travelling" | "on_term" | "left";

/** When several states apply the first wins: left, travelling, on_term, invited, active. */
function statusOf(person: PersonRow, windows: TravelRow[], at: Date): PersonStatus {
  if (person.left_at) return "left";
  if (windows.some((window) => window.starts_at.getTime() <= at.getTime() && at.getTime() < window.ends_at.getTime())) return "travelling";
  if (termRunning(person, at)) return "on_term";
  if (!person.first_sign_in_at) return "invited";
  return "active";
}

function viewOf(
  person: PersonRow,
  windows: TravelRow[],
  scopes: string[],
  allVaults: string[],
  at: Date,
): Record<string, unknown> {
  return {
    id: person.id,
    full_name: person.full_name,
    email: person.email,
    handle: person.handle,
    role: person.role,
    aliases: person.aliases,
    status: statusOf(person, windows, at),
    vault_ids: person.left_at ? [] : isDesk(person.role) ? allVaults : scopes,
    term: person.term_starts_on && person.term_ends_on ? { starts_on: person.term_starts_on, ends_on: person.term_ends_on } : null,
    travel: windows.map((window) => ({ id: window.id, starts_at: localMinute(window.starts_at), ends_at: localMinute(window.ends_at) })),
    seat: person.seat,
    left_at: person.left_at ? utcIso(person.left_at) : null,
  };
}

export async function peopleJson(db: Db, rows: PersonRow[], at: Date): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [travel, scopes, vaults] = await Promise.all([
    db.query<TravelRow>("SELECT id, person_id, starts_at, ends_at FROM travel WHERE person_id = ANY($1) ORDER BY starts_at", [ids]),
    db.query<{ person_id: string; vault_id: string }>(
      `SELECT pv.person_id, pv.vault_id FROM person_vaults pv JOIN vaults v ON v.id = pv.vault_id
       WHERE pv.person_id = ANY($1) ORDER BY v.ord`,
      [ids],
    ),
    db.query<{ id: string }>("SELECT id FROM vaults ORDER BY ord"),
  ]);
  const allVaults = vaults.map((vault) => vault.id);
  return rows.map((row) =>
    viewOf(
      row,
      travel.filter((window) => window.person_id === row.id),
      scopes.filter((scope) => scope.person_id === row.id).map((scope) => scope.vault_id),
      allVaults,
      at,
    ),
  );
}

export async function personJson(db: Db, row: PersonRow, at: Date): Promise<Record<string, unknown>> {
  const [view] = await peopleJson(db, [row], at);
  if (!view) throw new Error("person view failed");
  return view;
}
