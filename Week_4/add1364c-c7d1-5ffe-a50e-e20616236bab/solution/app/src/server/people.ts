import type { Db, Tx } from "./db.js";
import { db, write } from "./db.js";
import { record, type Actor } from "./audit.js";
import { now } from "./clock.js";
import { newId } from "./crypto.js";
import { syncAccess } from "./access-sync.js";
import { ApiError, Fields, checkBody, conflict, forbidden, invalid, notFound, type Spec } from "./http.js";
import { KeycloakUnavailable, createUser, setEnabled } from "./keycloak.js";
import { ROLES, isDesk, type PersonRow, type Role, type VaultRow } from "./model.js";
import { isLocalMinute, isRealDate, officeDate, officeInstant, officeMidnight } from "./office-time.js";
import { peopleJson, personJson } from "./people-view.js";
import { revokeSessions } from "./sessions.js";
import { dropScopes, gainScopes } from "./scopes.js";
import { closeLines } from "./review-lines.js";
import { driveSeat, markWaiting, WAIT_FOR_BILLING_MS } from "./seats.js";
import type { TurnDue } from "./turns.js";
import { scopeVaultIds } from "./visibility.js";

const HANDLE = /^[a-z][a-z0-9-]{1,19}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;

export const actorOf = (person: PersonRow): Actor => ({ personId: person.id, name: person.full_name });
const personSubject = (person: PersonRow): { kind: "person"; id: string; name: string } => ({
  kind: "person",
  id: person.id,
  name: person.full_name,
});

export async function loadPerson(db: Db, id: string): Promise<PersonRow | null> {
  return db.one<PersonRow>("SELECT * FROM people WHERE id = $1", [id]);
}

export async function listPeople(): Promise<Record<string, unknown>[]> {
  return peopleJson(db, await db.query<PersonRow>("SELECT * FROM people ORDER BY ord"), now());
}

function serviceDown(): ApiError {
  return new ApiError(503, "sign_in_unavailable", "Sign-in is unavailable right now. Try again in a minute.");
}

function checkAliases(value: unknown, fields: Fields): string[] {
  const aliases = Array.isArray(value) ? (value as string[]) : [];
  if (aliases.length > 5) fields.add("aliases", "Give at most 5 aliases.");
  else if (aliases.some((alias) => alias.trim().length < 1 || alias.trim().length > 30)) fields.add("aliases", "Each alias is 1 to 30 characters.");
  return aliases.map((alias) => alias.trim());
}

async function checkVaultIds(tx: Db, value: unknown, fields: Fields): Promise<string[]> {
  const ids = Array.isArray(value) ? [...new Set(value as string[])] : [];
  if (ids.length > 0) {
    const found = await tx.query<{ id: string }>("SELECT id FROM vaults WHERE id = ANY($1)", [ids]);
    if (found.length !== ids.length) fields.add("vault_ids", "Pick vaults that exist.");
  }
  return ids;
}

function checkTerm(value: unknown, role: Role | null, fields: Fields, today: string): { starts_on: string; ends_on: string } | null {
  if (role !== "outside_bookkeeper") {
    if (value !== null && value !== undefined) fields.add("term", "Only an outside bookkeeper has an engagement term.");
    return null;
  }
  const term = value as { starts_on?: unknown; ends_on?: unknown } | null | undefined;
  if (!term) {
    fields.add("term", "An outside bookkeeper needs an engagement term.");
    return null;
  }
  const { starts_on: starts, ends_on: ends } = term;
  if (typeof starts !== "string" || typeof ends !== "string" || !isRealDate(starts) || !isRealDate(ends)) {
    fields.add("term", "Give the term as two dates.");
    return null;
  }
  if (ends < starts || ends < today) {
    fields.add("term", "The term must end on or after its start and on or after today.");
    return null;
  }
  return { starts_on: starts, ends_on: ends };
}

const JOINER: Spec = {
  full_name: { kind: "string" },
  email: { kind: "string" },
  handle: { kind: "string" },
  role: { kind: "string" },
  aliases: { kind: "string_array" },
  vault_ids: { kind: "string_array" },
  initial_password: { kind: "string" },
  term: { kind: "object_or_null" },
};

export async function addJoiner(actor: PersonRow, body: unknown): Promise<Record<string, unknown>> {
  const created = await write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, JOINER, fields);
    const at = now();
    const today = officeDate(at);
    const fullName = typeof v.full_name === "string" ? v.full_name.trim() : "";
    if (v.full_name !== undefined && (fullName.length < 2 || fullName.length > 80)) fields.add("full_name", "Use 2 to 80 characters.");
    const email = typeof v.email === "string" ? v.email.trim() : "";
    if (v.email !== undefined) {
      if (!EMAIL.test(email)) fields.add("email", "Give a valid email address.");
      else if (await tx.one("SELECT 1 FROM people WHERE lower(email) = lower($1)", [email])) fields.add("email", "That email is already on record.");
    }
    const handle = typeof v.handle === "string" ? v.handle : "";
    if (v.handle !== undefined) {
      if (!HANDLE.test(handle)) fields.add("handle", "Use 2 to 20 characters: a lowercase letter, then letters, digits or hyphens.");
      else if (await tx.one("SELECT 1 FROM people WHERE handle = $1", [handle])) fields.add("handle", "That handle has been used in this office.");
    }
    const role = ROLES.find((candidate) => candidate === v.role) ?? null;
    if (v.role !== undefined && !role) fields.add("role", "Pick one of the four roles.");
    const aliases = checkAliases(v.aliases, fields);
    const vaultIds = await checkVaultIds(tx, v.vault_ids, fields);
    const password = typeof v.initial_password === "string" ? v.initial_password : "";
    if (v.initial_password !== undefined && (password.length < 12 || password.length > 64)) fields.add("initial_password", "Use 12 to 64 characters.");
    const term = v.term !== undefined ? checkTerm(v.term, role, fields, today) : null;
    if (v.term === undefined && role === "outside_bookkeeper") fields.add("term", "An outside bookkeeper needs an engagement term.");
    fields.throwIfAny();
    if (!role) throw new Error("role was validated");

    const startsNow = !term || term.starts_on <= today;
    try {
      const made = await createUser({ handle, fullName, password, enabled: startsNow });
      if (made === "exists") throw invalid({ handle: "That handle has been used in this office." });
    } catch (error) {
      if (error instanceof KeycloakUnavailable) throw serviceDown();
      throw error;
    }
    const id = newId();
    await tx.query(
      `INSERT INTO people (id, full_name, email, handle, role, aliases, term_starts_on, term_ends_on, term_started, seat, seat_since, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting_on_billing',$10,$10)`,
      [id, fullName, email, handle, role, aliases, term?.starts_on ?? null, term?.ends_on ?? null, term !== null && term.starts_on <= today, at],
    );
    const person = await tx.one<PersonRow>("SELECT * FROM people WHERE id = $1", [id]);
    if (!person) throw new Error("joiner was not stored");
    await record(tx, actorOf(actor), "person_join", personSubject(person), { role, vault_ids: isDesk(role) ? [] : vaultIds });
    if (term && term.starts_on <= today) await record(tx, actorOf(actor), "term_start", personSubject(person), term);
    if (!isDesk(role)) await gainScopes(tx, person, vaultIds, actorOf(actor), at);
    return person;
  });
  const confirmed = await driveSeat(created.id, Date.now() + WAIT_FOR_BILLING_MS, actorOf(actor));
  if (!confirmed) await markWaiting(created, actorOf(actor));
  const fresh = await loadPerson(db, created.id);
  return personJson(db, fresh ?? created, now());
}

// ---- movers ----

const MOVER: Spec = {
  role: { kind: "string", optional: true },
  vault_ids: { kind: "string_array", optional: true },
  aliases: { kind: "string_array", optional: true },
  term_ends_on: { kind: "string", optional: true },
};

export async function changeAccess(actor: PersonRow, personId: string, body: unknown): Promise<Record<string, unknown>> {
  const changed = await write(async (tx) => {
    const person = await loadPerson(tx, personId);
    if (!person) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    if (person.id === actor.id) throw conflict("own_record", "You cannot change your own record.");
    if (person.left_at) throw conflict("already_left", `${person.full_name} has already left.`);
    const fields = new Fields();
    const v = checkBody(body, MOVER, fields);
    const at = now();
    const today = officeDate(at);
    const role = v.role === undefined ? person.role : (ROLES.find((candidate) => candidate === v.role) ?? null);
    if (!role) fields.add("role", "Pick one of the four roles.");
    const aliases = v.aliases === undefined ? person.aliases : checkAliases(v.aliases, fields);
    const requested = v.vault_ids === undefined ? null : await checkVaultIds(tx, v.vault_ids, fields);
    let termEnds = person.term_ends_on;
    let termStarts = person.term_starts_on;
    if (role === "outside_bookkeeper") {
      if (typeof v.term_ends_on === "string") {
        if (!isRealDate(v.term_ends_on) || v.term_ends_on < today || (termStarts && person.role === "outside_bookkeeper" && v.term_ends_on < termStarts)) {
          fields.add("term_ends_on", "The term must end on or after today.");
        } else termEnds = v.term_ends_on;
        if (person.role !== "outside_bookkeeper") termStarts = today;
      } else if (person.role !== "outside_bookkeeper") fields.add("term", "An outside bookkeeper needs an engagement term.");
    } else {
      if (v.term_ends_on !== undefined) fields.add("term_ends_on", "Only an outside bookkeeper has an engagement term.");
      termEnds = null;
      termStarts = null;
    }
    fields.throwIfAny();
    if (!role) throw new Error("role was validated");

    const before = await scopeVaultIds(tx, person);
    const stored = (await tx.query<{ vault_id: string }>("SELECT vault_id FROM person_vaults WHERE person_id = $1", [person.id])).map((row) => row.vault_id);
    const allVaults = (await tx.query<{ id: string }>("SELECT id FROM vaults ORDER BY ord")).map((row) => row.id);
    const after = isDesk(role) ? allVaults : (requested ?? (isDesk(person.role) ? [] : stored));
    const dropped = before.filter((id) => !after.includes(id));
    const gained = after.filter((id) => !before.includes(id));

    await tx.query("UPDATE people SET role = $2, aliases = $3, term_starts_on = $4, term_ends_on = $5, term_started = $6 WHERE id = $1", [
      person.id,
      role,
      aliases,
      termStarts,
      termEnds,
      role === "outside_bookkeeper" ? person.term_started || person.role !== "outside_bookkeeper" : false,
    ]);
    const updated = await loadPerson(tx, person.id);
    if (!updated) throw new Error("person vanished");
    await record(tx, actorOf(actor), "person_change", personSubject(updated), {
      role,
      vault_ids: after,
      aliases,
      term_ends_on: termEnds,
    });
    if (isDesk(role) && !isDesk(person.role)) {
      for (const vaultId of before) {
        const vault = await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [vaultId]);
        if (vault) await closeLines(tx, updated, vault.id, vault.name, actorOf(actor), at);
      }
      await tx.query("DELETE FROM person_vaults WHERE person_id = $1", [person.id]);
    }
    await dropScopes(tx, updated, dropped, actorOf(actor), at);
    if (!isDesk(role)) await gainScopes(tx, updated, gained, actorOf(actor), at);
    tx.after(() => syncAccess(person.id, "change"));
    return updated;
  });
  return personJson(db, changed, now());
}

// ---- leave and term end ----

interface LeaveResult {
  person: PersonRow;
  turnsDue: TurnDue[];
}

/** The one action that takes a person's access away: used by a confirmed leave and by the end of a term. */
export async function endAccess(
  tx: Tx,
  person: PersonRow,
  actor: Actor,
  kind: "person_leave" | "term_end",
  at: Date,
): Promise<LeaveResult> {
  await tx.query("UPDATE people SET left_at = $2, seat = 'release_waiting', seat_since = $2 WHERE id = $1", [person.id, at]);
  await revokeSessions(tx, person.id, at);
  const lost = await scopeVaultIds(tx, person);
  const entry = await record(tx, actor, kind, personSubject(person), {}, at);
  const turnsDue = await dropScopes(tx, person, lost, actor, at);
  const details = actor === "system" ? { turns_due: turnsDue } : { confirmed_by: actor.name, turns_due: turnsDue };
  await tx.query("UPDATE audit SET details = $2 WHERE id = $1", [entry.id, JSON.stringify(details)]);
  const left = await loadPerson(tx, person.id);
  if (!left) throw new Error("person vanished");
  tx.after(() => syncAccess(person.id, kind === "person_leave" ? "change" : "boundary"));
  return { person: left, turnsDue };
}

export async function confirmLeave(actor: PersonRow, personId: string, body: unknown): Promise<Record<string, unknown>> {
  const done = await write(async (tx) => {
    const person = await loadPerson(tx, personId);
    if (!person) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    if (person.id === actor.id) throw conflict("own_record", "You cannot change your own record.");
    if (person.left_at) throw conflict("already_left", `${person.full_name} has already left.`);
    const fields = new Fields();
    const v = checkBody(body, { confirm: { kind: "any" } }, fields);
    if (v.confirm !== true) fields.add("confirm", "Confirm the leave to continue.");
    fields.throwIfAny();
    try {
      await setEnabled(person.handle, false);
    } catch (error) {
      if (error instanceof KeycloakUnavailable) throw serviceDown();
      throw error;
    }
    return endAccess(tx, person, actorOf(actor), "person_leave", now());
  });
  const released = await driveSeat(done.person.id, Date.now() + WAIT_FOR_BILLING_MS, actorOf(actor));
  if (!released) await markWaiting(done.person, actorOf(actor));
  const fresh = (await loadPerson(db, done.person.id)) ?? done.person;
  return {
    person: await personJson(db, fresh, now()),
    turns_due: done.turnsDue,
    due_by: done.turnsDue[0]?.due_by ?? null,
    seat: fresh.seat,
  };
}

// ---- travel windows ----

const TRAVEL: Spec = { starts_at: { kind: "string" }, ends_at: { kind: "string" } };
const MAX_TRAVEL_DAYS = 60;

export async function addTravel(actor: PersonRow, personId: string, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const person = await loadPerson(tx, personId);
    if (!person) throw notFound();
    if (actor.role !== "office_manager" && actor.id !== person.id) throw forbidden();
    if (person.left_at) throw conflict("already_left", `${person.full_name} has already left.`);
    const fields = new Fields();
    const v = checkBody(body, TRAVEL, fields);
    const starts = typeof v.starts_at === "string" ? v.starts_at : "";
    const ends = typeof v.ends_at === "string" ? v.ends_at : "";
    if (v.starts_at !== undefined && !isLocalMinute(starts)) fields.add("starts_at", "Use a date and time like 2026-11-05T09:00.");
    if (v.ends_at !== undefined && !isLocalMinute(ends)) fields.add("ends_at", "Use a date and time like 2026-11-05T09:00.");
    fields.throwIfAny();
    const at = now();
    const from = officeInstant(starts.slice(0, 10), starts.slice(11)).at;
    const to = officeInstant(ends.slice(0, 10), ends.slice(11)).at;
    if (from.getTime() >= to.getTime()) fields.add("ends_at", "The window must end after it starts.");
    else if (to.getTime() <= at.getTime()) fields.add("ends_at", "The window must end in the future.");
    else if (to.getTime() - from.getTime() > MAX_TRAVEL_DAYS * DAY_MS) fields.add("ends_at", "A window lasts at most 60 days.");
    fields.throwIfAny();
    const id = newId();
    await tx.query("INSERT INTO travel (id, person_id, starts_at, ends_at, created_at) VALUES ($1,$2,$3,$4,$5)", [id, person.id, from, to, at]);
    await record(tx, actorOf(actor), "travel_set", personSubject(person), { starts_at: starts, ends_at: ends });
    tx.after(() => syncAccess(person.id, "boundary"));
    return { id, starts_at: starts, ends_at: ends };
  });
}

export async function cancelTravel(actor: PersonRow, personId: string, travelId: string): Promise<void> {
  await write(async (tx) => {
    const person = await loadPerson(tx, personId);
    if (!person) throw notFound();
    const window = await tx.one<{ id: string; starts_at: Date; ends_at: Date }>("SELECT id, starts_at, ends_at FROM travel WHERE id = $1 AND person_id = $2", [travelId, personId]);
    if (!window) throw notFound();
    if (actor.role !== "office_manager" && actor.id !== person.id) throw forbidden();
    if (window.starts_at.getTime() <= now().getTime()) throw conflict("travel_started", "That travel window has already started.");
    await tx.query("DELETE FROM travel WHERE id = $1", [travelId]);
    await record(tx, actorOf(actor), "travel_cancel", personSubject(person), {});
  });
}

// ---- engagement terms (timed) ----

/** An outside bookkeeper's term starts at 00:00 on its first day: their sign-in is enabled and the start is audited. */
export async function startTerms(): Promise<void> {
  const due = await db.query<PersonRow>(
    "SELECT * FROM people WHERE role = 'outside_bookkeeper' AND left_at IS NULL AND NOT term_started AND term_starts_on IS NOT NULL ORDER BY ord",
  );
  for (const person of due) {
    const startsAt = officeMidnight(person.term_starts_on ?? "");
    if (startsAt.getTime() > now().getTime()) continue;
    try {
      await setEnabled(person.handle, true);
    } catch (error) {
      if (error instanceof KeycloakUnavailable) return;
      throw error;
    }
    await write(async (tx) => {
      const marked = await tx.one("UPDATE people SET term_started = true WHERE id = $1 AND NOT term_started RETURNING id", [person.id]);
      if (!marked) return;
      await record(tx, "system", "term_start", personSubject(person), { starts_on: person.term_starts_on, ends_on: person.term_ends_on }, startsAt);
    });
    await syncAccess(person.id, "boundary");
  }
}

