// Repositories: the only code that touches SQL. Each maps a row to the API's
// shapes and back.

import type { Db } from "./db.js";
import { withClient } from "./db.js";
import type { AutomationContent, EdgeLink, StepNode, TriggerNode } from "./graph.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { newSessionToken, newToken, newUserId, newWorkspaceId, newAutomationId, newTableId, newImportId, newRunId } from "./ids.js";
import { realNow } from "./clock.js";

// Draft steps and edges are stored under version 0 (the PK column cannot
// hold NULL); the API's null version maps to 0 and back here.
const DRAFT_VERSION = 0;

export interface UserRow { id: string; email: string; name: string; password_hash: string; confirmed: boolean }
export interface WorkspaceRow { id: string; name: string; slug: string; clock_offset_seconds: number }
export interface MemberRow { workspace_id: string; user_id: string; role: string; joined_at: Date }
export interface AutomationRow { id: string; workspace_id: string; name: string; trigger_kind: string; live_version: number | null; draft_revision: number }
export interface RunRow {
  id: string; workspace_id: string; automation_id: string; number: number; status: string; test: boolean;
  version: number | null; replay_of: string | null; owner_port: number; started_at: Date | null; finished_at: Date | null;
  trigger_output: unknown; message: string | null;
}
export interface RunStepRow {
  run_id: string; step_id: string; kind: string; name: string; col: number; row: number; status: string;
  reused: boolean; input: unknown; output: unknown; log: string[]; attempts: number;
  started_at: Date | null; finished_at: Date | null; due_at: Date | null; retry_at: Date | null; ord: number;
}
export interface TableRow2 { id: string; workspace_id: string; name: string; columns: { name: string; type: string }[]; seq: number }
export interface TimerRow { id: number; workspace_id: string; run_id: string | null; step_id: string | null; kind: string; due_at: Date; fired: boolean; payload: Record<string, unknown>; owner_port: number }

export const users = {
  async byEmail(db: Db, email: string): Promise<UserRow | null> {
    const r = await db.query("SELECT * FROM users WHERE email=$1", [email]);
    return (r.rows[0] as unknown as UserRow) ?? null;
  },
  async byId(db: Db, id: string): Promise<UserRow | null> {
    const r = await db.query("SELECT * FROM users WHERE id=$1", [id]);
    return (r.rows[0] as unknown as UserRow) ?? null;
  },
  async create(db: Db, email: string, name: string, password: string, confirmed: boolean): Promise<UserRow> {
    const id = newUserId();
    await db.query(
      "INSERT INTO users (id,email,name,password_hash,confirmed) VALUES ($1,$2,$3,$4,$5)",
      [id, email, name, hashPassword(password), confirmed]
    );
    return { id, email, name, password_hash: "", confirmed };
  },
  async setConfirmed(db: Db, id: string): Promise<void> {
    await db.query("UPDATE users SET confirmed=true WHERE id=$1", [id]);
  },
};

export const sessions = {
  async create(db: Db, userId: string): Promise<string> {
    const token = newSessionToken();
    await db.query("INSERT INTO sessions (token,user_id) VALUES ($1,$2)", [token, userId]);
    return token;
  },
  async userIdOf(db: Db, token: string): Promise<string | null> {
    const r = await db.query("SELECT user_id FROM sessions WHERE token=$1", [token]);
    return (r.rows[0]?.user_id as string) ?? null;
  },
  async delete(db: Db, token: string): Promise<void> {
    await db.query("DELETE FROM sessions WHERE token=$1", [token]);
  },
};

export const confirmTokens = {
  async create(db: Db, userId: string): Promise<string> {
    const token = newToken();
    await db.query("INSERT INTO confirm_tokens (user_id,token) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET token=$2", [userId, token]);
    return token;
  },
  async find(db: Db, token: string): Promise<string | null> {
    const r = await db.query("SELECT user_id FROM confirm_tokens WHERE token=$1", [token]);
    return (r.rows[0]?.user_id as string) ?? null;
  },
  async consume(db: Db, userId: string): Promise<void> {
    await db.query("DELETE FROM confirm_tokens WHERE user_id=$1", [userId]);
  },
};

export const workspaces = {
  async byId(db: Db, id: string): Promise<WorkspaceRow | null> {
    const r = await db.query("SELECT * FROM workspaces WHERE id=$1", [id]);
    return (r.rows[0] as unknown as WorkspaceRow) ?? null;
  },
  async bySlug(db: Db, slug: string): Promise<WorkspaceRow | null> {
    const r = await db.query("SELECT * FROM workspaces WHERE slug=$1", [slug]);
    return (r.rows[0] as unknown as WorkspaceRow) ?? null;
  },
  async create(db: Db, name: string, slug: string): Promise<WorkspaceRow> {
    const id = newWorkspaceId();
    await db.query("INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3)", [id, name, slug]);
    return { id, name, slug, clock_offset_seconds: 0 };
  },
  async memberRole(db: Db, wsId: string, userId: string): Promise<string | null> {
    const r = await db.query("SELECT role FROM members WHERE workspace_id=$1 AND user_id=$2", [wsId, userId]);
    return (r.rows[0]?.role as string) ?? null;
  },
  async members(db: Db, wsId: string): Promise<MemberRow[]> {
    const r = await db.query("SELECT * FROM members WHERE workspace_id=$1 ORDER BY joined_at", [wsId]);
    return r.rows as unknown as MemberRow[];
  },
  async addMember(db: Db, wsId: string, userId: string, role: string): Promise<void> {
    await db.query("INSERT INTO members (user_id,workspace_id,role,joined_at) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,user_id) DO NOTHING", [userId, wsId, role, realNow()]);
  },
  async listForUser(db: Db, userId: string): Promise<{ id: string; name: string; slug: string; role: string }[]> {
    const r = await db.query(
      "SELECT w.id, w.name, w.slug, m.role FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY m.joined_at, w.id",
      [userId]
    );
    return r.rows as unknown as { id: string; name: string; slug: string; role: string }[];
  },
};

export const invites = {
  async create(db: Db, wsId: string, email: string, role: string): Promise<{ id: string; token: string }> {
    const id = newImportId().replace("im-", "inv-");
    const token = newToken();
    await db.query(
      `INSERT INTO invites (id,workspace_id,email,role,token) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [id, wsId, email, role, token]
    );
    return { id, token };
  },
  async find(db: Db, token: string): Promise<{ id: string; workspace_id: string; email: string; role: string; used: boolean } | null> {
    const r = await db.query("SELECT * FROM invites WHERE token=$1", [token]);
    return (r.rows[0] as any) ?? null;
  },
  async byEmail(db: Db, wsId: string, email: string): Promise<{ id: string; email: string; role: string } | null> {
    const r = await db.query("SELECT id,email,role FROM invites WHERE workspace_id=$1 AND email=$2 AND used=false", [wsId, email]);
    return (r.rows[0] as any) ?? null;
  },
  async replaceForEmail(db: Db, wsId: string, email: string, role: string): Promise<{ id: string; token: string }> {
    await db.query("UPDATE invites SET used=true WHERE workspace_id=$1 AND email=$2", [wsId, email]);
    return invites.create(db, wsId, email, role);
  },
  async markUsed(db: Db, id: string): Promise<void> {
    await db.query("UPDATE invites SET used=true WHERE id=$1", [id]);
  },
  async listPending(db: Db, wsId: string): Promise<{ id: string; email: string; role: string }[]> {
    const r = await db.query("SELECT id,email,role FROM invites WHERE workspace_id=$1 AND used=false ORDER BY created_at", [wsId]);
    return r.rows as unknown as { id: string; email: string; role: string }[];
  },
};

export const automations = {
  async byId(db: Db, id: string): Promise<AutomationRow | null> {
    const r = await db.query("SELECT * FROM automations WHERE id=$1", [id]);
    return (r.rows[0] as unknown as AutomationRow) ?? null;
  },
  async listForWs(db: Db, wsId: string): Promise<AutomationRow[]> {
    const r = await db.query("SELECT * FROM automations WHERE workspace_id=$1 ORDER BY created_at, id", [wsId]);
    return r.rows as unknown as AutomationRow[];
  },
  async create(db: Db, wsId: string, name: string, triggerKind: string): Promise<AutomationRow> {
    const id = newAutomationId();
    await db.query("INSERT INTO automations (id,workspace_id,name,trigger_kind) VALUES ($1,$2,$3,$4)", [id, wsId, name, triggerKind]);
    return { id, workspace_id: wsId, name, trigger_kind: triggerKind, live_version: null, draft_revision: 1 };
  },
  async nextDraftStepSeq(db: Db, aid: string): Promise<number> {
    const r = await db.query("SELECT COALESCE(MAX(seq),0) AS m FROM steps WHERE automation_id=$1 AND version=0", [aid]);
    return Number(r.rows[0].m) + 1;
  },
  async nextStepId(db: Db, aid: string): Promise<string> {
    const r = await db.query("SELECT COALESCE(MAX((regexp_match(id,'^s(\\\\d+)'))[1]::bigint),0) AS m FROM steps WHERE automation_id=$1", [aid]);
    return "s" + (Number(r.rows[0].m) + 1);
  },
};

export const stepsRepo = {
  async listDraft(db: Db, aid: string): Promise<StepNode[]> {
    const r = await db.query("SELECT * FROM steps WHERE automation_id=$1 AND version=$2 ORDER BY seq", [aid, DRAFT_VERSION]);
    return r.rows.map(rowToStep);
  },
  async listVersion(db: Db, aid: string, version: number): Promise<StepNode[]> {
    const r = await db.query("SELECT * FROM steps WHERE automation_id=$1 AND version=$2 ORDER BY seq", [aid, version]);
    return r.rows.map(rowToStep);
  },
  async triggerOf(db: Db, aid: string, version: number | null): Promise<TriggerNode> {
    const r = await db.query("SELECT * FROM steps WHERE automation_id=$1 AND version=$2 AND id='trigger'", [aid, version === null ? DRAFT_VERSION : version]);
    return rowToTrigger(r.rows[0]);
  },
  async byId(db: Db, aid: string, version: number | null, sid: string): Promise<StepNode | null> {
    const r = await db.query("SELECT * FROM steps WHERE automation_id=$1 AND version=$2 AND id=$3", [aid, version === null ? DRAFT_VERSION : version, sid]);
    return r.rows[0] ? rowToStep(r.rows[0]) : null;
  },
  async insert(db: Db, aid: string, version: number | null, s: (StepNode | TriggerNode) & { seq: number }, sample?: unknown): Promise<void> {
    const hasSample = s.id === "trigger";
    await db.query(
      "INSERT INTO steps (automation_id,version,id,kind,name,col,row,fields,sample,seq) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10) ON CONFLICT (automation_id,version,id) DO UPDATE SET kind=$4,name=$5,col=$6,row=$7,fields=$8,sample=$9,seq=$10",
      [aid, version === null ? DRAFT_VERSION : version, s.id, s.kind, s.name, s.col, s.row, JSON.stringify(s.fields), hasSample ? JSON.stringify(sample ?? null) : null, s.seq]
    );
  },
  async updateFields(db: Db, aid: string, version: number | null, sid: string, patch: { name?: string; fields?: Record<string, unknown>; sample?: unknown; col?: number; row?: number }): Promise<void> {
    const cur = await stepsRepo.byId(db, aid, version, sid);
    if (!cur) return;
    const name = patch.name ?? cur.name;
    const fields = patch.fields ? { ...cur.fields, ...patch.fields } : cur.fields;
    const col = patch.col ?? cur.col;
    const row = patch.row ?? cur.row;
    const v = version === null ? DRAFT_VERSION : version;
    if (sid === "trigger" && patch.sample !== undefined) {
      await db.query(
        "UPDATE steps SET name=$1,fields=$2,col=$3,row=$4,sample=$5 WHERE automation_id=$6 AND version=$7 AND id=$8",
        [name, JSON.stringify(fields), col, row, JSON.stringify(patch.sample), aid, v, sid]
      );
      return;
    }
    await db.query(
      "UPDATE steps SET name=$1,fields=$2,col=$3,row=$4 WHERE automation_id=$5 AND version=$6 AND id=$7",
      [name, JSON.stringify(fields), col, row, aid, v, sid]
    );
  },
  async delete(db: Db, aid: string, version: number | null, sid: string): Promise<void> {
    await db.query("DELETE FROM steps WHERE automation_id=$1 AND version=$2 AND id=$3", [aid, version === null ? DRAFT_VERSION : version, sid]);
  },
};

export const edgesRepo = {
  async list(db: Db, aid: string, version: number | null): Promise<EdgeLink[]> {
    const r = await db.query("SELECT id,from_step AS \"from\",port,to_step AS \"to\",ord AS \"order\" FROM edges WHERE automation_id=$1 AND version=$2 ORDER BY ord", [aid, version === null ? DRAFT_VERSION : version]);
    return r.rows as unknown as EdgeLink[];
  },
  async insert(db: Db, aid: string, version: number | null, e: EdgeLink): Promise<void> {
    await db.query("INSERT INTO edges (automation_id,version,id,from_step,port,to_step,ord) VALUES ($1,$2,$3,$4,$5,$6,$7)", [aid, version === null ? DRAFT_VERSION : version, e.id, e.from, e.port, e.to, e.order]);
  },
  async delete(db: Db, aid: string, version: number | null, eid: string): Promise<void> {
    await db.query("DELETE FROM edges WHERE automation_id=$1 AND version=$2 AND id=$3", [aid, version === null ? DRAFT_VERSION : version, eid]);
  },
  async deleteOfStep(db: Db, aid: string, version: number | null, sid: string): Promise<void> {
    await db.query("DELETE FROM edges WHERE automation_id=$1 AND version=$2 AND (from_step=$3 OR to_step=$3)", [aid, version === null ? DRAFT_VERSION : version, sid]);
  },
};

export const countersRepo = {
  async bumpStep(db: Db, aid: string, kind: string): Promise<number> {
    const r = await db.query(
      "INSERT INTO step_counters (automation_id,kind,count) VALUES ($1,$2,1) ON CONFLICT (automation_id,kind) DO UPDATE SET count=step_counters.count+1 RETURNING count",
      [aid, kind]
    );
    return Number(r.rows[0].count);
  },
  async nextEdgeId(db: Db, aid: string, version: number | null): Promise<string> {
    const r = await db.query("SELECT COALESCE(MAX((regexp_match(id,'^e(\\\\d+)'))[1]::bigint),0) AS m FROM edges WHERE automation_id=$1 AND version" + (version === null ? " IS NULL" : "=$2"), version === null ? [aid] : [aid, version]);
    return "e" + (Number(r.rows[0].m) + 1);
  },
};

function rowToStep(r: Record<string, unknown>): StepNode {
  return { id: r.id as string, kind: r.kind as string, name: r.name as string, col: r.col as number, row: r.row as number, fields: (r.fields as Record<string, unknown>) ?? {} };
}
function rowToTrigger(r: Record<string, unknown>): TriggerNode {
  return { id: "trigger", kind: r.kind as string, name: r.name as string, col: r.col as number, row: r.row as number, fields: (r.fields as Record<string, unknown>) ?? {}, sample: r.sample };
}

export const runsRepo = {
  async create(db: Db, r: Omit<RunRow, "id">): Promise<RunRow> {
    const id = newRunId();
    await db.query(
      `INSERT INTO runs (id,workspace_id,automation_id,number,status,test,version,replay_of,owner_port,started_at,finished_at,trigger_output,message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, r.workspace_id, r.automation_id, r.number, r.status, r.test, r.version, r.replay_of, r.owner_port, r.started_at, r.finished_at, JSON.stringify(r.trigger_output ?? null), r.message ?? null]
    );
    return { ...r, id };
  },
  async byId(db: Db, id: string): Promise<RunRow | null> {
    const r = await db.query("SELECT * FROM runs WHERE id=$1", [id]);
    return (r.rows[0] as unknown as RunRow) ?? null;
  },
  async nextNumber(db: Db, aid: string): Promise<number> {
    const r = await db.query("SELECT COALESCE(MAX(number),0) AS m FROM runs WHERE automation_id=$1", [aid]);
    return Number(r.rows[0].m) + 1;
  },
  async listForWs(db: Db, wsId: string, limit = 100): Promise<RunRow[]> {
    const r = await db.query("SELECT * FROM runs WHERE workspace_id=$1 ORDER BY started_at DESC NULLS LAST, number DESC LIMIT $2", [wsId, limit]);
    return r.rows as unknown as RunRow[];
  },
  async setStatus(db: Db, id: string, status: string, finishedAt: Date | null, message: string | null): Promise<void> {
    await db.query("UPDATE runs SET status=$1, finished_at=$2, message=$3 WHERE id=$4", [status, finishedAt, message, id]);
  },
  async unfinishedOnOldVersions(db: Db, aid: string, liveVersion: number): Promise<number> {
    const r = await db.query(
      "SELECT COUNT(*) AS c FROM runs WHERE automation_id=$1 AND test=false AND version < $2 AND status IN ('queued','running','waiting')",
      [aid, liveVersion]
    );
    return Number(r.rows[0].c);
  },
  async drainCount(db: Db, aid: string, liveVersion: number | null): Promise<number> {
    if (liveVersion === null) return 0;
    return runsRepo.unfinishedOnOldVersions(db, aid, liveVersion);
  },
};

export const runStepsRepo = {
  async createAll(db: Db, runId: string, recs: { step_id: string; kind: string; name: string; col: number; row: number; ord: number }[]): Promise<void> {
    for (const s of recs) {
      await db.query(
        `INSERT INTO run_steps (run_id,step_id,kind,name,col,row,status,reused,input,output,log,attempts,started_at,finished_at,due_at,retry_at,ord)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',false,'null','null','[]'::jsonb,0,NULL,NULL,NULL,NULL,$7)`,
        [runId, s.step_id, s.kind, s.name, s.col, s.row, s.ord]
      );
    }
  },
  async list(db: Db, runId: string): Promise<RunStepRow[]> {
    const r = await db.query("SELECT * FROM run_steps WHERE run_id=$1 ORDER BY ord", [runId]);
    return r.rows.map(rowToRunStep);
  },
  async byId(db: Db, runId: string, sid: string): Promise<RunStepRow | null> {
    const r = await db.query("SELECT * FROM run_steps WHERE run_id=$1 AND step_id=$2", [runId, sid]);
    return r.rows[0] ? rowToRunStep(r.rows[0]) : null;
  },
  async update(db: Db, runId: string, sid: string, patch: Partial<RunStepRow>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const put = (col: string, v: unknown) => { sets.push(col + "=$" + i); vals.push(v); i++; };
    if (patch.status !== undefined) put("status", patch.status);
    if (patch.reused !== undefined) put("reused", patch.reused);
    if (patch.input !== undefined) put("input", JSON.stringify(patch.input));
    if (patch.output !== undefined) put("output", JSON.stringify(patch.output));
    if (patch.log !== undefined) put("log", JSON.stringify(patch.log));
    if (patch.attempts !== undefined) put("attempts", patch.attempts);
    if (patch.started_at !== undefined) put("started_at", patch.started_at);
    if (patch.finished_at !== undefined) put("finished_at", patch.finished_at);
    if (patch.due_at !== undefined) put("due_at", patch.due_at);
    if (patch.retry_at !== undefined) put("retry_at", patch.retry_at);
    if (sets.length === 0) return;
    vals.push(runId, sid);
    await db.query(`UPDATE run_steps SET ${sets.join(",")} WHERE run_id=$${i} AND step_id=$${i + 1}`, vals);
  },
};

function rowToRunStep(r: Record<string, unknown>): RunStepRow {
  return {
    run_id: r.run_id as string, step_id: r.step_id as string, kind: r.kind as string, name: r.name as string,
    col: r.col as number, row: r.row as number, status: r.status as string, reused: Boolean(r.reused),
    input: r.input, output: r.output, log: (r.log as string[]) ?? [], attempts: r.attempts as number,
    started_at: (r.started_at as Date | null) ?? null, finished_at: (r.finished_at as Date | null) ?? null,
    due_at: (r.due_at as Date | null) ?? null, retry_at: (r.retry_at as Date | null) ?? null, ord: r.ord as number,
  };
}

export const tablesRepo = {
  async byId(db: Db, id: string): Promise<TableRow2 | null> {
    const r = await db.query("SELECT * FROM tables_ WHERE id=$1", [id]);
    return r.rows[0] ? rowToTable(r.rows[0]) : null;
  },
  async listForWs(db: Db, wsId: string): Promise<TableRow2[]> {
    const r = await db.query("SELECT * FROM tables_ WHERE workspace_id=$1 ORDER BY seq, id", [wsId]);
    return r.rows.map(rowToTable);
  },
  async create(db: Db, wsId: string, name: string, columns: { name: string; type: string }[]): Promise<TableRow2> {
    const id = newTableId();
    const r = await db.query("SELECT COALESCE(MAX(seq),0) AS m FROM tables_ WHERE workspace_id=$1", [wsId]);
    const seq = Number(r.rows[0].m) + 1;
    await db.query("INSERT INTO tables_ (id,workspace_id,name,columns,seq) VALUES ($1,$2,$3,$4,$5)", [id, wsId, name, JSON.stringify(columns), seq]);
    return { id, workspace_id: wsId, name, columns, seq };
  },
  async rows(db: Db, tableId: string): Promise<{ row_id: string; values: Record<string, unknown> }[]> {
    const r = await db.query("SELECT row_id, values FROM table_rows WHERE table_id=$1 ORDER BY seq", [tableId]);
    return r.rows.map((x: Record<string, unknown>) => ({ row_id: x.row_id as string, values: (x.values as Record<string, unknown>) ?? {} }));
  },
  async rowCount(db: Db, tableId: string): Promise<number> {
    const r = await db.query("SELECT COUNT(*) AS c FROM table_rows WHERE table_id=$1", [tableId]);
    return Number(r.rows[0].c);
  },
  async insertRow(db: Db, tableId: string, values: Record<string, unknown>): Promise<{ row_id: string; values: Record<string, unknown> }> {
    const r = await db.query("SELECT COALESCE(MAX(seq),0) AS m FROM table_rows WHERE table_id=$1", [tableId]);
    const seq = Number(r.rows[0].m) + 1;
    const rowId = "r" + seq;
    await db.query("INSERT INTO table_rows (table_id,row_id,seq,values) VALUES ($1,$2,$3,$4)", [tableId, rowId, seq, JSON.stringify(values)]);
    return { row_id: rowId, values };
  },
  async updateRow(db: Db, tableId: string, rowId: string, values: Record<string, unknown>): Promise<boolean> {
    const r = await db.query("SELECT values FROM table_rows WHERE table_id=$1 AND row_id=$2", [tableId, rowId]);
    const cur = r.rows[0]?.values as Record<string, unknown> | undefined;
    if (!cur) return false;
    await db.query("UPDATE table_rows SET values=$1 WHERE table_id=$2 AND row_id=$3", [JSON.stringify({ ...cur, ...values }), tableId, rowId]);
    return true;
  },
};

function rowToTable(r: Record<string, unknown>): TableRow2 {
  return { id: r.id as string, workspace_id: r.workspace_id as string, name: r.name as string, columns: (r.columns as { name: string; type: string }[]) ?? [], seq: r.seq as number };
}

export const timersRepo = {
  async insert(db: Db, t: Omit<TimerRow, "id" | "created_at" | "fired">): Promise<number> {
    const r = await db.query(
      "INSERT INTO timers (workspace_id,run_id,step_id,kind,due_at,fired,payload,owner_port) VALUES ($1,$2,$3,$4,$5,false,$6,$7) RETURNING id",
      [t.workspace_id, t.run_id, t.step_id, t.kind, t.due_at, JSON.stringify(t.payload ?? {}), t.owner_port]
    );
    return Number(r.rows[0].id);
  },
  async dueForPort(db: Db, port: number, now: Date): Promise<TimerRow[]> {
    const r = await db.query("SELECT * FROM timers WHERE fired=false AND owner_port=$1 AND due_at<=$2 ORDER BY due_at, id", [port, now]);
    return r.rows.map(rowToTimer);
  },
  async allDueForPort(db: Db, port: number, now: Date): Promise<TimerRow[]> {
    return timersRepo.dueForPort(db, port, now);
  },
  async markFired(db: Db, id: number): Promise<void> {
    await db.query("UPDATE timers SET fired=true WHERE id=$1", [id]);
  },
  async cancelRunTimers(db: Db, runId: string): Promise<void> {
    await db.query("UPDATE timers SET fired=true WHERE run_id=$1 AND fired=false", [runId]);
  },
  async anyUnfired(db: Db, runId: string): Promise<boolean> {
    const r = await db.query("SELECT 1 FROM timers WHERE run_id=$1 AND fired=false LIMIT 1", [runId]);
    return r.rows.length > 0;
  },
};

function rowToTimer(r: Record<string, unknown>): TimerRow {
  return {
    id: Number(r.id), workspace_id: r.workspace_id as string, run_id: (r.run_id as string | null) ?? null,
    step_id: (r.step_id as string | null) ?? null, kind: r.kind as string, due_at: r.due_at as Date,
    fired: Boolean(r.fired), payload: (r.payload as Record<string, unknown>) ?? {}, owner_port: r.owner_port as number,
  };
}

export const idemKeys = {
  async find(db: Db, wsId: string, path: string, key: string): Promise<{ run_id: string; body_sha: string; created_at: Date } | null> {
    const r = await db.query("SELECT run_id,body_sha,created_at FROM idempotency_keys WHERE workspace_id=$1 AND hook_path=$2 AND key=$3", [wsId, path, key]);
    return (r.rows[0] as any) ?? null;
  },
  async put(db: Db, wsId: string, path: string, key: string, runId: string, sha: string, at: Date): Promise<void> {
    await db.query(
      "INSERT INTO idempotency_keys (workspace_id,hook_path,key,run_id,body_sha,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (workspace_id,hook_path,key) DO NOTHING",
      [wsId, path, key, runId, sha, at]
    );
  },
};

export const editHolds = {
  async get(db: Db, aid: string, sid: string): Promise<{ holder: string; held_until: Date } | null> {
    const r = await db.query("SELECT holder,held_until FROM edit_holds WHERE automation_id=$1 AND step_id=$2", [aid, sid]);
    return r.rows[0] ? { holder: r.rows[0].holder as string, held_until: r.rows[0].held_until as Date } : null;
  },
  async put(db: Db, aid: string, sid: string, holder: string, until: Date): Promise<void> {
    await db.query(
      "INSERT INTO edit_holds (automation_id,step_id,holder,held_until) VALUES ($1,$2,$3,$4) ON CONFLICT (automation_id,step_id) DO UPDATE SET holder=$3,held_until=$4",
      [aid, sid, holder, until]
    );
  },
  async release(db: Db, aid: string, sid: string, holder: string): Promise<void> {
    await db.query("DELETE FROM edit_holds WHERE automation_id=$1 AND step_id=$2 AND holder=$3", [aid, sid, holder]);
  },
};

export const versionsRepo = {
  async put(db: Db, aid: string, version: number, revision: number, publishedAt: Date, content: AutomationContent): Promise<void> {
    await db.query(
      "INSERT INTO automation_versions (automation_id,version,revision,published_at,content) VALUES ($1,$2,$3,$4,$5)",
      [aid, version, revision, publishedAt, JSON.stringify(content)]
    );
  },
  async get(db: Db, aid: string, version: number): Promise<{ version: number; revision: number; published_at: Date; content: AutomationContent } | null> {
    const r = await db.query("SELECT * FROM automation_versions WHERE automation_id=$1 AND version=$2", [aid, version]);
    if (!r.rows[0]) return null;
    return { version, revision: r.rows[0].revision as number, published_at: r.rows[0].published_at as Date, content: r.rows[0].content as AutomationContent };
  },
  async list(db: Db, aid: string): Promise<{ version: number; published_at: Date }[]> {
    const r = await db.query("SELECT version,published_at FROM automation_versions WHERE automation_id=$1 ORDER BY version DESC", [aid]);
    return r.rows.map((x: Record<string, unknown>) => ({ version: x.version as number, published_at: x.published_at as Date }));
  },
};

export const automationsAll = {
  async listAll(d: Db): Promise<AutomationRow[]> {
    const r = await d.query("SELECT * FROM automations ORDER BY created_at, id");
    return r.rows as unknown as AutomationRow[];
  },
};
