// Tracewell server. Binds 0.0.0.0 on APP_PUBLIC_PORT (default 4173) and
// serves the public board API, the staff API, the operator API and the
// browser app.

import express from "express";
import type { NextFunction, Request, Response } from "express";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { applySchemaAndSeed } from "./seed.js";
import { initVault, startVaultProbing, refreshVaultStatus } from "./vault.js";
import { ApiError, errors } from "./errors.js";
import { crossSiteGuard, bodyLimit, contentTypeGuard, sendError, readJsonBody } from "./http.js";
import * as staff from "./staff.js";
import {
  checkRole,
  createRestatement,
  clearRestatement,
  getRestatement,
  listRestatements,
  loadAudit,
  releaseRestatement,
  returnRestatement,
  saveRestatement,
  submitRestatement,
  withdrawRestatement,
} from "./restatement.js";
import { computationById } from "./computations.js";
import { serveExhibit } from "./exhibits.js";
import { handleExhibitUpload } from "./upload.js";
import { boardBody, computationBody, restatementBody, auditBody, hydrateComputation, type ComputationRow } from "./serialize.js";
import { marketNow, setRehearsalClock, getClockRow } from "./clock.js";
import { getTapeState, setTapeState, startTape } from "./tape.js";
import { startCloseProcessing, processDueCloses, ensureCloseRowsUpTo } from "./close.js";
import { ingestTick, getTickKey } from "./ticks.js";
import { isoString, nyDateString, parseIsoInstant } from "./nytime.js";
import { sessionForDate, shiftDate } from "./calendar.js";
import { wallTimeToEpochMs } from "./nytime.js";
import { FIGURE_ORDER, type FigureKey } from "./display.js";
import { pool } from "./db.js";
import type { Role, StaffUserRecord } from "./types.js";

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);

async function main(): Promise<void> {
  initVault();
  await applySchemaAndSeed();
  const vaultReachable = await refreshVaultStatus().catch(() => false);
  startVaultProbing();
  if (vaultReachable) {
    // Seeded exhibits are written at start when the vault answers its first
    // probe; otherwise within 10 seconds of the vault becoming reachable,
    // driven by the probe timer.
    const { attemptSeedExhibitWrites } = await import("./seed.js");
    await attemptSeedExhibitWrites().catch(() => undefined);
  }
  await ensureCloseRowsUpTo(await marketNow());
  await processDueCloses();
  startCloseProcessing();
  startTape();

  const app = express();
  app.disable("x-powered-by");
  app.use(crossSiteGuard);
  app.use(bodyLimit);
  app.use(contentTypeGuard((path) => path.endsWith("/exhibit")));

  const h =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };

  // ---------------------------------------------------------------------
  // Session.

  app.post(
    "/api/session",
    h(async (req, res) => {
      const body = (await readJsonBody(req)) as { email?: unknown; password?: unknown };
      const fields: Record<string, string> = {};
      if (typeof body.email !== "string" || body.email === "") fields.email = "Enter your email.";
      if (typeof body.password !== "string" || body.password === "") fields.password = "Enter your password.";
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
      const { rows } = await pool.query(
        `SELECT id, name, email, roles, password_hash FROM staff_users WHERE email = $1`,
        [body.email as string],
      );
      const user = rows[0] as
        | { id: string; name: string; email: string; roles: Role[]; password_hash: string }
        | undefined;
      if (!user || !verifyPassword(body.password as string, user.password_hash)) {
        throw errors.invalidCredentials();
      }
      const token = await staff.createSession(user.id);
      setSessionCookie(res, token);
      res.json({ user: { id: user.id, name: user.name, email: user.email, roles: user.roles } });
    }),
  );

  app.get(
    "/api/session",
    h(async (req, res) => {
      const auth = await staff.authenticate(cookieToken(req));
      if (!auth) throw errors.unauthenticated();
      res.json({ user: userBody(auth.user) });
    }),
  );

  app.delete(
    "/api/session",
    h(async (req, res) => {
      const token = cookieToken(req);
      if (token) await staff.endSession(token);
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------------
  // Public.

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get(
    "/api/clock",
    h(async (_req, res) => {
      const now = await marketNow();
      const row = await getClockRow();
      res.json({ now: isoString(now), rehearsal: row.rehearsal_base_ms !== null });
    }),
  );

  app.get(
    "/api/session-calendar",
    h(async (req, res) => {
      const date = typeof req.query.date === "string" ? req.query.date : "";
      const session = sessionForDate(date);
      if (!session) throw errors.validationFailed({ date: "Enter a 2026 date as YYYY-MM-DD." });
      res.json({
        date,
        trading_day: session.tradingDay,
        holiday: session.holiday,
        opens_at: session.openAt === null ? null : isoString(session.openAt),
        closes_at: session.closeAt === null ? null : isoString(session.closeAt),
        early_close: session.earlyClose,
      });
    }),
  );

  app.get(
    "/api/board",
    h(async (_req, res) => {
      res.json(await boardBody());
    }),
  );

  app.get(
    "/api/computations/:id",
    h(async (req, res) => {
      const record = await computationById(req.params.id ?? "");
      if (!record) throw errors.notFound();
      res.json({ computation: computationBody(record) });
    }),
  );

  app.get(
    "/api/citations/:figure/:date",
    h(async (req, res) => {
      const figure = req.params.figure as string;
      const date = req.params.date as string;
      if (!FIGURE_ORDER.includes(figure as FigureKey)) throw errors.notFound();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.notFound();
      const now = await marketNow();
      const marketDate = nyDateString(now);
      if (date > marketDate) throw errors.notFound();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parseNyDay(date) === null) throw errors.notFound();
      const dayEnd = nyDayEnd(date);
      const provisional = date === marketDate;
      if (!provisional && now < dayEnd) throw errors.notFound();
      const cutoff = provisional ? now : dayEnd;
      const { rows } = await pool.query(
        `SELECT * FROM computations WHERE figure = $1 AND computed_at < $2
          ORDER BY computed_at DESC, stored_order DESC LIMIT 1`,
        [figure, String(dayEnd)],
      );
      void cutoff;
      if (rows.length === 0) throw errors.notFound();
      res.json({
        citation: { figure, date, provisional },
        computation: computationBody(hydrateComputation(rows[0] as ComputationRow)),
      });
    }),
  );

  app.get(
    "/api/exhibits/:sha256",
    h(async (req, res) => {
      const auth = await staff.authenticate(cookieToken(req));
      await serveExhibit(req, res, auth !== null);
    }),
  );

  // ---------------------------------------------------------------------
  // Restatements (staff).

  app.get(
    "/api/restatements",
    h(async (req, res) => {
      await requireStaff(req);
      res.json({ restatements: (await listRestatements()).map(restatementBody) });
    }),
  );

  app.post(
    "/api/restatements",
    h(async (req, res) => {
      const auth = await requireStaff(req);
      checkRole(auth.user.roles, "treasury_analyst");
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const record = await createRestatement(auth.user.id, body, await marketNow());
      res.status(201).json({ restatement: restatementBody(record) });
    }),
  );

  app.get(
    "/api/restatements/:id",
    h(async (req, res) => {
      await requireStaff(req);
      res.json({ restatement: restatementBody(await getRestatement(req.params.id ?? "")) });
    }),
  );

  app.get(
    "/api/restatements/:id/audit",
    h(async (req, res) => {
      await requireStaff(req);
      res.json({ entries: (await loadAudit(req.params.id ?? "")).map(auditBody) });
    }),
  );

  app.patch(
    "/api/restatements/:id",
    h(async (req, res) => {
      const auth = await requireStaff(req);
      checkRole(auth.user.roles, "treasury_analyst");
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const record = await saveRestatement(auth.user.id, req.params.id ?? "", body, await marketNow());
      res.json({ restatement: restatementBody(record) });
    }),
  );

  app.put("/api/restatements/:id/exhibit", h(handleExhibitUpload));

  app.post(
    "/api/restatements/:id/submit",
    h(async (req, res) => {
      const auth = await requireStaff(req);
      checkRole(auth.user.roles, "treasury_analyst");
      const record = await submitRestatement(auth.user.id, req.params.id ?? "", await marketNow());
      res.json({ restatement: restatementBody(record) });
    }),
  );

  app.post(
    "/api/restatements/:id/return",
    h(async (req, res) => {
      const auth = await requireStaff(req);
      const body = (await readJsonBody(req)) as { note?: unknown };
      if (typeof body.note !== "string" || body.note.length < 10 || body.note.length > 1000) {
        throw errors.validationFailed({ note: "Use 10 to 1,000 characters." });
      }
      const record = await returnRestatement(
        auth.user.id,
        auth.user.roles,
        req.params.id ?? "",
        body.note,
        await marketNow(),
      );
      res.json({ restatement: restatementBody(record) });
    }),
  );

  app.post(
    "/api/restatements/:id/clear",
    h(async (req, res) => {
      const auth = await requireStaff(req);
      const body = (await readJsonBody(req)) as { checked?: unknown; version?: unknown };
      const fields: Record<string, string> = {};
      if (!Array.isArray(body.checked) || !body.checked.every((v) => typeof v === "string")) {
        fields.checked = "Confirm all six exhibit rows.";
      }
      if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1) {
        fields.version = "version must be a positive integer.";
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
      const record = await clearRestatement(
        auth.user.id,
        auth.user.roles,
        req.params.id ?? "",
        body.checked as string[],
        body.version as number,
        await marketNow(),
      );
      res.json({ restatement: restatementBody(record) });
    }),
  );

  app.post(
    "/api/restatements/:id/release",
    h(async (req, res) => {
      const auth = await requireStaff(req);
      checkRole(auth.user.roles, "disclosure_officer");
      const body = (await readJsonBody(req)) as { confirm?: unknown };
      if (body.confirm !== true) throw errors.validationFailed({ confirm: "Confirm the release." });
      const idempotencyKey = req.header("idempotency-key");
      if (idempotencyKey !== undefined) {
        if (idempotencyKey.length < 1 || idempotencyKey.length > 100 || !/^[\x20-\x7e]+$/.test(idempotencyKey)) {
          throw errors.validationFailed({ idempotency_key: "Use 1 to 100 visible characters." });
        }
      }
      const restatementId = req.params.id ?? "";

      // Idempotent replay is decided before the state checks.
      if (idempotencyKey !== undefined) {
        const stored = await findIdempotentRelease(auth.user.id, idempotencyKey);
        if (stored) {
          if (stored.restatementId !== restatementId) throw errors.idempotencyConflict();
          res.status(stored.status).json(stored.body);
          return;
        }
      }

      const outcome = await releaseRestatement(auth.user.id, auth.user.roles, restatementId, await marketNow());
      const status = outcome.outcome === "queued" ? 202 : 200;
      const bodyOut = { outcome: outcome.outcome, restatement: restatementBody(outcome.restatement) };
      if (idempotencyKey !== undefined) {
        await storeIdempotentRelease(auth.user.id, idempotencyKey, restatementId, status, bodyOut);
      }
      res.status(status).json(bodyOut);
    }),
  );

  app.post(
    "/api/restatements/:id/withdraw",
    h(async (req, res) => {
      const auth = await requireStaff(req);
      checkRole(auth.user.roles, "disclosure_officer");
      const body = (await readJsonBody(req)) as { note?: unknown; version?: unknown };
      const fields: Record<string, string> = {};
      if (typeof body.note !== "string" || body.note.length < 10 || body.note.length > 500) {
        fields.note = "Use 10 to 500 characters.";
      }
      if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1) {
        fields.version = "version must be a positive integer.";
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
      const record = await withdrawRestatement(
        auth.user.id,
        auth.user.roles,
        req.params.id ?? "",
        body.note as string,
        body.version as number,
        await marketNow(),
      );
      res.json({ restatement: restatementBody(record) });
    }),
  );

  // ---------------------------------------------------------------------
  // Operator.

  app.get(
    "/api/operator/tape",
    h(async (req, res) => {
      await requireOperator(req);
      const state = await getTapeState();
      res.json({ state: state.state, position: state.position });
    }),
  );

  app.put(
    "/api/operator/tape",
    h(async (req, res) => {
      await requireOperator(req);
      const body = (await readJsonBody(req)) as { state?: unknown };
      if (body.state !== "playing" && body.state !== "paused") {
        throw errors.validationFailed({ state: "Use playing or paused." });
      }
      const state = await setTapeState(body.state);
      res.json({ state: state.state, position: state.position });
    }),
  );

  app.put(
    "/api/operator/clock",
    h(async (req, res) => {
      await requireOperator(req);
      const body = (await readJsonBody(req)) as { at?: unknown };
      if (body.at === null) {
        await setRehearsalClock(null);
        await ensureCloseRowsUpTo(await marketNow());
        await processDueCloses();
        res.json({ now: isoString(await marketNow()), rehearsal: false });
        return;
      }
      if (typeof body.at !== "string" || parseIsoInstant(body.at) === null) {
        throw errors.validationFailed({ at: "Enter an instant." });
      }
      await setRehearsalClock(body.at);
      const now = await marketNow();
      await ensureCloseRowsUpTo(now);
      await processDueCloses();
      res.json({ now: isoString(now), rehearsal: true });
    }),
  );

  app.get(
    "/api/operator/tick-key",
    h(async (req, res) => {
      await requireOperator(req);
      res.json({ key: await getTickKey() });
    }),
  );

  // ---------------------------------------------------------------------
  // Internal ticks.

  app.post(
    "/api/internal/ticks",
    h(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const result = await ingestTick(rawBody, req.header("x-tick-signature"));
      res.status(result.status).json(result.body);
    }),
  );

  // ---------------------------------------------------------------------
  // Pages and static assets.

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/")) return next();
    sendError(res, errors.notFound());
  });

  const publicDir = new URL("./public/", import.meta.url).pathname;
  app.use(
    "/static",
    express.static(publicDir, {
      index: false,
      fallthrough: true,
      maxAge: "1h",
    }),
  );

  const page = (_req: Request, res: Response) => {
    res.sendFile(`${publicDir}index.html`);
  };
  app.get("/", page);
  app.get("/cite/:figure/:date", page);
  app.get("/staff", page);
  app.get("/staff/restatements", page);
  app.get("/staff/restatements/:id", page);
  app.get("/operator", page);

  app.use((_req, res) => {
    sendError(res, errors.notFound());
  });

  // The single error handler: no caught error's text ever reaches a response.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    if (res.headersSent) return;
    sendError(res, errors.internal());
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`tracewell serving on port ${PORT}`);
  });
}

// -----------------------------------------------------------------------
// Helpers.

function cookieToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === staff.SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string): void {
  res.append("Set-Cookie", `${staff.SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

function userBody(user: StaffUserRecord): Record<string, unknown> {
  return { id: user.id, name: user.name, email: user.email, roles: user.roles };
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

async function requireStaff(req: Request): Promise<staff.AuthenticatedRequest> {
  const auth = await staff.authenticate(cookieToken(req));
  if (!auth) throw errors.unauthenticated();
  return auth;
}

async function requireOperator(req: Request): Promise<staff.AuthenticatedRequest> {
  const auth = await requireStaff(req);
  checkRole(auth.user.roles, "operator");
  return auth;
}

/** A New York day's end: the midnight that ends it, at the offset in force then. */
function nyDayEnd(date: string): number {
  const next = shiftDate(date, 1);
  return wallTimeToEpochMs(
    Number(next.slice(0, 4)),
    Number(next.slice(5, 7)),
    Number(next.slice(8, 10)),
    0,
    0,
    0,
  ) as number;
}

function parseNyDay(date: string): number | null {
  const parts = wallTimeToEpochMs(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
    0,
    0,
    0,
  );
  return parts;
}

async function findIdempotentRelease(
  userId: string,
  key: string,
): Promise<{ restatementId: string; status: number; body: unknown } | null> {
  const { rows } = await pool.query(
    `SELECT restatement_id, status, body FROM idempotency WHERE user_id = $1 AND key = $2`,
    [userId, key],
  );
  const row = rows[0] as { restatement_id: string; status: number; body: unknown } | undefined;
  if (!row) return null;
  return { restatementId: row.restatement_id, status: row.status, body: row.body };
}

async function storeIdempotentRelease(
  userId: string,
  key: string,
  restatementId: string,
  status: number,
  body: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency (user_id, key, restatement_id, status, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, restatementId, status, JSON.stringify(body), String(Date.now())],
  );
}

main().catch(() => {
  // Startup failures print nothing that could leak: only that it failed.
  console.error("tracewell failed to start");
  process.exit(1);
});
