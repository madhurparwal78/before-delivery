/** Sight grants: one owner's sight of one Issued drawing, withdrawn for good or ended at an instant. */
import { nextCode, one, rows, run, transaction, type Queryable, type Row } from "./db.js";
import { audit } from "./audit.js";
import { loadFact } from "./drawings.js";
import { liveAccountOfRole, personOf, type AccountRow } from "./accounts.js";
import { FieldErrors, refuse } from "./errors.js";
import { instant, maybeInstant, now, wholeSecond } from "./time.js";
import { keysetPage, type PageRequest } from "./paging.js";
import { FIELD } from "../shared/copy.js";
import * as check from "./validate.js";
import type { Grant, Page } from "../shared/types.js";

const SELECT = `SELECT g.*, o.email AS owner_email, o.display_name AS owner_name, o.deleted AS owner_deleted
  FROM sight_grant g JOIN account o ON o.id = g.owner_id`;

/** A grant is withdrawn once withdrawn, or from its end instant on. */
function withdrawnAt(row: Row, at: Date): Date | null {
  const ended = row.ends_at && row.ends_at.getTime() <= at.getTime() ? (row.ends_at as Date) : null;
  if (row.withdrawn_at && ended) return row.withdrawn_at.getTime() <= ended.getTime() ? row.withdrawn_at : ended;
  return row.withdrawn_at ?? ended;
}

export function grantView(row: Row, at: Date): Grant {
  const gone = withdrawnAt(row, at);
  return {
    id: row.id,
    drawing_code: row.drawing_code,
    owner: personOf({ email: row.owner_email, display_name: row.owner_name, deleted: row.owner_deleted }),
    status: gone ? "withdrawn" : "granted",
    granted_at: instant(row.granted_at),
    ends_at: maybeInstant(row.ends_at),
    withdrawn_at: maybeInstant(gone),
  };
}

export async function grantRow(db: Queryable, id: string, lock = false): Promise<Row | null> {
  return one(db, `${SELECT} WHERE g.id = $1 ${lock ? "FOR UPDATE OF g" : ""}`, [id]);
}

/** The owner's grant while it is still active; a withdrawn, ended or someone else's grant is not found. */
export async function activeGrantOf(db: Queryable, owner: AccountRow, id: string, at: Date): Promise<Row | null> {
  const row = await grantRow(db, id);
  return row && row.owner_id === owner.id && !withdrawnAt(row, at) ? row : null;
}

export async function ownerDrawingCodes(db: Queryable, owner: AccountRow, at: Date): Promise<string[]> {
  const found = await rows<{ drawing_code: string }>(
    db,
    "SELECT DISTINCT drawing_code FROM sight_grant WHERE owner_id = $1 AND withdrawn_at IS NULL AND (ends_at IS NULL OR ends_at > $2)",
    [owner.id, at],
  );
  return found.map((row) => row.drawing_code);
}

export async function listGrants(db: Queryable, clause: string, params: unknown[], request: PageRequest, filter: string, at: Date, activeOnly = false): Promise<Page<Grant>> {
  const active = activeOnly ? "AND g.withdrawn_at IS NULL AND (g.ends_at IS NULL OR g.ends_at > $" + (params.length + 1) + ")" : "";
  return keysetPage(db, {
    base: `SELECT g.*, o.email AS owner_email, o.display_name AS owner_name, o.deleted AS owner_deleted, g.granted_at AS k1, g.num AS k2
             FROM sight_grant g JOIN account o ON o.id = g.owner_id WHERE ${clause} ${active}`,
    params: activeOnly ? [...params, at] : params,
    types: ["timestamptz", "int"],
    direction: "desc",
    filter,
    request,
    map: (row) => grantView(row, at),
  });
}

export async function createGrant(actor: AccountRow, drawingCode: string, body: check.Body): Promise<Grant> {
  return transaction(async (db) => {
    const at = now();
    const facts = (await loadFact(db, drawingCode, at))!;
    if (facts.derived.status !== "issued") throw refuse("wrong_state");
    const errors = new FieldErrors();
    const owner = await liveAccountOfRole(db, body.owner_email, "yacht-owner");
    if (!owner) errors.add("owner_email", FIELD.ownerAccount);
    const ends = check.futureInstant(errors, body, "ends_at", at, true);
    errors.throwIfAny();
    const num = await nextCode(db, "grant");
    const id = `G-${String(num).padStart(4, "0")}`;
    await run(db, "INSERT INTO sight_grant (id, num, drawing_code, owner_id, granted_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      num,
      drawingCode,
      owner!.id,
      wholeSecond(at),
      ends ?? null,
    ]);
    await audit(db, { actor: actor.email, action: "grant.create", target: id, after: "granted" });
    return grantView((await grantRow(db, id))!, at);
  });
}

export async function withdrawGrant(actor: AccountRow, id: string): Promise<Grant> {
  return transaction(async (db) => {
    const at = now();
    const row = (await grantRow(db, id, true))!;
    if (withdrawnAt(row, at)) throw refuse("wrong_state");
    await run(db, "UPDATE sight_grant SET withdrawn_at = $2 WHERE id = $1", [id, wholeSecond(at)]);
    await audit(db, { actor: actor.email, action: "grant.withdraw", target: id, before: "granted", after: "withdrawn" });
    return grantView((await grantRow(db, id))!, at);
  });
}
