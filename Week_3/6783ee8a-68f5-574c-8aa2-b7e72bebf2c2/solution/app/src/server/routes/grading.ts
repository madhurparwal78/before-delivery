import type { PoolClient } from "pg";
import type { Output, ShareRole } from "../../shared/api";
import { settings } from "../config";
import { query } from "../db";
import { notFound, validationFailed } from "../errors";
import { Problems, defineRoute, reply } from "../http";
import { exportDocument, insertCell, newCellId } from "../notebooks";
import type { ExportDocument, NewCell } from "../notebooks";
import { syncNotebook } from "../search";
import { hashToken, newId, newToken, openSession } from "../session";
import { CELL_TYPE_MESSAGE } from "../notebook-format";
import { isObject } from "../validate";
import { createUser } from "./auth";
import { storeCheckpoint } from "./checkpoints";

interface SeedUser {
  key: string;
  email: string;
  display_name: string;
  password: string;
}

interface SeedCell {
  id?: string;
  cell_type: "code" | "markdown";
  source: string;
  outputs?: Output[];
  execution_count?: number | null;
}

interface SeedNotebook {
  key: string;
  owner: string;
  title: string;
  cells: SeedCell[];
  execution_counter?: number;
  shares?: { user: string; role: ShareRole }[];
  checkpoints?: { label: string; cells: SeedCell[] }[];
}

interface SeedBody {
  users: SeedUser[];
  notebooks: SeedNotebook[];
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function readSeed(body: unknown): SeedBody {
  const problems = new Problems();
  const root = isObject(body) ? body : {};
  const users = asList(root.users).map((raw, i) => {
    const u = isObject(raw) ? raw : {};
    for (const key of ["key", "email", "display_name", "password"]) if (typeof u[key] !== "string") problems.add(`users[${i}].${key}`, "is required");
    return u as unknown as SeedUser;
  });
  const keys = new Set(users.map((u) => u.key));
  const notebooks = asList(root.notebooks).map((raw, i) => {
    const n = isObject(raw) ? raw : {};
    for (const key of ["key", "owner", "title"]) if (typeof n[key] !== "string") problems.add(`notebooks[${i}].${key}`, "is required");
    if (typeof n.owner === "string" && !keys.has(n.owner)) problems.add(`notebooks[${i}].owner`, "must name a seeded user");
    asList(n.cells).forEach((cell, c) => {
      if (!isObject(cell) || (cell.cell_type !== "code" && cell.cell_type !== "markdown")) problems.add(`notebooks[${i}].cells[${c}].cell_type`, CELL_TYPE_MESSAGE);
    });
    asList(n.shares).forEach((share, s) => {
      if (!isObject(share) || typeof share.user !== "string" || !keys.has(share.user)) problems.add(`notebooks[${i}].shares[${s}].user`, "must name a seeded user");
    });
    return n as unknown as SeedNotebook;
  });
  problems.done();
  return { users, notebooks };
}

const toNewCell = (cell: SeedCell): NewCell => ({
  id: cell.id ?? newCellId(),
  cell_type: cell.cell_type,
  source: cell.source,
  outputs: cell.outputs,
  execution_count: cell.execution_count,
});

function snapshotOf(cells: NewCell[]): ExportDocument {
  return exportDocument(
    cells.map((cell, position) => ({
      id: cell.id as string,
      position,
      cell_type: cell.cell_type,
      source: cell.source,
      revision: 1,
      execution_count: cell.cell_type === "code" ? (cell.execution_count ?? null) : null,
      run_state: "idle",
      outputs: cell.cell_type === "code" ? (cell.outputs ?? []) : [],
      outputs_version: 0,
      metadata: {},
      locked_by: null,
    })),
  );
}

interface Made {
  users: Record<string, { id: string; cookie: string }>;
  notebooks: Record<string, { id: string; cell_ids: string[]; checkpoint_ids: string[] }>;
}

/** Creates users, notebooks, cells, shares and checkpoints in one call. */
async function seedWorld(db: PoolClient, seed: SeedBody): Promise<Made> {
  const made: Made = { users: {}, notebooks: {} };
  for (const [i, user] of seed.users.entries()) {
    if ((await query(db, "SELECT 1 FROM users WHERE lower(email) = lower($1)", [user.email])).length) {
      throw validationFailed([{ path: `users[${i}].email`, message: "is already registered" }]);
    }
    const created = await createUser(db, { email: user.email, display_name: user.display_name, password: user.password, verified: true });
    made.users[user.key] = { id: created.id, cookie: `bp_session=${await openSession(db, created.id)}` };
  }
  for (const nb of seed.notebooks) {
    const id = newId("nb");
    const cells = (nb.cells.length ? nb.cells : [{ cell_type: "code" as const, source: "" }]).map(toNewCell);
    const counter = nb.execution_counter ?? Math.max(0, ...cells.map((cell) => cell.execution_count ?? 0));
    await db.query("INSERT INTO notebooks (id, owner_id, title, execution_counter) VALUES ($1, $2, $3, $4)", [id, (made.users[nb.owner] as { id: string }).id, nb.title, counter]);
    for (const [position, cell] of cells.entries()) await insertCell(db, id, position, cell);
    for (const share of nb.shares ?? []) {
      const user = await query<{ email: string }>(db, "SELECT email FROM users WHERE id = $1", [(made.users[share.user] as { id: string }).id]);
      await db.query("INSERT INTO shares (id, notebook_id, email, user_id, role, status, token_hash) VALUES ($1, $2, $3, $4, $5, 'active', $6)", [
        newId("sh"),
        id,
        (user[0] as { email: string }).email,
        (made.users[share.user] as { id: string }).id,
        share.role,
        hashToken(newToken()),
      ]);
    }
    const checkpointIds: string[] = [];
    for (const checkpoint of nb.checkpoints ?? []) {
      checkpointIds.push((await storeCheckpoint(db, id, checkpoint.label, snapshotOf(checkpoint.cells.map(toNewCell)))).id);
    }
    await syncNotebook(db, id);
    made.notebooks[nb.key] = { id, cell_ids: cells.map((cell) => cell.id as string), checkpoint_ids: checkpointIds };
  }
  return made;
}

export const seed = defineRoute<undefined, SeedBody>({
  method: "POST",
  path: "/api/grading/seed",
  access: "public",
  resolve: async () => {
    if (!settings.grading) throw notFound();
    return undefined;
  },
  body: "json",
  validate: (body) => readSeed(body),
  run: async (ctx, _resource, body) => {
    const made = await seedWorld(await ctx.transaction(), body);
    return reply(201, made);
  },
});
