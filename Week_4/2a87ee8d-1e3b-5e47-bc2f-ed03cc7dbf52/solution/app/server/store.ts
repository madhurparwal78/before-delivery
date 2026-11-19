import type { Db } from "./db.js";
import { fail } from "./errors.js";
import type { Status } from "../shared/states.js";
import type { Template } from "../shared/templates.js";

export interface WorkshopRow {
  id: string;
  facilitator_id: string;
  title: string;
  template: Template;
  status: Status;
  scheduled_start: string;
  scheduled_end: string;
  start_at: Date;
  end_at: Date;
  sponsor_email: string;
  fee_cents: number;
  round_number: number;
  round_ends_at: Date | null;
  dot_budget: number | null;
  voting_ends_at: Date | null;
  version: number;
  time_zone: string;
  facilitator_name: string;
}

const SELECT = `SELECT w.*, f.time_zone, f.name AS facilitator_name FROM workshops w JOIN facilitators f ON f.id = w.facilitator_id`;

export async function findWorkshop(t: Db, id: string): Promise<WorkshopRow | undefined> {
  return t.one<WorkshopRow>(`${SELECT} WHERE w.id = $1`, [id]);
}

/** Locks the workshop row; every board write, reveal and transition serialises on it. */
export async function lockWorkshop(t: Db, id: string): Promise<WorkshopRow> {
  const row = await t.one<WorkshopRow>(`${SELECT} WHERE w.id = $1 FOR UPDATE OF w`, [id]);
  if (!row) fail("not_found");
  return row;
}

/** The workshop a frame, note, cluster, connector or trash item belongs to. */
export async function workshopOf(t: Db, kind: "frame" | "note" | "cluster" | "connector" | "trash", id: string): Promise<string | undefined> {
  const table = { frame: "frames", note: "notes", cluster: "clusters", connector: "connectors", trash: "trash_items" }[kind];
  const row = await t.one<{ workshop_id: string }>(`SELECT workshop_id FROM ${table} WHERE id = $1`, [id]);
  return row?.workshop_id;
}
