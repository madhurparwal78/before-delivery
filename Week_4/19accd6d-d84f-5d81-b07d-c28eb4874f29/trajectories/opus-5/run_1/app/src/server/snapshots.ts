import { randomBytes } from 'node:crypto';
import { pool } from './db.js';
import type { RecipeStep } from '../shared/recipe.js';
import {
  StorageDown,
  getObject,
  putObject,
  sha256Hex,
  snapshotInputKey,
  snapshotOutputKey,
} from './storage.js';

export type SnapshotStatus = 'pending' | 'active' | 'expired' | 'revoked';

export interface SnapshotRow {
  token: string;
  owner_id: string;
  recipe_name: string;
  recipe_id: string | null;
  recipe_version: number | null;
  steps: RecipeStep[];
  input_bytes: number;
  output_bytes: number;
  input_sha: string;
  output_sha: string;
  status: string;
  created_at: Date;
  expires_at: Date;
}

export interface SnapshotBody {
  token: string;
  status: SnapshotStatus;
  createdAt: string;
  expiresAt: string;
  recipe: { name: string; version: number | null; steps: RecipeStep[] } | null;
  inputBytes: number;
  outputBytes: number;
  url: string;
}

/** The single place that decides a snapshot's status, always from the server clock. */
export function snapshotStatus(row: SnapshotRow, now = new Date()): SnapshotStatus {
  if (row.status === 'revoked') return 'revoked';
  if (now.getTime() >= row.expires_at.getTime()) return 'expired';
  return row.status === 'active' ? 'active' : 'pending';
}

export function snapshotBody(row: SnapshotRow, now = new Date()): SnapshotBody {
  const status = snapshotStatus(row, now);
  const hidden = status === 'expired' || status === 'revoked';
  return {
    token: row.token,
    status,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    recipe: hidden
      ? null
      : { name: row.recipe_name, version: row.recipe_version, steps: row.steps },
    inputBytes: row.input_bytes,
    outputBytes: row.output_bytes,
    url: `/s/${row.token}`,
  };
}

export async function findSnapshot(token: string): Promise<SnapshotRow | null> {
  const result = await pool.query<SnapshotRow>('select * from snapshots where token = $1', [token]);
  return result.rows[0] ?? null;
}

export interface NewSnapshot {
  ownerId: string;
  recipeName: string;
  recipeId: string | null;
  recipeVersion: number | null;
  steps: RecipeStep[];
  input: Uint8Array;
  output: Uint8Array;
  createdAt: Date;
  expiresAt: Date;
}

export async function createSnapshot(draft: NewSnapshot): Promise<SnapshotRow> {
  const token = randomBytes(16).toString('hex');
  await pool.query(
    `insert into snapshots (token, owner_id, recipe_name, recipe_id, recipe_version, steps, input_bytes,
       output_bytes, input_sha, output_sha, pending_input, pending_output, status, created_at, expires_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,'pending',$13,$14)`,
    [
      token,
      draft.ownerId,
      draft.recipeName,
      draft.recipeId,
      draft.recipeVersion,
      JSON.stringify(draft.steps),
      draft.input.length,
      draft.output.length,
      sha256Hex(draft.input),
      sha256Hex(draft.output),
      Buffer.from(draft.input),
      Buffer.from(draft.output),
      draft.createdAt,
      draft.expiresAt,
    ],
  );
  await confirmSnapshot(token);
  return (await findSnapshot(token))!;
}

/** Writes a pending snapshot's objects and reads them back before marking it active. */
export async function confirmSnapshot(token: string): Promise<boolean> {
  const result = await pool.query<{
    pending_input: Buffer | null;
    pending_output: Buffer | null;
    input_sha: string;
    output_sha: string;
    input_bytes: number;
    output_bytes: number;
  }>(
    `select pending_input, pending_output, input_sha, output_sha, input_bytes, output_bytes
     from snapshots where token = $1 and status = 'pending'`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined || row.pending_input === null || row.pending_output === null) return false;
  try {
    await putObject(snapshotInputKey(token), new Uint8Array(row.pending_input));
    await putObject(snapshotOutputKey(token), new Uint8Array(row.pending_output));
    const storedInput = await getObject(snapshotInputKey(token));
    const storedOutput = await getObject(snapshotOutputKey(token));
    if (storedInput === null || storedOutput === null) return false;
    if (
      storedInput.length !== row.input_bytes ||
      storedOutput.length !== row.output_bytes ||
      sha256Hex(storedInput) !== row.input_sha ||
      sha256Hex(storedOutput) !== row.output_sha
    ) {
      return false;
    }
  } catch (cause) {
    if (cause instanceof StorageDown) return false;
    throw cause;
  }
  await pool.query(
    "update snapshots set status = 'active', pending_input = null, pending_output = null where token = $1",
    [token],
  );
  return true;
}

/** Keeps trying pending snapshots every five seconds, so they become active when storage returns. */
export function startSnapshotConfirmation(): void {
  const tick = async (): Promise<void> => {
    const pending = await pool.query<{ token: string }>(
      "select token from snapshots where status = 'pending' and expires_at > now()",
    );
    for (const row of pending.rows) await confirmSnapshot(row.token);
  };
  setInterval(() => {
    void tick().catch(() => undefined);
  }, 5000).unref();
}
