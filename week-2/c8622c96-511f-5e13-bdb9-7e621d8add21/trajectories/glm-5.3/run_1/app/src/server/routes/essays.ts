import type { Router, Request, Response } from "express";
import Busboy from "busboy";
import sharp from "sharp";
import type { Services } from "../services.js";
import { errors, ApiError } from "../errors.js";
import { parseStrictBody } from "../validation.js";
import { requirePerson, role, isNewsroomRole, etag, AppRequest, handleRouteError } from "../web.js";
import {
  validateEssayFields, loadEssay, loadCredits, loadFrames, creditLine, bumpVersion,
  ESSAY_FIELD_MESSAGES, frameUrls, type EssayRow, type PersonRow,
} from "../domain/essays.js";
import { windowInfo } from "../domain/licensing.js";
import { resolveLiftLocal, isoInstant, formatCoopTime } from "../../shared/time.js";
import { asJson } from "../db.js";
import { makeDerivatives, putOriginal, sniffImageType, MAX_UPLOAD_BYTES } from "../storage.js";

// Essays: contributor drafts with co-credits, frames, submissions and
// withdrawal requests; the feed; and per-role essay views.
export function registerEssayRoutes(router: Router, services: Services): void {
  const { sql, storage, clock } = services;

  const essayBody = async (essayId: string, viewer: PersonRow): Promise<Record<string, unknown> | null> => {
    const essay = await loadEssay(sql, essayId);
    if (!essay) return null;
    const credits = await loadCredits(sql, essayId);
    const frames = await loadFrames(sql, essayId);
    const names = credits.map((c) => c.name);
    const body: Record<string, unknown> = {
      id: essay.id,
      version: Number(essay.version),
      title: essay.title,
      caption: essay.caption,
      credit_line: creditLine(names),
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
      window: await windowInfo(sql, essayId, isNewsroomRole(viewer) ? viewer.newsroom_id : null, clock.now()),
    };
    if (isNewsroomRole(viewer)) {
      // The newsroom view strips split shares, desk notes, withdrawal state
      // and story URLs.
      body.credits = credits.map((c) => ({ handle: c.handle, name: c.name, position: Number(c.position) }));
      delete body.desk_notes;
      delete body.withdrawal_requested;
      body.frames = frames.map((f) => ({
        id: f.id,
        position: Number(f.position),
        caption: f.caption,
        grid_url: `/media/frames/${f.id}/grid`,
        preview_url: `/media/frames/${f.id}/preview`,
      }));
    }
    return body;
  };

  // Whether a newsroom viewer may see an essay: embargoed, live, or
  // withdrawn while their newsroom holds a licence on it.
  const newsroomMaySee = async (essay: EssayRow, newsroomId: number): Promise<boolean> => {
    if (essay.state === "embargoed" || essay.state === "live") return true;
    if (essay.state === "withdrawn") {
      const licence = await sql`
        SELECT id FROM licences WHERE essay_id = ${essay.id} AND newsroom_id = ${newsroomId} LIMIT 1`;
      return licence.length > 0;
    }
    return false;
  };

  const visibleEssayFor = async (essayId: string, person: PersonRow): Promise<{ error: ApiError } | { body: Record<string, unknown> }> => {
    const essay = await loadEssay(sql, essayId);
    if (!essay) return { error: errors.notFound() };
    if (essay.state === "taken_down" && person.role !== "desk_editor") return { error: errors.takenDown() };
    if (isNewsroomRole(person)) {
      const maySee = await newsroomMaySee(essay, person.newsroom_id!);
      if (!maySee) return { error: errors.notFound() };
    } else if (person.role === "contributor") {
      const credited = await sql`SELECT 1 FROM credits WHERE essay_id = ${essayId} AND person_id = ${person.id}`;
      if (credited.length === 0) return { error: errors.notFound() };
    }
    const body = await essayBody(essayId, person);
    if (!body) return { error: errors.notFound() };
    return { body };
  };

  // --- Feed: only embargoed and live essays, latest lift first, matching the
  // published search fields. ---
  router.get("/api/feed", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    const q = (req.query.q as string | undefined) ?? "";
    try {
      const pattern = `%${q.replace(/([%_\\])/g, "\\$1")}%`;
      const rows = await sql`
        SELECT e.id, e.title, e.state, e.lift_at FROM essays e
        WHERE e.state IN ('embargoed','live')
          AND (
            ${q === ""} OR
            e.title ILIKE ${pattern} OR e.caption ILIKE ${pattern} OR
            EXISTS (SELECT 1 FROM frames f WHERE f.essay_id = e.id AND f.caption ILIKE ${pattern}) OR
            EXISTS (SELECT 1 FROM credits c JOIN people p ON p.id = c.person_id
                    WHERE c.essay_id = e.id AND p.name ILIKE ${pattern})
          )
        ORDER BY e.lift_at DESC`;
      const essays = [];
      for (const row of rows) {
        const credits = await loadCredits(sql, row.id);
        const frames = await loadFrames(sql, row.id);
        const cover = frames.length > 0 ? frames[0] : null;
        essays.push({
          id: row.id,
          title: row.title,
          credit_line: creditLine(credits.map((c) => c.name)),
          state: row.state,
          lift_at: isoInstant(new Date(row.lift_at).getTime()),
          lift_display: formatCoopTime(new Date(row.lift_at).getTime()),
          frame_count: frames.length,
          cover_url: cover ? `/media/frames/${cover.id}/grid` : null,
          window: await windowInfo(sql, row.id, isNewsroomRole(person) ? person.newsroom_id : null, clock.now()),
        });
      }
      res.status(200).json({ essays });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  // --- Get one essay ---
  router.get("/api/essays/:id", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      const result = await visibleEssayFor(req.params.id, person);
      if ("error" in result) {
        res.status(result.error.status).json(result.error.body());
        return;
      }
      const essay = await loadEssay(sql, req.params.id);
      res.setHeader("ETag", etag(Number(essay!.version)));
      res.status(200).json(result.body);
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  // --- Create an essay (contributor) ---
  router.post("/api/essays", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "contributor");
      const raw = (req as AppRequest).rawBody;
      const listed = ["title", "caption", "lift_local", "exclusive_days", "standard_days", "exclusive_price_minor", "standard_price_minor", "credits"];
      const problems: Record<string, string> = {};
      for (const key of Object.keys(raw as object)) if (!listed.includes(key)) problems[key] = "Unknown field";
      const result = await validateEssayFields(sql, person, raw as Record<string, unknown>, true);
      if (!result.ok) {
        res.status(422).json(errors.validationFailed({ ...result.error.fields, ...problems }).body());
        return;
      }
      const { fields } = result;
      if (Object.keys(problems).length > 0) {
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      const lift = resolveLiftLocal(fields.lift_local!)!;
      const id = await newEssayId(sql, fields.title!);
      await sql.begin(async (tx) => {
        await tx`INSERT INTO essays (id, title, caption, state, lift_local, lift_at, lift_resolution, exclusive_days, standard_days, exclusive_price_minor, standard_price_minor)
                 VALUES (${id}, ${fields.title!}, ${fields.caption!}, 'draft', ${fields.lift_local!}, ${lift.instant}, ${lift.resolution},
                         ${fields.exclusive_days!}, ${fields.standard_days!}, ${fields.exclusive_price_minor!}, ${fields.standard_price_minor!})`;
        let position = 1;
        for (const credit of fields.credits!) {
          const pid = await tx`SELECT id FROM people WHERE contributor_handle = ${credit.contributor}`;
          await tx`INSERT INTO credits (essay_id, person_id, handle, position, split_bp)
                   VALUES (${id}, ${pid[0].id}, ${credit.contributor}, ${position}, ${credit.split_bp})`;
          position += 1;
        }
      });
      const body = await essayBody(id, person);
      res.setHeader("ETag", etag(1));
      res.status(201).json(body);
    } catch (err) {
      handleDbError(res, err);
    }
  });

  // --- Patch an essay (contributor, draft only, version precondition) ---
  router.patch("/api/essays/:id", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "contributor");
      const essay = await loadEssay(sql, req.params.id);
      if (!essay) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const credited = await sql`SELECT 1 FROM credits WHERE essay_id = ${req.params.id} AND person_id = ${person.id}`;
      if (credited.length === 0) {
        // An essay that does not credit the caller answers 404 to them.
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay.state === "taken_down") {
        res.status(410).json(errors.takenDown().body());
        return;
      }
      if (essay.state !== "draft") {
        res.status(409).json(errors.illegalTransition(essay.state, "edit").body());
        return;
      }
      const ifMatch = req.headers["if-match"] as string | undefined;
      if (!ifMatch) {
        res.status(428).json(errors.preconditionRequired().body());
        return;
      }
      const currentVersion = Number(ifMatch.replace(/"/g, ""));
      const raw = (req as AppRequest).rawBody;
      const listed = ["title", "caption", "lift_local", "exclusive_days", "standard_days", "exclusive_price_minor", "standard_price_minor", "credits"];
      const problems: Record<string, string> = {};
      for (const key of Object.keys(raw as object)) if (!listed.includes(key)) problems[key] = "Unknown field";
      const result = await validateEssayFields(sql, person, raw as Record<string, unknown>, false);
      if (!result.ok) {
        res.status(422).json(errors.validationFailed({ ...result.error.fields, ...problems }).body());
        return;
      }
      const { fields } = result;
      if (Object.keys(problems).length > 0) {
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      const lift = fields.lift_local ? resolveLiftLocal(fields.lift_local) : null;
      const rows = await sql.begin(async (tx) => {
        const updated = await tx`
          UPDATE essays SET
            version = version + 1,
            title = ${fields.title ?? essay.title},
            caption = ${fields.caption ?? essay.caption},
            lift_local = ${fields.lift_local ?? essay.lift_local},
            lift_at = ${lift ? lift.instant : new Date(essay.lift_at)},
            lift_resolution = ${lift ? lift.resolution : essay.lift_resolution},
            exclusive_days = ${fields.exclusive_days ?? essay.exclusive_days},
            standard_days = ${fields.standard_days ?? essay.standard_days},
            exclusive_price_minor = ${fields.exclusive_price_minor ?? essay.exclusive_price_minor},
            standard_price_minor = ${fields.standard_price_minor ?? essay.standard_price_minor}
          WHERE id = ${req.params.id} AND version = ${currentVersion}
          RETURNING *`;
        if (updated.length === 0) return null;
        if (fields.credits) {
          await tx`DELETE FROM credits WHERE essay_id = ${req.params.id}`;
          let position = 1;
          for (const credit of fields.credits) {
            const pid = await tx`SELECT id FROM people WHERE contributor_handle = ${credit.contributor}`;
            await tx`INSERT INTO credits (essay_id, person_id, handle, position, split_bp)
                     VALUES (${req.params.id}, ${pid[0].id}, ${credit.contributor}, ${position}, ${credit.split_bp})`;
            position += 1;
          }
        }
        return updated[0];
      });
      if (!rows) {
        res.status(412).json(errors.versionConflict(currentVersion).body());
        return;
      }
      const body = await essayBody(req.params.id, person);
      res.setHeader("ETag", etag(Number(rows.version)));
      res.status(200).json(body);
    } catch (err) {
      handleDbError(res, err);
    }
  });

  // --- Upload a frame (contributor, draft only) ---
  router.post("/api/essays/:id/frames", (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    uploadFrame(req, res, person, services).catch((err: unknown) => {
      if (err instanceof ApiError) {
        res.status(err.status).json(err.body());
      } else {
        handleDbError(res, err);
      }
    });
  });

  // --- Frame caption ---
  router.patch("/api/frames/:frameId", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "contributor");
      const parsed = parseStrictBody((req as AppRequest).rawBody, {
        caption: { type: "string", required: true, message: ESSAY_FIELD_MESSAGES.frameCaption },
      });
      if (parsed.invalid) {
        res.status(422).json(errors.validationFailed(parsed.fields ?? {}).body());
        return;
      }
      const caption = (parsed.fields as { caption: string }).caption;
      if ([...caption].length > 500) {
        res.status(422).json(errors.validationFailed({ caption: ESSAY_FIELD_MESSAGES.frameCaption }).body());
        return;
      }
      const frame = await sql`SELECT * FROM frames WHERE id = ${req.params.frameId}`;
      if (frame.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const essay = await loadEssay(sql, frame[0].essay_id);
      if (!essay) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const credited = await sql`SELECT 1 FROM credits WHERE essay_id = ${essay.id} AND person_id = ${person.id}`;
      if (credited.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay.state !== "draft") {
        res.status(409).json(errors.illegalTransition(essay.state, "edit").body());
        return;
      }
      const version = await bumpVersion(sql, essay.id);
      await sql`UPDATE frames SET caption = ${caption} WHERE id = ${req.params.frameId}`;
      res.setHeader("ETag", etag(version));
      res.status(200).json({
        id: frame[0].id,
        position: Number(frame[0].position),
        caption,
        filename: frame[0].filename,
        bytes: Number(frame[0].bytes),
        type: frame[0].type,
        width: Number(frame[0].width),
        height: Number(frame[0].height),
        essay_version: version,
      });
    } catch (err) {
      handleDbError(res, err);
    }
  });

  // --- Delete a frame ---
  router.delete("/api/frames/:frameId", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "contributor");
      const frame = await sql`SELECT * FROM frames WHERE id = ${req.params.frameId}`;
      if (frame.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const essay = await loadEssay(sql, frame[0].essay_id);
      const credited = await sql`SELECT 1 FROM credits WHERE essay_id = ${frame[0].essay_id} AND person_id = ${person.id}`;
      if (credited.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay!.state !== "draft") {
        res.status(409).json(errors.illegalTransition(essay!.state, "edit").body());
        return;
      }
      await sql`DELETE FROM frames WHERE id = ${req.params.frameId}`;
      const version = await bumpVersion(sql, frame[0].essay_id);
      res.setHeader("ETag", etag(version));
      res.status(204).end();
    } catch (err) {
      handleDbError(res, err);
    }
  });

  // --- Submit for review ---
  router.post("/api/essays/:id/submit", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "contributor");
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
      const credited = await sql`SELECT 1 FROM credits WHERE essay_id = ${req.params.id} AND person_id = ${person.id}`;
      if (credited.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay.state !== "draft") {
        res.status(409).json(errors.illegalTransition(essay.state, "submit").body());
        return;
      }
      const frames = await loadFrames(sql, req.params.id);
      if (frames.length === 0) {
        res.status(422).json(errors.validationFailed({ frames: "Add at least one frame before submitting" }).body());
        return;
      }
      const rows = await sql`
        UPDATE essays SET state = 'in_review', submitted_at = now(), version = version + 1
        WHERE id = ${req.params.id} RETURNING version`;
      const body = await essayBody(req.params.id, person);
      res.setHeader("ETag", etag(Number(rows[0].version)));
      res.status(200).json(body);
    } catch (err) {
      handleDbError(res, err);
    }
  });

  // --- Request withdrawal ---
  router.post("/api/essays/:id/withdrawal-request", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "contributor");
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
      const credited = await sql`SELECT 1 FROM credits WHERE essay_id = ${req.params.id} AND person_id = ${person.id}`;
      if (credited.length === 0) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      if (essay.state !== "embargoed" && essay.state !== "live") {
        res.status(409).json(errors.illegalTransition(essay.state, "request_withdrawal").body());
        return;
      }
      const rows = await sql`
        UPDATE essays SET withdrawal_requested = true, version = version + 1
        WHERE id = ${req.params.id} RETURNING version`;
      const body = await essayBody(req.params.id, person);
      res.setHeader("ETag", etag(Number(rows[0].version)));
      res.status(200).json(body);
    } catch (err) {
      handleDbError(res, err);
    }
  });

  // --- Studio: my essays ---
  router.get("/api/studio/essays", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "contributor");
      const essays = await sql`
        SELECT e.id FROM essays e
        JOIN credits c ON c.essay_id = e.id AND c.person_id = ${person.id}
        ORDER BY e.created_at DESC, e.id`;
      const out = [];
      const nowMs = clock.now();
      for (const row of essays) {
        const body = await essayBody(row.id, person);
        if (!body) continue;
        const licences = await sql`
          SELECT n.name, n.slug, l.kind, l.state, l.window_end, l.amount_minor, l.hold_until,
                 e.taken_down_at IS NOT NULL AS taken_down
          FROM licences l
          JOIN newsrooms n ON n.id = l.newsroom_id
          JOIN essays e ON e.id = l.essay_id
          WHERE l.essay_id = ${row.id}`;
        const licenceList = licences
          .filter((l) => !(l.state === "pending_invoice" && nowMs >= Number(l.hold_until)))
          .map((l) => {
            const state = l.taken_down
              ? "revoked"
              : l.state === "active" && nowMs >= Number(l.window_end)
                ? "expired"
                : l.state;
            return {
              newsroom: { slug: l.slug, name: l.name },
              kind: l.kind,
              state,
              window_end: isoInstant(Number(l.window_end)),
              window_end_display: formatCoopTime(Number(l.window_end)),
              amount_minor: Number(l.amount_minor),
            };
          });
        body.licences = licenceList;
        out.push(body);
      }
      res.status(200).json({ essays: out });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  // --- Studio: my royalties, only the caller's own share lines ---
  router.get("/api/studio/royalties", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "contributor");
      const statements = await sql`SELECT month, lines FROM royalty_statements ORDER BY month DESC`;
      const out = [];
      for (const statement of statements) {
        for (const line of asJson<{ licence_id: string; essay_title: string; shares: { handle: string; position: number; split_bp: number; amount_minor: number }[] }[]>(statement.lines)) {
          for (const share of line.shares) {
            if (share.handle === person.contributor_handle) {
              out.push({
                month: statement.month,
                licence_id: line.licence_id,
                essay_title: line.essay_title,
                position: share.position,
                split_bp: share.split_bp,
                amount_minor: share.amount_minor,
              });
            }
          }
        }
      }
      out.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.licence_id < b.licence_id ? -1 : 1));
      res.status(200).json({ lines: out });
    } catch (err) {
      handleRouteError(res, err);
      }
  });
}

async function newEssayId(sql: Services["sql"], title: string): Promise<string> {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "essay";
  let id = base;
  let n = 2;
  while ((await sql`SELECT 1 FROM essays WHERE id = ${id}`).length > 0) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

const handleDbError = handleRouteError;

async function uploadFrame(req: Request, res: Response, person: PersonRow, services: Services): Promise<void> {
  const { sql, storage } = services;
  role(person, "contributor");
  const essay = await loadEssay(sql, req.params.id);
  if (!essay) {
    res.status(404).json(errors.notFound().body());
    return;
  }
  const credited = await sql`SELECT 1 FROM credits WHERE essay_id = ${req.params.id} AND person_id = ${person.id}`;
  if (credited.length === 0) {
    res.status(404).json(errors.notFound().body());
    return;
  }
  if (essay.state !== "draft") {
    res.status(409).json(errors.illegalTransition(essay.state, "edit").body());
    return;
  }
  const existing = await sql`SELECT position FROM frames WHERE essay_id = ${req.params.id}`;
  if (existing.length >= 24) {
    res.status(422).json(errors.validationFailed({ file: "An essay holds at most 24 frames" }).body());
    return;
  }

  const fileParts = await new Promise<{ data: Buffer; filename: string; truncated: boolean; caption: string | null }>((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    let caption: string | null = null;
    let settled = false;
    busboy.on("field", (name, value) => {
      if (name === "caption") {
        if (caption === null) caption = value;
      }
    });
    busboy.on("file", (name, stream, info) => {
      if (name !== "file" || settled) {
        stream.resume();
        return;
      }
      settled = true;
      const chunks: Buffer[] = [];
      let truncated = false;
      stream.on("limit", () => {
        truncated = true;
      });
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        resolve({ data: Buffer.concat(chunks), filename: info.filename ?? "upload", truncated, caption });
      });
    });
    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (!settled) {
        reject(new ApiError(422, "validation_failed", "That request has fields Saltprint Desk can't accept.", undefined, { file: "This file can't be read as an image" }));
      }
    });
    req.pipe(busboy);
  });

  if (fileParts.caption !== null && [...fileParts.caption].length > 500) {
    res.status(422).json(errors.validationFailed({ caption: ESSAY_FIELD_MESSAGES.frameCaption }).body());
    return;
  }

  if (fileParts.truncated || fileParts.data.length > MAX_UPLOAD_BYTES) {
    res.status(413).json(errors.fileTooLarge().body());
    return;
  }
  const type = sniffImageType(fileParts.data.subarray(0, 16));
  if (!type) {
    res.status(415).json(errors.unsupportedType().body());
    return;
  }
  let meta;
  try {
    meta = await sharp(fileParts.data, { failOn: "none" }).metadata();
  } catch {
    res.status(422).json(errors.validationFailed({ file: "This file can't be read as an image" }).body());
    return;
  }
  if (!meta.width || !meta.height) {
    res.status(422).json(errors.validationFailed({ file: "This file can't be read as an image" }).body());
    return;
  }

  const position = existing.length + 1;
  const frameId = `${essay.id}-f${position}-${Date.now().toString(36)}`;
  try {
    await putOriginal(storage, essay.id, frameId, fileParts.data);
    await makeDerivatives(storage, essay.id, frameId, fileParts.data);
  } catch {
    res.status(503).json(errors.storageUnavailable().body());
    return;
  }
  const safeFilename = fileParts.filename.replace(/^.*[\\/]/, "");
  const version = await bumpVersion(sql, essay.id);
  await sql`INSERT INTO frames (id, essay_id, position, caption, filename, bytes, type, width, height)
            VALUES (${frameId}, ${essay.id}, ${position}, ${fileParts.caption ?? ""}, ${safeFilename}, ${fileParts.data.length}, ${type}, ${meta.width}, ${meta.height})`;
  res.setHeader("ETag", etag(version));
  res.status(201).json({
    id: frameId,
    position,
    caption: fileParts.caption ?? "",
    filename: safeFilename,
    bytes: fileParts.data.length,
    type,
    width: meta.width,
    height: meta.height,
    essay_version: version,
  });
}
