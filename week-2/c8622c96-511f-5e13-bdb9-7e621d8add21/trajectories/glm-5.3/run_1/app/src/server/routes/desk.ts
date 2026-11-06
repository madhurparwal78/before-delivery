import type { Router, Request, Response } from "express";
import type { Services } from "../services.js";
import { errors, ApiError } from "../errors.js";
import { requirePerson, role, AppRequest, etag, handleRouteError } from "../web.js";
import { loadEssay, loadCredits, loadFrames, creditLine, frameUrls, bumpVersion, type EssayRow } from "../domain/essays.js";
import { resolveLiftLocal, isoInstant, formatCoopTime } from "../../shared/time.js";
import { actionTakedown } from "../domain/takedown.js";
import { parseStrictBody } from "../validation.js";
import { asJson } from "../db.js";

// The co-op desk editor: review queue, publish and hold, withdrawals and
// legal takedowns.
export function registerDeskRoutes(router: Router, services: Services): void {
  const { sql, storage, mailer, clock } = services;

  const staffEssayBody = async (essay: EssayRow): Promise<Record<string, unknown>> => {
    const credits = await loadCredits(sql, essay.id);
    const frames = await loadFrames(sql, essay.id);
    return {
      id: essay.id,
      version: Number(essay.version),
      title: essay.title,
      caption: essay.caption,
      credit_line: creditLine(credits.map((c) => c.name)),
      credits: credits.map((c) => ({ handle: c.handle, name: c.name, position: Number(c.position), split_bp: Number(c.split_bp) })),
      state: essay.state,
      lift_local: essay.lift_local,
      lift_at: isoInstant(new Date(essay.lift_at).getTime()),
      lift_display: formatCoopTime(new Date(essay.lift_at).getTime()),
      lift_resolution: essay.lift_resolution,
      exclusive_days: essay.exclusive_days,
      standard_days: essay.standard_days,
      exclusive_price_minor: Number(essay.exclusive_price_minor),
      standard_price_minor: Number(essay.standard_price_minor),
      frames: frames.map((f) => ({
        id: f.id,
        position: Number(f.position),
        caption: f.caption,
        ...frameUrls(f.id, true),
      })),
      desk_notes: asJson(essay.desk_notes),
      withdrawal_requested: essay.withdrawal_requested,
      window: { state: essay.state === "embargoed" || essay.state === "live" ? "open" : "open", held_by: null, held_until: null, held_until_display: null, standard_running_until: null, standard_running_until_display: null },
    };
  };

  router.get("/api/desk/queue", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "desk_editor");
      const inReview = await sql`
        SELECT * FROM essays WHERE state = 'in_review'
        ORDER BY COALESCE(submitted_at, now()) ASC, id`;
      const withdrawals = await sql`
        SELECT * FROM essays WHERE withdrawal_requested = true AND state IN ('embargoed','live')
        ORDER BY id`;
      res.status(200).json({
        essays: await Promise.all(inReview.map((e) => staffEssayBody(e as EssayRow))),
        withdrawal_requests: await Promise.all(withdrawals.map((e) => staffEssayBody(e as EssayRow))),
      });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.get("/api/desk/essays", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "desk_editor");
      const essays = await sql`SELECT * FROM essays ORDER BY id`;
      res.status(200).json({ essays: await Promise.all(essays.map((e) => staffEssayBody(e as EssayRow))) });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.post("/api/essays/:id/publish", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "desk_editor");
      const strict = parseStrictBody((req as AppRequest).rawBody, {});
      if (strict.invalid) {
        res.status(422).json(errors.validationFailed(strict.fields ?? {}).body());
        return;
      }
      const essay = await loadEssay(sql, req.params.id);
      if (!essay) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay.state !== "in_review") {
        res.status(409).json(errors.illegalTransition(essay.state, "publish").body());
        return;
      }
      const nowMs = clock.now();
      const liftMs = new Date(essay.lift_at).getTime();
      const newState = liftMs <= nowMs ? "live" : "embargoed";
      await sql.begin(async (tx) => {
        const updated = await tx`
          UPDATE essays SET state = ${newState},
            lifted_at = CASE WHEN ${newState} = 'live' THEN ${new Date(nowMs)} ELSE lifted_at END,
            version = version + 1
          WHERE id = ${req.params.id} AND state = 'in_review'
          RETURNING version`;
        if (updated.length === 0) throw new Error("conflict");
      });
      const fresh = await loadEssay(sql, req.params.id);
      const body = await staffEssayBody(fresh!);
      res.setHeader("ETag", etag(Number(fresh!.version)));
      res.status(200).json(body);
    } catch (err) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.message === "conflict") {
        res.status(409).json(errors.illegalTransition("in_review", "publish").body());
        return;
      }
      res.status(503).json(errors.databaseUnavailable().body());
    }
  });

  router.post("/api/essays/:id/hold", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "desk_editor");
      const raw = (req as AppRequest).rawBody as Record<string, unknown>;
      if (Object.keys(raw).some((k) => k !== "note")) {
        const problems: Record<string, string> = {};
        for (const k of Object.keys(raw)) if (k !== "note") problems[k] = "Unknown field";
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      if (typeof raw.note !== "string" || [...raw.note].length < 1 || [...raw.note].length > 1000) {
        res.status(422).json(errors.validationFailed({ note: "Desk note must be 1 to 1000 characters" }).body());
        return;
      }
      const essay = await loadEssay(sql, req.params.id);
      if (!essay) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay.state !== "in_review") {
        res.status(409).json(errors.illegalTransition(essay.state, "hold").body());
        return;
      }
      const notes = asJson<Record<string, unknown>[]>(essay.desk_notes);
      const freshNotes = [...notes, { note: raw.note, at: isoInstant(clock.now()), at_display: formatCoopTime(clock.now()) }];
      await sql`
        UPDATE essays SET state = 'draft', desk_notes = ${JSON.stringify(freshNotes)}::jsonb,
          version = version + 1, submitted_at = NULL
        WHERE id = ${req.params.id} AND state = 'in_review'`;
      const fresh = await loadEssay(sql, req.params.id);
      res.setHeader("ETag", etag(Number(fresh!.version)));
      res.status(200).json(await staffEssayBody(fresh!));
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.post("/api/essays/:id/withdraw", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "desk_editor");
      const strict = parseStrictBody((req as AppRequest).rawBody, {});
      if (strict.invalid) {
        res.status(422).json(errors.validationFailed(strict.fields ?? {}).body());
        return;
      }
      const essay = await loadEssay(sql, req.params.id);
      if (!essay) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay.state !== "embargoed" && essay.state !== "live") {
        res.status(409).json(errors.illegalTransition(essay.state, "withdraw").body());
        return;
      }
      if (!essay.withdrawal_requested) {
        res.status(409).json(errors.noWithdrawalRequest().body());
        return;
      }
      await sql.begin(async (tx) => {
        const updated = await tx`
          UPDATE essays SET state = 'withdrawn', version = version + 1
          WHERE id = ${req.params.id} AND state IN ('embargoed','live') AND withdrawal_requested
          RETURNING version`;
        if (updated.length === 0) throw new Error("conflict");
        // A carried-out withdrawal removes the essay from every shortlist and
        // cancels its unsent alerts. Existing licences keep running.
        await tx`DELETE FROM shortlist_items WHERE essay_id = ${req.params.id}`;
        await tx`UPDATE mail_queue SET status = 'cancelled'
                 WHERE essay_id = ${req.params.id} AND status IN ('queued','sending') AND kind = 'embargo_lift'`;
      });
      const fresh = await loadEssay(sql, req.params.id);
      res.setHeader("ETag", etag(Number(fresh!.version)));
      res.status(200).json(await staffEssayBody(fresh!));
    } catch (err) {
      const pgErr = err as { message?: string };
      if (pgErr.message === "conflict") {
        res.status(409).json(errors.illegalTransition("withdraw", "withdraw").body());
        return;
      }
      res.status(503).json(errors.databaseUnavailable().body());
    }
  });

  router.post("/api/essays/:id/takedown", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "desk_editor");
      const raw = (req as AppRequest).rawBody as Record<string, unknown>;
      if (Object.keys(raw).some((k) => k !== "reference")) {
        const problems: Record<string, string> = {};
        for (const k of Object.keys(raw)) if (k !== "reference") problems[k] = "Unknown field";
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      if (typeof raw.reference !== "string" || [...raw.reference].length < 1 || [...raw.reference].length > 200) {
        res.status(422).json(errors.validationFailed({ reference: "Legal reference must be 1 to 200 characters" }).body());
        return;
      }
      const result = await actionTakedown(sql, storage, mailer, clock, req.params.id, raw.reference);
      if (result instanceof ApiError) {
        res.status(result.status).json(result.body());
        return;
      }
      const fresh = await loadEssay(sql, req.params.id);
      res.setHeader("ETag", etag(Number(fresh!.version)));
      res.status(200).json({ id: req.params.id, state: "taken_down", revoked_licences: result.revoked_licences });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  void resolveLiftLocal;
  void bumpVersion;
}
