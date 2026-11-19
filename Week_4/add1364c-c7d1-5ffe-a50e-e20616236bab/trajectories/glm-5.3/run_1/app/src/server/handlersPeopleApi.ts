import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, invalid, notFound, unavailable } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { requireRole, beginIdempotent, finishIdempotent, loadVaults, visibleNow } from './handlersCore.js';
import { loadPersonSnapshot, personView, mapVaultRow } from './handlersPeople.js';
import { mapPerson, type PersonRow, type Role } from './people.js';
import { addReviewLinesForScopes, applyScopeLoss, closePersonSessions } from './domain/scopeChanges.js';
import { termIsOpen } from './domain/visibility.js';
import { officeDateString, officeLocalInstant, parseOfficeDate, secondBusinessDayAfter } from './officeTime.js';
import { randomUUID } from 'node:crypto';

const VALID_ROLES: Role[] = ['office_manager', 'managing_partner', 'staff_accountant', 'outside_bookkeeper'];

export async function createPerson(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const idem = await beginIdempotent(ctx, '/api/people', body);
  if (idem.conflictError) throw idem.conflictError;
  if (idem.stored) {
    jsonOk(ctx.res, idem.stored.status, idem.stored.body);
    return;
  }
  const spec: BodySpec = {
    full_name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    handle: { type: 'string', required: true },
    role: { type: 'string', required: true },
    aliases: { type: 'array', required: false },
    vault_ids: { type: 'array', required: false },
    initial_password: { type: 'string', required: true },
    term: { type: 'object', required: false }
  };
  const bodyError = checkBody(spec, body);
  if (bodyError) {
    await finishIdempotent(ctx, '/api/people', idem, bodyError.status, errorBody(bodyError));
    throw bodyError;
  }
  const actor = ctx.person!;
  const fullName = String(body.full_name ?? '');
  const email = String(body.email ?? '');
  const handle = String(body.handle ?? '');
  const role = String(body.role ?? '') as Role;
  const aliases = Array.isArray(body.aliases) ? body.aliases.filter((a): a is string => typeof a === 'string') : [];
  const vaultIds = Array.isArray(body.vault_ids) ? body.vault_ids.filter((v): v is string => typeof v === 'string') : [];
  const initialPassword = String(body.initial_password ?? '');
  const term = isTerm(body.term) ? body.term : null;
  const now = ctx.store.clock.now();
  const today = officeDateString(now);

  const fields: Record<string, string> = {};
  if (fullName.length < 2 || fullName.length > 80) fields.full_name = 'Give a full name of 2 to 80 characters.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = 'Give a valid email address.';
  if (!/^[a-z][a-z0-9-]{1,19}$/.test(handle)) fields.handle = 'Give a handle of 2 to 20 characters: a lowercase letter, then lowercase letters, digits or hyphens.';
  if (!VALID_ROLES.includes(role)) fields.role = 'Pick a role from the list.';
  if (aliases.length > 5 || aliases.some((alias) => alias.length < 1 || alias.length > 30)) {
    fields.aliases = 'Give at most 5 aliases of 1 to 30 characters each.';
  }
  if (initialPassword.length < 12 || initialPassword.length > 64) {
    fields.initial_password = 'Give an initial password of 12 to 64 characters.';
  }
  if (role === 'outside_bookkeeper') {
    if (!term || !term.starts_on || !term.ends_on) {
      fields.term = 'An outside bookkeeper needs a term.';
    } else {
      const starts = parseOfficeDate(String(term.starts_on));
      const ends = parseOfficeDate(String(term.ends_on));
      if (!starts || !ends) {
        fields.term = 'Give the term as real dates.';
      } else if (ends < starts || ends < today) {
        fields.term = 'The term must end on or after its start and on or after office today.';
      }
    }
  } else if (term !== null) {
    fields.term = 'Only an outside bookkeeper has a term.';
  }
  const vaultRows = await ctx.store.pool.query('SELECT id FROM vaults');
  const vaultSet = new Set(vaultRows.rows.map((row) => String(row.id)));
  if (vaultIds.some((id) => !vaultSet.has(id))) {
    fields.vault_ids = 'Pick vaults that exist.';
  }
  if (Object.keys(fields).length > 0) {
    const err = invalid(fields);
    await finishIdempotent(ctx, '/api/people', idem, err.status, errorBody(err));
    throw err;
  }
  const emailTaken = await ctx.store.pool.query('SELECT id FROM people WHERE lower(email) = lower($1)', [email]);
  if (emailTaken.rows.length > 0) {
    const err = invalid({ email: 'This email is already on record.' });
    await finishIdempotent(ctx, '/api/people', idem, err.status, errorBody(err));
    throw err;
  }
  const handleTaken = await ctx.store.pool.query('SELECT id FROM people WHERE lower(handle) = lower($1)', [handle]);
  if (handleTaken.rows.length > 0) {
    const err = invalid({ handle: 'This handle is already on record.' });
    await finishIdempotent(ctx, '/api/people', idem, err.status, errorBody(err));
    throw err;
  }
  const officeKey = ctx.store.settings.officeKey;
  const words = fullName.split(/\s+/);
  const firstName = words[0] ?? fullName;
  const lastName = words.length > 1 ? words.slice(1).join(' ') : firstName;
  const created = await ctx.store.keycloak.createUser(
    `${officeKey}.${handle}`,
    firstName,
    lastName,
    `${officeKey}.${handle}@people.lockset.example`,
    initialPassword
  );
  if ('unreachable' in created) {
    const err = unavailable('sign_in_unavailable', COPY.signInUnavailable);
    await finishIdempotent(ctx, '/api/people', idem, err.status, errorBody(err));
    throw err;
  }
  if ('exists' in created) {
    const err = invalid({ handle: 'This handle is already on record.' });
    await finishIdempotent(ctx, '/api/people', idem, err.status, errorBody(err));
    throw err;
  }
  if (role === 'outside_bookkeeper' && term) {
    const startInstant = officeLocalInstant(String(term.starts_on), '00:00');
    if (startInstant.getTime() > now.getTime()) {
      await ctx.store.keycloak.setEnabled(`${officeKey}.${handle}`, false);
    }
  }
  const personId = randomUUID();
  await ctx.store.transaction(async (client) => {
    const maxSeq = await client.query('SELECT COALESCE(MAX(created_seq), 1) + 1 AS seq FROM people');
    await client.query(
      `INSERT INTO people (id, full_name, email, handle, role, status, aliases, term_starts_on, term_ends_on, first_signed_in_at, created_seq)
       VALUES ($1,$2,$3,$4,$5,'invited',$6,$7,$8,NULL,$9)`,
      [
        personId,
        fullName,
        email,
        handle,
        role,
        aliases,
        term?.starts_on ?? null,
        term?.ends_on ?? null,
        Number(maxSeq.rows[0].seq)
      ]
    );
    for (const vaultId of vaultIds) {
      await client.query('INSERT INTO vault_scopes (person_id, vault_id) VALUES ($1,$2)', [personId, vaultId]);
    }
    await client.query(
      `INSERT INTO seat_changes (id, person_id, change, state, since) VALUES ($1,$2,'add','waiting',$3)`,
      [randomUUID(), personId, now]
    );
    const addedLines = await addReviewLinesForScopes(ctx.store, client, personId, vaultIds);
    const drafts = [
      { action: 'person_join', subject: { kind: 'person', id: personId, name: fullName } },
      ...addedLines.map(() => ({ action: 'review_line_added', subject: { kind: 'person', id: personId, name: fullName } }))
    ];
    await ctx.store.writeAudit(client, { personId: actor.id, name: actor.full_name }, drafts);
    if (role === 'outside_bookkeeper' && term) {
      const startInstant2 = officeLocalInstant(String(term.starts_on), '00:00');
      if (startInstant2.getTime() <= now.getTime()) {
        await ctx.store.writeAudit(client, { system: 'Lockset' }, [
          { action: 'term_start', subject: { kind: 'person', id: personId, name: fullName } }
        ]);
      }
    }
  });
  const confirmed = await requestSeat(ctx, handle);
  if (confirmed) {
    await ctx.store.transaction(async (client) => {
      await client.query(
        `UPDATE seat_changes SET state = 'confirmed', kb_subscription_id = $3, confirmed_at = $2 WHERE person_id = $1 AND state = 'waiting' AND change = 'add'`,
        [personId, now, confirmed]
      );
      await ctx.store.writeAudit(client, { system: 'Lockset' }, [
        { action: 'seat_confirmed', subject: { kind: 'person', id: personId, name: fullName } }
      ]);
    });
    notifySeatConfirmed(ctx, personId, fullName, 'add');
  } else {
    await ctx.store.transaction(async (client) => {
      await ctx.store.writeAudit(client, { system: 'Lockset' }, [
        { action: 'seat_waiting', subject: { kind: 'person', id: personId, name: fullName } }
      ]);
    });
  }
  const snap = await loadPersonSnapshot(ctx, personId);
  const response = personView(snap);
  await finishIdempotent(ctx, '/api/people', idem, 201, response);
  jsonOk(ctx.res, 201, response);
}

function isTerm(value: unknown): value is { starts_on?: string; ends_on?: string } | null {
  return value === null || (typeof value === 'object' && value !== null && !Array.isArray(value));
}

function errorBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: { code: err.code, message: err.message } };
  if (err.fields) body.error = { code: err.code, message: err.message, fields: err.fields };
  return body;
}

/** Ask Kill Bill for the seat and wait up to 5 seconds for the subscription to be confirmed. */
async function requestSeat(ctx: Ctx, handle: string): Promise<string | null> {
  const accountId = await ctx.store.killbill.ensureAccount();
  if (!accountId) return null;
  const created = await ctx.store.killbill.createSeat(accountId, handle);
  if (created === 'unreachable' || created === null) return null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const sub = await ctx.store.killbill.subscription(created.subscriptionId);
    if (sub && sub.state === 'ACTIVE' && sub.chargedThroughDate) {
      return sub.subscriptionId;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export function notifySeatConfirmed(ctx: Ctx, personId: string, name: string, change: 'add' | 'release'): void {
  void ctx.store.pool
    .query("SELECT id FROM people WHERE role IN ('office_manager','managing_partner') AND status <> 'left'")
    .then((rows) => {
      for (const row of rows.rows) {
        ctx.store.events.send(String(row.id), 'seat-confirmed', { person_id: personId, name, change });
        ctx.store.events.send(String(row.id), 'billing-changed', {});
      }
    });
}

export async function patchPerson(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const personId = ctx.params.id;
  const rows = await ctx.store.pool.query('SELECT * FROM people WHERE id = $1', [personId]);
  if (rows.rows.length === 0) throw notFound();
  const person = mapPerson(rows.rows[0]);
  const spec: BodySpec = {
    role: { type: 'string', required: false },
    vault_ids: { type: 'array', required: false },
    aliases: { type: 'array', required: false },
    term_ends_on: { type: 'string', required: false }
  };
  // own record answers own_record before any body check
  if (person.id === ctx.person!.id) {
    throw conflict('own_record', 'The office manager cannot change their own record.');
  }
  if (person.status === 'left' || person.left_at !== null) {
    throw conflict('already_left', `${person.full_name} has already left.`);
  }
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const role = typeof body.role === 'string' ? (body.role as Role) : person.role;
  const aliases = Array.isArray(body.aliases) ? body.aliases.filter((a): a is string => typeof a === 'string') : person.aliases;
  const termEndsOn = typeof body.term_ends_on === 'string' ? body.term_ends_on : person.term_ends_on;
  const vaultIds = Array.isArray(body.vault_ids)
    ? body.vault_ids.filter((v): v is string => typeof v === 'string')
    : null;
  const fields: Record<string, string> = {};
  if (!VALID_ROLES.includes(role)) fields.role = 'Pick a role from the list.';
  if (aliases.length > 5 || aliases.some((alias) => alias.length < 1 || alias.length > 30)) {
    fields.aliases = 'Give at most 5 aliases of 1 to 30 characters each.';
  }
  if (role === 'outside_bookkeeper') {
    if (!termEndsOn) {
      fields.term = 'An outside bookkeeper needs a term end date.';
    } else if (!parseOfficeDate(termEndsOn)) {
      fields.term = 'Give the term end as a real date.';
    }
  }
  if (vaultIds !== null) {
    const vaultRows = await ctx.store.pool.query('SELECT id FROM vaults');
    const vaultSet = new Set(vaultRows.rows.map((row) => String(row.id)));
    if (vaultIds.some((id) => !vaultSet.has(id))) fields.vault_ids = 'Pick vaults that exist.';
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  const roleChanged = role !== person.role;
  const termStarts = role === 'outside_bookkeeper' ? (roleChanged ? today : person.term_starts_on) : null;
  await ctx.store.transaction(async (client) => {
    await client.query(
      'UPDATE people SET role = $2, aliases = $3, term_starts_on = $4, term_ends_on = $5 WHERE id = $1',
      [personId, role, aliases, termStarts, role === 'outside_bookkeeper' ? termEndsOn : null]
    );
    const drafts: Array<{ action: string; subject: { kind: string; id: string; name: string }; details?: Record<string, unknown> }> = [
      { action: 'person_change', subject: { kind: 'person', id: personId, name: person.full_name } }
    ];
    if (vaultIds !== null) {
      const oldScopes = await client.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [personId]);
      const oldSet = new Set(oldScopes.rows.map((row) => String(row.vault_id)));
      const dropped: string[] = [];
      const gained: string[] = [];
      for (const id of oldSet) if (!vaultIds.includes(id)) dropped.push(id);
      for (const id of vaultIds) if (!oldSet.has(id)) gained.push(id);
      await client.query('DELETE FROM vault_scopes WHERE person_id = $1', [personId]);
      for (const id of vaultIds) {
        await client.query('INSERT INTO vault_scopes (person_id, vault_id) VALUES ($1,$2)', [personId, id]);
      }
      if (dropped.length > 0) {
        await applyScopeLoss(
          ctx.store,
          client,
          { personId, personName: person.full_name, vaultIds: dropped, confirmedBy: actorId(ctx), cause: 'mover' },
          { personId: ctx.person!.id, name: ctx.person!.full_name }
        );
      }
      const addedLines = await addReviewLinesForScopes(ctx.store, client, personId, gained);
      for (const _line of addedLines) {
        drafts.push({ action: 'review_line_added', subject: { kind: 'person', id: personId, name: person.full_name } });
      }
    }
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, drafts);
  });
  if (role === 'outside_bookkeeper' && roleChanged) {
    // enable the Keycloak user within the term
    void ctx.store.keycloak.setEnabled(`${ctx.store.settings.officeKey}.${person.handle}`, true).catch(() => undefined);
  }
  if (vaultIds !== null) {
    const visible = await visibleNow(ctx, person);
    ctx.store.events.send(personId, 'access-changed', {
      vault_ids: visible,
      ended: [],
      cause: 'change'
    });
    notifyReviewChangedToManagers(ctx);
  }
  const snap = await loadPersonSnapshot(ctx, personId);
  jsonOk(ctx.res, 200, personView(snap));
}

function actorId(ctx: Ctx): string | null {
  return ctx.person?.id ?? null;
}

export function notifyReviewChangedToManagers(ctx: Ctx): void {
  void ctx.store.pool
    .query("SELECT id FROM people WHERE role IN ('office_manager','managing_partner') AND status <> 'left'")
    .then((rows) => {
      for (const row of rows.rows) {
        ctx.store.events.send(String(row.id), 'review-changed', {});
      }
    });
}

export async function leavePerson(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const idem = await beginIdempotent(ctx, `/api/people/${ctx.params.id}/leave`, body);
  if (idem.conflictError) throw idem.conflictError;
  if (idem.stored) {
    jsonOk(ctx.res, idem.stored.status, idem.stored.body);
    return;
  }
  const personId = ctx.params.id;
  const rows = await ctx.store.pool.query('SELECT * FROM people WHERE id = $1', [personId]);
  if (rows.rows.length === 0) throw notFound();
  const person = mapPerson(rows.rows[0]);
  if (person.id === ctx.person!.id) {
    const err = conflict('own_record', 'The office manager cannot leave their own record.');
    await finishIdempotent(ctx, `/api/people/${ctx.params.id}/leave`, idem, err.status, errorBody(err));
    throw err;
  }
  if (person.status === 'left' || person.left_at !== null) {
    const err = conflict('already_left', COPY.alreadyLeft(person.full_name));
    await finishIdempotent(ctx, `/api/people/${ctx.params.id}/leave`, idem, err.status, errorBody(err));
    throw err;
  }
  if (body.confirm !== true) {
    const err = invalid({ confirm: 'Confirm the leave to continue.' });
    await finishIdempotent(ctx, `/api/people/${ctx.params.id}/leave`, idem, err.status, errorBody(err));
    throw err;
  }
  // Disable the Keycloak user; if Keycloak cannot be reached nothing changes.
  const disabled = await ctx.store.keycloak.setEnabled(`${ctx.store.settings.officeKey}.${person.handle}`, false);
  if (!disabled) {
    const err = unavailable('sign_in_unavailable', COPY.signInUnavailable);
    await finishIdempotent(ctx, `/api/people/${ctx.params.id}/leave`, idem, err.status, errorBody(err));
    throw err;
  }
  await ctx.store.keycloak.endSessions(`${ctx.store.settings.officeKey}.${person.handle}`);
  const now = ctx.store.clock.now();
  let turnsDue: Array<{ credential_id: string; label: string; due_by: string }> = [];
  await ctx.store.transaction(async (client) => {
    await client.query("UPDATE people SET status = 'left', left_at = $2 WHERE id = $1", [personId, now]);
    const oldScopes = await client.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [personId]);
    const dropped = oldScopes.rows.map((row) => String(row.vault_id));
    await client.query('DELETE FROM vault_scopes WHERE person_id = $1', [personId]);
    await client.query('UPDATE credential_holders SET holder_left = true WHERE person_id = $1', [personId]);
    await closePersonSessions(client, personId);
    turnsDue = await applyScopeLoss(
      ctx.store,
      client,
      { personId, personName: person.full_name, vaultIds: dropped, confirmedBy: ctx.person!.id, cause: 'leave' },
      { personId: ctx.person!.id, name: ctx.person!.full_name }
    );
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      {
        action: 'person_leave',
        subject: { kind: 'person', id: personId, name: person.full_name },
        details: { confirmed_by: ctx.person!.id, turns_due: turnsDue.length }
      }
    ]);
    await client.query(
      `UPDATE seat_changes SET state = 'release_waiting' WHERE person_id = $1 AND state = 'confirmed' AND change = 'add'`,
      [personId]
    );
  });
  // request the seat release; the seat count drops only when Kill Bill confirms it
  const released = await requestSeatRelease(ctx, personId, person.handle);
  let seat: 'release_waiting' | 'released' = 'release_waiting';
  if (released) {
    seat = 'released';
    await ctx.store.transaction(async (client) => {
      await client.query(
        "UPDATE seat_changes SET state = 'confirmed', confirmed_at = $3 WHERE person_id = $1 AND state = 'release_waiting'",
        [personId, released, now]
      );
      await ctx.store.writeAudit(client, { system: 'Lockset' }, [
        { action: 'seat_released', subject: { kind: 'person', id: personId, name: person.full_name } }
      ]);
    });
    notifySeatConfirmed(ctx, personId, person.full_name, 'release');
  }
  const snap = await loadPersonSnapshot(ctx, personId);
  const response = {
    person: personView(snap),
    turns_due: turnsDue,
    seat
  };
  await finishIdempotent(ctx, `/api/people/${ctx.params.id}/leave`, idem, 200, response);
  jsonOk(ctx.res, 200, response);
}

async function requestSeatRelease(ctx: Ctx, personId: string, handle: string): Promise<string | null> {
  const rows = await ctx.store.pool.query(
    "SELECT kb_subscription_id FROM seat_changes WHERE person_id = $1 AND change = 'add' ORDER BY since DESC",
    [personId]
  );
  const subscriptionId = rows.rows.length > 0 ? String(rows.rows[0].kb_subscription_id ?? '') : null;
  const accountId = await ctx.store.killbill.ensureAccount();
  if (!accountId) return null;
  if (subscriptionId) {
    const cancelled = await ctx.store.killbill.cancelSeat(subscriptionId);
    if (cancelled === 'unreachable' || cancelled === null) return null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const sub = await ctx.store.killbill.subscription(subscriptionId);
      if (sub && sub.state === 'CANCELLED' && sub.billingEndDate === sub.chargedThroughDate) {
        return sub.subscriptionId;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }
  return null;
}

export async function setTravel(ctx: Ctx): Promise<void> {
  const personId = ctx.params.id;
  const rows = await ctx.store.pool.query('SELECT * FROM people WHERE id = $1', [personId]);
  if (rows.rows.length === 0) throw notFound();
  const person = mapPerson(rows.rows[0]);
  if (ctx.person!.role !== 'office_manager' && ctx.person!.id !== personId) throw new ApiError(403, 'forbidden', 'Your role may not do this.');
  if (person.status === 'left' || person.left_at !== null) {
    throw conflict('already_left', COPY.alreadyLeft(person.full_name));
  }
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = { starts_at: { type: 'string', required: true }, ends_at: { type: 'string', required: true } };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const startsAt = String(body.starts_at ?? '');
  const endsAt = String(body.ends_at ?? '');
  const startMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(startsAt);
  const endMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(endsAt);
  const fields: Record<string, string> = {};
  if (!startMatch || !parseOfficeDate(startMatch[1])) fields.starts_at = 'Give the start as an office date and time.';
  if (!endMatch || !parseOfficeDate(endMatch[1])) fields.ends_at = 'Give the end as an office date and time.';
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const startInstant = officeLocalInstant(startMatch![1], startMatch![2]);
  const endInstant = officeLocalInstant(endMatch![1], endMatch![2]);
  const now = ctx.store.clock.now();
  if (!(startInstant.getTime() < endInstant.getTime())) throw invalid({ starts_at: 'The start must be before the end.' });
  if (!(endInstant.getTime() > now.getTime())) throw invalid({ ends_at: 'The end must be in the future.' });
  if (endInstant.getTime() - startInstant.getTime() > 60 * 24 * 3600 * 1000) {
    throw invalid({ ends_at: 'A travel window is at most 60 days long.' });
  }
  const id = randomUUID();
  await ctx.store.transaction(async (client) => {
    await client.query('INSERT INTO travel_windows (id, person_id, starts_at, ends_at, created_seq) VALUES ($1,$2,$3,$4,nextval(\'row_seq_seq\'::regclass))', [
      id,
      personId,
      startInstant,
      endInstant
    ]);
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'travel_set', subject: { kind: 'person', id: personId, name: person.full_name } }
    ]);
  });
  jsonOk(ctx.res, 201, {
    id,
    starts_at: `${startMatch![1]}T${startMatch![2]}`,
    ends_at: `${endMatch![1]}T${endMatch![2]}`
  });
}

export async function cancelTravel(ctx: Ctx): Promise<void> {
  const personId = ctx.params.id;
  const travelId = ctx.params.travelId;
  if (ctx.person!.role !== 'office_manager' && ctx.person!.id !== personId) throw new ApiError(403, 'forbidden', 'Your role may not do this.');
  const rows = await ctx.store.pool.query('SELECT * FROM travel_windows WHERE id = $1 AND person_id = $2', [travelId, personId]);
  if (rows.rows.length === 0) throw notFound();
  const travel = rows.rows[0];
  const now = ctx.store.clock.now();
  if (new Date(travel.starts_at as string).getTime() <= now.getTime()) {
    throw conflict('travel_started', 'This travel window has already started.');
  }
  const personRows = await ctx.store.pool.query('SELECT full_name FROM people WHERE id = $1', [personId]);
  await ctx.store.transaction(async (client) => {
    await client.query('DELETE FROM travel_windows WHERE id = $1', [travelId]);
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'travel_cancel', subject: { kind: 'person', id: personId, name: String(personRows.rows[0]?.full_name ?? '') } }
    ]);
  });
  jsonOk(ctx.res, 204 as never, {});
}
