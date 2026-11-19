/** Rule sets and cutting authorities. */
import { nextCode, one, opaqueId, run, transaction, type Queryable, type Row } from "./db.js";
import { audit } from "./audit.js";
import { currentRuleSet, ruleSetView } from "./rules.js";
import { liveAccountOfRole, personOf, type AccountRow } from "./accounts.js";
import { FieldErrors, refuse } from "./errors.js";
import { instant, maybeInstant, now } from "./time.js";
import { keysetPage, type PageRequest } from "./paging.js";
import { FIELD } from "../shared/copy.js";
import * as check from "./validate.js";
import type { Authority, Page, RuleSet } from "../shared/types.js";

export async function listRuleSets(db: Queryable, request: PageRequest): Promise<Page<RuleSet>> {
  const at = now();
  const current = (await currentRuleSet(db, at)).version;
  return keysetPage(db, {
    base: "SELECT *, version AS k1 FROM ruleset",
    params: [],
    types: ["int"],
    direction: "desc",
    filter: "rulesets",
    request,
    map: (row) => ruleSetView(row, current),
  });
}

interface RuleFigures {
  seam: number;
  roach: number;
  tolerance: number;
  minWidth: number;
  minLength: number;
  effectiveAt: Date;
}

function readRuleFigures(errors: FieldErrors, body: check.Body, at: Date): Partial<RuleFigures> {
  return {
    seam: check.wholeNumber(errors, body, "seam_overlap_mm", 0, 100),
    roach: check.wholeNumber(errors, body, "roach_permille", 1000, 1300),
    tolerance: check.wholeNumber(errors, body, "tolerance_mm", 1, 100),
    minWidth: check.wholeNumber(errors, body, "min_offcut_width_mm", 1, 2000),
    minLength: check.wholeNumber(errors, body, "min_offcut_length_mm", 1, 60000),
    effectiveAt: check.futureInstant(errors, body, "effective_at", at) ?? undefined,
  };
}

export async function createRuleSet(actor: AccountRow, body: check.Body): Promise<RuleSet> {
  return transaction(async (db) => {
    const at = now();
    const errors = new FieldErrors();
    const figures = readRuleFigures(errors, body, at);
    errors.throwIfAny();
    const version = await nextCode(db, "ruleset");
    await run(
      db,
      `INSERT INTO ruleset (version, effective_at, seam_overlap_mm, roach_permille, tolerance_mm, min_offcut_width_mm, min_offcut_length_mm)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [version, figures.effectiveAt, figures.seam, figures.roach, figures.tolerance, figures.minWidth, figures.minLength],
    );
    await audit(db, { actor: actor.email, action: "ruleset.create", target: `v${version}`, after: instant(figures.effectiveAt!) });
    const current = (await currentRuleSet(db, at)).version;
    return ruleSetView((await one(db, "SELECT * FROM ruleset WHERE version = $1", [version]))!, current);
  });
}

export async function updateRuleSet(actor: AccountRow, version: number, revision: number, body: check.Body): Promise<RuleSet> {
  return transaction(async (db) => {
    const at = now();
    const locked = (await one<Row>(db, "SELECT * FROM ruleset WHERE version = $1 FOR UPDATE", [version]))!;
    if (locked.revision !== revision) throw refuse("stale_revision");
    if (locked.effective_at.getTime() <= at.getTime()) throw refuse("sealed");
    const errors = new FieldErrors();
    const figures = readRuleFigures(errors, body, at);
    errors.throwIfAny();
    await run(
      db,
      `UPDATE ruleset SET effective_at = $2, seam_overlap_mm = $3, roach_permille = $4, tolerance_mm = $5, min_offcut_width_mm = $6,
         min_offcut_length_mm = $7, revision = revision + 1 WHERE version = $1`,
      [version, figures.effectiveAt, figures.seam, figures.roach, figures.tolerance, figures.minWidth, figures.minLength],
    );
    await audit(db, { actor: actor.email, action: "ruleset.update", target: `v${version}`, before: instant(locked.effective_at), after: instant(figures.effectiveAt!) });
    const current = (await currentRuleSet(db, at)).version;
    return ruleSetView((await one(db, "SELECT * FROM ruleset WHERE version = $1", [version]))!, current);
  });
}

function authorityView(row: Row, at: Date): Authority {
  const ended = (row.valid_until && row.valid_until.getTime() <= at.getTime()) || (row.withdrawn_at && row.withdrawn_at.getTime() <= at.getTime());
  return {
    id: row.id,
    loft_hand: personOf({ email: row.lh_email, display_name: row.lh_name, deleted: row.lh_deleted }),
    valid_from: instant(row.valid_from),
    valid_until: maybeInstant(row.withdrawn_at && (!row.valid_until || row.withdrawn_at < row.valid_until) ? row.withdrawn_at : row.valid_until),
    status: ended ? "ended" : row.valid_from.getTime() > at.getTime() ? "not_yet" : "in_force",
  };
}

const AUTHORITY_SELECT = `SELECT u.*, a.email AS lh_email, a.display_name AS lh_name, a.deleted AS lh_deleted
  FROM authority u JOIN account a ON a.id = u.loft_hand_id`;

export async function authorityRow(db: Queryable, id: string, lock = false): Promise<Row | null> {
  return one(db, `${AUTHORITY_SELECT} WHERE u.id = $1 ${lock ? "FOR UPDATE OF u" : ""}`, [id]);
}

export async function listAuthorities(db: Queryable, request: PageRequest): Promise<Page<Authority>> {
  const at = now();
  return keysetPage(db, {
    base: `SELECT u.*, a.email AS lh_email, a.display_name AS lh_name, a.deleted AS lh_deleted, u.valid_from AS k1, u.id AS k2
             FROM authority u JOIN account a ON a.id = u.loft_hand_id`,
    params: [],
    types: ["timestamptz", "text"],
    direction: "desc",
    filter: "authorities",
    request,
    map: (row) => authorityView(row, at),
  });
}

export async function createAuthority(actor: AccountRow, body: check.Body): Promise<Authority> {
  return transaction(async (db) => {
    const at = now();
    const errors = new FieldErrors();
    const loftHand = await liveAccountOfRole(db, body.loft_hand_email, "loft-hand");
    if (!loftHand) errors.add("loft_hand_email", FIELD.loftHandAccount);
    const from = check.futureInstant(errors, body, "valid_from", new Date(at.getTime() - 1000));
    const until = check.futureInstant(errors, body, "valid_until", at, true);
    if (from && until && until.getTime() <= from.getTime()) errors.add("valid_until", FIELD.instant);
    errors.throwIfAny();
    const id = await opaqueId(db, "AU-");
    await run(db, "INSERT INTO authority (id, loft_hand_id, valid_from, valid_until) VALUES ($1, $2, $3, $4)", [id, loftHand!.id, from, until ?? null]);
    await audit(db, { actor: actor.email, action: "authority.create", target: id, after: loftHand!.email });
    return authorityView((await authorityRow(db, id))!, at);
  });
}

export async function withdrawAuthority(actor: AccountRow, id: string): Promise<Authority> {
  return transaction(async (db) => {
    const at = now();
    const row = (await authorityRow(db, id, true))!;
    if (authorityView(row, at).status === "ended") throw refuse("wrong_state");
    await run(db, "UPDATE authority SET withdrawn_at = $2 WHERE id = $1", [id, at]);
    await audit(db, { actor: actor.email, action: "authority.withdraw", target: id, before: "in_force", after: "ended" });
    return authorityView((await authorityRow(db, id))!, at);
  });
}
