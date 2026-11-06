import { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { all, one, run, tx, CycleRow } from "../db";
import { ApiError, errors } from "../errors";
import {
  Viewer,
  originAllowed,
  parseCookies,
  parseIfMatch,
  readJsonBody,
  readRawBody,
  sendJson,
  etagOf,
  MAX_JSON_BYTES,
  MAX_UPLOAD_BYTES,
} from "./http";
import { clubInfo, cycle, household, line as lineRowOf, product, catalogue } from "../domain/club";
import { buildCycle, buildLine, cycleSummary } from "../domain/shapes";
import { createDraft, draftValidation, openCycle, patchCycle, parseCycleFields } from "../domain/cycles";
import { putPledge, withdrawPledge, lineShares } from "../domain/pledge";
import { resolveLine } from "../domain/resolution";
import { recordShort } from "../domain/shorts";
import { confirmTopup, topupsOf } from "../domain/topup";
import { checkUpload, uploadDocument, documentsOf, documentRecord, DocKind, uploadsAllowed } from "../domain/documents";
import { bagsOf, setBagItem, addFlag, flagsOf } from "../domain/bags";
import { pledgesByDay } from "../domain/daily";
import { closeCycle } from "../domain/close";
import { movementsOf, creditOf } from "../domain/ledger";
import { dollarsTextToCents } from "../money";
import { checkIdempotencyKey, withIdempotency } from "../util/idem";
import { paymentsStatus, KbTimeout, KbUnreachable } from "../providers/killbill";
import { S3Unavailable, S3Error, getObject } from "../providers/s3";
import { deliverSoon } from "../providers/mailworker";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  viewer: Viewer;
  params: Record<string, string>;
  idempotencyKey: string | undefined;
}

type Handler = (ctx: Ctx) => Promise<void>;

const personOf = (v: Viewer): string => (v.householdCode ? `${v.role}:${v.householdCode}` : `${v.role}:${v.name}`);

function requireCoordinator(ctx: Ctx): void {
  if (ctx.viewer.role !== "coordinator") throw errors.forbidden();
}

function requireVolunteerOrCoordinator(ctx: Ctx): void {
  if (ctx.viewer.role !== "volunteer" && ctx.viewer.role !== "coordinator") throw errors.forbidden();
}

function requireMember(ctx: Ctx): string {
  if (ctx.viewer.role !== "member" || !ctx.viewer.householdCode) throw errors.forbidden();
  return ctx.viewer.householdCode;
}

function getCycleOr404(id: string): CycleRow {
  const c = cycle(id);
  if (!c) throw errors.notFound();
  return c;
}

/** Compare-and-set status change with its revision bump. */
function transitionStatus(cycleId: string, from: string[], to: string): CycleRow {
  return tx(() => {
    const c = one<CycleRow>("SELECT * FROM cycles WHERE id = ?", cycleId)!;
    const effNow = Math.floor(Date.now() / 1000);
    const eff =
      c.status === "open" && c.cutoff_at !== null && effNow >= c.cutoff_at ? "sealing" : c.status;
    if (!from.includes(eff)) throw errors.illegalTransition();
    run("UPDATE cycles SET status = ?, revision = revision + 1 WHERE id = ?", to, cycleId);
    return cycle(cycleId)!;
  });
}

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

function route(method: string, pattern: string, handler: Handler): void {
  routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });
}

const SEG = "[^/]+";

function sendCycle(ctx: Ctx, c: CycleRow): void {
  sendJson(ctx.res, 200, buildCycle(c, ctx.viewer), { ETag: etagOf(c.revision) });
}

// ---------- session ----------

route("POST", "/api/session", async (ctx) => {
  const body = await readJsonBody(ctx.req);
  if (typeof body.code !== "string" || body.code.length === 0) {
    throw errors.validation({ code: "Enter your access code." });
  }
  const person = one<{ role: string; name: string }>("SELECT role, name FROM people WHERE access_code = ?", body.code);
  let viewer: Viewer | null = null;
  if (person) {
    viewer = { role: person.role as Viewer["role"], name: person.name, householdCode: null };
  } else {
    const hh = one<{ code: string; name: string }>("SELECT code, name FROM households WHERE access_code = ?", body.code);
    if (hh) viewer = { role: "member", name: hh.name, householdCode: hh.code };
  }
  if (!viewer) throw errors.invalidCode();
  const token = randomBytes(24).toString("hex");
  tx(() => {
    run(
      "INSERT INTO sessions (token, role, person_name, household_code, created_at) VALUES (?, ?, ?, ?, ?)",
      token, viewer!.role, viewer!.name, viewer!.householdCode, Math.floor(Date.now() / 1000)
    );
  });
  sendJson(ctx.res, 200, { role: viewer.role, name: viewer.name, household_code: viewer.householdCode }, {
    "Set-Cookie": `tally_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
  });
});

route("GET", "/api/me", async (ctx) => {
  sendJson(ctx.res, 200, { role: ctx.viewer.role, name: ctx.viewer.name, household_code: ctx.viewer.householdCode });
});

route("DELETE", "/api/session", async (ctx) => {
  const token = parseCookies(ctx.req.headers.cookie)["tally_session"];
  if (token) {
    tx(() => {
      run("DELETE FROM sessions WHERE token = ?", token);
    });
  }
  ctx.res.writeHead(204, {
    "Set-Cookie": "tally_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    "Cache-Control": "no-store",
  });
  ctx.res.end();
});

route("GET", "/api/club", async (ctx) => {
  sendJson(ctx.res, 200, clubInfo());
});

route("GET", "/api/catalog", async (ctx) => {
  requireCoordinator(ctx);
  sendJson(ctx.res, 200, {
    products: catalogue().map((p) => ({
      id: p.id,
      case_name: p.case_name,
      pack: p.pack,
      unit: p.unit,
      price_cents: p.price_cents,
    })),
  });
});

route("GET", "/api/payments/status", async (ctx) => {
  const state = await paymentsStatus();
  sendJson(ctx.res, 200, { payments: state });
});

// ---------- cycles ----------

route("GET", "/api/cycles", async (ctx) => {
  const rows = all<CycleRow>("SELECT * FROM cycles ORDER BY sort_order DESC");
  const visible = ctx.viewer.role === "coordinator" ? rows : rows.filter((c) => c.status !== "draft");
  sendJson(ctx.res, 200, { cycles: visible.map(cycleSummary) });
});

route("POST", "/api/cycles", async (ctx) => {
  requireCoordinator(ctx);
  const raw = await readJsonBody(ctx.req);
  if (typeof raw.name !== "string") {
    throw errors.validation({ name: "Name the cycle in 1 to 60 characters on one line." });
  }
  const fields = parseCycleFields(raw);
  const { resolved, fieldErrors, products } = draftValidation(fields, {
    cutoffSec: null,
    pickupStartSec: null,
    pickupEndSec: null,
  });
  if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
  const c = createDraft(fields, resolved, products);
  sendJson(ctx.res, 201, buildCycle(c, ctx.viewer), { ETag: etagOf(c.revision) });
});

route("GET", `/api/cycles/(${SEG})`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  const c = getCycleOr404(id);
  if (c.status === "draft" && ctx.viewer.role !== "coordinator") throw errors.notFound();
  sendCycle(ctx, c);
});

route("PATCH", `/api/cycles/(${SEG})`, async (ctx) => {
  const id = ctx.params[0];
  const c = getCycleOr404(id);
  requireCoordinator(ctx);
  const { revision } = parseIfMatch(ctx.req.headers["if-match"]);
  if (revision === null) throw errors.preconditionRequired();
  const raw = await readJsonBody(ctx.req);
  if (revision < 0 || revision !== c.revision) {
    throw errors.staleCycle(etagOf(c.revision));
  }
  const fields = parseCycleFields(raw);
  const updated = patchCycle(c, fields, Math.floor(Date.now() / 1000));
  sendCycle(ctx, updated);
});

route("POST", `/api/cycles/(${SEG})/transitions`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  const raw = await readJsonBody(ctx.req);
  const to = typeof raw.to === "string" ? raw.to : "";
  const c = getCycleOr404(id);
  requireCoordinator(ctx);

  if (to === "open") {
    const hasFields = ["name", "cutoff_local", "pickup_start_local", "pickup_end_local", "product_ids"].some(
      (k) => k in raw
    );
    const { revision } = parseIfMatch(ctx.req.headers["if-match"]);
    if (hasFields && revision === null) throw errors.preconditionRequired();
    if (hasFields && revision !== null && (revision < 0 || revision !== c.revision)) {
      throw errors.staleCycle(etagOf(c.revision));
    }
    const fields = hasFields ? parseCycleFields(raw) : {};
    const opened = openCycle(c, fields, Math.floor(Date.now() / 1000));
    sendCycle(ctx, opened);
    return;
  }

  if (to === "ordered") {
    const lineStatuses = all<{ status: string }>("SELECT status FROM lines WHERE cycle_id = ?", c.id);
    if (lineStatuses.some((l) => l.status === "filling")) throw errors.unresolvedLines();
    if (lineStatuses.length > 0 && lineStatuses.every((l) => l.status === "dropped")) {
      throw errors.nothingToOrder();
    }
    const updated = transitionStatus(c.id, ["sealing"], "ordered");
    sendCycle(ctx, updated);
    return;
  }

  if (to === "received") {
    sendCycle(ctx, transitionStatus(c.id, ["ordered"], "received"));
    return;
  }

  if (to === "breakdown") {
    sendCycle(ctx, transitionStatus(c.id, ["received"], "breakdown"));
    return;
  }

  if (to === "closed") {
    const keyError = checkIdempotencyKey(ctx.idempotencyKey);
    if (keyError) throw keyError;
    const result = await withIdempotency(
      {
        person: personOf(ctx.viewer),
        key: ctx.idempotencyKey!,
        method: "POST",
        path: `/api/cycles/${c.id}/transitions`,
        body: JSON.stringify({ to: "closed" }),
      },
      async () => {
        const outcome = await closeCycle(c).catch((e: unknown) => {
          if (e instanceof KbTimeout || e instanceof KbUnreachable) throw errors.paymentsPaused();
          if (e instanceof S3Unavailable || e instanceof S3Error) throw errors.storageUnavailable();
          throw e;
        });
        const closed = cycle(c.id)!;
        return {
          status: 200,
          body: { cycle: buildCycle(closed, ctx.viewer), receipts_queued: outcome.receiptsQueued },
        };
      }
    );
    deliverSoon();
    sendJson(ctx.res, result.status, result.body, {
      ETag: etagOf(cycle(c.id)!.revision),
      ...(result.replay ? { "Idempotent-Replay": "true" } : {}),
    });
    return;
  }

  throw errors.illegalTransition();
});

// ---------- pledges ----------

route("PUT", `/api/cycles/(${SEG})/lines/(${SEG})/pledge`, async (ctx) => {
  const id = ctx.params[0];
  const pid = ctx.params[1];
  const keyError = checkIdempotencyKey(ctx.idempotencyKey);
  if (keyError) throw keyError;
  const c = getCycleOr404(id);
  const code = requireMember(ctx);
  const p = product(pid);
  if (!p) throw errors.notFound();
  const raw = await readJsonBody(ctx.req);
  const units = raw.units;
  if (typeof units !== "number" || !Number.isInteger(units) || units < 1) {
    throw errors.validation({ units: `Choose at least 1 unit.` });
  }
  const result = await withIdempotency(
    {
      person: personOf(ctx.viewer),
      key: ctx.idempotencyKey!,
      method: "PUT",
      path: `/api/cycles/${id}/lines/${pid}/pledge`,
      body: JSON.stringify(raw),
    },
    async () => {
      putPledge(c, pid, code, units, Math.floor(Date.now() / 1000));
      const ln = lineRowOf(c.id, pid)!;
      return { status: 200, body: { line: buildLine(c, ln, p, ctx.viewer), credit: creditOf(code) } };
    }
  );
  sendJson(ctx.res, result.status, result.body, result.replay ? { "Idempotent-Replay": "true" } : undefined);
});

route("DELETE", `/api/cycles/(${SEG})/lines/(${SEG})/pledge`, async (ctx) => {
  const id = ctx.params[0];
  const pid = ctx.params[1];
  const keyError = checkIdempotencyKey(ctx.idempotencyKey);
  if (keyError) throw keyError;
  const c = getCycleOr404(id);
  const code = requireMember(ctx);
  const p = product(pid);
  if (!p) throw errors.notFound();
  const result = await withIdempotency(
    {
      person: personOf(ctx.viewer),
      key: ctx.idempotencyKey!,
      method: "DELETE",
      path: `/api/cycles/${id}/lines/${pid}/pledge`,
      body: "",
    },
    async () => {
      withdrawPledge(c, pid, code, Math.floor(Date.now() / 1000));
      const ln = lineRowOf(c.id, pid)!;
      return { status: 200, body: { line: buildLine(c, ln, p, ctx.viewer), credit: creditOf(code) } };
    }
  );
  sendJson(ctx.res, result.status, result.body, result.replay ? { "Idempotent-Replay": "true" } : undefined);
});

route("GET", `/api/cycles/(${SEG})/lines/(${SEG})/shares`, async (ctx) => {
  if (ctx.viewer.role === "volunteer") throw errors.forbidden();
  const id = decodeURIComponent(ctx.params[0]);
  const pid = decodeURIComponent(ctx.params[1]);
  const c = getCycleOr404(id);
  const ln = lineRowOf(c.id, pid);
  if (!ln) throw errors.notFound();
  if (ln.status !== "sealed" && ln.status !== "taken_up") throw errors.lineNotSealed();
  sendJson(ctx.res, 200, lineShares(c, pid));
});

// ---------- resolution and shorts ----------

route("POST", `/api/cycles/(${SEG})/lines/(${SEG})/resolution`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  const pid = decodeURIComponent(ctx.params[1]);
  const c = getCycleOr404(id);
  const raw = await readJsonBody(ctx.req);
  if (raw.action !== "drop" && raw.action !== "take_up") {
    throw errors.validation({ action: "Choose drop or take up." });
  }
  resolveLine(c, pid, raw.action);
  const ln = lineRowOf(c.id, pid)!;
  sendJson(ctx.res, 200, buildLine(c, ln, product(pid)!, ctx.viewer));
});

route("POST", `/api/cycles/(${SEG})/lines/(${SEG})/shorts`, async (ctx) => {
  const id = ctx.params[0];
  const pid = ctx.params[1];
  const keyError = checkIdempotencyKey(ctx.idempotencyKey);
  if (keyError) throw keyError;
  const c = getCycleOr404(id);
  requireCoordinator(ctx);
  const raw = await readJsonBody(ctx.req);
  const p = product(pid);
  if (!p) throw errors.notFound();
  if (typeof raw.units !== "number" || !Number.isInteger(raw.units)) {
    throw errors.validation({ units: `Enter whole units.` });
  }
  const result = await withIdempotency(
    {
      person: personOf(ctx.viewer),
      key: ctx.idempotencyKey!,
      method: "POST",
      path: `/api/cycles/${id}/lines/${pid}/shorts`,
      body: JSON.stringify(raw),
    },
    async () => {
      const outcome = recordShort(c, pid, raw.units as number);
      deliverSoon();
      const ln = lineRowOf(c.id, pid)!;
      return {
        status: 201,
        body: {
          short_id: outcome.shortId,
          line: buildLine(c, ln, p, ctx.viewer),
          affected: outcome.affected,
        },
      };
    }
  );
  sendJson(ctx.res, result.status, result.body, result.replay ? { "Idempotent-Replay": "true" } : undefined);
});

// ---------- documents ----------

route("PUT", `/api/cycles/(${SEG})/documents/invoice`, async (ctx) => {
  await handleUpload(ctx, "invoice");
});

route("PUT", `/api/cycles/(${SEG})/documents/packing-slip`, async (ctx) => {
  await handleUpload(ctx, "packing-slip");
});

async function handleUpload(ctx: Ctx, kind: DocKind): Promise<void> {
  const id = decodeURIComponent(ctx.params[0]);
  const c = getCycleOr404(id);
  requireCoordinator(ctx);
  if (!uploadsAllowed(c)) throw errors.wrongCycleState();
  const body = await readRawBody(ctx.req);
  const check = checkUpload(ctx.req.headers["content-type"], body);
  if (check instanceof ApiError) throw check;
  try {
    const stored = await uploadDocument(c, kind, body, check.type, check.ext);
    sendJson(ctx.res, 201, {
      kind: stored.kind,
      key: stored.key,
      bytes: stored.bytes,
      sha256: stored.sha256,
    });
  } catch (e) {
    if (e instanceof S3Unavailable || e instanceof S3Error) throw errors.storageUnavailable();
    throw e;
  }
}

route("GET", `/api/cycles/(${SEG})/documents`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  getCycleOr404(id);
  requireCoordinator(ctx);
  const docs = documentsOf(id).map((d) => ({
    kind: d.kind,
    key: d.key,
    bytes: d.bytes,
    sha256: d.sha256,
    uploaded_at: new Date(d.uploaded_at * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  }));
  sendJson(ctx.res, 200, { documents: docs });
});

route("GET", `/api/cycles/(${SEG})/documents/(${SEG})`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  const kindPath = decodeURIComponent(ctx.params[1]);
  getCycleOr404(id);
  requireCoordinator(ctx);
  if (kindPath !== "invoice" && kindPath !== "packing-slip") throw errors.notFound();
  const kind: DocKind = kindPath;
  const record = documentRecord(id, kind);
  if (!record) throw errors.notFound();
  let bytes: Buffer | null;
  try {
    bytes = await getObject(record.key);
  } catch (e) {
    if (e instanceof S3Unavailable || e instanceof S3Error) throw errors.storageUnavailable();
    throw e;
  }
  if (bytes === null) throw errors.notFound();
  const filename = kind === "invoice" ? "invoice.pdf" : record.key.endsWith(".png") ? "packing-slip.png" : "packing-slip.jpg";
  const contentType = kind === "invoice" ? "application/pdf" : record.key.endsWith(".png") ? "image/png" : "image/jpeg";
  ctx.res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(bytes.length),
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  ctx.res.end(bytes);
});

// ---------- bags and flags ----------

route("GET", `/api/cycles/(${SEG})/bags`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  const c = getCycleOr404(id);
  requireVolunteerOrCoordinator(ctx);
  if (c.status !== "breakdown") throw errors.wrongCycleState();
  sendJson(ctx.res, 200, { bags: bagsOf(c) });
});

route("PUT", `/api/cycles/(${SEG})/bags/(${SEG})/items/(${SEG})`, async (ctx) => {
  const id = ctx.params[0];
  const hh = ctx.params[1];
  const pid = ctx.params[2];
  const c = getCycleOr404(id);
  requireVolunteerOrCoordinator(ctx);
  const raw = await readJsonBody(ctx.req);
  if (typeof raw.packed !== "boolean") throw errors.validation({ packed: "Say whether the item is packed." });
  const bag = setBagItem(c, hh, pid, raw.packed, Math.floor(Date.now() / 1000));
  sendJson(ctx.res, 200, bag);
});

route("POST", `/api/cycles/(${SEG})/bags/(${SEG})/flags`, async (ctx) => {
  const id = ctx.params[0];
  const hh = ctx.params[1];
  const c = getCycleOr404(id);
  if (ctx.viewer.role !== "volunteer") throw errors.forbidden();
  const raw = await readJsonBody(ctx.req);
  if (typeof raw.product_id !== "string") throw errors.validation({ product_id: "Choose a case." });
  if (typeof raw.units !== "number" || !Number.isInteger(raw.units)) {
    throw errors.validation({ units: "Enter whole units." });
  }
  const flag = addFlag(c, hh, raw.product_id, raw.units, Math.floor(Date.now() / 1000));
  sendJson(ctx.res, 201, { flag });
});

route("GET", `/api/cycles/(${SEG})/flags`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  getCycleOr404(id);
  requireCoordinator(ctx);
  sendJson(ctx.res, 200, { flags: flagsOf(id) });
});

// ---------- daily and receipts ----------

route("GET", `/api/cycles/(${SEG})/daily`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  getCycleOr404(id);
  requireCoordinator(ctx);
  sendJson(ctx.res, 200, pledgesByDay(id));
});

route("GET", `/api/cycles/(${SEG})/receipts`, async (ctx) => {
  const id = decodeURIComponent(ctx.params[0]);
  getCycleOr404(id);
  requireCoordinator(ctx);
  const rows = all<{ household_code: string; to_email: string; status: string; failed_attempts: number }>(
    "SELECT household_code, to_email, status, failed_attempts FROM emails WHERE cycle_id = ? AND kind = 'receipt' ORDER BY household_code",
    id
  );
  sendJson(ctx.res, 200, {
    receipts: rows.map((r) => ({
      household_code: r.household_code,
      email: r.to_email,
      status: r.status,
      failed_attempts: r.failed_attempts,
    })),
  });
});

// ---------- top-ups ----------

route("POST", "/api/topups", async (ctx) => {
  const keyError = checkIdempotencyKey(ctx.idempotencyKey);
  if (keyError) throw keyError;
  const code = requireMember(ctx);
  const raw = await readJsonBody(ctx.req);
  if (typeof raw.amount !== "string") throw errors.validation({ amount: "Enter an amount from $5.00 to $500.00." });
  const cents = dollarsTextToCents(raw.amount);
  if (cents === null || cents < 500 || cents > 50000) {
    throw errors.validation({ amount: "Enter an amount from $5.00 to $500.00." });
  }
  const result = await withIdempotency(
    {
      person: personOf(ctx.viewer),
      key: ctx.idempotencyKey!,
      method: "POST",
      path: "/api/topups",
      body: JSON.stringify(raw),
    },
    async () => {
      try {
        return { status: 201, body: await confirmTopup(code, ctx.idempotencyKey!, cents) };
      } catch (e) {
        if (e instanceof KbTimeout || e instanceof KbUnreachable) throw errors.paymentsPaused();
        throw e;
      }
    }
  );
  sendJson(ctx.res, result.status, result.body, result.replay ? { "Idempotent-Replay": "true" } : undefined);
});

route("GET", "/api/topups", async (ctx) => {
  const code = requireMember(ctx);
  const rows = topupsOf(code).map((t) => ({
    id: t.id,
    amount_cents: t.amount_cents,
    status: t.status,
    created_at: new Date(t.created_at * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  }));
  sendJson(ctx.res, 200, { topups: rows });
});

// ---------- ledger ----------

route("GET", `/api/households/(${SEG})/ledger`, async (ctx) => {
  const hh = decodeURIComponent(ctx.params[0]);
  if (ctx.viewer.role !== "coordinator" && !(ctx.viewer.role === "member" && ctx.viewer.householdCode === hh)) {
    throw errors.forbidden();
  }
  if (!household(hh)) throw errors.notFound();
  let limit = 20;
  const limitParam = ctx.url.searchParams.get("limit");
  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam) || parseInt(limitParam, 10) < 1 || parseInt(limitParam, 10) > 50) {
      throw errors.validation({ limit: "Ask for 1 to 50 movements." });
    }
    limit = parseInt(limitParam, 10);
  }
  let beforeId: number | null = null;
  const beforeParam = ctx.url.searchParams.get("before");
  if (beforeParam !== null) {
    beforeId = decodeCursor(beforeParam);
    if (beforeId === null) throw errors.validation({ before: "That page marker isn't valid." });
  }
  const { movements, nextBefore, total } = movementsOf(hh, beforeId, limit);
  const credit = creditOf(hh);
  sendJson(ctx.res, 200, {
    household_code: hh,
    balance_cents: credit.balance_cents,
    held_cents: credit.held_cents,
    spendable_cents: credit.spendable_cents,
    total_movements: total,
    next_before: nextBefore === null ? null : encodeCursor(nextBefore),
    movements: movements.map((m) => ({
      id: m.id,
      kind: m.kind,
      cycle_id: m.cycle_id,
      memo: m.memo,
      created_at: new Date(m.created_at * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      legs: m.legs,
    })),
  });
});

function encodeCursor(id: number): string {
  return Buffer.from(`tally:${id}`, "utf8").toString("base64");
}

function decodeCursor(value: string): number | null {
  try {
    const text = Buffer.from(value, "base64").toString("utf8");
    const m = /^tally:(\d+)$/.exec(text);
    if (!m) return null;
    const id = parseInt(m[1], 10);
    if (!one<{ id: number }>("SELECT id FROM movements WHERE id = ?", id)) return null;
    return id;
  } catch {
    return null;
  }
}

route("GET", "/api/health", async (ctx) => {
  sendJson(ctx.res, 200, { status: "ok" });
});

function isUploadPath(pathname: string): boolean {
  return /^\/api\/cycles\/[^/]+\/documents\/(invoice|packing-slip)$/.test(pathname);
}

export function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  viewer: Viewer | null
): Promise<boolean> {
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/") && pathname !== "/api") return Promise.resolve(false);
  const match = routes.find((r) => r.method === req.method && r.pattern.test(pathname));
  const ctx: Ctx = {
    req,
    res,
    url,
    viewer: viewer ?? { role: "volunteer", name: "", householdCode: null },
    params: {},
    idempotencyKey: req.headers["idempotency-key"] as string | undefined,
  };
  return (async () => {
    try {
      if (!match) throw errors.notFound();
      const groups = match.pattern.exec(pathname)!.slice(1);
      ctx.params = groups.map(decodeURIComponentSafe) as unknown as Record<string, string>;

      if (req.method !== "GET" && req.method !== "HEAD" && !originAllowed(req)) {
        throw errors.forbidden();
      }

      const isUpload = req.method === "PUT" && isUploadPath(pathname);
      const declared = req.headers["content-length"];
      const declaredLength = declared !== undefined ? parseInt(declared, 10) : NaN;
      if (!Number.isNaN(declaredLength) && declaredLength > (isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES)) {
        throw errors.tooLarge();
      }
      const hasBody = declaredLength > 0 || (declared === undefined && req.method !== "GET" && req.method !== "HEAD");
      if (hasBody && !isUpload) {
        const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (ct !== "application/json") throw errors.unsupportedMediaType();
      }
      if (isUpload) {
        const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!["application/pdf", "image/jpeg", "image/png"].includes(ct)) throw errors.unsupportedMediaType();
      }

      const isPublicPath = pathname === "/api/health" || (req.method === "POST" && pathname === "/api/session");
      if (!isPublicPath && !viewer) throw errors.unauthenticated();

      await match.handler(ctx);
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return true;
      }
      if (e instanceof ApiError) {
        sendJson(res, e.status, JSON.parse(e.body()), e.headers);
      } else {
        console.error("internal error", e);
        sendJson(res, 500, { error: { code: "internal", message: "Something went wrong." } });
      }
    }
    return true;
  })();
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
