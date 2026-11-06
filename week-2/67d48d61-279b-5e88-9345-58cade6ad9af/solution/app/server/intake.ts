// The company request intake in PocketBase: the `requests` collection, the pull into triage,
// decisions written back before they are final, and filing.

import {
  DETAILS_MAX,
  FIELD_MESSAGES as M,
  TITLE_MAX,
  crewByHandle,
  departmentByKey,
  taskId,
  type IntakeRequest,
  type StatusKey,
} from "../shared/catalog.js";
import { underLock } from "./changes.js";
import { config } from "./config.js";
import { calendar } from "./cycles.js";
import { pool } from "./db.js";
import type { TaskRow } from "./domain.js";
import { ApiError, invalid, route, type Reply } from "./http.js";
import { markService } from "./status.js";
import { diff, known, ok, taskOrThrow } from "./tasks.js";

class IntakeDown extends Error {}

class IntakeRefused extends Error {
  constructor(readonly status: number) {
    super(`intake answered ${status}`);
  }
}

interface RequestRecord {
  id: string;
  title: string;
  details: string;
  requester: string;
  department: string;
  status: IntakeRequest["status"];
  task: string;
  decision_note: string;
  decided_at: string;
  created: string;
}

let token: string | null = null;
let collectionReady = false;

const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${config.pocketbase.url}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    markService("intake", false);
    throw new IntakeDown();
  }
  markService("intake", true);
  if (!res.ok) throw new IntakeRefused(res.status);
  return (res.status === 204 ? null : await res.json()) as T;
};

const intake = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  if (!token) {
    const auth = await call<{ token: string }>("POST", "/api/admins/auth-with-password", {
      identity: config.pocketbase.email,
      password: config.pocketbase.password,
    });
    token = auth.token;
  }
  try {
    return await call<T>(method, path, body);
  } catch (error) {
    if (!(error instanceof IntakeRefused && error.status === 401)) throw error;
    token = null;
    return intake<T>(method, path, body);
  }
};

const SEEDED_REQUESTS = [
  {
    title: "The upstage door still sticks when it swings shut",
    details: "Caught it twice on the Act 1 entrance.",
    requester: "Leon Park",
    department: "carpentry",
  },
  {
    title: "Bring the thunder in after the line about barring the door",
    details: "It currently lands before the line.",
    requester: "Leon Park",
    department: "sound",
  },
  {
    title: "Lose the rocking chair in Act 2, it slows the scene change",
    details: "",
    requester: "Hana Ito",
    department: "props",
  },
];

// Ensures the `requests` collection; the process that creates it seeds the three requests.
const ensureCollection = async (): Promise<void> => {
  try {
    await intake("GET", "/api/collections/requests");
    collectionReady = true;
    return;
  } catch (error) {
    if (!(error instanceof IntakeRefused && error.status === 404)) throw error;
  }
  const text = (name: string, required = false) => ({ name, type: "text", required, options: {} });
  try {
    await intake("POST", "/api/collections", {
      name: "requests",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      schema: [
        text("title", true),
        text("details"),
        text("requester", true),
        text("department"),
        { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["pending", "accepted", "declined", "merged"] } },
        text("task"),
        text("decision_note"),
        { name: "decided_at", type: "date", required: false, options: {} },
      ],
    });
  } catch (error) {
    if (error instanceof IntakeRefused && error.status === 400) {
      collectionReady = true;
      return;
    }
    throw error;
  }
  for (const request of SEEDED_REQUESTS) {
    await intake("POST", "/api/collections/requests/records", { ...request, status: "pending" });
  }
  collectionReady = true;
};

const records = async (filter: string, sort: string): Promise<RequestRecord[]> => {
  const all: RequestRecord[] = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ page: String(page), perPage: "500", sort, skipTotal: "1" });
    if (filter) query.set("filter", filter);
    const { items } = await intake<{ items: RequestRecord[] }>("GET", `/api/collections/requests/records?${query}`);
    all.push(...items);
    if (items.length < 500) return all;
  }
};

const iso = (pocketbaseDate: string): string | null => (pocketbaseDate ? pocketbaseDate.replace(" ", "T") : null);

const asRequest = (r: RequestRecord): IntakeRequest => ({
  id: r.id,
  title: r.title,
  details: r.details,
  requester: r.requester,
  department: r.department || null,
  status: r.status,
  task: r.task || null,
  created: iso(r.created) as string,
  decided_at: iso(r.decided_at),
});

const providerError = (error: unknown): ApiError => {
  if (error instanceof IntakeDown) return new ApiError(503, "intake_unavailable", "Request intake is unreachable.");
  if (error instanceof IntakeRefused) return new ApiError(502, "intake_rejected", `Request intake refused the call (${error.status}).`);
  throw error;
};

export const intakeReachable = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${config.pocketbase.url}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
};

// Pulls every pending request that has no task yet into triage, as one change.
export const pull = async (): Promise<void> => {
  let pending: RequestRecord[];
  try {
    if (!collectionReady) await ensureCollection();
    pending = await records("status='pending'", "created,id");
  } catch (error) {
    if (error instanceof IntakeDown || error instanceof IntakeRefused) return;
    throw error;
  }
  if (!pending.length) return;
  const { rows } = await pool.query<{ request: string }>("SELECT request FROM tasks WHERE request = ANY($1)", [pending.map((r) => r.id)]);
  const taken = new Set(rows.map((r) => r.request));
  if (pending.every((r) => taken.has(r.id))) return;
  await underLock(null, async (w) => {
    const have = new Set([...w.graph.rows.values()].map((r) => r.request));
    const fresh = pending.filter((r) => !have.has(r.id));
    if (!fresh.length) return ok(null);
    const now = new Date();
    const first = Math.max(0, ...w.graph.rows.keys()) + 1;
    const created: TaskRow[] = fresh.map((r, i) => ({
      number: first + i,
      title: r.title,
      details: r.details,
      department: departmentByKey(r.department) ? r.department : null,
      label: null,
      status: "triage",
      priority: 0,
      owner: null,
      cycle: null,
      parent: null,
      duplicate_of: null,
      request: r.id,
      version: 1,
      updated_at: now,
    }));
    const numbers = created.map((r) => r.number);
    await w.commit({
      kind: "pull",
      actor: null,
      after: w.graph.with(created),
      saved: numbers,
      inserted: numbers,
      activity: created.map((r) => ({ task: r.number, kind: "created", actor: null, changes: { title: { from: null, to: r.title }, status: { from: null, to: "triage" } } })),
      undoable: false,
    });
    return ok(null);
  });
};

route("POST", "/api/triage/:id/decision", (req) =>
  underLock(req, async (w) => {
    const n = taskOrThrow(w.graph, req.params[0]);
    await w.idempotency();
    const row = w.graph.row(n);
    if (row.status !== "triage") throw new ApiError(409, "already_decided", `${taskId(n)} was already decided.`);
    const b = req.json;
    const fields: Record<string, string> = { ...req.headerErrors };
    const { windows, current } = calendar();
    let next: TaskRow = row;
    let outcome: { status: IntakeRequest["status"]; task: string; note?: string } = { status: "accepted", task: taskId(n) };
    if (b.decision === "accept") {
      const department = typeof b.department === "string" && departmentByKey(b.department) ? b.department : null;
      if (!department) fields.department = M.department;
      const priority = b.priority ?? 0;
      if (!Number.isInteger(priority) || (priority as number) < 0 || (priority as number) > 4) fields.priority = M.priority;
      const owner = b.owner ?? null;
      if (owner !== null && !(typeof owner === "string" && crewByHandle(owner))) fields.owner = M.crew;
      const label = b.label ?? null;
      if (label !== null && !departmentByKey(department)?.labels.some((l) => l.key === label)) fields.label = M.label;
      next = { ...row, status: "backlog", department, priority: priority as number, owner: owner as string | null, label: label as string | null, cycle: windows[current].key };
    } else if (b.decision === "decline") {
      if (typeof b.reason !== "string" || !b.reason.trim()) fields.reason = M.reason;
      else if (b.reason.length > DETAILS_MAX) fields.reason = M.details;
      next = { ...row, status: "cancelled", cycle: null };
      outcome = { status: "declined", task: taskId(n), note: typeof b.reason === "string" ? b.reason.trim() : "" };
    } else if (b.decision === "merge") {
      const target = known(w.graph, b.duplicate_of);
      const mergeable: StatusKey[] = ["backlog", "todo", "in_progress", "done"];
      if (target === null || !mergeable.includes(w.graph.row(target).status)) fields.duplicate_of = M.duplicateOf;
      next = { ...row, status: "duplicate", duplicate_of: target };
      outcome = { status: "merged", task: taskId(target ?? n) };
    } else {
      fields.decision = M.decision;
    }
    if (Object.keys(fields).length) throw invalid(fields);
    const recordId = row.request as string;
    try {
      const record = await intake<RequestRecord>("GET", `/api/collections/requests/records/${encodeURIComponent(recordId)}`);
      if (record.status !== "pending") throw new IntakeRefused(409);
      await intake("PATCH", `/api/collections/requests/records/${encodeURIComponent(recordId)}`, {
        status: outcome.status,
        task: outcome.task,
        decision_note: outcome.note ?? "",
        decided_at: new Date().toISOString().replace("T", " "),
      });
    } catch (error) {
      throw providerError(error);
    }
    const final = { ...next, version: row.version + 1, updated_at: new Date() };
    const changes = diff(row, final);
    if (final.department !== row.department) changes.department = { from: row.department, to: final.department };
    if (final.duplicate_of !== null) changes.duplicate_of = { from: null, to: taskId(final.duplicate_of) };
    const result = await w.commit({
      kind: "decision",
      actor: req.actor,
      after: w.graph.with([final]),
      saved: [n],
      activity: [{ task: n, kind: "decided", actor: req.actor, changes }],
      undoable: false,
      extra: { request: { id: recordId, status: outcome.status, task: outcome.task } },
    });
    return ok(result);
  }),
);

route("GET", "/api/requests", async (): Promise<Reply> => {
  try {
    if (!collectionReady) await ensureCollection();
    return ok({ requests: (await records("", "-created,-id")).map(asRequest) });
  } catch (error) {
    throw providerError(error);
  }
});

route("POST", "/api/requests", (req) =>
  underLock(req, async (w) => {
    await w.idempotency();
    const b = req.json;
    const fields: Record<string, string> = { ...req.headerErrors };
    if (typeof b.title !== "string" || !b.title.trim()) fields.title = M.requestEmpty;
    else if (b.title.trim().length > TITLE_MAX) fields.title = M.requestLong;
    if (typeof b.requester !== "string" || !b.requester.trim()) fields.requester = M.requester;
    if (b.details !== undefined && (typeof b.details !== "string" || b.details.length > DETAILS_MAX)) fields.details = M.details;
    const department = b.department ?? "";
    if (department !== "" && !(typeof department === "string" && departmentByKey(department))) fields.department = M.department;
    if (Object.keys(fields).length) throw invalid(fields);
    try {
      if (!collectionReady) await ensureCollection();
      const record = await intake<RequestRecord>("POST", "/api/collections/requests/records", {
        title: (b.title as string).trim(),
        details: (b.details as string | undefined) ?? "",
        requester: (b.requester as string).trim(),
        department,
        status: "pending",
      });
      return ok({ request: asRequest(record) }, 201);
    } catch (error) {
      throw providerError(error);
    }
  }),
);

