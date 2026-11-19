import { randomUUID } from "node:crypto";
import { type Db, query } from "../db";
import { periodsFrom } from "../domain/schedule";
import type { Client, Frequency, Registration, StateInfo } from "../../shared/types";
import { insertReturn } from "./returns";

export async function insertClient(db: Db, practiceId: string, name: string): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO clients (id, practice_id, name) VALUES ($1, $2, $3)", [id, practiceId, name]);
  return id;
}

/** Registers a client in a state and creates the registration's first returns, each with its reminders. */
export async function registerInState(db: Db, input: {
  practiceId: string; clientId: string; state: StateInfo; frequency: Frequency; firstPeriod: string;
  reminderHour: number; changedBy: string;
}): Promise<{ registration: Registration; returnIds: Record<string, string> }> {
  const id = randomUUID();
  await db.query(
    "INSERT INTO registrations (id, practice_id, client_id, state_code, frequency, first_period) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, input.practiceId, input.clientId, input.state.code, input.frequency, input.firstPeriod]);
  const returnIds: Record<string, string> = {};
  for (const period of periodsFrom(input.frequency, input.firstPeriod)) {
    returnIds[period] = await insertReturn(db, {
      practiceId: input.practiceId, clientId: input.clientId, registrationId: id, state: input.state,
      frequency: input.frequency, period, reminderHour: input.reminderHour, changedBy: input.changedBy,
    });
  }
  return {
    registration: { id, state: input.state.code, frequency: input.frequency, first_period: input.firstPeriod },
    returnIds,
  };
}

export async function stateTaken(db: Db, clientId: string, code: string): Promise<boolean> {
  return (await query(db, "SELECT 1 FROM registrations WHERE client_id = $1 AND state_code = $2", [clientId, code])).length > 0;
}

export async function listClients(db: Db, practiceId: string): Promise<Client[]> {
  const clients = await query<{ id: string; name: string; owner_id: string; owner_name: string; owner_email: string }>(
    db, `SELECT c.id, c.name, u.id AS owner_id, u.display_name AS owner_name, u.email AS owner_email
         FROM clients c JOIN users u ON u.client_id = c.id AND u.role = 'owner'
         WHERE c.practice_id = $1 ORDER BY c.name, c.id`, [practiceId]);
  const registrations = await query<Registration & { client_id: string }>(
    db, `SELECT id, client_id, state_code AS state, frequency, first_period FROM registrations
         WHERE practice_id = $1 ORDER BY state_code`, [practiceId]);
  return clients.map((c) => ({
    id: c.id, name: c.name, owner: { id: c.owner_id, display_name: c.owner_name, email: c.owner_email },
    registrations: registrations.filter((r) => r.client_id === c.id)
      .map(({ id, state, frequency, first_period }) => ({ id, state, frequency, first_period })),
  }));
}
