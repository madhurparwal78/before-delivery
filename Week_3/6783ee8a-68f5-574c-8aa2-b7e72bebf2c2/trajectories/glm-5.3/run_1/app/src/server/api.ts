import type { Ctx, Handler } from "./http.ts";
import { ApiError, Router, validationFailed } from "./http.ts";
import { one, query, withTransaction } from "./db.ts";
import { createSession, endSession, hashPassword, newId, userFromSession, uuid, verifyPassword } from "./identity.ts";
import { limits, appOrigin, grading } from "./config.ts";
import { subscribe, publish, publishLocks, publishPresence, endStreamForUser } from "./live.ts";
import {
  CELL_ID_RE,
  loadCells,
  normalizePositions,
  notebookKernelStatus,
  publishAfterStructural,
  publishCells,
  publishPresence as publishPresenceList,
  publishLocks as publishLockList,
  pushWorkingCopy,
  requireAccess,
  searchDocFor,
  serializeCell,
  syncSearch,
  dropSearch,
} from "./store.ts";
import {
  applyRunResult,
  cancelQueuedRunsInTab,
  findRun,
  KERNEL_TRANSITIONS,
  kernelTransitionAllowed,
  markNotRun,
  publishKernel,
  publishRunResult,
  runTransitionAllowed,
} from "./runs.ts";
import { compareNotebooks } from "./compare.ts";
import { validateImport, workingCopyFromImport, importValidationError, sniffImageMime, decodeBase64 } from "./importFormat.ts";
import { limitMessage, overCapNotice, tableFromOutput, validateTableRequest } from "./outputs.ts";
import * as s3 from "./s3.ts";
import * as meili from "./meili.ts";
import { sendMail, verificationMail, invitationMail } from "./mail.ts";
import type { Cell, CellType, Checkpoint, Output, Role } from "../shared/types.ts";
import { snapshotFromCells } from "./shapes.ts";
import { latestStorageProbe } from "./probe.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(res: Ctx["res"], status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function requireUser(ctx: Ctx): { id: string; email: string; display_name: string; verified: boolean } {
  if (ctx.user === null) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  return ctx.user;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

type Body = Record<string, unknown>;

function bodyObject(ctx: Ctx): Body {
  if (ctx.body === null || typeof ctx.body !== "object" || Array.isArray(ctx.body)) {
    throw validationFailed([{ path: "body", message: "must be an object" }]);
  }
  return ctx.body as Body;
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return null;
}

function countPoints(text: string): number {
  return [...text].length;
}

async function notebookFor(notebookId: string, userId: string): Promise<{ id: string; title: string; role: Role; owner_display_name: string; imported: boolean; execution_counter: number; kernel_status: string }> {
  const access = await requireAccess(notebookId, userId, ["owner", "editor", "viewer"]);
  const meta = await one<{ title: string; owner_display_name: string; imported: boolean; execution_counter: number }>(
    "SELECT n.title, u.display_name AS owner_display_name, n.imported, n.execution_counter FROM notebooks n JOIN users u ON u.id = n.owner_id WHERE n.id = $1",
    [notebookId],
  );
  if (meta === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const cells = await loadCells(notebookId);
  const kernel = await notebookKernelStatus(notebookId);
  return {
    id: access.notebookId,
    title: meta.title,
    role: access.role,
    owner_display_name: meta.owner_display_name,
    imported: meta.imported,
    execution_counter: meta.execution_counter,
    kernel_status: kernel,
  };
}

async function serializeNotebook(notebookId: string, userId: string): Promise<Record<string, unknown>> {
  const meta = await notebookFor(notebookId, userId);
  const cells = await loadCells(notebookId);
  return { ...meta, cells: cells.map(serializeCell) };
}

async function activeShares(notebookId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>("SELECT user_id FROM shares WHERE notebook_id = $1 AND status = 'active'", [notebookId]);
  return rows.rows.map((r) => r.user_id);
}

const router = new Router();

function setSessionCookie(ctx: Ctx, value: string): void {
  ctx.res.setHeader("set-cookie", `bp_session=${value}; HttpOnly; SameSite=Lax; Path=/`);
}

function readSessionCookie(ctx: Ctx): string | undefined {
  const header = ctx.req.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("bp_session=")) return decodeURIComponent(trimmed.slice("bp_session=".length));
  }
  return undefined;
}

function clearSessionCookie(ctx: Ctx): void {
  ctx.res.setHeader("set-cookie", "bp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

// ---------------------------------------------------------------------------
// Health and configuration
// ---------------------------------------------------------------------------

router.add("GET", "/api/health", async (ctx) => {
  const probe = await latestStorageProbe();
  if (!probe.dbUp) {
    json(ctx.res, 503, { status: "starting" });
    return;
  }
  json(ctx.res, 200, probe.storageUp ? { status: "ok" } : { status: "unavailable" });
});

router.add("GET", "/api/config", async (ctx) => {
  json(ctx.res, 200, { ...limits });
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

router.add("POST", "/api/auth/signup", async (ctx) => {
  const body = bodyObject(ctx);
  const displayName = str(body["display_name"]) ?? "";
  const email = str(body["email"]) ?? "";
  const password = str(body["password"]) ?? "";
  const use = str(body["use"]);
  const invitationToken = str(body["invitation_token"]);
  const errors: { path: string; message: string }[] = [];
  if (countPoints(displayName) < 1 || countPoints(displayName) > 40) errors.push({ path: "display_name", message: "must be 1 to 40 characters" });
  if (!EMAIL_RE.test(email)) errors.push({ path: "email", message: "must be a valid email address" });
  if (password.length < 10 || password.length > 128) errors.push({ path: "password", message: "must be 10 to 128 characters" });
  if (errors.length === 0) {
    const existing = await one<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM users WHERE lower(email) = lower($1)",
      [email],
    );
    if (existing !== null && existing.password_hash !== "") {
      errors.push({ path: "email", message: "is already registered" });
    }
  }
  let invitedUser: { userId: string; notebookId: string } | null = null;
  if (invitationToken !== null) {
    const invite = await one<{ share_id: string; email: string }>(
      `SELECT i.share_id, t.email FROM tokens t JOIN invitations i ON i.token = t.token
       WHERE t.token = $1 AND t.kind = 'invite'`,
      [invitationToken],
    );
    const share = invite === null ? null : await one<{ notebook_id: string; status: string }>(
      "SELECT notebook_id, status FROM shares WHERE id = $1",
      [invite.share_id],
    );
    if (invite === null || share === null || invite.email.toLowerCase() !== email.toLowerCase()) {
      errors.push({ path: "invitation_token", message: "is not valid for this email" });
    } else {
      invitedUser = { userId: "", notebookId: share.notebook_id };
    }
  }
  if (errors.length > 0) throw validationFailed(errors);
  if (invitedUser === null) {
    const token = newId("v");
    const sent = await sendMail(verificationMail(email, token));
    if (!sent) throw new ApiError(503, "mail_unavailable", "We could not send email right now. Try again in a minute.");
    const userId = newId("u");
    await query("INSERT INTO tokens (token, kind, user_id, email) VALUES ($1, 'verify', NULL, $2)", [token, email]);
    const result = await withTransaction(async (client) => {
      const userRow = await client.query(
        "INSERT INTO users (id, email, display_name, password_hash, verified) VALUES ($1, $2, $3, $4, false) RETURNING id, email, display_name, verified",
        [userId, email, displayName, hashPassword(password)],
      );
      return userRow.rows[0];
    });
    await query("UPDATE tokens SET user_id = $2 WHERE token = $1", [token, userId]);
    json(ctx.res, 201, { user: result });
    return;
  }
  // Invited sign-up: verify, accept and sign in, taking over any pending row.
  const pendingRow = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1) AND password_hash = ''", [email]);
  const userId = pendingRow?.id ?? newId("u");
  const created = await withTransaction(async (client) => {
    if (pendingRow === null) {
      await client.query(
        "INSERT INTO users (id, email, display_name, password_hash, verified) VALUES ($1, $2, $3, $4, true) RETURNING id, email, display_name, verified",
        [userId, email, displayName, hashPassword(password)],
      );
    } else {
      await client.query(
        "UPDATE users SET display_name = $2, password_hash = $3, verified = true WHERE id = $1 RETURNING id, email, display_name, verified",
        [userId, displayName, hashPassword(password)],
      );
    }
    const inviteRow = await client.query<{ share_id: string }>(
      "SELECT share_id FROM invitations WHERE token = $1",
      [invitationToken],
    );
    if (inviteRow.rows.length > 0) {
      await client.query("UPDATE shares SET status = 'active' WHERE id = $1", [inviteRow.rows[0].share_id]);
      await client.query("DELETE FROM tokens WHERE token = $1", [invitationToken]);
      await client.query("DELETE FROM invitations WHERE token = $1", [invitationToken]);
    }
    const takenOver = await client.query(
      "SELECT id, email, display_name, verified FROM users WHERE id = $1",
      [userId],
    );
    return takenOver.rows[0];
  });
  const cookie = await createSession(userId);
  setSessionCookie(ctx, cookie);
  const notebookId = invitedUser.notebookId;
  void syncSearch(notebookId);
  json(ctx.res, 201, { user: created, notebook_id: notebookId });
});

router.add("POST", "/api/auth/verify", async (ctx) => {
  const body = bodyObject(ctx);
  const token = str(body["token"]) ?? "";
  const row = await one<{ user_id: string | null }>(
    "SELECT user_id FROM tokens WHERE token = $1 AND kind = 'verify'",
    [token],
  );
  if (row === null || row.user_id === null) throw validationFailed([{ path: "token", message: "is not valid" }]);
  await query("UPDATE users SET verified = true WHERE id = $1", [row.user_id]);
  await query("DELETE FROM tokens WHERE token = $1", [token]);
  const user = await one("SELECT id, email, display_name, verified FROM users WHERE id = $1", [row.user_id]);
  json(ctx.res, 200, { user });
});

router.add("POST", "/api/auth/signin", async (ctx) => {
  const body = bodyObject(ctx);
  const email = str(body["email"]) ?? "";
  const password = str(body["password"]) ?? "";
  const user = await one<{ id: string; email: string; display_name: string; verified: boolean; password_hash: string }>(
    "SELECT id, email, display_name, verified, password_hash FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  if (user === null || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
  }
  if (!user.verified) {
    throw new ApiError(403, "email_not_verified", "Verify your email first. We sent you a link.");
  }
  const cookie = await createSession(user.id);
  setSessionCookie(ctx, cookie);
  json(ctx.res, 200, { user: { id: user.id, email: user.email, display_name: user.display_name, verified: user.verified } });
});

router.add("POST", "/api/auth/signout", async (ctx) => {
  const raw = readSessionCookie(ctx);
  await endSession(raw);
  clearSessionCookie(ctx);
  ctx.res.writeHead(204, { "content-length": "0" });
  ctx.res.end();
});

router.add("GET", "/api/me", async (ctx) => {
  const user = requireUser(ctx);
  json(ctx.res, 200, { user });
});

// ---------------------------------------------------------------------------
// Notebooks
// ---------------------------------------------------------------------------

router.add("GET", "/api/notebooks", async (ctx) => {
  const user = requireUser(ctx);
  const rows = await query<{ id: string; title: string; role: Role; owner_display_name: string; modified_at: string }>(
    `SELECT n.id, n.title,
            CASE WHEN n.owner_id = $1 THEN 'owner' ELSE s.role END AS role,
            u.display_name AS owner_display_name, n.modified_at
     FROM notebooks n
     JOIN users u ON u.id = n.owner_id
     LEFT JOIN shares s ON s.notebook_id = n.id AND s.user_id = $1 AND s.status = 'active'
     WHERE n.owner_id = $1 OR s.user_id = $1
     ORDER BY n.modified_at DESC`,
    [user.id],
  );
  json(ctx.res, 200, {
    notebooks: rows.rows.map((row) => ({ ...row, modified_at: new Date(row.modified_at).toISOString() })),
  });
});

router.add("POST", "/api/notebooks", async (ctx) => {
  const user = requireUser(ctx);
  const body = bodyObject(ctx);
  const title = str(body["title"]) ?? "";
  if (countPoints(title) < 1 || countPoints(title) > 120) {
    throw validationFailed([{ path: "title", message: "must be 1 to 120 characters" }]);
  }
  const notebookId = newId("nb");
  const created = await withTransaction(async (client) => {
    await client.query("INSERT INTO notebooks (id, title, owner_id) VALUES ($1, $2, $3)", [notebookId, title, user.id]);
    const cellId = newId("c");
    await client.query(
      "INSERT INTO cells (notebook_id, id, position, cell_type, source) VALUES ($1, $2, 0, 'code', '')",
      [notebookId, cellId],
    );
    return notebookId;
  });
  void syncSearch(created);
  json(ctx.res, 201, { notebook: await serializeNotebook(created, user.id) });
});

router.add("GET", "/api/notebooks/:id", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  json(ctx.res, 200, { notebook: await serializeNotebook(ctx.params.id, user.id) });
});

router.add("DELETE", "/api/notebooks/:id", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner"]);
  const cells = await loadCells(ctx.params.id);
  for (const cell of cells) {
    await s3.remove(s3.attachmentKey(ctx.params.id, cell.id, ""));
  }
  const checkpoints = await query<{ id: string }>("SELECT id FROM checkpoints WHERE notebook_id = $1", [ctx.params.id]);
  for (const cp of checkpoints.rows) {
    await s3.remove(s3.checkpointKey(ctx.params.id, cp.id));
  }
  await s3.remove(s3.workingKey(ctx.params.id));
  await s3.remove(s3.originalKey(ctx.params.id));
  await dropSearch(ctx.params.id);
  await query("DELETE FROM notebooks WHERE id = $1", [ctx.params.id]);
  json(ctx.res, 204, "");
});

// ---------------------------------------------------------------------------
// Cells: save and structure
// ---------------------------------------------------------------------------

router.add("POST", "/api/notebooks/:id/save", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const tabId = str(body["tab_id"]) ?? "";
  const cells = Array.isArray(body["cells"]) ? (body["cells"] as Body[]) : [];
  const notebookId = ctx.params.id;
  const errors: { path: string; message: string }[] = [];
  const current = await loadCells(notebookId);
  const byId = new Map(current.map((c) => [c.id, c]));
  const prepared: { id: string; base: number; source: string; type: CellType }[] = [];
  cells.forEach((cellBody, i) => {
    const id = str(cellBody["id"]) ?? "";
    const cell = byId.get(id);
    if (cell === undefined) {
      errors.push({ path: `cells[${i}].id`, message: "must name cells of this notebook" });
      return;
    }
    const base = wholeNumber(cellBody["base_revision"]);
    if (base === null) {
      errors.push({ path: `cells[${i}].base_revision`, message: "must be a whole number" });
      return;
    }
    const source = str(cellBody["source"]);
    if (source === null || countPoints(source) > 1_000_000) {
      errors.push({ path: `cells[${i}].source`, message: "must be at most 1,000,000 characters" });
      return;
    }
    const type = cellBody["cell_type"];
    if (type !== "code" && type !== "markdown") {
      errors.push({ path: `cells[${i}].cell_type`, message: 'must be "code" or "markdown"' });
      return;
    }
    prepared.push({ id, base, source, type });
  });
  if (errors.length > 0) throw validationFailed(errors);

  // Locks are checked before stale revisions, and only for cells this save touches.
  for (const item of prepared) {
    const lock = await one<{ tab_id: string; holder: string }>(
      "SELECT tab_id, holder_display_name AS holder FROM locks WHERE notebook_id = $1 AND cell_id = $2",
      [notebookId, item.id],
    );
    if (lock !== null && lock.tab_id !== tabId) {
      throw new ApiError(409, "cell_locked", "This cell is being edited by someone else.", { cell_id: item.id, holder: lock.holder });
    }
  }
  const stale = prepared.filter((item) => (byId.get(item.id)?.revision ?? 0) !== item.base);
  if (stale.length > 0) {
    json(ctx.res, 409, {
      error: "stale_revision",
      message: "This notebook changed elsewhere.",
      cells: stale.map((item) => serializeCell(byId.get(item.id) as never)),
    });
    return;
  }
  const working = await pushWorkingCopy(notebookId);
  if (!working) throw new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
  const saved = await withTransaction(async (client) => {
    const out: Cell[] = [];
    for (const item of prepared) {
      const result = await client.query(
        "UPDATE cells SET source = $3, cell_type = $4, revision = revision + 1 WHERE notebook_id = $1 AND id = $2 RETURNING id, position, cell_type, source, revision, execution_count, run_state, outputs, outputs_version, metadata",
        [notebookId, item.id, item.source, item.type],
      );
      const row = result.rows[0];
      const typeChanged = row.cell_type !== item.type;
      if (typeChanged) {
        await client.query(
          "UPDATE cells SET execution_count = NULL, outputs = '[]'::jsonb, run_state = 'idle' WHERE notebook_id = $1 AND id = $2",
          [notebookId, item.id],
        );
      }
      out.push(row as unknown as Cell);
    }
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
    return out;
  });
  const withLocks = await loadCells(notebookId);
  const savedIds = new Set(prepared.map((p) => p.id));
  const serialized = withLocks.filter((c) => savedIds.has(c.id)).map(serializeCell);
  publish(notebookId, { type: "cell_saved", cells: serialized });
  void syncSearch(notebookId);
  json(ctx.res, 200, { cells: serialized });
});

router.add("POST", "/api/notebooks/:id/cells", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const position = wholeNumber(body["position"]);
  const cellType = body["cell_type"] === "markdown" ? "markdown" : "code";
  const source = strOr(body["source"], "");
  const notebookId = ctx.params.id;
  const cellCount = Number((await one<{ count: string }>("SELECT count(*) AS count FROM cells WHERE notebook_id = $1", [notebookId]))?.count ?? "0");
  if (position === null || position < 0 || position > cellCount) {
    throw validationFailed([{ path: "position", message: `must be between 0 and ${cellCount}` }]);
  }
  const newIds = await withTransaction(async (client) => {
    await client.query("UPDATE cells SET position = position + 1 WHERE notebook_id = $1 AND position >= $2", [notebookId, position]);
    const id = newId("c");
    await client.query(
      "INSERT INTO cells (notebook_id, id, position, cell_type, source) VALUES ($1, $2, $3, $4, $5)",
      [notebookId, id, position, cellType, source],
    );
    await normalizePositions(client, notebookId);
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
    return [id];
  });
  await publishAfterStructural(notebookId);
  const cells = await loadCells(notebookId);
  json(ctx.res, 201, { cells: cells.map(serializeCell), new_ids: newIds });
});

router.add("POST", "/api/notebooks/:id/cells/paste", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const position = wholeNumber(body["position"]);
  const cellList = Array.isArray(body["cells"]) ? (body["cells"] as Body[]) : [];
  const count = Number((await one<{ count: string }>("SELECT count(*) AS count FROM cells WHERE notebook_id = $1", [notebookId]))?.count ?? "0");
  const errors: { path: string; message: string }[] = [];
  if (position === null || position < 0 || position > count) {
    errors.push({ path: "position", message: `must be between 0 and ${count}` });
  }
  const parsedCells: { type: CellType; source: string }[] = [];
  cellList.forEach((cellBody, i) => {
    const type = cellBody["cell_type"];
    if (type !== "code" && type !== "markdown") {
      errors.push({ path: `cells[${i}].cell_type`, message: 'must be "code" or "markdown"' });
      return;
    }
    const source = str(cellBody["source"]);
    if (source === null || countPoints(source) > 1_000_000) {
      errors.push({ path: `cells[${i}].source`, message: "must be at most 1,000,000 characters" });
      return;
    }
    parsedCells.push({ type, source });
  });
  if (errors.length > 0) throw validationFailed(errors);
  const insertAt = position as number;
  const newIds = await withTransaction(async (client) => {
    await client.query("UPDATE cells SET position = position + $3 WHERE notebook_id = $1 AND position >= $2", [notebookId, insertAt, parsedCells.length]);
    const ids: string[] = [];
    for (let i = 0; i < parsedCells.length; i++) {
      const id = newId("c");
      await client.query(
        "INSERT INTO cells (notebook_id, id, position, cell_type, source) VALUES ($1, $2, $3, $4, $5)",
        [notebookId, id, insertAt + i, parsedCells[i].type, parsedCells[i].source],
      );
      ids.push(id);
    }
    await normalizePositions(client, notebookId);
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
    return ids;
  });
  await publishAfterStructural(notebookId);
  const cells = await loadCells(notebookId);
  json(ctx.res, 201, { cells: cells.map(serializeCell), new_ids: newIds });
});

router.add("POST", "/api/notebooks/:id/cells/delete", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const tabId = str(body["tab_id"]) ?? "";
  const ids = Array.isArray(body["ids"]) ? (body["ids"] as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const notebookId = ctx.params.id;
  const current = await loadCells(notebookId);
  const known = new Set(current.map((c) => c.id));
  if (ids.some((id) => !known.has(id))) {
    throw validationFailed([{ path: "ids", message: "must name cells of this notebook" }]);
  }
  for (const id of ids) {
    const lock = await one<{ tab_id: string; holder: string }>(
      "SELECT tab_id, holder_display_name AS holder FROM locks WHERE notebook_id = $1 AND cell_id = $2",
      [notebookId, id],
    );
    if (lock !== null && lock.tab_id !== tabId) {
      throw new ApiError(409, "cell_locked", "This cell is being edited by someone else.", { cell_id: id, holder: lock.holder });
    }
  }
  await withTransaction(async (client) => {
    const seq = await client.query<{ next: bigint }>("SELECT nextval('deleted_seq') AS next");
    const seqValue = seq.rows[0]?.next ?? BigInt(0);
    for (const id of ids) {
      const cell = current.find((c) => c.id === id);
      if (cell === undefined) continue;
      await client.query(
        `INSERT INTO deleted_cells (notebook_id, id, position, cell_type, source, outputs, metadata, deleted_seq)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
         ON CONFLICT (notebook_id, id) DO UPDATE SET position = EXCLUDED.position, deleted_seq = EXCLUDED.deleted_seq`,
        [notebookId, id, cell.position, cell.cell_type, cell.source, JSON.stringify(cell.outputs), JSON.stringify(cell.metadata), seqValue],
      );
      await client.query("DELETE FROM cells WHERE notebook_id = $1 AND id = $2", [notebookId, id]);
    }
    const remaining = await client.query<{ count: string }>("SELECT count(*) AS count FROM cells WHERE notebook_id = $1", [notebookId]);
    if (Number(remaining.rows[0].count) === 0) {
      await client.query(
        "INSERT INTO cells (notebook_id, id, position, cell_type, source) VALUES ($1, $2, 0, 'code', '')",
        [notebookId, newId("c")],
      );
    }
    await normalizePositions(client, notebookId);
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
  });
  await publishAfterStructural(notebookId);
  const cells = await loadCells(notebookId);
  json(ctx.res, 200, { cells: cells.map(serializeCell) });
});

router.add("POST", "/api/notebooks/:id/cells/restore", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const ids = Array.isArray(body["ids"]) ? (body["ids"] as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const notebookId = ctx.params.id;
  const restored = await withTransaction(async (client) => {
    const result: Cell[] = [];
    const count = Number(
      (await client.query<{ count: string }>("SELECT count(*) AS count FROM cells WHERE notebook_id = $1", [notebookId])).rows[0].count,
    );
    for (const id of ids) {
      const deleted = await client.query<{ id: string; position: number; cell_type: string; source: string; outputs: unknown; metadata: unknown; deleted_seq: bigint }>(
        "SELECT id, position, cell_type, source, outputs, metadata, deleted_seq FROM deleted_cells WHERE notebook_id = $1 AND id = $2",
        [notebookId, id],
      );
      if (deleted.rows.length === 0) throw new ApiError(409, "not_deleted", "These cells were not deleted from this notebook.");
      const row = deleted.rows[0];
      const position = Math.min(row.position, count);
      await client.query("UPDATE cells SET position = position + 1 WHERE notebook_id = $1 AND position >= $2", [notebookId, position]);
      await client.query(
        "INSERT INTO cells (notebook_id, id, position, cell_type, source, outputs, metadata, run_state, execution_count, revision) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'idle', NULL, 1)",
        [notebookId, row.id, position, row.cell_type, row.source, JSON.stringify(row.outputs), JSON.stringify(row.metadata)],
      );
      await client.query("DELETE FROM deleted_cells WHERE notebook_id = $1 AND id = $2", [notebookId, id]);
      result.push({
        id: row.id,
        position,
        cell_type: row.cell_type as CellType,
        source: row.source,
        revision: 1,
        execution_count: null,
        run_state: "idle",
        outputs: row.outputs as Output[],
        outputs_version: 1,
        metadata: row.metadata as Record<string, unknown>,
        locked_by: null,
      });
    }
    await normalizePositions(client, notebookId);
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
    return result;
  });
  await publishAfterStructural(notebookId);
  const cells = await loadCells(notebookId);
  json(ctx.res, 200, { cells: cells.map(serializeCell) });
});

router.add("POST", "/api/notebooks/:id/cells/:cellId/move", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const cellId = ctx.params.cellId;
  const tabId = str(body["tab_id"]) ?? "";
  const position = wholeNumber(body["position"]);
  const current = await loadCells(notebookId);
  const cell = current.find((c) => c.id === cellId);
  if (cell === undefined) throw new ApiError(404, "not_found", "Notebook not found.");
  const lock = await one<{ tab_id: string; holder: string }>(
    "SELECT tab_id, holder_display_name AS holder FROM locks WHERE notebook_id = $1 AND cell_id = $2",
    [notebookId, cellId],
  );
  if (lock !== null && lock.tab_id !== tabId) {
    throw new ApiError(409, "cell_locked", "This cell is being edited by someone else.", { cell_id: cellId, holder: lock.holder });
  }
  const count = current.length;
  if (position === null || position < 0 || position > count - 1) {
    throw validationFailed([{ path: "position", message: `must be between 0 and ${count - 1}` }]);
  }
  await withTransaction(async (client) => {
    const rest = current.filter((c) => c.id !== cellId);
    rest.splice(position, 0, cell);
    for (let i = 0; i < rest.length; i++) {
      await client.query("UPDATE cells SET position = $3 WHERE notebook_id = $1 AND id = $2", [notebookId, rest[i].id, i]);
    }
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
  });
  await publishAfterStructural(notebookId);
  const cells = await loadCells(notebookId);
  json(ctx.res, 200, { cells: cells.map(serializeCell) });
});

router.add("POST", "/api/notebooks/:id/cells/:cellId/split", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const cellId = ctx.params.cellId;
  const tabId = str(body["tab_id"]) ?? "";
  const baseRevision = wholeNumber(body["base_revision"]);
  const line = wholeNumber(body["line"]);
  const current = await loadCells(notebookId);
  const cell = current.find((c) => c.id === cellId);
  if (cell === undefined) throw new ApiError(404, "not_found", "Notebook not found.");
  const lock = await one<{ tab_id: string; holder: string }>(
    "SELECT tab_id, holder_display_name AS holder FROM locks WHERE notebook_id = $1 AND cell_id = $2",
    [notebookId, cellId],
  );
  if (lock !== null && lock.tab_id !== tabId) {
    throw new ApiError(409, "cell_locked", "This cell is being edited by someone else.", { cell_id: cellId, holder: lock.holder });
  }
  const lineCount = cell.source.split("\n").length;
  if (baseRevision === null || cell.revision !== baseRevision) {
    json(ctx.res, 409, {
      error: "stale_revision",
      message: "This notebook changed elsewhere.",
      cells: [serializeCell(cell)],
    });
    return;
  }
  if (line === null || line < 2 || line > lineCount) {
    throw validationFailed([{ path: "line", message: `must be between 2 and ${lineCount}` }]);
  }
  const lines = cell.source.split("\n");
  const upper = lines.slice(0, line - 1).join("\n");
  const lower = lines.slice(line - 1).join("\n");
  const newIds = await withTransaction(async (client) => {
    await client.query("UPDATE cells SET position = position + 1 WHERE notebook_id = $1 AND position > $2", [notebookId, cell.position]);
    const newCellId = newId("c");
    await client.query(
      "INSERT INTO cells (notebook_id, id, position, cell_type, source) VALUES ($1, $2, $3, $4, $5)",
      [notebookId, newCellId, cell.position + 1, cell.cell_type, lower],
    );
    await client.query(
      "UPDATE cells SET source = $3, revision = revision + 1, execution_count = NULL, outputs = '[]'::jsonb, run_state = 'idle', outputs_version = outputs_version + 1 WHERE notebook_id = $1 AND id = $2",
      [notebookId, cellId, upper],
    );
    await normalizePositions(client, notebookId);
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
    return [newCellId];
  });
  await publishAfterStructural(notebookId);
  const cells = await loadCells(notebookId);
  json(ctx.res, 200, { cells: cells.map(serializeCell), new_ids: newIds });
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

router.add("POST", "/api/notebooks/:id/cells/merge", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const tabId = str(body["tab_id"]) ?? "";
  const ids = Array.isArray(body["ids"]) ? (body["ids"] as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const baseRevisions = body["base_revisions"];
  const current = await loadCells(notebookId);
  const byId = new Map(current.map((c) => [c.id, c]));
  const chosen = ids.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (chosen.length < 2) {
    throw validationFailed([{ path: "ids", message: "must be two or more adjacent cells in order" }]);
  }
  const positions = chosen.map((c) => c.position);
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] !== positions[i - 1] + 1) {
      throw validationFailed([{ path: "ids", message: "must be two or more adjacent cells in order" }]);
    }
  }
  if (new Set(chosen.map((c) => c.cell_type)).size > 1) {
    throw validationFailed([{ path: "ids", message: "must all be the same cell type" }]);
  }
  for (const cell of chosen) {
    const lock = await one<{ tab_id: string; holder: string }>(
      "SELECT tab_id, holder_display_name AS holder FROM locks WHERE notebook_id = $1 AND cell_id = $2",
      [notebookId, cell.id],
    );
    if (lock !== null && lock.tab_id !== tabId) {
      throw new ApiError(409, "cell_locked", "This cell is being edited by someone else.", { cell_id: cell.id, holder: lock.holder });
    }
  }
  if (!isObject(baseRevisions)) {
    throw validationFailed([{ path: "base_revisions", message: "must be an object" }]);
  }
  const stale = chosen.filter((cell) => {
    const given = wholeNumber(baseRevisions[cell.id]);
    return given === null || given !== cell.revision;
  });
  if (stale.length > 0) {
    json(ctx.res, 409, {
      error: "stale_revision",
      message: "This notebook changed elsewhere.",
      cells: stale.map((c) => serializeCell(c)),
    });
    return;
  }
  const mergedSource = chosen.map((c) => c.source).join("\n");
  const first = chosen[0];
  await withTransaction(async (client) => {
    for (const cell of chosen.slice(1)) {
      await client.query("DELETE FROM cells WHERE notebook_id = $1 AND id = $2", [notebookId, cell.id]);
    }
    await client.query(
      "UPDATE cells SET source = $3, revision = revision + 1, execution_count = NULL, outputs = '[]'::jsonb, run_state = 'idle', outputs_version = outputs_version + 1 WHERE notebook_id = $1 AND id = $2",
      [notebookId, first.id, mergedSource],
    );
    await normalizePositions(client, notebookId);
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
  });
  await publishAfterStructural(notebookId);
  const cells = await loadCells(notebookId);
  json(ctx.res, 200, { cells: cells.map(serializeCell) });
});

// ---------------------------------------------------------------------------
// Locks and presence
// ---------------------------------------------------------------------------

router.add("POST", "/api/notebooks/:id/cells/:cellId/lock", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const cellId = ctx.params.cellId;
  const tabId = str(body["tab_id"]) ?? "";
  const cell = await one<{ id: string }>("SELECT id FROM cells WHERE notebook_id = $1 AND id = $2", [notebookId, cellId]);
  if (cell === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const existing = await one<{ tab_id: string; holder_display_name: string }>(
    "SELECT tab_id, holder_display_name FROM locks WHERE notebook_id = $1 AND cell_id = $2",
    [notebookId, cellId],
  );
  if (existing !== null && existing.tab_id !== tabId) {
    throw new ApiError(409, "cell_locked", "This cell is being edited by someone else.", { cell_id: cellId, holder: existing.holder_display_name });
  }
  if (existing === null) {
    await query(
      "INSERT INTO locks (notebook_id, cell_id, tab_id, holder_display_name) VALUES ($1, $2, $3, $4)",
      [notebookId, cellId, tabId, user.display_name],
    );
  } else {
    await query("UPDATE locks SET last_seen = now() WHERE notebook_id = $1 AND cell_id = $2", [notebookId, cellId]);
  }
  await publishLocks(notebookId, cellId);
  json(ctx.res, 200, { cell_id: cellId, holder: user.display_name });
});

router.add("DELETE", "/api/notebooks/:id/cells/:cellId/lock", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const notebookId = ctx.params.id;
  const cellId = ctx.params.cellId;
  const tabId = ctx.query.get("tab_id") ?? "";
  await query("DELETE FROM locks WHERE notebook_id = $1 AND cell_id = $2 AND tab_id = $3", [notebookId, cellId, tabId]);
  await publishLocks(notebookId, cellId);
  ctx.res.writeHead(204, { "content-length": "0" });
  ctx.res.end();
});

router.add("POST", "/api/notebooks/:id/presence", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const tabId = str(body["tab_id"]) ?? "";
  const cellId = typeof body["cell_id"] === "string" ? (body["cell_id"] as string) : null;
  await query(
    `INSERT INTO presence (notebook_id, tab_id, user_id, display_name, cell_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (notebook_id, tab_id) DO UPDATE SET user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name, cell_id = EXCLUDED.cell_id, last_seen = now()`,
    [notebookId, tabId, user.id, user.display_name, cellId],
  );
  await query("UPDATE locks SET last_seen = now() WHERE notebook_id = $1 AND tab_id = $2", [notebookId, tabId]);
  await publishPresence(notebookId);
  const rows = await query<{ tab_id: string; user_id: string; display_name: string; cell_id: string | null }>(
    "SELECT tab_id, user_id, display_name, cell_id FROM presence WHERE notebook_id = $1 ORDER BY display_name, tab_id",
    [notebookId],
  );
  json(ctx.res, 200, { present: rows.rows });
});

router.add("GET", "/api/notebooks/:id/presence", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  const rows = await query<{ tab_id: string; user_id: string; display_name: string; cell_id: string | null }>(
    "SELECT tab_id, user_id, display_name, cell_id FROM presence WHERE notebook_id = $1 ORDER BY display_name, tab_id",
    [ctx.params.id],
  );
  json(ctx.res, 200, { present: rows.rows });
});

// ---------------------------------------------------------------------------
// Runs and kernel status
// ---------------------------------------------------------------------------

router.add("POST", "/api/notebooks/:id/runs", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const runId = str(body["run_id"]) ?? "";
  const cellId = str(body["cell_id"]) ?? "";
  const tabId = str(body["tab_id"]) ?? "";
  const cell = await one<{ id: string; cell_type: string; run_state: string }>(
    "SELECT id, cell_type, run_state FROM cells WHERE notebook_id = $1 AND id = $2",
    [notebookId, cellId],
  );
  if (cell === null) throw new ApiError(404, "not_found", "Notebook not found.");
  if (cell.cell_type !== "code") {
    throw validationFailed([{ path: "cell_id", message: "must be a code cell" }]);
  }
  const reused = await findRun(notebookId, runId);
  if (reused !== null) throw new ApiError(409, "run_id_reused", "This run id was already used.");
  if (cell.run_state === "queued" || cell.run_state === "running") {
    throw new ApiError(409, "illegal_transition", "This cell is already running.", { from: cell.run_state, to: "queued" });
  }
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO runs (notebook_id, run_id, cell_id, tab_id, state, prev_state)
       SELECT $1, $2, $3, $4, 'queued', CASE WHEN c.run_state IN ('queued','running') THEN 'idle' ELSE c.run_state END
       FROM cells c WHERE c.notebook_id = $1 AND c.id = $3`,
      [notebookId, runId, cellId, tabId],
    );
    await client.query("UPDATE cells SET run_state = 'queued' WHERE notebook_id = $1 AND id = $2", [notebookId, cellId]);
  });
  await publishCells(notebookId);
  json(ctx.res, 202, { run: { run_id: runId, cell_id: cellId, state: "queued" } });
});

router.add("POST", "/api/notebooks/:id/runs/:runId/start", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const notebookId = ctx.params.id;
  const runId = ctx.params.runId;
  const run = await findRun(notebookId, runId);
  if (run === null) throw new ApiError(404, "not_found", "Notebook not found.");
  if (!runTransitionAllowed(run.state, "running")) {
    throw new ApiError(409, "illegal_transition", "This run cannot start.", { from: run.state, to: "running" });
  }
  await withTransaction(async (client) => {
    await client.query("UPDATE runs SET state = 'running' WHERE notebook_id = $1 AND run_id = $2", [notebookId, runId]);
    await client.query("UPDATE cells SET run_state = 'running' WHERE notebook_id = $1 AND id = $2", [notebookId, run.cell_id]);
  });
  await publishCells(notebookId);
  json(ctx.res, 200, { run: { run_id: runId, cell_id: run.cell_id, state: "running" } });
});

router.add("POST", "/api/notebooks/:id/runs/:runId/result", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const runId = ctx.params.runId;
  const status = str(body["status"]) ?? "";
  const outputs = Array.isArray(body["outputs"]) ? (body["outputs"] as Output[]) : [];
  const run = await findRun(notebookId, runId);
  if (run === null) throw new ApiError(404, "not_found", "Notebook not found.");
  if (run.stored_response !== null) {
    json(ctx.res, 200, run.stored_response as Record<string, unknown>);
    return;
  }
  const allowed = ["finished", "failed", "interrupted", "not_run", "cancelled"];
  if (!allowed.includes(status)) {
    throw validationFailed([{ path: "status", message: "must be finished, failed, interrupted, not_run or cancelled" }]);
  }
  if (!runTransitionAllowed(run.state, status)) {
    throw new ApiError(409, "illegal_transition", "This run cannot move there.", { from: run.state, to: status });
  }
  const result = await withTransaction(async (client) => {
    const applied = await applyRunResult({ client, notebookId, runId, state: status, outputs });
    const cell = await client.query(
      "SELECT id, position, cell_type, source, revision, execution_count, run_state, outputs, outputs_version, metadata FROM cells WHERE notebook_id = $1 AND id = $2",
      [notebookId, applied.run.cell_id],
    );
    const response = {
      run: { run_id: runId, cell_id: applied.run.cell_id, state: status, execution_count: applied.executionCount },
      cell: cell.rows[0],
    };
    await client.query("UPDATE runs SET stored_response = $3 WHERE notebook_id = $1 AND run_id = $2", [notebookId, runId, JSON.stringify(response)]);
    return response;
  });
  await publishRunResult(notebookId, run.cell_id);
  json(ctx.res, 200, result);
});

router.add("POST", "/api/notebooks/:id/kernel", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const tabId = str(body["tab_id"]) ?? "";
  const status = str(body["status"]) ?? "";
  if (!["starting", "idle", "busy", "interrupted", "restarting"].includes(status)) {
    throw validationFailed([{ path: "status", message: "must be a kernel status" }]);
  }
  const previous = await one<{ status: string | null }>(
    "SELECT status FROM kernel_reports WHERE notebook_id = $1 AND tab_id = $2",
    [notebookId, tabId],
  );
  const from = previous?.status ?? "starting";
  if (!kernelTransitionAllowed(from, status)) {
    throw new ApiError(409, "illegal_transition", "The kernel cannot move there.", { from, to: status });
  }
  await query(
    `INSERT INTO kernel_reports (notebook_id, tab_id, status) VALUES ($1, $2, $3)
     ON CONFLICT (notebook_id, tab_id) DO UPDATE SET status = EXCLUDED.status, reported_at = now()`,
    [notebookId, tabId, status],
  );
  if (status === "restarting") {
    await cancelQueuedRunsInTab(notebookId, tabId);
  }
  const shown = await notebookKernelStatus(notebookId);
  publish(notebookId, { type: "kernel_status", kernel_status: shown });
  json(ctx.res, 200, { kernel_status: shown });
});

router.add("GET", "/api/notebooks/:id/cells/:cellId/outputs/:index/rows", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  const notebookId = ctx.params.id;
  const cellId = ctx.params.cellId;
  const { index, version, offset, limit: requestedLimit } = validateTableRequest({
    index: /^\d+$/.test(ctx.params.index) ? Number(ctx.params.index) : null,
    version: ctx.query.get("version"),
    offset: ctx.query.get("offset"),
    limit: ctx.query.get("limit"),
  });
  const limit = Math.min(requestedLimit, limits.table_page_rows);
  const cell = await one<{ outputs: unknown; outputs_version: number }>(
    "SELECT outputs, outputs_version FROM cells WHERE notebook_id = $1 AND id = $2",
    [notebookId, cellId],
  );
  if (cell === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const outputs = (cell.outputs ?? []) as Output[];
  if (index >= outputs.length) {
    throw validationFailed([{ path: "index", message: "must name an output of this cell" }]);
  }
  const output = outputs[index];
  const table = tableFromOutput(output);
  if (table === null) {
    throw validationFailed([{ path: "index", message: "must be a table output" }]);
  }
  if (cell.outputs_version !== version) {
    json(ctx.res, 409, { error: "output_replaced", message: "This output was replaced by a new run.", version: cell.outputs_version });
    return;
  }
  const effectiveOffset = offset >= table.total ? table.total : offset;
  json(ctx.res, 200, {
    columns: table.columns,
    rows: table.rows.slice(effectiveOffset, effectiveOffset + limit),
    offset: effectiveOffset,
    total: table.total,
    version,
  });
});

// ---------------------------------------------------------------------------
// Live connection
// ---------------------------------------------------------------------------

router.add("GET", "/api/notebooks/:id/events", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  const tabId = ctx.query.get("tab_id");
  if (tabId === null || tabId === "") {
    throw validationFailed([{ path: "tab_id", message: "is required" }]);
  }
  subscribe(ctx.params.id, tabId, user.id, ctx.res);
});

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

async function createCheckpoint(notebookId: string, label: string): Promise<Checkpoint> {
  const cells = await loadCells(notebookId);
  const snapshot = snapshotFromCells(cells, {
    kernelspec: { name: "brackenpad-js", display_name: "JavaScript (Brackenpad)", language: "javascript" },
    language_info: { name: "javascript" },
  });
  const number = Number(
    (await one<{ next: number }>("SELECT coalesce(max(number), 0) + 1 AS next FROM checkpoints WHERE notebook_id = $1", [notebookId]))?.next ?? 1,
  );
  const id = newId("cp");
  const buffer = Buffer.from(JSON.stringify(snapshot, null, 1), "utf8");
  const put = await s3.put(s3.checkpointKey(notebookId, id), buffer, "application/json");
  if (!put) throw new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
  await query("INSERT INTO checkpoints (id, notebook_id, number, label) VALUES ($1, $2, $3, $4)", [id, notebookId, number, label]);
  const kept = await query<{ id: string }>(
    "SELECT id FROM checkpoints WHERE notebook_id = $1 ORDER BY number DESC",
    [notebookId],
  );
  for (const row of kept.rows.slice(limits.checkpoints_kept)) {
    await s3.remove(s3.checkpointKey(notebookId, row.id));
    await query("DELETE FROM checkpoints WHERE id = $1", [row.id]);
  }
  publish(notebookId, { type: "checkpoints", checkpoints: await listCheckpoints(notebookId) });
  return {
    id,
    number,
    label,
    created_at: new Date().toISOString(),
    status: "saved",
  };
}

async function listCheckpoints(notebookId: string): Promise<Checkpoint[]> {
  const rows = await query<{ id: string; number: number; label: string; created_at: string }>(
    "SELECT id, number, label, created_at FROM checkpoints WHERE notebook_id = $1 ORDER BY number DESC",
    [notebookId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    number: row.number,
    label: row.label,
    created_at: new Date(row.created_at).toISOString(),
    status: "saved",
  }));
}

router.add("GET", "/api/notebooks/:id/checkpoints", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  json(ctx.res, 200, { checkpoints: await listCheckpoints(ctx.params.id) });
});

router.add("POST", "/api/notebooks/:id/checkpoints", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const body = bodyObject(ctx);
  const label = body["label"] === undefined ? null : str(body["label"]);
  if (label !== null && (countPoints(label) < 1 || countPoints(label) > 60)) {
    throw validationFailed([{ path: "label", message: "must be 1 to 60 characters" }]);
  }
  const number = Number((await one<{ next: number }>("SELECT coalesce(max(number), 0) + 1 AS next FROM checkpoints WHERE notebook_id = $1", [ctx.params.id]))?.next ?? 1);
  const checkpoint = await createCheckpoint(ctx.params.id, label ?? `Checkpoint ${number}`);
  json(ctx.res, 201, { checkpoint });
});

async function loadCheckpointSnapshot(notebookId: string, checkpointId: string): Promise<Record<string, unknown> | null> {
  const meta = await one<{ id: string }>(
    "SELECT id FROM checkpoints WHERE notebook_id = $1 AND id = $2",
    [notebookId, checkpointId],
  );
  if (meta === null) return null;
  const buffer = await s3.get(s3.checkpointKey(notebookId, checkpointId));
  if (buffer === null) return null;
  try {
    return JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

router.add("GET", "/api/notebooks/:id/checkpoints/:cpId/compare", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  const notebookId = ctx.params.id;
  const snapshot = await loadCheckpointSnapshot(notebookId, ctx.params.cpId);
  if (snapshot === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const meta = await one<{ id: string }>("SELECT id FROM checkpoints WHERE notebook_id = $1 AND id = $2", [notebookId, ctx.params.cpId]);
  if (meta === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const snapshotCells = (snapshot["cells"] as Record<string, unknown>[]).map((cell, index) => ({
    id: cell["id"] as string,
    position: index,
    cell_type: cell["cell_type"] as CellType,
    source: cell["source"] as string,
    revision: 1,
    execution_count: (cell["execution_count"] as number | null) ?? null,
    run_state: "idle" as const,
    outputs: ((cell["outputs"] as Output[]) ?? []),
    outputs_version: 1,
    metadata: (cell["metadata"] as Record<string, unknown>) ?? {},
    locked_by: null,
  }));
  const current = await loadCells(notebookId);
  json(ctx.res, 200, compareNotebooks(snapshotCells, current));
});

router.add("POST", "/api/notebooks/:id/checkpoints/:cpId/revert", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor"]);
  const notebookId = ctx.params.id;
  const checkpointId = ctx.params.cpId;
  const body = bodyObject(ctx);
  const cellId = body["cell_id"] === undefined ? null : str(body["cell_id"]);
  const checkpointMeta = await one<{ label: string }>(
    "SELECT label FROM checkpoints WHERE notebook_id = $1 AND id = $2",
    [notebookId, checkpointId],
  );
  if (checkpointMeta === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const snapshot = await loadCheckpointSnapshot(notebookId, checkpointId);
  if (snapshot === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const snapshotCells = (snapshot["cells"] as Record<string, unknown>[]).map((cell, index) => ({
    id: cell["id"] as string,
    position: index,
    cell_type: cell["cell_type"] as CellType,
    source: cell["source"] as string,
    execution_count: (cell["execution_count"] as number | null) ?? null,
    outputs: ((cell["outputs"] as Output[]) ?? []),
    metadata: (cell["metadata"] as Record<string, unknown>) ?? {},
  }));
  const current = await loadCells(notebookId);
  const beforeRevert = await createCheckpoint(notebookId, "Before revert");
  await withTransaction(async (client) => {
    if (cellId === null) {
      await client.query("DELETE FROM cells WHERE notebook_id = $1", [notebookId]);
      for (let i = 0; i < snapshotCells.length; i++) {
        const cell = snapshotCells[i];
        await client.query(
          `INSERT INTO cells (notebook_id, id, position, cell_type, source, execution_count, run_state, outputs, outputs_version, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::int::text IS NULL THEN 'not_run' ELSE 'finished' END, $7::jsonb, 1, $8::jsonb)
           ON CONFLICT (notebook_id, id) DO UPDATE SET position = EXCLUDED.position, cell_type = EXCLUDED.cell_type, source = EXCLUDED.source,
             execution_count = EXCLUDED.execution_count, run_state = EXCLUDED.run_state, outputs = EXCLUDED.outputs, outputs_version = 1, metadata = EXCLUDED.metadata`,
          [notebookId, cell.id, i, cell.cell_type, cell.source, cell.execution_count, JSON.stringify(cell.outputs), JSON.stringify(cell.metadata)],
        );
      }
    } else {
      const target = snapshotCells.find((c) => c.id === cellId);
      const existing = current.find((c) => c.id === cellId);
      if (target === undefined && existing === undefined) {
        throw validationFailed([{ path: "cell_id", message: "is in neither version" }]);
      }
      if (target === undefined) {
        await client.query("DELETE FROM cells WHERE notebook_id = $1 AND id = $2", [notebookId, cellId]);
      } else if (existing === undefined) {
        const position = Math.min(target.position, current.length);
        await client.query("UPDATE cells SET position = position + 1 WHERE notebook_id = $1 AND position >= $2", [notebookId, position]);
        await client.query(
          `INSERT INTO cells (notebook_id, id, position, cell_type, source, execution_count, run_state, outputs, outputs_version, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::int::text IS NULL THEN 'not_run' ELSE 'finished' END, $7::jsonb, 1, $8::jsonb)`,
          [notebookId, target.id, position, target.cell_type, target.source, target.execution_count, JSON.stringify(target.outputs), JSON.stringify(target.metadata)],
        );
      } else {
        await client.query(
          `UPDATE cells SET cell_type = $3, source = $4, execution_count = $5, run_state = CASE WHEN $5::int::text IS NULL THEN 'not_run' ELSE 'finished' END,
             outputs = $6::jsonb, outputs_version = 1, metadata = $7::jsonb WHERE notebook_id = $1 AND id = $2`,
          [notebookId, target.id, target.cell_type, target.source, target.execution_count, JSON.stringify(target.outputs), JSON.stringify(target.metadata)],
        );
      }
    }
    await normalizePositions(client, notebookId);
    await client.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
  });
  await publishAfterStructural(notebookId);
  const cells = await loadCells(notebookId);
  json(ctx.res, 200, { before_revert: beforeRevert, cells: cells.map(serializeCell) });
});

// ---------------------------------------------------------------------------
// Import, export and files
// ---------------------------------------------------------------------------

router.add("POST", "/api/notebooks/import", async (ctx) => {
  const user = requireUser(ctx);
  const bytes = ctx.body as Buffer;
  const title = ctx.query.get("title") ?? "Imported notebook";
  if (title.trim() === "" || countPoints(title) > 120) {
    throw validationFailed([{ path: "title", message: "must be 1 to 120 characters" }]);
  }
  if (bytes.length > limits.import_max_bytes) {
    throw new ApiError(413, "too_large", `File is larger than ${limits.import_max_bytes.toLocaleString("en-US")} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw validationFailed([{ path: "file", message: "is not valid JSON" }]);
  }
  const { errors } = validateImport(parsed);
  if (errors.length > 0) throw importValidationError(errors);
  const working = workingCopyFromImport(parsed);
  const originalPut = await s3.put(s3.originalKey(`pending-${user.id}`), bytes, "application/octet-stream");
  if (!originalPut) throw new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
  const notebookId = newId("nb");
  let highestCount = 0;
  await withTransaction(async (client) => {
    await client.query("INSERT INTO notebooks (id, title, owner_id, imported) VALUES ($1, $2, $3, true)", [notebookId, title, user.id]);
    for (let i = 0; i < working.cells.length; i++) {
      const cell = working.cells[i];
      const hasOutputs = cell.outputs.length > 0;
      if (hasOutputs && cell.outputs.some((o) => o.output_type === "execute_result")) {
        const exec = cell.outputs.find((o) => o.output_type === "execute_result");
        if (exec !== undefined && exec.output_type === "execute_result" && typeof exec.execution_count === "number") {
          highestCount = Math.max(highestCount, exec.execution_count);
        }
      }
      const byteCapExceeded = cell.outputs.some((o) => Buffer.byteLength(JSON.stringify(o), "utf8") > limits.output_byte_cap);
      const storedOutputs = byteCapExceeded ? [] : cell.outputs;
      await client.query(
        `INSERT INTO cells (notebook_id, id, position, cell_type, source, execution_count, run_state, outputs, outputs_version, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::int::text IS NULL THEN 'idle' ELSE 'finished' END, $7::jsonb, 1, $8::jsonb)`,
        [notebookId, cell.id, i, cell.cell_type, cell.source, cell.cell_type === "code" ? cell.execution_count : null, JSON.stringify(storedOutputs), JSON.stringify(cell.metadata)],
      );
    }
    await client.query("UPDATE notebooks SET execution_counter = $2 WHERE id = $1", [notebookId, highestCount]);
  });
  for (const cell of working.cells) {
    for (const attachment of cell.attachments) {
      const put = await s3.put(s3.attachmentKey(notebookId, cell.id, attachment.name), attachment.bytes, attachment.mime);
      if (put) {
        await query(
          "INSERT INTO attachments (notebook_id, cell_id, name, mime) VALUES ($1, $2, $3, $4) ON CONFLICT (notebook_id, cell_id, name) DO NOTHING",
          [notebookId, cell.id, attachment.name, attachment.mime],
        );
      }
    }
  }
  await s3.put(s3.originalKey(notebookId), bytes, "application/octet-stream");
  await s3.remove(s3.originalKey(`pending-${user.id}`));
  await pushWorkingCopy(notebookId);
  void syncSearch(notebookId);
  json(ctx.res, 201, { notebook: await serializeNotebook(notebookId, user.id) });
});

router.add("GET", "/api/notebooks/:id/export", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  const notebookId = ctx.params.id;
  const meta = await one<{ title: string }>("SELECT title FROM notebooks WHERE id = $1", [notebookId]);
  if (meta === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const cells = await loadCells(notebookId);
  const doc = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: "brackenpad-js", display_name: "JavaScript (Brackenpad)", language: "javascript" },
      language_info: { name: "javascript" },
    },
    cells: cells.map((cell) => ({
      id: cell.id,
      cell_type: cell.cell_type,
      source: cell.source,
      metadata: cell.metadata,
      ...(cell.cell_type === "code" ? { execution_count: cell.execution_count, outputs: cell.outputs } : {}),
    })),
  };
  const buffer = Buffer.from(JSON.stringify(doc, null, 1) + "\n", "utf8");
  const exportId = newId("ex");
  const put = await s3.put(s3.exportKey(notebookId, exportId), buffer, "application/x-ipynb+json");
  if (!put) throw new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
  const safeTitle = meta.title.replace(/["\\\\\r\n]/g, " ").trim() || "notebook";
  ctx.res.writeHead(200, {
    "content-type": "application/x-ipynb+json",
    "content-disposition": `attachment; filename="${safeTitle}.ipynb"`,
    "content-length": buffer.length,
  });
  ctx.res.end(buffer);
});

router.add("GET", "/api/notebooks/:id/original", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  const notebookId = ctx.params.id;
  const meta = await one<{ imported: boolean }>("SELECT imported FROM notebooks WHERE id = $1", [notebookId]);
  if (meta === null || !meta.imported) {
    throw new ApiError(404, "no_original", "This notebook was not imported.");
  }
  const buffer = await s3.get(s3.originalKey(notebookId));
  if (buffer === null) throw new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
  ctx.res.writeHead(200, { "content-type": "application/octet-stream", "content-length": buffer.length });
  ctx.res.end(buffer);
});

router.add("GET", "/api/notebooks/:id/attachments/:cellId/:name", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner", "editor", "viewer"]);
  const meta = await one<{ mime: string }>(
    "SELECT mime FROM attachments WHERE notebook_id = $1 AND cell_id = $2 AND name = $3",
    [ctx.params.id, ctx.params.cellId, ctx.params.name],
  );
  if (meta === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const buffer = await s3.get(s3.attachmentKey(ctx.params.id, ctx.params.cellId, ctx.params.name));
  if (buffer === null) throw new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
  ctx.res.writeHead(200, { "content-type": meta.mime, "content-length": buffer.length });
  ctx.res.end(buffer);
});

// ---------------------------------------------------------------------------
// Sharing and invitations
// ---------------------------------------------------------------------------

router.add("GET", "/api/notebooks/:id/shares", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner"]);
  const rows = await query<{ id: string; email: string; display_name: string | null; role: Role; status: string }>(
    `SELECT s.id, u.email, u.display_name, s.role, s.status FROM shares s JOIN users u ON u.id = s.user_id WHERE s.notebook_id = $1`,
    [ctx.params.id],
  );
  json(ctx.res, 200, { shares: rows.rows });
});

router.add("POST", "/api/notebooks/:id/shares", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner"]);
  const body = bodyObject(ctx);
  const notebookId = ctx.params.id;
  const email = str(body["email"]) ?? "";
  const role = body["role"];
  const errors: { path: string; message: string }[] = [];
  if (!EMAIL_RE.test(email)) errors.push({ path: "email", message: "must be a valid email address" });
  if (role !== "editor" && role !== "viewer") errors.push({ path: "role", message: 'must be "editor" or "viewer"' });
  if (errors.length === 0 && email.toLowerCase() === user.email.toLowerCase()) {
    errors.push({ path: "email", message: "is the owner" });
  }
  if (errors.length === 0) {
    const already = await one<{ id: string }>(
      "SELECT s.id FROM shares s JOIN users u ON u.id = s.user_id WHERE s.notebook_id = $1 AND lower(u.email) = lower($2)",
      [notebookId, email],
    );
    if (already !== null) {
      throw new ApiError(409, "already_shared", "This person already has access.");
    }
  }
  if (errors.length > 0) throw validationFailed(errors);
  const meta = await one<{ title: string }>("SELECT title FROM notebooks WHERE id = $1", [notebookId]);
  if (meta === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const invitee = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
  if (invitee !== null) {
    const activeAlready = await one<{ id: string }>(
      "SELECT id FROM shares WHERE notebook_id = $1 AND user_id = $2",
      [notebookId, invitee.id],
    );
    if (activeAlready !== null) {
      throw new ApiError(409, "already_shared", "This person already has access.");
    }
  }
  const shareId = newId("sh");
  const token = newId("iv");
  const sent = await sendMail(invitationMail(email, user.display_name, meta.title, role as string, token));
  if (!sent) throw new ApiError(503, "mail_unavailable", "Invitation not sent: email is unavailable");
  const insertUserId = invitee?.id ?? newId("pending");
  await withTransaction(async (client) => {
    if (invitee === null) {
      // An invited address without an account gets a pending row, which the invited
      // sign-up takes over; a real sign-up never sees it as registered.
      await client.query(
        "INSERT INTO users (id, email, display_name, password_hash, verified) VALUES ($1, $2, $3, '', false)",
        [insertUserId, email, email],
      );
    }
    await client.query(
      "INSERT INTO shares (id, notebook_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'invited')",
      [shareId, notebookId, insertUserId, role],
    );
    await client.query("INSERT INTO tokens (token, kind, user_id, email) VALUES ($1, 'invite', NULL, $2)", [token, email]);
    await client.query("INSERT INTO invitations (token, share_id) VALUES ($1, $2)", [token, shareId]);
  });
  json(ctx.res, 201, { share: { id: shareId, email, display_name: null, role, status: "invited" } });
});

router.add("DELETE", "/api/notebooks/:id/shares/:shareId", async (ctx) => {
  const user = requireUser(ctx);
  await requireAccess(ctx.params.id, user.id, ["owner"]);
  const notebookId = ctx.params.id;
  const share = await one<{ user_id: string }>("SELECT user_id FROM shares WHERE id = $1 AND notebook_id = $2", [ctx.params.shareId, notebookId]);
  if (share === null) throw new ApiError(404, "not_found", "Notebook not found.");
  await query("DELETE FROM shares WHERE id = $1", [ctx.params.shareId]);
  void syncSearch(notebookId);
  await endStreamForUser(notebookId, share.user_id);
  ctx.res.writeHead(204, { "content-length": "0" });
  ctx.res.end();
});

router.add("GET", "/api/invitations/:token", async (ctx) => {
  const invite = await one<{ email: string; role: Role; notebook_title: string; owner_display_name: string }>(
    `SELECT t.email, s.role, n.title AS notebook_title, u.display_name AS owner_display_name
     FROM tokens t JOIN invitations i ON i.token = t.token JOIN shares s ON s.id = i.share_id
     JOIN notebooks n ON n.id = s.notebook_id JOIN users u ON u.id = n.owner_id
     WHERE t.token = $1 AND t.kind = 'invite'`,
    [ctx.params.token],
  );
  if (invite === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const account = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [invite.email]);
  const realAccount = account === null ? null : await one<{ display_name: string }>("SELECT display_name FROM users WHERE id = $1 AND password_hash <> ''", [account.id]);
  json(ctx.res, 200, {
    email: invite.email,
    role: invite.role,
    notebook_title: invite.notebook_title,
    owner_display_name: invite.owner_display_name,
    account_exists: realAccount !== null,
  });
});

router.add("POST", "/api/invitations/:token/accept", async (ctx) => {
  const user = requireUser(ctx);
  const invite = await one<{ share_id: string; email: string }>(
    `SELECT i.share_id, t.email FROM tokens t JOIN invitations i ON i.token = t.token
     WHERE t.token = $1 AND t.kind = 'invite'`,
    [ctx.params.token],
  );
  if (invite === null) throw new ApiError(404, "not_found", "Notebook not found.");
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new ApiError(403, "invitation_for_another_account", "This invitation is for another account.");
  }
  const share = await one<{ notebook_id: string }>("SELECT notebook_id FROM shares WHERE id = $1", [invite.share_id]);
  if (share === null) throw new ApiError(404, "not_found", "Notebook not found.");
  await query("UPDATE shares SET status = 'active' WHERE id = $1", [invite.share_id]);
  void syncSearch(share.notebook_id);
  json(ctx.res, 200, { notebook_id: share.notebook_id });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

router.add("GET", "/api/search", async (ctx) => {
  const user = requireUser(ctx);
  const q = ctx.query.get("q") ?? "";
  if (countPoints(q) < 1 || countPoints(q) > 200) {
    throw validationFailed([{ path: "q", message: "must be 1 to 200 characters" }]);
  }
  const result = await meili.search(q, user.id);
  if (!result.ok) throw new ApiError(503, "search_unavailable", "Search is unavailable right now.");
  const allowed: { id: string; title: string }[] = [];
  for (const id of result.ids) {
    const meta = await one<{ title: string }>(
      `SELECT n.title FROM notebooks n WHERE n.id = $1 AND (n.owner_id = $2 OR EXISTS (
         SELECT 1 FROM shares s WHERE s.notebook_id = n.id AND s.user_id = $2 AND s.status = 'active'))`,
      [id, user.id],
    );
    if (meta !== null) allowed.push({ id, title: meta.title });
  }
  json(ctx.res, 200, { results: allowed });
});

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

router.add("POST", "/api/grading/seed", async (ctx) => {
  if (!grading) throw new ApiError(404, "not_found", "Notebook not found.");
  const body = bodyObject(ctx);
  const userSeeds = Array.isArray(body["users"]) ? (body["users"] as Body[]) : [];
  const notebookSeeds = Array.isArray(body["notebooks"]) ? (body["notebooks"] as Body[]) : [];
  const errors: { path: string; message: string }[] = [];
  userSeeds.forEach((seed, i) => {
    if (typeof seed["email"] !== "string" || !EMAIL_RE.test(seed["email"])) errors.push({ path: `users[${i}].email`, message: "must be a valid email address" });
    if (typeof seed["password"] !== "string" || seed["password"].length < 10) errors.push({ path: `users[${i}].password`, message: "must be 10 to 128 characters" });
    if (typeof seed["display_name"] !== "string" || seed["display_name"].length < 1) errors.push({ path: `users[${i}].display_name`, message: "must be 1 to 40 characters" });
  });
  notebookSeeds.forEach((seed, i) => {
    if (typeof seed["title"] !== "string" || seed["title"].length < 1) errors.push({ path: `notebooks[${i}].title`, message: "must be 1 to 120 characters" });
    if (typeof seed["owner"] !== "string") errors.push({ path: `notebooks[${i}].owner`, message: "must name a seeded user key" });
    if (!Array.isArray(seed["cells"])) errors.push({ path: `notebooks[${i}].cells`, message: "must be an array" });
  });
  if (errors.length > 0) throw validationFailed(errors);

  const userByKey = new Map<string, string>();
  const userCookies: Record<string, { id: string; cookie: string }> = {};
  for (const seed of userSeeds) {
    const key = str(seed["key"]) ?? "";
    const email = (seed["email"] as string).toLowerCase();
    const existing = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
    const userId = existing?.id ?? newId("u");
    if (existing === null) {
      await query(
        "INSERT INTO users (id, email, display_name, password_hash, verified) VALUES ($1, $2, $3, $4, true)",
        [userId, email, seed["display_name"] as string, hashPassword(seed["password"] as string)],
      );
    }
    userByKey.set(key, userId);
    const cookie = await createSession(userId);
    userCookies[key] = { id: userId, cookie: `bp_session=${cookie}` };
  }

  const notebookCookies: Record<string, { id: string; cell_ids: string[]; checkpoint_ids: string[] }> = {};
  for (const seed of notebookSeeds) {
    const key = str(seed["key"]) ?? "";
    const ownerKey = str(seed["owner"]) ?? "";
    const ownerId = userByKey.get(ownerKey);
    if (ownerId === undefined) throw validationFailed([{ path: `notebooks[${key}].owner`, message: "must name a seeded user key" }]);
    const notebookId = newId("nb");
    const cellIds: string[] = [];
    const cells = Array.isArray(seed["cells"]) ? (seed["cells"] as Body[]) : [];
    const counter = wholeNumber(seed["execution_counter"]) ?? 0;
    await withTransaction(async (client) => {
      await client.query("INSERT INTO notebooks (id, title, owner_id, execution_counter) VALUES ($1, $2, $3, $4)", [notebookId, seed["title"] as string, ownerId, counter]);
      for (let i = 0; i < cells.length; i++) {
        const cellSeed = cells[i];
        const id = strOr(cellSeed["id"], newId("c"));
        const cellType = cellSeed["cell_type"] === "markdown" ? "markdown" : "code";
        const outputs = Array.isArray(cellSeed["outputs"]) ? (cellSeed["outputs"] as Output[]) : [];
        const execCount = wholeNumber(cellSeed["execution_count"]);
        const knownOutputs = outputs.map((o) => {
          if (o.output_type === "execute_result") return { ...o, execution_count: execCount };
          return o;
        });
        await client.query(
          `INSERT INTO cells (notebook_id, id, position, cell_type, source, execution_count, run_state, outputs, outputs_version, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 = 'markdown' OR $6::int::text IS NULL THEN 'idle' ELSE 'finished' END, $7::jsonb, 1, '{}'::jsonb)`,
          [notebookId, id, i, cellType, strOr(cellSeed["source"], ""), execCount, JSON.stringify(knownOutputs)],
        );
        cellIds.push(id);
      }
    });
    const shares = Array.isArray(seed["shares"]) ? (seed["shares"] as Body[]) : [];
    for (const shareSeed of shares) {
      const shareUser = userByKey.get(str(shareSeed["user"]) ?? "");
      if (shareUser === undefined) continue;
      await query(
        `INSERT INTO shares (id, notebook_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (notebook_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
        [newId("sh"), notebookId, shareUser, shareSeed["role"] === "viewer" ? "viewer" : "editor"],
      );
    }
    const checkpointIds: string[] = [];
    const checkpointSeeds = Array.isArray(seed["checkpoints"]) ? (seed["checkpoints"] as Body[]) : [];
    for (const cpSeed of checkpointSeeds) {
      const label = strOr(cpSeed["label"], "Checkpoint");
      const cpCells = Array.isArray(cpSeed["cells"]) ? (cpSeed["cells"] as Body[]) : [];
      const snapshot = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: cpCells.map((cellSeed, index) => ({
          id: strOr(cellSeed["id"], newId("c")),
          cell_type: cellSeed["cell_type"] === "markdown" ? "markdown" : "code",
          source: strOr(cellSeed["source"], ""),
          metadata: {},
          ...(cellSeed["cell_type"] === "markdown" ? {} : { execution_count: wholeNumber(cellSeed["execution_count"]), outputs: Array.isArray(cellSeed["outputs"]) ? cellSeed["outputs"] : [] }),
        })),
      };
      const cpId = newId("cp");
      const put = await s3.put(s3.checkpointKey(notebookId, cpId), Buffer.from(JSON.stringify(snapshot, null, 1), "utf8"), "application/json");
      if (!put) throw new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
      const number = Number((await one<{ next: number }>("SELECT coalesce(max(number), 0) + 1 AS next FROM checkpoints WHERE notebook_id = $1", [notebookId]))?.next ?? 1);
      await query("INSERT INTO checkpoints (id, notebook_id, number, label) VALUES ($1, $2, $3, $4)", [cpId, notebookId, number, label]);
      checkpointIds.push(cpId);
    }
    await pushWorkingCopy(notebookId);
    await syncSearch(notebookId);
    notebookCookies[key] = { id: notebookId, cell_ids: cellIds, checkpoint_ids: checkpointIds };
  }

  json(ctx.res, 201, { users: userCookies, notebooks: notebookCookies });
});

export { router };
