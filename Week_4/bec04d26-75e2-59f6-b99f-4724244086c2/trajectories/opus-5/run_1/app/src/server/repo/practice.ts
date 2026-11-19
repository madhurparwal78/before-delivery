import { Carry, ClientRecord, Edition, Frequency, StateRecord } from '../../shared/types';
import { newId } from '../auth';
import { query, queryOne, Tx } from '../db';
import { CATALOGUE, CATALOGUE_EDITION_DATE } from '../domain/catalogue';
import { zoneLabel } from '../domain/zones';

export interface PracticeRow {
  id: string;
  reminder_hour: number;
  clock_now_ms: string | null;
}

export interface StateRow {
  id: string;
  practice_id: string;
  code: string;
  name: string;
  zone: string;
}

export interface LoadedState extends StateRow {
  holidays: string[];
  editions: Edition[];
}

export async function getPractice(practiceId: string): Promise<PracticeRow | null> {
  return queryOne<PracticeRow>(
    'SELECT id, reminder_hour, clock_now_ms FROM practices WHERE id = $1',
    [practiceId],
  );
}

/** The practice clock: its frozen instant, or real time when it was never set. */
export function practiceNow(practice: PracticeRow): number {
  return practice.clock_now_ms === null ? Date.now() : Number(practice.clock_now_ms);
}

export async function createPractice(reminderHour: number, tx: Tx): Promise<string> {
  const id = newId();
  await tx.query(
    'INSERT INTO practices (id, reminder_hour, clock_now_ms, created_ms) VALUES ($1,$2,NULL,$3)',
    [id, reminderHour, Date.now()],
  );
  return id;
}

export interface SeedStateInput {
  code: string;
  name: string;
  zone: string;
  holidays: string[];
  editions: Edition[];
}

export function catalogueStates(): SeedStateInput[] {
  return CATALOGUE.map((state) => ({
    code: state.code,
    name: state.name,
    zone: state.zone,
    holidays: [...state.holidays],
    editions: [
      {
        effective_date: CATALOGUE_EDITION_DATE,
        due_day: state.dueDay,
        carry: state.carry,
        rate: state.rate,
        extension_days: state.extensionDays,
      },
    ],
  }));
}

export async function insertStates(
  practiceId: string,
  states: readonly SeedStateInput[],
  tx: Tx,
): Promise<void> {
  for (const state of states) {
    const stateId = newId();
    await tx.query('INSERT INTO states (id, practice_id, code, name, zone) VALUES ($1,$2,$3,$4,$5)', [
      stateId,
      practiceId,
      state.code,
      state.name,
      state.zone,
    ]);
    for (const day of state.holidays) {
      await tx.query(
        'INSERT INTO state_holidays (state_id, day) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [stateId, day],
      );
    }
    for (const edition of state.editions) {
      await tx.query(
        `INSERT INTO state_editions (id, state_id, effective_date, due_day, carry, rate, extension_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          newId(),
          stateId,
          edition.effective_date,
          edition.due_day,
          edition.carry,
          edition.rate,
          edition.extension_days,
        ],
      );
    }
  }
}

interface EditionRow {
  state_id: string;
  effective_date: string;
  due_day: number;
  carry: Carry;
  rate: string;
  extension_days: number;
}

export async function loadStates(practiceId: string, tx?: Tx): Promise<LoadedState[]> {
  const run = tx ? tx.query.bind(tx) : query;
  const states = await run<StateRow>(
    'SELECT id, practice_id, code, name, zone FROM states WHERE practice_id = $1 ORDER BY code',
    [practiceId],
  );
  if (states.length === 0) return [];
  const ids = states.map((s) => s.id);
  const holidays = await run<{ state_id: string; day: string }>(
    'SELECT state_id, day::text AS day FROM state_holidays WHERE state_id = ANY($1) ORDER BY day',
    [ids],
  );
  const editions = await run<EditionRow>(
    `SELECT state_id, effective_date::text AS effective_date, due_day, carry, rate::text AS rate, extension_days
       FROM state_editions WHERE state_id = ANY($1) ORDER BY effective_date`,
    [ids],
  );
  return states.map((state) => ({
    ...state,
    holidays: holidays.filter((h) => h.state_id === state.id).map((h) => h.day),
    editions: editions
      .filter((e) => e.state_id === state.id)
      .map((e) => ({
        effective_date: e.effective_date,
        due_day: e.due_day,
        carry: e.carry,
        rate: e.rate,
        extension_days: e.extension_days,
      })),
  }));
}

export async function loadState(
  practiceId: string,
  code: string,
  tx?: Tx,
): Promise<LoadedState | null> {
  const states = await loadStates(practiceId, tx);
  return states.find((state) => state.code === code) ?? null;
}

export function presentState(state: LoadedState): StateRecord {
  return {
    code: state.code,
    name: state.name,
    zone: state.zone,
    zone_label: zoneLabel(state.zone),
    holidays: state.holidays,
    editions: state.editions,
  };
}

interface ClientRow {
  id: string;
  name: string;
  owner_id: string;
  owner_display_name: string;
  owner_email: string;
}

interface RegistrationRow {
  id: string;
  client_id: string;
  state_code: string;
  frequency: Frequency;
  first_period: string;
}

export async function loadClients(practiceId: string, tx?: Tx): Promise<ClientRecord[]> {
  const run = tx ? tx.query.bind(tx) : query;
  const clients = await run<ClientRow>(
    `SELECT c.id, c.name, u.id AS owner_id, u.display_name AS owner_display_name, u.email AS owner_email
       FROM clients c JOIN users u ON u.id = c.owner_user_id
      WHERE c.practice_id = $1 ORDER BY c.name`,
    [practiceId],
  );
  if (clients.length === 0) return [];
  const registrations = await run<RegistrationRow>(
    `SELECT r.id, r.client_id, s.code AS state_code, r.frequency, r.first_period
       FROM registrations r JOIN states s ON s.id = r.state_id
      WHERE r.practice_id = $1 ORDER BY s.code`,
    [practiceId],
  );
  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    owner: {
      id: client.owner_id,
      display_name: client.owner_display_name,
      email: client.owner_email,
    },
    registrations: registrations
      .filter((r) => r.client_id === client.id)
      .map((r) => ({
        id: r.id,
        state: r.state_code,
        frequency: r.frequency,
        first_period: r.first_period,
      })),
  }));
}
