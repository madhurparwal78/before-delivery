import type { Router, Request, Response } from "express";
import type { Services } from "../services.js";
import { errors, ApiError } from "../errors.js";
import { requirePerson, role, AppRequest, handleRouteError } from "../web.js";
import {
  checkLicensable, windowHeldError, essayLockKey, isIdempotencyKeyValid, newLicenceId,
  rateAtConfirmation, effectiveEnd, licenceWindow, num, type LicenceRow, effectiveState,
} from "../domain/licensing.js";
import { attemptActivation } from "../domain/scheduler.js";
import { licenceRecipients } from "../domain/mailbody.js";
import { newsroomLicences, usageTotals, usageCsv } from "../domain/usage.js";
import { loadEssay, loadFrames } from "../domain/essays.js";
import { isoInstant, formatCoopTime, coopDateOf } from "../../shared/time.js";
import { presignOriginal } from "../storage.js";

// Licences, idempotency, grants and usage.
export function registerLicenceRoutes(router: Router, services: Services): void {
  const { sql, storage, clock, mailer } = services;

  const licenceBody = async (licence: LicenceRow, viewerNewsroomId: number): Promise<Record<string, unknown>> => {
    const nowMs = clock.now();
    const state = effectiveState(licence, nowMs);
    const takenDown = await sql`SELECT taken_down_at IS NOT NULL AS td FROM essays WHERE id = ${licence.essay_id}`;
    const effective: string = takenDown[0].td ? "revoked" : state === "removed" ? "pending_invoice" : state;
    const revoked = effective === "revoked";
    const holdUntil = licence.state === "pending_invoice" ? num(licence.hold_until) : null;
    return {
      id: licence.id,
      essay_id: licence.essay_id,
      essay_title: revoked ? "Removed essay (legal takedown)" : licence.essay_title,
      credit_line: revoked ? null : licence.credit_line,
      kind: licence.kind,
      state: effective === "removed" ? "pending_invoice" : effective,
      newsroom: { slug: licence.newsroom_slug, name: licence.newsroom_name },
      licensed_by: { name: licence.licensed_by_name },
      confirmed_at: isoInstant(num(licence.confirmed_epoch_ms)),
      confirmed_display: formatCoopTime(num(licence.confirmed_epoch_ms)),
      window_start: isoInstant(num(licence.window_start)),
      window_end: isoInstant(num(licence.window_end)),
      window_end_display: formatCoopTime(num(licence.window_end)),
      hold_until: holdUntil !== null ? isoInstant(holdUntil) : null,
      hold_until_display: holdUntil !== null ? formatCoopTime(holdUntil) : null,
      amount_minor: Number(licence.amount_minor),
      currency: "USD",
      invoice_state: licence.invoice_state,
      receipt_state: licence.receipt_state,
      frames: revoked ? [] : (await loadFrames(sql, licence.essay_id)).map((f) => ({ id: f.id, position: Number(f.position) })),
    };
    void viewerNewsroomId;
  };

  const loadFull = async (id: string): Promise<LicenceRow | null> => {
    const rows = await sql`
      SELECT l.*, e.title AS essay_title, e.caption AS essay_caption, e.state AS essay_state,
             e.lift_at, e.taken_down_at, n.slug AS newsroom_slug, n.name AS newsroom_name,
             p.name AS licensed_by_name
      FROM licences l
      JOIN essays e ON e.id = l.essay_id
      JOIN newsrooms n ON n.id = l.newsroom_id
      JOIN people p ON p.id = l.licensed_by
      WHERE l.id = ${id}`;
    const row = rows[0] as LicenceRow | undefined;
    if (!row) return null;
    const names = await sql`
      SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id
      WHERE c.essay_id = ${row.essay_id} ORDER BY c.position`;
    const list = names.map((n) => n.name);
    row.credit_line = list.length === 0
      ? ""
      : list.length === 1
        ? `Photographs by ${list[0]}`
        : `Photographs by ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    return row;
  };

  // --- Create a licence (picture editor) ---
  router.post("/api/essays/:id/licences", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor");
      const key = req.headers["idempotency-key"] as string | undefined;
      if (typeof key !== "string" || !isIdempotencyKeyValid(key)) {
        res.status(422).json(errors.validationFailed({ idempotency_key: "Send an Idempotency-Key header of 1 to 100 visible characters" }).body());
        return;
      }
      const raw = (req as AppRequest).rawBody as Record<string, unknown>;
      if (Object.keys(raw).some((k) => k !== "kind")) {
        const problems: Record<string, string> = {};
        for (const k of Object.keys(raw)) if (k !== "kind") problems[k] = "Unknown field";
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      if (raw.kind !== "exclusive" && raw.kind !== "standard") {
        res.status(422).json(errors.validationFailed({ kind: "Kind must be exclusive or standard" }).body());
        return;
      }
      const kind = raw.kind as "exclusive" | "standard";
      const essayId = req.params.id;

      // Idempotency: scoped to the requesting person.
      const existing = await sql`SELECT * FROM idempotency_keys WHERE person_id = ${person.id} AND key = ${key}`;
      if (existing.length > 0) {
        const row = existing[0];
        if (row.essay_id !== essayId || row.kind !== kind) {
          res.status(409).json(errors.idempotencyKeyReused().body());
          return;
        }
        if (row.status !== null && row.body !== null) {
          res.status(Number(row.status)).json(row.body);
          return;
        }
        // The first request with this key is still running; wait for it.
        const waited = await waitForStoredResponse(person.id, key, sql, 30000);
        if (waited) {
          res.status(waited.status).json(waited.body);
          return;
        }
      } else {
        await sql`
          INSERT INTO idempotency_keys (person_id, key, essay_id, kind, in_flight)
          VALUES (${person.id}, ${key}, ${essayId}, ${kind}, true)
          ON CONFLICT (person_id, key) DO NOTHING`;
      }

      const nowMs = clock.now();
      const confirmedDate = new Date(nowMs);
      const essay = await loadEssay(sql, essayId);
      if (!essay) {
        await storeResponse(sql, person.id, key, 404, errors.notFound().body());
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay.state === "taken_down") {
        await storeResponse(sql, person.id, key, 410, errors.takenDown().body());
        res.status(410).json(errors.takenDown().body());
        return;
      }

      let licenceId: string | null = null;
      let insertError: ApiError | null = null;
      try {
        await sql.begin(async (tx) => {
          // Serialize licence requests on one essay with each other, with
          // activations and with takedowns.
          await tx`SELECT pg_advisory_xact_lock(${essayLockKey(essayId)})`;
          // From the end instant the exclusive window reopens for claims: a
          // licence whose window has ended stops holding the window first.
          await tx`UPDATE licences SET state = 'expired'
                   WHERE essay_id = ${essayId} AND state = 'active' AND window_end <= ${BigInt(nowMs)}`;
          const check = await checkLicensable(tx, essayId, kind, person, clock.now());
          if (!check.ok) {
            insertError = check.error!;
            return;
          }
          licenceId = newLicenceId();
          const window = licenceWindow(
            kind,
            nowMs,
            new Date(essay.lift_at).getTime(),
            kind === "exclusive" ? essay.exclusive_days : essay.standard_days,
          );
          const rateBp = await rateAtConfirmation(tx, nowMs);
          await tx`INSERT INTO licences (id, essay_id, newsroom_id, licensed_by, kind, state, confirmed_at, confirmed_epoch_ms, window_start, window_end, hold_until, amount_minor, rate_bp)
                   VALUES (${licenceId}, ${essayId}, ${person.newsroom_id}, ${person.id}, ${kind}, 'pending_invoice',
                           ${confirmedDate}, ${BigInt(nowMs)}, ${BigInt(window.windowStart)}, ${BigInt(window.windowEnd)}, ${BigInt(window.holdUntil)},
                           ${kind === "exclusive" ? essay.exclusive_price_minor : essay.standard_price_minor}, ${rateBp})`;
        });
      } catch (err) {
        const pgErr = err as { code?: string; constraint?: string };
        if (pgErr.code === "23505") {
          if (pgErr.constraint === "licences_one_per_newsroom") {
            insertError = errors.alreadyLicensed();
          } else {
            // Another newsroom won the exclusive window.
            insertError = await windowHeldError(sql, essayId, person.newsroom_id, clock.now());
          }
        } else {
          throw err;
        }
      }
      if (insertError) {
        await storeResponse(sql, person.id, key, insertError.status, insertError.body());
        res.status(insertError.status).json(insertError.body());
        return;
      }

      // The licence is committed; try to activate at once so an up billing
      // provider answers active. The scheduler retries when it can't.
      const activation = await attemptActivation({ sql, storage, billing: services.billing, mailer, clock }, licenceId!);
      if (activation === "removed") {
        // Billing refused the charge: the licence and its window hold are
        // removed entirely.
        await storeResponse(sql, person.id, key, 502, errors.billingRejected().body());
        res.status(502).json(errors.billingRejected().body());
        return;
      }
      const licence = await loadFull(licenceId!);
      if (!licence) {
        await storeResponse(sql, person.id, key, 404, errors.notFound().body());
        res.status(404).json(errors.notFound().body());
        return;
      }
      const body = await licenceBody(licence, person.newsroom_id!);
      const status = licence.state === "active" ? 201 : 202;
      await storeResponse(sql, person.id, key, status, body);
      res.status(status).json(body);
    } catch (err) {
      handleRouteError(res, err);
    }
  });

  // --- List the newsroom's licences, newest confirmation first ---
  router.get("/api/licences", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor", "licensing_manager");
      const rows = await sql`
        SELECT l.*, e.title AS essay_title, e.caption AS essay_caption, n.slug AS newsroom_slug,
               n.name AS newsroom_name, p.name AS licensed_by_name, e.taken_down_at,
               e.state AS essay_state, e.lift_at
        FROM licences l
        JOIN essays e ON e.id = l.essay_id
        JOIN newsrooms n ON n.id = l.newsroom_id
        JOIN people p ON p.id = l.licensed_by
        WHERE l.newsroom_id = ${person.newsroom_id}
        ORDER BY l.confirmed_epoch_ms DESC, l.id ASC`;
      const nowMs = clock.now();
      const out = [];
      for (const row of rows as unknown as LicenceRow[]) {
        if (row.state === "pending_invoice" && nowMs >= num(row.hold_until)) continue;
        row.credit_line = await creditLineFor(sql, row.essay_id);
        out.push(await licenceBody(row, person.newsroom_id!));
      }
      res.status(200).json({ licences: out });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.get("/api/licences/:id", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor", "licensing_manager");
      const licence = await loadFull(req.params.id);
      if (!licence || Number(licence.newsroom_id) !== person.newsroom_id) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const nowMs = clock.now();
      if (licence.state === "pending_invoice" && nowMs >= num(licence.hold_until)) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      res.status(200).json(await licenceBody(licence, person.newsroom_id!));
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  // --- Original download grants ---
  router.post("/api/licences/:id/grants", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "picture_editor");
      const raw = (req as AppRequest).rawBody as Record<string, unknown>;
      if (Object.keys(raw).some((k) => k !== "frame_id")) {
        const problems: Record<string, string> = {};
        for (const k of Object.keys(raw)) if (k !== "frame_id") problems[k] = "Unknown field";
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      if (typeof raw.frame_id !== "string") {
        res.status(422).json(errors.validationFailed({ frame_id: "This field is missing or has the wrong type" }).body());
        return;
      }
      const licence = await loadFull(req.params.id);
      if (!licence || Number(licence.newsroom_id) !== person.newsroom_id) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const nowMs = clock.now();
      if (licence.state === "pending_invoice" && nowMs >= num(licence.hold_until)) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const essayRow = await sql`SELECT taken_down_at IS NOT NULL AS td FROM essays WHERE id = ${licence.essay_id}`;
      if (essayRow[0].td || licence.state === "revoked") {
        res.status(410).json(errors.licenceRevoked().body());
        return;
      }
      if (licence.state === "pending_invoice") {
        res.status(409).json(errors.licencePending().body());
        return;
      }
      if (nowMs >= num(licence.window_end)) {
        res.status(410).json(errors.licenceEnded().body());
        return;
      }
      const frame = await sql`SELECT id, position, type, essay_id FROM frames WHERE id = ${raw.frame_id}`;
      if (frame.length === 0 || frame[0].essay_id !== licence.essay_id) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const type = frame[0].type === "image/png" ? "image/png" : "image/jpeg";
      try {
        const link = await presignOriginal(storage, licence.essay_id, frame[0].id, Number(frame[0].position), type, num(licence.window_end), nowMs);
        res.status(201).json({ url: link.url, expires_at: isoInstant(link.expiresAtMs) });
      } catch {
        res.status(503).json(errors.storageUnavailable().body());
      }
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  // --- Usage (licensing manager) ---
  router.get("/api/usage", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "licensing_manager");
      const newsroom = await sql`SELECT slug, name FROM newsrooms WHERE id = ${person.newsroom_id}`;
      const licences = await newsroomLicences(sql, person.newsroom_id!, clock.now());
      const totals = usageTotals(licences, clock.now());
      const shortlist = await sql`SELECT count(*) AS c FROM shortlist_items WHERE newsroom_id = ${person.newsroom_id}`;
      res.status(200).json({
        newsroom: { slug: newsroom[0].slug, name: newsroom[0].name },
        ...totals,
        shortlist_count: Number(shortlist[0].c),
      });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.get("/api/usage.csv", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "licensing_manager");
      const newsroom = await sql`SELECT slug, name FROM newsrooms WHERE id = ${person.newsroom_id}`;
      const licences = await newsroomLicences(sql, person.newsroom_id!, clock.now());
      const csv = usageCsv(licences, coopDateOf(clock.now()));
      const filename = `saltprint-usage-${newsroom[0].slug}-${coopDateOf(clock.now())}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  void mailer;
  void effectiveEnd;
  void licenceRecipients;
}

async function creditLineFor(sql: Services["sql"], essayId: string): Promise<string> {
  const names = await sql`
    SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id
    WHERE c.essay_id = ${essayId} ORDER BY c.position`;
  const list = names.map((n) => n.name);
  if (list.length === 0) return "";
  if (list.length === 1) return `Photographs by ${list[0]}`;
  return `Photographs by ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

async function waitForStoredResponse(
  personId: number,
  key: string,
  sql: Services["sql"],
  timeoutMs: number,
): Promise<{ status: number; body: unknown } | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
    const rows = await sql`SELECT status, body FROM idempotency_keys WHERE person_id = ${personId} AND key = ${key}`;
    if (rows.length > 0 && rows[0].status !== null && rows[0].body !== null) {
      return { status: Number(rows[0].status), body: rows[0].body };
    }
  }
  return null;
}

async function storeResponse(sql: Services["sql"], personId: number, key: string, status: number, body: unknown): Promise<void> {
  await sql`
    INSERT INTO idempotency_keys (person_id, key, essay_id, kind, status, body, in_flight)
    VALUES (${personId}, ${key}, NULL, NULL, ${status}, ${JSON.stringify(body)}::jsonb, false)
    ON CONFLICT (person_id, key) DO UPDATE SET status = ${status}, body = ${JSON.stringify(body)}::jsonb, in_flight = false`;
}



