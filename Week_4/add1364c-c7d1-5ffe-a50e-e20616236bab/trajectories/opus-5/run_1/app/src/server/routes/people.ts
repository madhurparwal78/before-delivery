import { now } from '../clock.js';
import { copy } from '../copy.js';
import { conflict, invalid, notFound } from '../errors.js';
import { isUniqueViolation, query } from '../db.js';
import { withAudit } from '../audit.js';
import { sendTo } from '../events.js';
import {
  group,
  optionalText,
  optionalTextList,
  readBody,
  text,
  textList,
} from '../fields.js';
import { isOfficeDate, officeDate, officeLocalToInstant } from '../officeTime.js';
import { newId } from '../secretStore.js';
import { createUser } from '../services/keycloak.js';
import { ROLES, type PersonRow, type Role, type VaultRow } from '../types.js';
import { deskStaffIds, loadPeople, loadPerson, personJson, scopeIds, travelWindows } from '../domain/people.js';
import { allVaults } from '../domain/visibility.js';
import { applyLeave, applyScopeGain, applyScopeLoss, announceLeave, announceReviewChange } from '../domain/scopeChanges.js';
import { openReview } from '../domain/reviews.js';
import { requestRelease, requestSeat } from '../domain/seats.js';
import { bundleKeyFor } from '../services/killbill.js';
import type { Route } from '../http.js';

const DESK_STAFF = ['office_manager', 'managing_partner'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE = /^[a-z][a-z0-9-]*$/;

async function personBody(id: string): Promise<Record<string, unknown>> {
  const at = now();
  const person = await loadPerson(id);
  if (person === null) throw notFound();
  return personJson(person, await scopeIds(id), await travelWindows(id), at);
}

function checkName(fields: Record<string, string>, fullName: string): void {
  if (fullName.trim().length < 2 || fullName.length > 80) fields.full_name = 'Use 2 to 80 characters.';
}

function checkAliases(fields: Record<string, string>, aliases: readonly string[]): void {
  if (aliases.length > 5 || aliases.some((alias) => alias.trim().length < 1 || alias.length > 30)) {
    fields.aliases = 'Use at most 5 aliases of 1 to 30 characters.';
  }
}

function checkRole(fields: Record<string, string>, role: string): void {
  if (!(ROLES as readonly string[]).includes(role)) fields.role = 'Pick a role from the list.';
}

async function checkVaults(fields: Record<string, string>, vaultIds: readonly string[]): Promise<VaultRow[]> {
  const vaults = await allVaults();
  const chosen = vaultIds.map((id) => vaults.find((vault) => vault.id === id));
  if (chosen.some((vault) => vault === undefined)) fields.vault_ids = 'Pick vaults that exist.';
  return chosen.filter((vault): vault is VaultRow => vault !== undefined);
}

export const peopleRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/people',
    roles: DESK_STAFF,
    handler: async () => {
      const at = now();
      const people = await loadPeople();
      const body: Record<string, unknown>[] = [];
      for (const person of people) {
        body.push(personJson(person, await scopeIds(person.id), await travelWindows(person.id), at));
      }
      return { status: 200, body: { people: body } };
    },
  },
  {
    method: 'POST',
    path: '/api/people',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const body = readBody(ctx.body, {
        full_name: { kind: 'string' },
        email: { kind: 'string' },
        handle: { kind: 'string' },
        role: { kind: 'string' },
        aliases: { kind: 'string_array' },
        vault_ids: { kind: 'string_array' },
        initial_password: { kind: 'string' },
        term: { kind: 'object', nullable: true, shape: { starts_on: { kind: 'string' }, ends_on: { kind: 'string' } } },
      });
      const fullName = text(body, 'full_name');
      const email = text(body, 'email');
      const handle = text(body, 'handle');
      const role = text(body, 'role') as Role;
      const aliases = textList(body, 'aliases');
      const vaultIds = textList(body, 'vault_ids');
      const password = text(body, 'initial_password');
      const term = group(body, 'term');
      const at = now();
      const today = officeDate(at);

      const fields: Record<string, string> = {};
      checkName(fields, fullName);
      if (!EMAIL.test(email)) fields.email = 'Use a valid email address.';
      if (handle.length < 2 || handle.length > 20 || !HANDLE.test(handle)) {
        fields.handle = 'Use 2 to 20 characters: a lowercase letter, then lowercase letters, digits or hyphens.';
      }
      checkRole(fields, role);
      checkAliases(fields, aliases);
      const vaults = await checkVaults(fields, vaultIds);
      if (password.length < 12 || password.length > 64) fields.initial_password = 'Use 12 to 64 characters.';
      if (role === 'outside_bookkeeper') {
        if (term === null) fields.term = 'An outside bookkeeper needs an engagement term.';
        else {
          const startsOn = term.starts_on as string;
          const endsOn = term.ends_on as string;
          if (!isOfficeDate(startsOn) || !isOfficeDate(endsOn) || endsOn < startsOn || endsOn < today) {
            fields.term = 'The term must end on or after its start and on or after today.';
          }
        }
      } else if (term !== null) {
        fields.term = 'Only an outside bookkeeper has an engagement term.';
      }
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const termStartsOn = term === null ? null : (term.starts_on as string);
      const termEndsOn = term === null ? null : (term.ends_on as string);
      const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
      const personId = newId();
      const termOpen =
        termStartsOn === null ||
        (at.getTime() >= officeLocalToInstant(termStartsOn, '00:00').at.getTime() &&
          at.getTime() < officeLocalToInstant(termEndsOn as string, '23:59').at.getTime());
      const enabled = role !== 'outside_bookkeeper' || termOpen;

      let reviewId: string | null = null;
      try {
        await withAudit(async (client, write) => {
          await client.query(
            `insert into people (id, full_name, email, handle, role, aliases, term_starts_on, term_ends_on,
                                 term_started, seat, seat_bundle_key, keycloak_enabled)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting_on_billing',$10,$11)`,
            [
              personId,
              fullName,
              email,
              handle,
              role,
              aliases,
              termStartsOn,
              termEndsOn,
              termStartsOn !== null && termStartsOn <= today,
              bundleKeyFor(handle),
              enabled,
            ],
          );
          for (const vault of vaults) {
            await client.query('insert into person_vaults (person_id, vault_id) values ($1,$2)', [personId, vault.id]);
          }
          const created = await createUser({ handle, fullName, password, enabled });
          if (created.kind === 'exists') throw invalid({ handle: 'This username is already in use.' });
          await client.query('update people set keycloak_id = $2 where id = $1', [personId, created.id]);
          await write({
            actor,
            action: 'person_join',
            subject: { kind: 'person', id: personId, name: fullName },
            details: { role, vault_ids: vaults.map((vault) => vault.id) },
          });
          if (termStartsOn !== null && termStartsOn <= today) {
            await write({
              actor,
              action: 'term_start',
              subject: { kind: 'person', id: personId, name: fullName },
              details: { starts_on: termStartsOn },
            });
          }
          const joined: PersonRow = { ...ctx.caller.person, id: personId, full_name: fullName, role };
          const touched = await applyScopeGain(client, write, {
            person: joined,
            vaultIds: vaults.map((vault) => vault.id),
            actor,
          });
          if (touched) reviewId = (await openReview())?.id ?? null;
        });
      } catch (error) {
        if (isUniqueViolation(error, 'people_handle_key')) throw invalid({ handle: 'This username is already in use.' });
        if (isUniqueViolation(error, 'people_email_key')) throw invalid({ email: 'This email is already in use.' });
        throw error;
      }

      const seat = await requestSeat(handle);
      await withAudit(async (client, write) => {
        await client.query(
          `update people set seat = $2, seat_change = $3, seat_change_since = $4, seat_subscription_id = $5
            where id = $1`,
          [
            personId,
            seat.confirmed ? 'confirmed' : 'waiting_on_billing',
            seat.confirmed ? null : 'add',
            seat.confirmed ? null : at,
            seat.subscriptionId,
          ],
        );
        await write({
          actor: 'Lockset',
          action: seat.confirmed ? 'seat_confirmed' : 'seat_waiting',
          subject: { kind: 'person', id: personId, name: fullName },
          details: { change: 'add' },
        });
      });

      const staff = await deskStaffIds();
      sendTo(staff, { name: 'billing-changed', data: {} });
      if (seat.confirmed) {
        sendTo(staff, { name: 'seat-confirmed', data: { person_id: personId, name: fullName, change: 'add' } });
      }
      if (reviewId !== null) await announceReviewChange(reviewId);
      return { status: 201, body: await personBody(personId) };
    },
  },
  {
    method: 'PATCH',
    path: '/api/people/:id',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const person = await loadPerson(ctx.params.id as string);
      if (person === null) throw notFound();
      if (person.id === ctx.caller.person.id) throw conflict('own_record', 'This is your own record.');
      if (person.left_at !== null) throw conflict('already_left', copy.alreadyLeft(person.full_name));
      const body = readBody(ctx.body, {
        role: { kind: 'string', optional: true },
        vault_ids: { kind: 'string_array', optional: true },
        aliases: { kind: 'string_array', optional: true },
        term_ends_on: { kind: 'string', optional: true },
      });

      const role = (optionalText(body, 'role') ?? person.role) as Role;
      const aliases = optionalTextList(body, 'aliases') ?? person.aliases;
      const termEndsOn = optionalText(body, 'term_ends_on');
      const at = now();
      const today = officeDate(at);
      const currentScopes = await scopeIds(person.id);

      const fields: Record<string, string> = {};
      checkRole(fields, role);
      checkAliases(fields, aliases);
      const vaults = await allVaults();
      const givenVaultIds = optionalTextList(body, 'vault_ids');
      let wanted: VaultRow[];
      if (role === 'managing_partner' || role === 'office_manager') {
        wanted = vaults;
      } else if (givenVaultIds === undefined) {
        wanted = vaults.filter((vault) => currentScopes.includes(vault.id));
      } else {
        wanted = await checkVaults(fields, givenVaultIds);
      }
      if (role === 'outside_bookkeeper') {
        const ends = termEndsOn ?? person.term_ends_on;
        if (ends === null || !isOfficeDate(ends) || ends < today) {
          fields.term = 'An outside bookkeeper needs a term that ends today or later.';
        }
      }
      if (termEndsOn !== undefined && (!isOfficeDate(termEndsOn) || termEndsOn < today)) {
        fields.term_ends_on = 'Pick today or a later date.';
      }
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const wantedIds = wanted.map((vault) => vault.id);
      const dropped = vaults.filter((vault) => currentScopes.includes(vault.id) && !wantedIds.includes(vault.id));
      const gained = wantedIds.filter((id) => !currentScopes.includes(id));
      const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
      let reviewTouched = false;

      await withAudit(async (client, write) => {
        const nextTermStart =
          role === 'outside_bookkeeper' && person.role !== 'outside_bookkeeper' ? today : person.term_starts_on;
        await client.query(
          'update people set role = $2, aliases = $3, term_starts_on = $4, term_ends_on = $5 where id = $1',
          [
            person.id,
            role,
            aliases,
            role === 'outside_bookkeeper' ? nextTermStart : null,
            role === 'outside_bookkeeper' ? (termEndsOn ?? person.term_ends_on) : null,
          ],
        );
        await client.query('delete from person_vaults where person_id = $1', [person.id]);
        for (const vaultId of wantedIds) {
          await client.query('insert into person_vaults (person_id, vault_id) values ($1,$2)', [person.id, vaultId]);
        }
        await write({
          actor,
          action: 'person_change',
          subject: { kind: 'person', id: person.id, name: person.full_name },
          details: { role, vault_ids: wantedIds },
        });
        const lost = await applyScopeLoss(client, write, {
          person,
          vaults: dropped,
          actor,
          confirmedBy: ctx.caller.person.full_name,
          at,
        });
        const gainedTouched = await applyScopeGain(client, write, {
          person: { ...person, role },
          vaultIds: gained,
          actor,
        });
        reviewTouched = lost.reviewTouched || gainedTouched;
      });

      const updated = await loadPerson(person.id);
      if (updated !== null) {
        const visible = await scopeIds(updated.id);
        sendTo([updated.id], {
          name: 'access-changed',
          data: {
            vault_ids: visible,
            ended: dropped.map((vault) => ({ vault_id: vault.id, name: vault.name })),
            cause: 'change',
          },
        });
      }
      if (reviewTouched) {
        const review = await openReview();
        if (review !== null) await announceReviewChange(review.id);
      }
      return { status: 200, body: await personBody(person.id) };
    },
  },
  {
    method: 'POST',
    path: '/api/people/:id/leave',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const person = await loadPerson(ctx.params.id as string);
      if (person === null) throw notFound();
      if (person.id === ctx.caller.person.id) throw conflict('own_record', 'This is your own record.');
      if (person.left_at !== null) throw conflict('already_left', copy.alreadyLeft(person.full_name));
      readBody(ctx.body, { confirm: { kind: 'true' } });

      const at = now();
      const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
      const vaults = await allVaults();
      const scopes = await scopeIds(person.id);
      const held = vaults.filter((vault) => scopes.includes(vault.id));

      const claimed = await query<{ id: string }>(
        'update people set left_at = $2 where id = $1 and left_at is null returning id',
        [person.id, at],
      );
      if (claimed.length === 0) throw conflict('already_left', copy.alreadyLeft(person.full_name));

      let turnsDue: { credential_id: string; label: string; due_by: string }[] = [];
      try {
        const outcome = await withAudit(async (client, write) =>
          applyLeave(client, write, { person, vaults: held, actor, at, cause: 'leave' }),
        );
        turnsDue = outcome.turnsDue;
      } catch (error) {
        await query('update people set left_at = null where id = $1', [person.id]);
        throw error;
      }

      await announceLeave(person);
      const release = await requestRelease(person);
      await withAudit(async (client, write) => {
        await client.query(
          'update people set seat = $2, seat_change = $3, seat_change_since = $4 where id = $1',
          [person.id, release.confirmed ? 'released' : 'release_waiting', release.confirmed ? null : 'release', release.confirmed ? null : at],
        );
        await write({
          actor: 'Lockset',
          action: release.confirmed ? 'seat_released' : 'seat_waiting',
          subject: { kind: 'person', id: person.id, name: person.full_name },
          details: { change: 'release' },
        });
      });
      const staff = await deskStaffIds();
      sendTo(staff, { name: 'billing-changed', data: {} });
      if (release.confirmed) {
        sendTo(staff, {
          name: 'seat-confirmed',
          data: { person_id: person.id, name: person.full_name, change: 'release' },
        });
      }
      const review = await openReview();
      if (review !== null) await announceReviewChange(review.id);

      return {
        status: 200,
        body: {
          person: await personBody(person.id),
          turns_due: turnsDue,
          seat: release.confirmed ? 'released' : 'release_waiting',
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/people/:id/travel',
    handler: async (ctx) => {
      const person = await loadPerson(ctx.params.id as string);
      if (person === null) throw notFound();
      if (ctx.caller.person.role !== 'office_manager' && ctx.caller.person.id !== person.id) throw notFound();
      if (person.left_at !== null) throw conflict('already_left', copy.alreadyLeft(person.full_name));
      const body = readBody(ctx.body, { starts_at: { kind: 'string' }, ends_at: { kind: 'string' } });
      const startsLocal = text(body, 'starts_at');
      const endsLocal = text(body, 'ends_at');
      const fields: Record<string, string> = {};
      if (!isLocalDateTime(startsLocal)) fields.starts_at = 'Use a date and time like 2027-01-04T08:00.';
      if (!isLocalDateTime(endsLocal)) fields.ends_at = 'Use a date and time like 2027-01-04T08:00.';
      if (Object.keys(fields).length > 0) throw invalid(fields);
      const starts = resolveLocal(startsLocal);
      const ends = resolveLocal(endsLocal);
      const at = now();
      if (starts.getTime() >= ends.getTime()) fields.starts_at = 'The start must come before the end.';
      if (ends.getTime() <= at.getTime()) fields.ends_at = 'Pick an end in the future.';
      if (ends.getTime() - starts.getTime() > 60 * 86_400_000) fields.ends_at = 'A window may run for at most 60 days.';
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const id = newId();
      await withAudit(async (client, write) => {
        await client.query(
          `insert into travel_windows (id, person_id, starts_local, ends_local, starts_at, ends_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [id, person.id, startsLocal, endsLocal, starts, ends],
        );
        await write({
          actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
          action: 'travel_set',
          subject: { kind: 'person', id: person.id, name: person.full_name },
          details: { starts_at: startsLocal, ends_at: endsLocal },
        });
      });
      return { status: 201, body: { id, starts_at: startsLocal, ends_at: endsLocal } };
    },
  },
  {
    method: 'DELETE',
    path: '/api/people/:id/travel/:travelId',
    handler: async (ctx) => {
      const person = await loadPerson(ctx.params.id as string);
      if (person === null) throw notFound();
      if (ctx.caller.person.role !== 'office_manager' && ctx.caller.person.id !== person.id) throw notFound();
      const windows = await travelWindows(person.id);
      const window = windows.find((entry) => entry.id === ctx.params.travelId);
      if (window === undefined) throw notFound();
      if (window.starts_at.getTime() <= now().getTime()) {
        throw conflict('travel_started', 'This window has already started.');
      }
      await withAudit(async (client, write) => {
        await client.query('delete from travel_windows where id = $1', [window.id]);
        await write({
          actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
          action: 'travel_cancel',
          subject: { kind: 'person', id: person.id, name: person.full_name },
          details: { starts_at: window.starts_local, ends_at: window.ends_local },
        });
      });
      return { status: 204 };
    },
  },
];

function isLocalDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  return isOfficeDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60;
}

function resolveLocal(value: string): Date {
  return officeLocalToInstant(value.slice(0, 10), value.slice(11, 16)).at;
}
