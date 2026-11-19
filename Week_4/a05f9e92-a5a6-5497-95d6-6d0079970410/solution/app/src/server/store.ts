import { query, type Tx } from "./db.js";

export type Workspace = "live" | "test";

export interface ConfigRow<T> {
  id: number;
  name: string;
  content: T;
  promoted: T | null;
}

export async function configList<T>(kind: string, workspace: Workspace = "live", tx?: Tx): Promise<ConfigRow<T>[]> {
  const run = tx ? tx.query.bind(tx) : query;
  const rows = await run("SELECT id, name, content, promoted FROM config_items WHERE workspace = $1 AND kind = $2 ORDER BY id", [workspace, kind]);
  return rows.map((r) => ({ id: r.id as number, name: r.name as string, content: r.content as T, promoted: (r.promoted as T | null) ?? null }));
}

export async function configGet<T>(kind: string, name: string, workspace: Workspace = "live", tx?: Tx): Promise<ConfigRow<T> | undefined> {
  const run = tx ? tx.query.bind(tx) : query;
  const rows = await run("SELECT id, name, content, promoted FROM config_items WHERE workspace = $1 AND kind = $2 AND name = $3", [workspace, kind, name]);
  const r = rows[0];
  return r ? { id: r.id as number, name: r.name as string, content: r.content as T, promoted: (r.promoted as T | null) ?? null } : undefined;
}

export async function configPut(tx: Tx, workspace: Workspace, kind: string, name: string, content: unknown, promoted?: unknown): Promise<number> {
  const rows = await tx.query<{ id: number }>(
    `INSERT INTO config_items (workspace, kind, name, content, promoted) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace, kind, name) DO UPDATE SET content = EXCLUDED.content, promoted = COALESCE($5, config_items.promoted) RETURNING id`,
    [workspace, kind, name, JSON.stringify(content), promoted === undefined ? null : JSON.stringify(promoted)],
  );
  return rows[0]!.id;
}

export async function configDelete(tx: Tx, workspace: Workspace, kind: string, name: string): Promise<void> {
  await tx.query("DELETE FROM config_items WHERE workspace = $1 AND kind = $2 AND name = $3", [workspace, kind, name]);
}
