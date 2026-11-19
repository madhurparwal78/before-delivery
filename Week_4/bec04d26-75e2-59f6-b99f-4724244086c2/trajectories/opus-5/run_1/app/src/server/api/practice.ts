import { Carry, ClientRecord, Edition } from '../../shared/types';
import { createReturnsForRegistration, recalculateForEdition, recalculateForHolidays, resyncAllReminders } from '../actions/returns';
import { attemptDueReminders, pumpPractice } from '../actions/schedule';
import { hashPassword, newId } from '../auth';
import { queryOne, transaction } from '../db';
import { isDateString } from '../../shared/dates';
import { MESSAGES } from '../domain/messages';
import { isFrequency, matchesFrequency } from '../domain/periods';
import { isEmail, isInteger, isNonEmptyString, isRate } from '../domain/validate';
import { PRIORITY, publish } from '../events';
import { bodyRecord, Ctx, requireBookkeeper, sendJson } from '../http/context';
import * as errors from '../http/errors';
import {
  getPractice,
  loadClients,
  loadState,
  loadStates,
  practiceNow,
  presentState,
} from '../repo/practice';
import { loadReturnRows, presentReturns } from '../repo/returns';
import { asRecord } from '../domain/validate';

export async function patchPractice(ctx: Ctx): Promise<void> {
  const user = requireBookkeeper(ctx);
  const body = bodyRecord(ctx);
  const hour = body.reminder_hour;
  if (!isInteger(hour) || hour < 6 || hour > 21) {
    throw errors.validation({ reminder_hour: MESSAGES.reminder_hour });
  }
  await transaction(async (tx) => {
    await tx.query('UPDATE practices SET reminder_hour = $2 WHERE id = $1', [
      user.practice_id,
      hour,
    ]);
    await resyncAllReminders(tx, user.practice_id, hour);
  });
  publish(user.practice_id, {
    lines: [
      {
        text: 'Reminder hour saved.',
        priority: PRIORITY.own_action,
        roles: ['bookkeeper'],
        clientId: null,
      },
    ],
  });
  await attemptDueReminders(user.practice_id);
  sendJson(ctx.res, 200, { reminder_hour: hour });
}

export async function getStates(ctx: Ctx): Promise<void> {
  const user = requireBookkeeper(ctx);
  const states = await loadStates(user.practice_id);
  sendJson(ctx.res, 200, states.map(presentState));
}

export async function putHolidays(ctx: Ctx): Promise<void> {
  const user = requireBookkeeper(ctx);
  const body = bodyRecord(ctx);
  const holidays = body.holidays;
  if (
    !Array.isArray(holidays) ||
    holidays.some((day) => typeof day !== 'string' || !isDateString(day))
  ) {
    throw errors.validation({ holidays: MESSAGES.holidays });
  }
  const existing = await loadState(user.practice_id, ctx.params.code);
  if (!existing) throw errors.notFound();
  const practice = await getPractice(user.practice_id);
  if (!practice) throw errors.notFound();
  const unique = [...new Set(holidays as string[])].sort();
  const state = await transaction(async (tx) => {
    await tx.query('DELETE FROM state_holidays WHERE state_id = $1', [existing.id]);
    for (const day of unique) {
      await tx.query('INSERT INTO state_holidays (state_id, day) VALUES ($1,$2)', [
        existing.id,
        day,
      ]);
    }
    const reloaded = await loadState(user.practice_id, ctx.params.code, tx);
    if (!reloaded) throw errors.notFound();
    await recalculateForHolidays(tx, reloaded, practice.reminder_hour);
    return reloaded;
  });
  publish(user.practice_id, {
    lines: [
      {
        text: `Holidays saved for ${state.code}.`,
        priority: PRIORITY.own_action,
        roles: ['bookkeeper'],
        clientId: null,
      },
    ],
  });
  pumpPractice(user.practice_id);
  sendJson(ctx.res, 200, presentState(state));
}

function validateEdition(
  body: Record<string, unknown>,
  existingDates: readonly string[],
): Edition {
  const fieldErrors: Record<string, string> = {};
  const effective = body.effective_date;
  if (typeof effective !== 'string' || !isDateString(effective)) {
    fieldErrors.effective_date = MESSAGES.effective_date;
  } else if (existingDates.includes(effective)) {
    fieldErrors.effective_date = MESSAGES.effective_date_duplicate;
  }
  const dueDay = body.due_day;
  if (!isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    fieldErrors.due_day = MESSAGES.due_day;
  }
  const carry = body.carry;
  if (carry !== 'next_business' && carry !== 'fixed') {
    fieldErrors.carry = MESSAGES.carry;
  }
  if (!isRate(body.rate)) fieldErrors.rate = MESSAGES.rate;
  const extensionDays = body.extension_days;
  if (!isInteger(extensionDays) || extensionDays < 0 || extensionDays > 180) {
    fieldErrors.extension_days = MESSAGES.extension_days;
  }
  if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
  return {
    effective_date: effective as string,
    due_day: dueDay as number,
    carry: carry as Carry,
    rate: body.rate as string,
    extension_days: extensionDays as number,
  };
}

export async function postEdition(ctx: Ctx): Promise<void> {
  const user = requireBookkeeper(ctx);
  const existing = await loadState(user.practice_id, ctx.params.code);
  if (!existing) throw errors.notFound();
  const practice = await getPractice(user.practice_id);
  if (!practice) throw errors.notFound();
  const edition = validateEdition(
    bodyRecord(ctx),
    existing.editions.map((item) => item.effective_date),
  );
  const recalculated = await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO state_editions (id, state_id, effective_date, due_day, carry, rate, extension_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        newId(),
        existing.id,
        edition.effective_date,
        edition.due_day,
        edition.carry,
        edition.rate,
        edition.extension_days,
      ],
    );
    const reloaded = await loadState(user.practice_id, ctx.params.code, tx);
    if (!reloaded) throw errors.notFound();
    return recalculateForEdition(tx, reloaded, edition.effective_date, practice.reminder_hour);
  });
  publish(user.practice_id, {
    lines: [
      {
        text: `Rule change published for ${existing.code}.`,
        priority: PRIORITY.own_action,
        roles: ['bookkeeper'],
        clientId: null,
      },
    ],
  });
  pumpPractice(user.practice_id);
  sendJson(ctx.res, 201, { edition, recalculated });
}

export async function getClients(ctx: Ctx): Promise<void> {
  const user = requireBookkeeper(ctx);
  sendJson(ctx.res, 200, await loadClients(user.practice_id));
}

export async function postClient(ctx: Ctx): Promise<void> {
  const user = requireBookkeeper(ctx);
  const body = bodyRecord(ctx);
  const owner = asRecord(body.owner);
  const fieldErrors: Record<string, string> = {};
  if (!isNonEmptyString(body.name)) fieldErrors.name = MESSAGES.name;
  if (!isNonEmptyString(owner.display_name)) fieldErrors.display_name = MESSAGES.display_name_owner;
  if (!isEmail(owner.email)) fieldErrors['owner.email'] = MESSAGES.email_invalid;
  if (typeof owner.password !== 'string' || owner.password.length < 8) {
    fieldErrors['owner.password'] = MESSAGES.password;
  }
  if (!fieldErrors['owner.email']) {
    const taken = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1)',
      [owner.email as string],
    );
    if (taken) fieldErrors['owner.email'] = MESSAGES.email_taken;
  }
  if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);

  const name = (body.name as string).trim();
  const passwordHash = await hashPassword(owner.password as string);
  const client: ClientRecord = await transaction(async (tx) => {
    const ownerId = newId();
    const clientId = newId();
    await tx.query(
      `INSERT INTO users (id, practice_id, display_name, email, password_hash, role, client_id, created_ms)
       VALUES ($1,$2,$3,$4,$5,'owner',$6,$7)`,
      [
        ownerId,
        user.practice_id,
        (owner.display_name as string).trim(),
        (owner.email as string).trim(),
        passwordHash,
        clientId,
        Date.now(),
      ],
    );
    await tx.query(
      'INSERT INTO clients (id, practice_id, name, owner_user_id, created_ms) VALUES ($1,$2,$3,$4,$5)',
      [clientId, user.practice_id, name, ownerId, Date.now()],
    );
    return {
      id: clientId,
      name,
      owner: {
        id: ownerId,
        display_name: (owner.display_name as string).trim(),
        email: (owner.email as string).trim(),
      },
      registrations: [],
    };
  });
  publish(user.practice_id, {
    lines: [
      {
        text: `Client added: ${name}.`,
        priority: PRIORITY.own_action,
        roles: ['bookkeeper'],
        clientId: null,
      },
    ],
  });
  sendJson(ctx.res, 201, client);
}

export async function postRegistration(ctx: Ctx): Promise<void> {
  const user = requireBookkeeper(ctx);
  const client = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM clients WHERE id = $1 AND practice_id = $2',
    [ctx.params.id, user.practice_id],
  );
  if (!client) throw errors.notFound();
  const practice = await getPractice(user.practice_id);
  if (!practice) throw errors.notFound();
  const body = bodyRecord(ctx);
  const fieldErrors: Record<string, string> = {};
  const stateCode = typeof body.state === 'string' ? body.state : '';
  const state = stateCode ? await loadState(user.practice_id, stateCode) : null;
  if (!state) fieldErrors.state = MESSAGES.state_missing;
  const frequency = body.frequency;
  if (!isFrequency(frequency)) fieldErrors.frequency = MESSAGES.frequency;
  const firstPeriod = body.first_period;
  if (
    typeof firstPeriod !== 'string' ||
    !isFrequency(frequency) ||
    !matchesFrequency(firstPeriod, frequency)
  ) {
    fieldErrors.first_period = MESSAGES.first_period;
  }
  if (state) {
    const duplicate = await queryOne<{ id: string }>(
      'SELECT id FROM registrations WHERE client_id = $1 AND state_id = $2',
      [client.id, state.id],
    );
    if (duplicate) fieldErrors.state = MESSAGES.state_duplicate;
  }
  if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
  if (!state || !isFrequency(frequency) || typeof firstPeriod !== 'string') {
    throw errors.validation(fieldErrors);
  }

  const registrationId = newId();
  const returnIds = await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO registrations (id, practice_id, client_id, state_id, frequency, first_period, created_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        registrationId,
        user.practice_id,
        client.id,
        state.id,
        frequency,
        firstPeriod,
        Date.now(),
      ],
    );
    return createReturnsForRegistration(tx, {
      practiceId: user.practice_id,
      clientId: client.id,
      registrationId,
      state,
      frequency,
      firstPeriod,
      reminderHour: practice.reminder_hour,
      changedBy: user.display_name,
    });
  });
  publish(user.practice_id, {
    lines: [
      {
        text: `${client.name} registered in ${state.code}.`,
        priority: PRIORITY.own_action,
        roles: ['bookkeeper'],
        clientId: client.id,
      },
    ],
  });
  pumpPractice(user.practice_id);

  const rows = await loadReturnRows(user.practice_id, { ids: returnIds });
  const records = await presentReturns(rows, practiceNow(practice));
  sendJson(ctx.res, 201, {
    registration: {
      id: registrationId,
      state: state.code,
      frequency,
      first_period: firstPeriod,
    },
    returns: records,
  });
}
