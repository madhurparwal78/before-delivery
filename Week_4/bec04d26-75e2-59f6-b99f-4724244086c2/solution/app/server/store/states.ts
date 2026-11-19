import { type Db, query } from "../db";
import { zoneLabel } from "../domain/zone";
import type { Edition, StateInfo } from "../../shared/types";
import { CATALOGUE, CATALOGUE_EDITION_DATE } from "../seed";

interface StateRow { code: string; name: string; zone: string; holidays: string[] }
interface EditionRow { state_code: string; effective_date: string; due_day: number; carry: Edition["carry"]; rate: string; extension_days: number }

export async function getStates(db: Db, practiceId: string): Promise<StateInfo[]> {
  const states = await query<StateRow>(
    db, `SELECT code, name, zone, holidays::text[] AS holidays FROM states WHERE practice_id = $1 ORDER BY code COLLATE "C"`, [practiceId]);
  const editions = await query<EditionRow>(
    db, "SELECT * FROM editions WHERE practice_id = $1 ORDER BY effective_date", [practiceId]);
  return states.map((s) => ({
    code: s.code, name: s.name, zone: s.zone, zone_label: zoneLabel(s.zone), holidays: [...s.holidays].sort(),
    editions: editions.filter((e) => e.state_code === s.code).map(({ effective_date, due_day, carry, rate, extension_days }) =>
      ({ effective_date, due_day, carry, rate, extension_days })),
  }));
}

export async function insertEdition(db: Db, practiceId: string, code: string, edition: Edition): Promise<void> {
  await db.query(
    `INSERT INTO editions (practice_id, state_code, effective_date, due_day, carry, rate, extension_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [practiceId, code, edition.effective_date, edition.due_day, edition.carry, edition.rate, edition.extension_days]);
}

export async function insertState(db: Db, practiceId: string, state: {
  code: string; name: string; zone: string; holidays: string[]; editions: Edition[];
}): Promise<void> {
  await db.query("INSERT INTO states (practice_id, code, name, zone, holidays) VALUES ($1,$2,$3,$4,$5)",
    [practiceId, state.code, state.name, state.zone, [...new Set(state.holidays)].sort()]);
  for (const edition of state.editions) await insertEdition(db, practiceId, state.code, edition);
}

export async function insertCatalogue(db: Db, practiceId: string): Promise<void> {
  for (const s of CATALOGUE) {
    await insertState(db, practiceId, {
      code: s.code, name: s.name, zone: s.zone, holidays: s.holidays,
      editions: [{ effective_date: CATALOGUE_EDITION_DATE, due_day: s.dueDay, carry: s.carry, rate: s.rate,
        extension_days: s.extensionDays }],
    });
  }
}

export async function saveHolidays(db: Db, practiceId: string, code: string, holidays: string[]): Promise<void> {
  await db.query("UPDATE states SET holidays = $3 WHERE practice_id = $1 AND code = $2",
    [practiceId, code, [...new Set(holidays)].sort()]);
}
