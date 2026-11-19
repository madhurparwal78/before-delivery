import { Carry, Edition, Frequency, ReturnStatus } from '../../shared/types';
import { announceNewlyOverdue, createReturnsForRegistration } from '../actions/returns';
import { attemptDueReminders, attemptRenders, syncReminders } from '../actions/schedule';
import { createSession, hashPassword, newId } from '../auth';
import { config } from '../config';
import { query, queryOne, transaction, Tx } from '../db';
import { isDateString } from '../../shared/dates';
import { MESSAGES } from '../domain/messages';
import { generatePeriods, isFrequency, matchesFrequency } from '../domain/periods';
import { asRecord, isAmount, isEmail, isInteger, isNonEmptyString, isRate } from '../domain/validate';
import { isInstantString, isValidZone, toInstantString } from '../domain/zones';
import { publish } from '../events';
import { bodyRecord, Ctx, sendJson } from '../http/context';
import * as errors from '../http/errors';
import {
  catalogueStates,
  createPractice,
  getPractice,
  insertStates,
  loadStates,
  practiceNow,
  SeedStateInput,
} from '../repo/practice';

const SEEDABLE: readonly ReturnStatus[] = [
  'not_started',
  'prepared',
  'client_approved',
  'filed',
  'packeted',
];

/** The grading routes exist only behind the right key. */
export function requireGradingKey(ctx: Ctx): void {
  if (!config.gradingKey) throw errors.notFound();
  const sent = ctx.req.headers['x-grading-key'];
  if (typeof sent !== 'string' || sent !== config.gradingKey) throw errors.notFound();
}

interface FixtureReturn {
  period: string;
  status: ReturnStatus;
  gross_sales: string | null;
  tax_due: string | null;
}

interface FixtureRegistration {
  key: string;
  state: string;
  frequency: Frequency;
  first_period: string;
  returns: FixtureReturn[];
}

interface FixtureClient {
  key: string;
  name: string;
  owner: { display_name: string; email: string; password: string };
  registrations: FixtureRegistration[];
}

interface FixtureInput {
  bookkeeper: { display_name: string; email: string; password: string; reminder_hour: number };
  nowMs: number | null;
  states: SeedStateInput[];
  clients: FixtureClient[];
}

class FixtureErrors {
  readonly errors: Record<string, string> = {};

  add(path: string, message: string): void {
    if (!this.errors[path]) this.errors[path] = message;
  }

  throwIfAny(): void {
    if (Object.keys(this.errors).length > 0) throw errors.validation(this.errors);
  }
}

function readEdition(raw: unknown, path: string, problems: FixtureErrors): Edition {
  const record = asRecord(raw);
  if (typeof record.effective_date !== 'string' || !isDateString(record.effective_date)) {
    problems.add(`${path}.effective_date`, MESSAGES.effective_date);
  }
  if (!isInteger(record.due_day) || record.due_day < 1 || record.due_day > 31) {
    problems.add(`${path}.due_day`, MESSAGES.due_day);
  }
  if (record.carry !== 'next_business' && record.carry !== 'fixed') {
    problems.add(`${path}.carry`, MESSAGES.carry);
  }
  if (!isRate(record.rate)) problems.add(`${path}.rate`, MESSAGES.rate);
  if (!isInteger(record.extension_days) || record.extension_days < 0 || record.extension_days > 180) {
    problems.add(`${path}.extension_days`, MESSAGES.extension_days);
  }
  return {
    effective_date: record.effective_date as string,
    due_day: record.due_day as number,
    carry: record.carry as Carry,
    rate: record.rate as string,
    extension_days: record.extension_days as number,
  };
}

function readFixture(body: Record<string, unknown>): FixtureInput {
  const problems = new FixtureErrors();
  const bookkeeper = asRecord(body.bookkeeper);
  if (!isNonEmptyString(bookkeeper.display_name)) {
    problems.add('bookkeeper.display_name', MESSAGES.display_name_signup);
  }
  if (!isEmail(bookkeeper.email)) problems.add('bookkeeper.email', MESSAGES.email_invalid);
  if (typeof bookkeeper.password !== 'string' || bookkeeper.password.length < 8) {
    problems.add('bookkeeper.password', MESSAGES.password);
  }
  let reminderHour = 9;
  if (bookkeeper.reminder_hour !== undefined) {
    if (
      !isInteger(bookkeeper.reminder_hour) ||
      bookkeeper.reminder_hour < 6 ||
      bookkeeper.reminder_hour > 21
    ) {
      problems.add('bookkeeper.reminder_hour', MESSAGES.reminder_hour);
    } else {
      reminderHour = bookkeeper.reminder_hour;
    }
  }

  let nowMs: number | null = null;
  if (body.now !== undefined && body.now !== null) {
    if (typeof body.now !== 'string' || !isInstantString(body.now)) {
      problems.add('now', MESSAGES.now);
    } else {
      nowMs = Date.parse(body.now);
    }
  }

  let states: SeedStateInput[];
  if (body.states === undefined) {
    states = catalogueStates();
  } else if (!Array.isArray(body.states)) {
    problems.add('states', 'Send an array of states.');
    states = [];
  } else {
    states = body.states.map((raw, index) => {
      const record = asRecord(raw);
      const path = `states[${index}]`;
      if (!isNonEmptyString(record.code)) problems.add(`${path}.code`, MESSAGES.state_missing);
      if (!isNonEmptyString(record.name)) problems.add(`${path}.name`, MESSAGES.name);
      if (typeof record.zone !== 'string' || !isValidZone(record.zone)) {
        problems.add(`${path}.zone`, 'Send an IANA time zone.');
      }
      const holidays: string[] = [];
      if (record.holidays !== undefined) {
        if (!Array.isArray(record.holidays)) {
          problems.add(`${path}.holidays`, MESSAGES.holidays);
        } else {
          for (const day of record.holidays) {
            if (typeof day !== 'string' || !isDateString(day)) {
              problems.add(`${path}.holidays`, MESSAGES.holidays);
            } else {
              holidays.push(day);
            }
          }
        }
      }
      const editionsRaw = record.editions;
      const editions: Edition[] = [];
      if (!Array.isArray(editionsRaw) || editionsRaw.length === 0) {
        problems.add(`${path}.editions`, 'Send at least one rule edition.');
      } else {
        editionsRaw.forEach((edition, editionIndex) => {
          editions.push(readEdition(edition, `${path}.editions[${editionIndex}]`, problems));
        });
      }
      editions.sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1));
      return {
        code: record.code as string,
        name: record.name as string,
        zone: record.zone as string,
        holidays: [...new Set(holidays)].sort(),
        editions,
      };
    });
  }

  const clients: FixtureClient[] = [];
  if (body.clients !== undefined) {
    if (!Array.isArray(body.clients)) {
      problems.add('clients', 'Send an array of clients.');
    } else {
      body.clients.forEach((raw, index) => {
        const record = asRecord(raw);
        const path = `clients[${index}]`;
        if (!isNonEmptyString(record.key)) problems.add(`${path}.key`, 'Send a key.');
        if (!isNonEmptyString(record.name)) problems.add(`${path}.name`, MESSAGES.name);
        const owner = asRecord(record.owner);
        if (!isNonEmptyString(owner.display_name)) {
          problems.add(`${path}.owner.display_name`, MESSAGES.display_name_owner);
        }
        if (!isEmail(owner.email)) problems.add(`${path}.owner.email`, MESSAGES.email_invalid);
        if (typeof owner.password !== 'string' || owner.password.length < 8) {
          problems.add(`${path}.owner.password`, MESSAGES.password);
        }
        const registrations: FixtureRegistration[] = [];
        if (record.registrations !== undefined) {
          if (!Array.isArray(record.registrations)) {
            problems.add(`${path}.registrations`, 'Send an array of registrations.');
          } else {
            record.registrations.forEach((rawRegistration, registrationIndex) => {
              const registration = asRecord(rawRegistration);
              const registrationPath = `${path}.registrations[${registrationIndex}]`;
              if (!isNonEmptyString(registration.key)) {
                problems.add(`${registrationPath}.key`, 'Send a key.');
              }
              const stateCode = registration.state;
              if (
                typeof stateCode !== 'string' ||
                !states.some((state) => state.code === stateCode)
              ) {
                problems.add(`${registrationPath}.state`, MESSAGES.state_missing);
              }
              if (!isFrequency(registration.frequency)) {
                problems.add(`${registrationPath}.frequency`, MESSAGES.frequency);
              }
              const firstPeriod = registration.first_period;
              const frequency = registration.frequency;
              if (
                typeof firstPeriod !== 'string' ||
                !isFrequency(frequency) ||
                !matchesFrequency(firstPeriod, frequency)
              ) {
                problems.add(`${registrationPath}.first_period`, MESSAGES.first_period);
              }
              const periods =
                typeof firstPeriod === 'string' && isFrequency(frequency)
                  ? generatePeriods(firstPeriod, frequency)
                  : [];
              const seeded: FixtureReturn[] = [];
              if (registration.returns !== undefined) {
                if (!Array.isArray(registration.returns)) {
                  problems.add(`${registrationPath}.returns`, 'Send an array of returns.');
                } else {
                  registration.returns.forEach((rawReturn, returnIndex) => {
                    const seededReturn = asRecord(rawReturn);
                    const returnPath = `${registrationPath}.returns[${returnIndex}]`;
                    const period = seededReturn.period;
                    if (typeof period !== 'string' || !periods.includes(period)) {
                      problems.add(`${returnPath}.period`, 'Send one of the generated periods.');
                    }
                    let status: ReturnStatus = 'not_started';
                    if (seededReturn.status !== undefined) {
                      if (!SEEDABLE.includes(seededReturn.status as ReturnStatus)) {
                        problems.add(`${returnPath}.status`, 'Send a seedable status.');
                      } else {
                        status = seededReturn.status as ReturnStatus;
                      }
                    }
                    const fallback = status === 'not_started' ? null : '0.00';
                    let gross = fallback;
                    let tax = fallback;
                    if (seededReturn.gross_sales !== undefined) {
                      if (!isAmount(seededReturn.gross_sales)) {
                        problems.add(`${returnPath}.gross_sales`, MESSAGES.amount);
                      } else {
                        gross = seededReturn.gross_sales;
                      }
                    }
                    if (seededReturn.tax_due !== undefined) {
                      if (!isAmount(seededReturn.tax_due)) {
                        problems.add(`${returnPath}.tax_due`, MESSAGES.amount);
                      } else {
                        tax = seededReturn.tax_due;
                      }
                    }
                    seeded.push({
                      period: period as string,
                      status,
                      gross_sales: gross,
                      tax_due: tax,
                    });
                  });
                }
              }
              registrations.push({
                key: registration.key as string,
                state: stateCode as string,
                frequency: frequency as Frequency,
                first_period: firstPeriod as string,
                returns: seeded,
              });
            });
          }
        }
        clients.push({
          key: record.key as string,
          name: record.name as string,
          owner: {
            display_name: owner.display_name as string,
            email: owner.email as string,
            password: owner.password as string,
          },
          registrations,
        });
      });
    }
  }
  problems.throwIfAny();
  return {
    bookkeeper: {
      display_name: bookkeeper.display_name as string,
      email: bookkeeper.email as string,
      password: bookkeeper.password as string,
      reminder_hour: reminderHour,
    },
    nowMs,
    states,
    clients,
  };
}

async function assertEmailsFree(input: FixtureInput): Promise<void> {
  const problems = new FixtureErrors();
  const seen = new Map<string, string>();
  const check = async (email: string, path: string): Promise<void> => {
    const lower = email.toLowerCase();
    if (seen.has(lower)) {
      problems.add(path, MESSAGES.email_taken);
      return;
    }
    seen.set(lower, path);
    const taken = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    if (taken) problems.add(path, MESSAGES.email_taken);
  };
  await check(input.bookkeeper.email, 'bookkeeper.email');
  for (const [index, client] of input.clients.entries()) {
    await check(client.owner.email, `clients[${index}].owner.email`);
  }
  problems.throwIfAny();
}

async function seedHistory(
  tx: Tx,
  returnId: string,
  seeded: FixtureReturn,
  ownerName: string,
  nowMs: number,
): Promise<void> {
  if (seeded.status === 'client_approved' || seeded.status === 'filed' || seeded.status === 'packeted') {
    await tx.query(
      `INSERT INTO approvals (id, return_id, action, by_name, at_ms, reason)
       VALUES ($1,$2,'approved',$3,$4,NULL)`,
      [newId(), returnId, ownerName, nowMs],
    );
  }
}

export async function postFixture(ctx: Ctx): Promise<void> {
  requireGradingKey(ctx);
  const input = readFixture(bodyRecord(ctx));
  await assertEmailsFree(input);

  const built = await transaction(async (tx) => {
    const practiceId = await createPractice(input.bookkeeper.reminder_hour, tx);
    if (input.nowMs !== null) {
      await tx.query('UPDATE practices SET clock_now_ms = $2 WHERE id = $1', [
        practiceId,
        input.nowMs,
      ]);
    }
    const nowMs = input.nowMs ?? Date.now();
    const bookkeeperId = newId();
    await tx.query(
      `INSERT INTO users (id, practice_id, display_name, email, password_hash, role, client_id, created_ms)
       VALUES ($1,$2,$3,$4,$5,'bookkeeper',NULL,$6)`,
      [
        bookkeeperId,
        practiceId,
        input.bookkeeper.display_name,
        input.bookkeeper.email,
        await hashPassword(input.bookkeeper.password),
        Date.now(),
      ],
    );
    await insertStates(practiceId, input.states, tx);
    const session = await createSession(bookkeeperId, tx);
    const states = await loadStates(practiceId, tx);

    const clients: Record<string, unknown> = {};
    const needRender: string[] = [];
    for (const client of input.clients) {
      const ownerId = newId();
      const clientId = newId();
      await tx.query(
        `INSERT INTO users (id, practice_id, display_name, email, password_hash, role, client_id, created_ms)
         VALUES ($1,$2,$3,$4,$5,'owner',$6,$7)`,
        [
          ownerId,
          practiceId,
          client.owner.display_name,
          client.owner.email,
          await hashPassword(client.owner.password),
          clientId,
          Date.now(),
        ],
      );
      await tx.query(
        'INSERT INTO clients (id, practice_id, name, owner_user_id, created_ms) VALUES ($1,$2,$3,$4,$5)',
        [clientId, practiceId, client.name, ownerId, Date.now()],
      );
      const ownerSession = await createSession(ownerId, tx);
      const registrations: Record<string, unknown> = {};
      for (const registration of client.registrations) {
        const state = states.find((candidate) => candidate.code === registration.state);
        if (!state) throw errors.notFound();
        const registrationId = newId();
        await tx.query(
          `INSERT INTO registrations (id, practice_id, client_id, state_id, frequency, first_period, created_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            registrationId,
            practiceId,
            clientId,
            state.id,
            registration.frequency,
            registration.first_period,
            Date.now(),
          ],
        );
        const ids = await createReturnsForRegistration(tx, {
          practiceId,
          clientId,
          registrationId,
          state,
          frequency: registration.frequency,
          firstPeriod: registration.first_period,
          reminderHour: input.bookkeeper.reminder_hour,
          changedBy: input.bookkeeper.display_name,
        });
        const periods = generatePeriods(registration.first_period, registration.frequency);
        const byPeriod: Record<string, string> = {};
        periods.forEach((period, index) => {
          byPeriod[period] = ids[index];
        });
        for (const seeded of registration.returns) {
          const returnId = byPeriod[seeded.period];
          const status = seeded.status === 'packeted' ? 'filed' : seeded.status;
          const awaiting = seeded.status === 'prepared';
          const filedAt =
            seeded.status === 'filed' || seeded.status === 'packeted' ? nowMs : null;
          const target = seeded.status === 'filed' || seeded.status === 'packeted' ? 1 : 0;
          await tx.query(
            `UPDATE returns SET status = $2, gross_sales = $3, tax_due = $4,
                    awaiting_approval = $5, filed_at_ms = $6, packet_target_revision = $7
               WHERE id = $1`,
            [
              returnId,
              status,
              seeded.gross_sales,
              seeded.tax_due,
              awaiting,
              filedAt,
              target,
            ],
          );
          await seedHistory(tx, returnId, seeded, client.owner.display_name, nowMs);
          const dueDate = await tx.queryOne<{ due_date: string }>(
            'SELECT due_date::text AS due_date FROM returns WHERE id = $1',
            [returnId],
          );
          if (dueDate) {
            await syncReminders(
              tx,
              returnId,
              status as ReturnStatus,
              dueDate.due_date,
              input.bookkeeper.reminder_hour,
            );
          }
          if (seeded.status === 'packeted') needRender.push(returnId);
        }
        registrations[registration.key] = { id: registrationId, returns: byPeriod };
      }
      clients[client.key] = { id: clientId, owner_session: ownerSession, registrations };
    }
    return { practiceId, session, clients, needRender };
  });

  // A seeded packeted return renders before the answer, and every fixture
  // return starts at version 1 whatever its status.
  if (built.needRender.length > 0) await attemptRenders(built.practiceId);
  await query('UPDATE returns SET version = 1 WHERE practice_id = $1', [built.practiceId]);
  await attemptDueReminders(built.practiceId);

  sendJson(ctx.res, 201, {
    practice_id: built.practiceId,
    session: built.session,
    clients: built.clients,
  });
}

export async function postClock(ctx: Ctx): Promise<void> {
  requireGradingKey(ctx);
  const body = bodyRecord(ctx);
  const practiceId = typeof body.practice_id === 'string' ? body.practice_id : '';
  const practice = practiceId ? await getPractice(practiceId) : null;
  if (!practice) throw errors.notFound();
  if (typeof body.now !== 'string' || !isInstantString(body.now)) {
    throw errors.validation({ now: MESSAGES.now });
  }
  const before = practiceNow(practice);
  const nowMs = Date.parse(body.now);
  await query('UPDATE practices SET clock_now_ms = $2 WHERE id = $1', [practiceId, nowMs]);
  await announceNewlyOverdue(practiceId, before, nowMs);
  await attemptDueReminders(practiceId);
  publish(practiceId, { lines: [] });
  sendJson(ctx.res, 200, { now: toInstantString(nowMs) });
}
