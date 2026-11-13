// What several modules each add to the one boot sequence: schema statements, start steps (deadlines to schedule again) and seed steps.
import type { Queryable } from './db.ts';

// ---------------------------------------------------------------- schema and startup

const schemaParts: string[] = [];
const startSteps: Array<() => Promise<void>> = [];

/** Adds idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements, applied at every start after the core tables. */
export function registerSchemaPart(sql: string): void {
  schemaParts.push(sql);
}

/** Runs once after the schema is applied and before the server listens (for example, to schedule open deadlines again). */
export function registerStartStep(step: () => Promise<void>): void {
  startSteps.push(step);
}

export async function applyExtraSchema(q: Queryable): Promise<void> {
  for (const sql of schemaParts) await q.query(sql);
}

export async function runStartSteps(): Promise<void> {
  for (const step of startSteps) await step();
}

// ---------------------------------------------------------------- grading seed

/** One seeded drawing, handed to the seed steps right after its state exists (xrefs already attached). */
export interface SeededDrawing {
  key: string;
  id: string;
  folderId: string;
  name: string;
  /** the `sheets` array of the drawing's seed record, exactly as sent */
  sheets: unknown;
}

/** The parts of the seed response only the sheet side fills in. */
export interface SeedOutput {
  sheets: Record<string, string>;
  versions: Record<string, string>;
  issues: Record<string, string>;
  rfis: Record<string, string>;
  links: Record<string, string>;
}

export type SeedStep = (drawing: SeededDrawing, output: SeedOutput) => Promise<void>;
const seedSteps: SeedStep[] = [];

/** Called for each seeded drawing, sources of xrefs first, once users, folders and the drawing exist. */
export function registerSeedStep(step: SeedStep): void {
  seedSteps.push(step);
}

export async function runSeedSteps(drawing: SeededDrawing, output: SeedOutput): Promise<void> {
  for (const step of seedSteps) await step(drawing, output);
}
