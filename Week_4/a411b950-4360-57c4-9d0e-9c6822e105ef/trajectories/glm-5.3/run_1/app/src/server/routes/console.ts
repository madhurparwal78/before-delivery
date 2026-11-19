import { Context, Earshot } from "../context.js";
import { RouteContext } from "../http-core.js";
import {
  AppError,
  conflict,
  illegalTransition,
  notFound,
  preconditionRequired,
  staleVersion,
  storageUnavailable,
  validationError,
} from "../errors.js";
import { parseMultipart } from "../multipart.js";
import { verifyPassword } from "../crypto.js";
import { randomSessionToken, randomTokenString } from "../tokens.js";
import { displayAddress } from "../mailer.js";
import {
  CREDIT_LABELS,
  ENQUIRY_STATUS_LABELS,
  LAYERS,
  Milestone,
  milestoneSplit,
} from "../../shared/domain.js";
import { isBareAddress, isMultiLineText, isSingleLineText, charCount } from "../../shared/text-rules.js";
import { formatInstant, isMonthString, monthLabel } from "../../shared/dates.js";
import { isWavOrOggAudioStem, isSafeFilename, oggDurationMs, wavDurationMs } from "../media-sniff.js";
import { StemRow, ProjectRow, OperatorRow } from "./records.js";
import { streamStoredObject } from "./public.js";
import { KillBillUnavailable } from "../killbill.js";
import { StorageUnavailable } from "../storage.js";
import { readFileSync } from "node:fs";

/**
 * Console API: sessions, projects, stems, transitions, listening links,
 * enquiries with versioned writes, proposals, milestone invoices, months,
 * settings, mail queue and the CSV export.
 */

const SESSION_COOKIE = "earshot_session";

export function consoleApi(context: Context): void {
  const { app, router } = context;

  // ---------------------------------------------------------------- session
  router.add("POST", "/api/console/session", async (route) => {
    const body = readJson(route);
    const errors: Record<string, string> = {};
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !isBareAddress(email)) errors.email = "Enter your email address.";
    if (!password) errors.password = "Enter your password.";
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const operators = await app.db.query<OperatorRow>(
      `SELECT id, email, password_hash FROM operators WHERE email = $1`,
      [email.toLowerCase()],
    );
    if (operators.length === 0 || !(await verifyPassword(password, operators[0].password_hash))) {
      throw new AppError(401, "invalid_credentials", "That email and password don't match.");
    }
    const token = randomSessionToken();
    await app.db.query(`INSERT INTO console_sessions (token, operator_id) VALUES ($1, $2)`, [
      token,
      operators[0].id,
    ]);
    return {
      status: 200,
      body: { operator: { email: operators[0].email } },
      headers: {
        "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
      },
    };
  });

  router.add("DELETE", "/api/console/session", async (route) => {
    await requireSession(app, route);
    const token = route.cookies[SESSION_COOKIE];
    await app.db.query(`DELETE FROM console_sessions WHERE token = $1`, [token]);
    return {
      status: 204,
      kind: "empty",
      headers: { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` },
    };
  });

  // --------------------------------------------------------------- projects
  router.add("GET", "/api/console/projects", async (route) => {
    await requireSession(app, route);
    const rows = await app.db.query<ProjectRow>(
      `SELECT * FROM projects ORDER BY position ASC, title ASC`,
    );
    return { status: 200, body: { projects: await Promise.all(rows.map((row) => projectView(app, row))) } };
  });

  router.add("POST", "/api/console/projects", async (route) => {
    await requireSession(app, route);
    const body = readJson(route);
    const input = validateProjectInput(body, true);
    const existing = await app.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM projects WHERE slug = $1`,
      [input.slug],
    );
    if (Number(existing[0].count) > 0) {
      throw conflict("slug_taken", "That slug is already used.");
    }
    const position = input.position ?? (await nextPosition(app));
    const result = await app.db.query<ProjectRow>(
      `INSERT INTO projects
         (slug, title, credit_type, credit_line, role, blurb, tags, visibility, position,
          bed_threshold, pulse_threshold, lead_threshold, stinger_threshold, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft')
       RETURNING *`,
      [
        input.slug,
        input.title,
        input.credit_type,
        input.credit_line,
        input.role,
        input.blurb,
        input.tags ?? [],
        input.visibility ?? "public",
        position,
        input.thresholds?.bed ?? 0,
        input.thresholds?.pulse ?? 25,
        input.thresholds?.lead ?? 50,
        input.thresholds?.stinger ?? 75,
      ],
    );
    return { status: 201, body: { project: await projectView(app, result[0]) } };
  });

  router.add("GET", "/api/console/projects/:id", async (route) => {
    await requireSession(app, route);
    const rows = await app.db.query<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [route.params.id]);
    if (rows.length === 0) throw notFound("That project does not exist.");
    return { status: 200, body: { project: await projectView(app, rows[0]) } };
  });

  router.add("PATCH", "/api/console/projects/:id", async (route) => {
    await requireSession(app, route);
    const rows = await app.db.query<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [route.params.id]);
    if (rows.length === 0) throw notFound("That project does not exist.");
    if (rows[0].status === "withdrawn") {
      throw conflict("project_withdrawn", "That project is withdrawn and cannot be edited.");
    }
    const body = readJson(route);
    const merged = {
      slug: body.slug !== undefined ? body.slug : rows[0].slug,
      title: body.title !== undefined ? body.title : rows[0].title,
      credit_type: body.credit_type !== undefined ? body.credit_type : rows[0].credit_type,
      credit_line: body.credit_line !== undefined ? body.credit_line : rows[0].credit_line,
      role: body.role !== undefined ? body.role : rows[0].role,
      blurb: body.blurb !== undefined ? body.blurb : rows[0].blurb,
      tags: body.tags !== undefined ? body.tags : rows[0].tags,
      visibility: body.visibility !== undefined ? body.visibility : rows[0].visibility,
      position: body.position !== undefined ? body.position : rows[0].position,
      thresholds: body.thresholds !== undefined ? body.thresholds : {
        bed: rows[0].bed_threshold,
        pulse: rows[0].pulse_threshold,
        lead: rows[0].lead_threshold,
        stinger: rows[0].stinger_threshold,
      },
    };
    const input = validateProjectInput(merged as Record<string, unknown>, false, body);
    if (input.slug !== rows[0].slug) {
      const clash = await app.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM projects WHERE slug = $1 AND id <> $2`,
        [input.slug, route.params.id],
      );
      if (Number(clash[0].count) > 0) {
        throw conflict("slug_taken", "That slug is already used.");
      }
    }
    const result = await app.db.query<ProjectRow>(
      `UPDATE projects SET slug = $2, title = $3, credit_type = $4, credit_line = $5, role = $6,
          blurb = $7, tags = $8, visibility = $9, position = $10, bed_threshold = $11,
          pulse_threshold = $12, lead_threshold = $13, stinger_threshold = $14, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [
        route.params.id,
        input.slug,
        input.title,
        input.credit_type,
        input.credit_line,
        input.role,
        input.blurb,
        input.tags ?? [],
        input.visibility ?? "public",
        input.position,
        input.thresholds.bed,
        input.thresholds.pulse,
        input.thresholds.lead,
        input.thresholds.stinger,
      ],
    );
    return { status: 200, body: { project: await projectView(app, result[0]) } };
  });

  router.add("POST", "/api/console/projects/:id/stems", async (route) => {
    await requireSession(app, route);
    const rows = await app.db.query<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [route.params.id]);
    if (rows.length === 0) throw notFound("That project does not exist.");
    if (rows[0].status === "withdrawn") {
      throw conflict("project_withdrawn", "That project is withdrawn and cannot be edited.");
    }
    const contentType = route.request.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw validationError({ body: "Send the stem as multipart form data." });
    }
    const parsed = parseMultipart(route.body, contentType);
    const layer = parsed.fields.get("layer") || "";
    if (!LAYERS.includes(layer as never)) {
      throw validationError({ layer: "Choose a layer: bed, pulse, lead or stinger." });
    }
    const file = parsed.files.get("file");
    if (!file) {
      throw validationError({ file: "Choose a WAV or OGG stem." });
    }
    if (!isSafeFilename(file.filename)) {
      throw validationError({ file: "File name is not allowed." });
    }
    if (file.bytes.length > 20000000) {
      throw new AppError(413, "file_too_large", "That stem is over 20,000,000 bytes.");
    }
    const sniffed = isWavOrOggAudioStem(file.bytes);
    if (!sniffed) {
      throw new AppError(415, "unsupported_media", "That file isn't a WAV or OGG stem.");
    }
    const durationMs =
      sniffed.format === "wav" ? wavDurationMs(file.bytes) ?? 0 : oggDurationMs(file.bytes) ?? 0;
    if (durationMs < 1000 || durationMs > 180000) {
      throw new AppError(422, "validation", "Stems must be between 1 and 180 seconds.", {
        errors: { file: "Stems must be between 1 and 180 seconds." },
      });
    }
    try {
      // Store the new object before deleting the old one, so a published
      // station never has a gap in that layer (DP: Business rules).
      const stem = await app.db.transaction(async (client) => {
        const previous = await client.query<{ id: string; format: string }>(
          `SELECT id, format FROM stems WHERE project_id = $1 AND layer = $2`,
          [route.params.id, layer],
        );
        const insert = await client.query<StemRow>(
          `INSERT INTO stems (project_id, layer, format, bytes, duration_ms)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [route.params.id, layer, sniffed.format, file.bytes.length, durationMs],
        );
        return { stem: insert.rows[0], previous: previous.rows[0] ?? null };
      });
      await app.storage.put(
        `projects/${route.params.id}/stems/${stem.stem.id}.${sniffed.format}`,
        file.bytes,
        sniffed.format === "wav" ? "audio/wav" : "audio/ogg",
      );
      if (stem.previous) {
        await app.storage.delete(
          `projects/${route.params.id}/stems/${stem.previous.id}.${stem.previous.format}`,
        );
      }
      app.storage.clearPlayability();
      return {
        status: 201,
        body: {
          stem: {
            id: stem.stem.id,
            layer: stem.stem.layer,
            format: stem.stem.format,
            bytes: stem.stem.bytes,
            duration_ms: stem.stem.duration_ms,
          },
        },
      };
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable();
      throw error;
    }
  });

  router.add("POST", "/api/console/projects/:id/transition", async (route) => {
    await requireSession(app, route);
    const body = readJson(route);
    const rows = await app.db.query<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [route.params.id]);
    if (rows.length === 0) throw notFound("That project does not exist.");
    const to = body.to;
    if (typeof to !== "string" || !["in_review", "draft", "published", "withdrawn"].includes(to)) {
      throw validationError({ to: "Choose a state the project can move to." });
    }
    const from = rows[0].status;
    // The single project lifecycle rule (DP-10).
    const legal: Record<string, string[]> = {
      draft: ["in_review", "withdrawn"],
      in_review: ["draft", "published", "withdrawn"],
      published: ["withdrawn"],
      withdrawn: [],
    };
    if (!legal[from].includes(to)) {
      throw illegalTransition(from, to);
    }
    if (to === "published") {
      const stems = await app.db.query<StemRow>(`SELECT * FROM stems WHERE project_id = $1`, [
        route.params.id,
      ]);
      const missing = LAYERS.filter(
        (layer) => !stems.some((stem) => stem.layer === layer),
      );
      if (missing.length > 0) {
        throw conflict("stems_incomplete", "Upload the missing stems first.", { missing });
      }
    }
    if (to === "withdrawn") {
      // Withdrawal deletes stem objects from storage before the status
      // changes (DP-12); storage unreachable answers 503 and changes nothing.
      const stems = await app.db.query<StemRow>(`SELECT * FROM stems WHERE project_id = $1`, [
        route.params.id,
      ]);
      try {
        for (const stem of stems) {
          await app.storage.delete(`projects/${route.params.id}/stems/${stem.id}.${stem.format}`);
        }
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageUnavailable();
        throw error;
      }
      await app.db.query(
        `UPDATE listening_links SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL`,
        [route.params.id],
      );
      await app.db.query(`DELETE FROM stems WHERE project_id = $1`, [route.params.id]);
      app.storage.clearPlayability();
    }
    const result = await app.db.query<ProjectRow>(
      `UPDATE projects SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [route.params.id, to],
    );
    return { status: 200, body: { project: await projectView(app, result[0]) } };
  });

  // -------------------------------------------------------- listening links
  router.add("POST", "/api/console/projects/:id/links", async (route) => {
    await requireSession(app, route);
    const rows = await app.db.query<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [route.params.id]);
    if (rows.length === 0) throw notFound("That project does not exist.");
    if (rows[0].status !== "in_review" && rows[0].status !== "published") {
      throw illegalTransition(rows[0].status, "link");
    }
    const body = readJson(route);
    const errors: Record<string, string> = {};
    const label = typeof body.label === "string" ? body.label : "";
    if (charCount(label) < 1 || charCount(label) > 80 || !isSingleLineText(label)) {
      errors.label = "Enter a label on one line, up to 80 characters.";
    }
    const expiresAt = typeof body.expires_at === "string" ? new Date(body.expires_at) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      errors.expires_at = "Choose an expiry date and time.";
    } else {
      const now = Date.now();
      if (expiresAt.getTime() <= now) {
        errors.expires_at = "Choose an expiry in the future.";
      } else if (expiresAt.getTime() - now > 31536000 * 1000) {
        errors.expires_at = "Choose an expiry within the next 365 days.";
      }
    }
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const token = randomTokenString();
    const result = await app.db.query<{
      id: string;
      label: string;
      token: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `INSERT INTO listening_links (project_id, label, token, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id, label, token, expires_at, revoked_at`,
      [route.params.id, label, token, expiresAt],
    );
    return { status: 201, body: { link: linkView(result[0]) } };
  });

  router.add("GET", "/api/console/projects/:id/links", async (route) => {
    await requireSession(app, route);
    const rows = await app.db.query<{
      id: string;
      label: string;
      token: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `SELECT id, label, token, expires_at, revoked_at FROM listening_links
        WHERE project_id = $1 ORDER BY created_at ASC`,
      [route.params.id],
    );
    return { status: 200, body: { links: rows.map(linkView) } };
  });

  router.add("POST", "/api/console/links/:id/revoke", async (route) => {
    await requireSession(app, route);
    const rows = await app.db.query<{ id: string; revoked_at: string | null }>(
      `SELECT id, revoked_at FROM listening_links WHERE id = $1`,
      [route.params.id],
    );
    if (rows.length === 0) throw notFound("That link does not exist.");
    await app.db.query(`UPDATE listening_links SET revoked_at = now() WHERE id = $1`, [route.params.id]);
    const fresh = await app.db.query<{
      id: string;
      label: string;
      token: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `SELECT id, label, token, expires_at, revoked_at FROM listening_links WHERE id = $1`,
      [route.params.id],
    );
    return { status: 200, body: { link: linkView(fresh[0]) } };
  });

  router.add("POST", "/api/console/links/:id/regenerate", async (route) => {
    await requireSession(app, route);
    const rows = await app.db.query<{
      id: string;
      label: string;
      token: string;
      expires_at: string;
      revoked_at: string | null;
      project_id: string;
    }>(
      `SELECT id, label, token, expires_at, revoked_at, project_id FROM listening_links WHERE id = $1`,
      [route.params.id],
    );
    if (rows.length === 0) throw notFound("That link does not exist.");
    const link = rows[0];
    // Revoked beats expired; only an active link can be regenerated (DP-15).
    if (link.revoked_at) {
      throw conflict("link_not_active", "Only an active link can be regenerated. Create a new link instead.");
    }
    if (new Date(link.expires_at).getTime() <= Date.now()) {
      throw conflict("link_not_active", "Only an active link can be regenerated. Create a new link instead.");
    }
    const result = await app.db.transaction(async (client) => {
      await client.query(`UPDATE listening_links SET revoked_at = now() WHERE id = $1`, [route.params.id]);
      const inserted = await client.query<{
        id: string;
        label: string;
        token: string;
        expires_at: string;
        revoked_at: string | null;
      }>(
        `INSERT INTO listening_links (project_id, label, token, expires_at, regenerated_from)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, label, token, expires_at, revoked_at`,
        [link.project_id, link.label, randomTokenString(), link.expires_at, route.params.id],
      );
      return inserted.rows[0];
    });
    return { status: 201, body: { link: linkView(result) } };
  });

  // -------------------------------------------------------------- enquiries
  router.add("GET", "/api/console/enquiries", async (route) => {
    await requireSession(app, route);
    const status = route.query.get("status") ?? undefined;
    const limitText = route.query.get("limit") ?? "25";
    const cursor = route.query.get("cursor") ?? undefined;
    const limit = parseLimit(limitText);
    if (limit === null) {
      throw validationError({ limit: "Choose a page size from 1 to 100." });
    }
    const page = await app.store.listEnquiries({ status, limit, cursor });
    return { status: 200, body: page };
  });

  router.add("GET", "/api/console/enquiries.csv", async (route) => {
    await requireSession(app, route);
    const csv = await buildCsv(app);
    return {
      status: 200,
      kind: "text",
      contentType: "text/csv; charset=utf-8",
      body: csv,
      headers: {
        "Content-Disposition": 'attachment; filename="earshot-enquiries.csv"',
      },
    };
  });

  router.add("GET", "/api/console/enquiries/:id", async (route) => {
    await requireSession(app, route);
    const enquiry = await app.store.getEnquiry(route.params.id);
    if (!enquiry) throw notFound("That enquiry does not exist.");
    await app.mailQueue.sweepExpiredProposals();
    return {
      status: 200,
      body: { enquiry },
      headers: { ETag: `"${enquiry.version}"` },
    };
  });

  router.add("GET", "/api/console/enquiries/:id/attachment", async (route) => {
    await requireSession(app, route);
    const enquiry = await app.store.getEnquiry(route.params.id);
    if (!enquiry || !enquiry.attachment) throw notFound("That attachment does not exist.");
    const rows = await app.db.query<{ attachment_id: string; attachment_format: string }>(
      `SELECT attachment_id, attachment_format FROM enquiries WHERE id = $1`,
      [route.params.id],
    );
    const format = rows[0].attachment_format;
    const stored = await app.storage.get(
      `briefs/${route.params.id}/${rows[0].attachment_id}.${format}`,
    );
    return {
      status: 200,
      kind: "media",
      body: stored.body,
      headers: {
        "Content-Type": contentTypeFor(format),
        "Content-Disposition": `attachment; filename="${sanitizeFilename(enquiry.attachment.filename)}"`,
        "Cache-Control": "no-store",
      },
    };
  });

  router.add("PATCH", "/api/console/enquiries/:id", async (route) => {
    await requireSession(app, route);
    const ifMatch = readIfMatch(route);
    const body = readJson(route);
    const writable = new Set(["triage_notes", "fit_score", "rate_floor_cents"]);
    const errors: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (!writable.has(key)) errors[key] = "Field is not writable.";
    }
    if (Object.keys(body).length === 0) {
      errors.body = "Send at least one field to save.";
    }
    const fields: {
      triage_notes?: string | null;
      fit_score?: number | null;
      rate_floor_cents?: number | null;
    } = {};
    if (body.triage_notes !== undefined) {
      if (body.triage_notes !== null) {
        if (typeof body.triage_notes !== "string" || charCount(body.triage_notes) > 4000 || !isMultiLineText(body.triage_notes)) {
          errors.triage_notes = "Triage notes can hold up to 4,000 characters.";
        } else {
          fields.triage_notes = body.triage_notes;
        }
      } else {
        fields.triage_notes = null;
      }
    }
    if (body.fit_score !== undefined) {
      if (body.fit_score !== null) {
        if (typeof body.fit_score !== "number" || !Number.isInteger(body.fit_score) || body.fit_score < 1 || body.fit_score > 5) {
          errors.fit_score = "Choose a fit score from 1 to 5.";
        } else {
          fields.fit_score = body.fit_score;
        }
      } else {
        fields.fit_score = null;
      }
    }
    if (body.rate_floor_cents !== undefined) {
      if (body.rate_floor_cents !== null) {
        if (typeof body.rate_floor_cents !== "number" || !Number.isInteger(body.rate_floor_cents) || body.rate_floor_cents < 0) {
          errors.rate_floor_cents = "Enter a rate floor in whole cents.";
        } else {
          fields.rate_floor_cents = body.rate_floor_cents;
        }
      } else {
        fields.rate_floor_cents = null;
      }
    }
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const enquiry = await app.store.saveTriage(route.params.id, ifMatch, fields);
    return { status: 200, body: { enquiry }, headers: { ETag: `"${enquiry.version}"` } };
  });

  router.add("POST", "/api/console/enquiries/:id/transition", async (route) => {
    await requireSession(app, route);
    const ifMatch = readIfMatch(route);
    const body = readJson(route);
    if (body.to === undefined) {
      throw validationError({ to: "Choose a state to move the enquiry to." });
    }
    if (body.to !== "qualified" && body.to !== "declined" && body.to !== "booked") {
      throw validationError({ to: "Choose a state the enquiry can move to." });
    }
    for (const key of Object.keys(body)) {
      if (key !== "to") throw validationError({ [key]: "Field is not writable." });
    }
    const result = await app.store.transitionEnquiry(route.params.id, ifMatch, body.to);
    return {
      status: 200,
      body: { enquiry: result.enquiry },
      headers: { ETag: `"${result.enquiry.version}"` },
    };
  });

  router.add("POST", "/api/console/enquiries/:id/proposal", async (route) => {
    await requireSession(app, route);
    const ifMatch = readIfMatch(route);
    const body = readJson(route);
    const writable = new Set([
      "producer_name",
      "producer_email",
      "project_title",
      "scope",
      "fee_cents",
      "production_month",
    ]);
    const errors: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (!writable.has(key)) errors[key] = "Field is not writable.";
    }
    const required = ["producer_name", "producer_email", "project_title", "scope", "fee_cents", "production_month"];
    for (const key of required) {
      if (body[key] === undefined) errors[key] = "Fill this in.";
    }
    if (typeof body.producer_name === "string" && (charCount(body.producer_name) < 1 || charCount(body.producer_name) > 120 || !isSingleLineText(body.producer_name))) {
      errors.producer_name = "Enter a name on one line, up to 120 characters.";
    }
    if (typeof body.producer_email === "string" && !isBareAddress(body.producer_email)) {
      errors.producer_email = "Enter one email address without extra text.";
    }
    if (typeof body.project_title === "string" && (charCount(body.project_title) < 1 || charCount(body.project_title) > 120 || !isSingleLineText(body.project_title))) {
      errors.project_title = "Enter a title on one line, up to 120 characters.";
    }
    if (typeof body.scope === "string" && (charCount(body.scope) < 1 || charCount(body.scope) > 2000 || !isMultiLineText(body.scope))) {
      errors.scope = "Write the scope, up to 2,000 characters.";
    }
    if (typeof body.fee_cents === "number" && (!Number.isInteger(body.fee_cents) || body.fee_cents < 100 || body.fee_cents > 100000000)) {
      errors.fee_cents = "Enter a fee between $1 and $1,000,000.";
    }
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const enquiryBefore = await app.store.getEnquiry(route.params.id);
    if (
      enquiryBefore &&
      enquiryBefore.rate_floor_cents !== null &&
      typeof body.fee_cents === "number" &&
      body.fee_cents < enquiryBefore.rate_floor_cents
    ) {
      throw validationError({ fee_cents: "Enter a fee at or above your rate floor." });
    }
    if (typeof body.production_month === "string" && !isMonthString(body.production_month)) {
      throw validationError({ production_month: "Choose a month in YYYY-MM form." });
    }
    const producerName = body.producer_name as string;
    const producerEmail = body.producer_email as string;
    const projectTitle = body.project_title as string;
    const scope = body.scope as string;
    const feeCents = body.fee_cents as number;
    const productionMonth = body.production_month as string;
    const enquiry = await app.store.createProposal(route.params.id, ifMatch, {
      producer_name: producerName,
      producer_email: producerEmail,
      project_title: projectTitle,
      scope,
      fee_cents: feeCents,
      production_month: productionMonth,
    });
    // The proposal email is queued with the settings as they stand now (DP-51).
    const settings = await app.store.readSettings();
    const proposal = enquiry.proposal!;
    const milestones = proposal.milestones;
    await app.mailQueue.queue({
      enquiryId: route.params.id,
      kind: "proposal",
      recipient: displayAddress(producerName, producerEmail),
      subject: `Proposal ${enquiry.reference} from Kettlehole Audio: ${projectTitle}`,
      body: [
        `A proposal from Kettlehole Audio for ${projectTitle}.`,
        ``,
        `Proposal ${enquiry.reference}.`,
        `Scope: ${scope}`,
        ``,
        `Milestones:`,
        ...milestones.map((milestone) => `  ${milestone.name} (${milestone.percent}%): $${money(milestone.amount_cents)}`),
        ``,
        `Accept and hold the month at ${proposal.url}`,
        `This link stops working on ${formatInstant(new Date(proposal.expires_at), settings.time_zone)}.`,
        ``,
        `Kettlehole Audio`,
      ].join("\r\n"),
      from: app.config.smtp.from,
    });
    const emailState = await app.mailQueue.tryDeliverNewlyQueued(route.params.id, "proposal");
    const fresh = await app.store.getEnquiry(route.params.id);
    return {
      status: 201,
      body: { enquiry: fresh, email: emailState },
      headers: { ETag: `"${fresh!.version}"` },
    };
  });

  router.add("POST", "/api/console/enquiries/:id/milestones/:n/invoice", async (route) => {
    await requireSession(app, route);
    const ifMatch = readIfMatch(route);
    const number = Number.parseInt(route.params.n, 10);
    if (number < 2 || number > 4) {
      throw notFound("That milestone does not exist.");
    }
    return invoiceMilestone(app, route.params.id, ifMatch, number);
  });

  // ----------------------------------------------------------------- months
  router.add("GET", "/api/console/months", async (route) => {
    await requireSession(app, route);
    const months = await app.store.monthsFromCurrent();
    return { status: 200, body: { months } };
  });

  router.add("PUT", "/api/console/months/:month", async (route) => {
    await requireSession(app, route);
    const body = readJson(route);
    const month = route.params.month;
    const errors: Record<string, string> = {};
    if (!isMonthString(month)) {
      errors.month = "Choose a month in YYYY-MM form.";
    } else {
      const settings = await app.store.readSettings();
      const current = await app.store.nextMonths(1);
      if (month < current[0]) {
        errors.month = "Choose the current month or a later one.";
      }
    }
    if (typeof body.capacity !== "number" || !Number.isInteger(body.capacity) || body.capacity < 0 || body.capacity > 12) {
      errors.capacity = "Choose a capacity from 0 to 12.";
    }
    for (const key of Object.keys(body)) {
      if (key !== "capacity") errors[key] = "Field is not writable.";
    }
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const record = await app.store.setMonthCapacity(month, body.capacity as number);
    return { status: 200, body: { month: record } };
  });

  // --------------------------------------------------------------- settings
  router.add("GET", "/api/console/settings", async (route) => {
    await requireSession(app, route);
    const settings = await app.store.readSettings();
    return { status: 200, body: settings };
  });

  router.add("PUT", "/api/console/settings", async (route) => {
    await requireSession(app, route);
    const body = readJson(route);
    const errors: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== "time_zone") errors[key] = "Field is not writable.";
    }
    if (typeof body.time_zone !== "string" || !isIANAZone(body.time_zone)) {
      errors.time_zone = "Choose a time zone from the list.";
    }
    if (Object.keys(errors).length > 0) throw validationError(errors);
    await app.store.writeTimeZone(body.time_zone as string);
    const settings = await app.store.readSettings();
    return { status: 200, body: settings };
  });

  // -------------------------------------------------------------- mail queue
  router.add("GET", "/api/console/mail-queue", async (route) => {
    await requireSession(app, route);
    await app.mailQueue.sweepExpiredProposals();
    const emails = await app.mailQueue.listPending();
    return {
      status: 200,
      body: {
        server_time: new Date().toISOString(),
        emails: emails.map((email) => ({
          kind: email.kind,
          reference: email.reference,
          to: email.to,
          queued_at: new Date(email.queued_at).toISOString(),
          retry_at: email.retry_at ? new Date(email.retry_at).toISOString() : null,
        })),
      },
    };
  });

  router.add("POST", "/api/console/milestones/preview", async (route) => {
    await requireSession(app, route);
    const body = readJson(route);
    if (
      typeof body.fee_cents !== "number" ||
      !Number.isInteger(body.fee_cents) ||
      body.fee_cents < 100 ||
      body.fee_cents > 100000000
    ) {
      throw validationError({ fee_cents: "Enter a fee between $1 and $1,000,000." });
    }
    for (const key of Object.keys(body)) {
      if (key !== "fee_cents") throw validationError({ [key]: "Field is not writable." });
    }
    return { status: 200, body: { milestones: milestoneSplit(body.fee_cents) } };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireSession(app: Earshot, route: RouteContext): Promise<void> {
  const token = route.cookies[SESSION_COOKIE];
  if (!token) throw new AppError(401, "unauthenticated", "Sign in to use the console.");
  const rows = await app.db.query<{ operator_id: string }>(
    `SELECT operator_id FROM console_sessions WHERE token = $1`,
    [token],
  );
  if (rows.length === 0) throw new AppError(401, "unauthenticated", "Sign in to use the console.");
}

function readJson(route: RouteContext): Record<string, unknown> {
  if (route.body.length === 0) {
    throw validationError({ body: "Send a JSON body." });
  }
  try {
    return JSON.parse(route.body.toString("utf-8")) as Record<string, unknown>;
  } catch {
    throw new AppError(400, "malformed_json", "That request body is not valid JSON.");
  }
}

function readIfMatch(route: RouteContext): string | null {
  const header = route.request.headers["if-match"];
  if (header === undefined) return null;
  const text = Array.isArray(header) ? header[0] : header;
  const unquoted = text.replace(/^"|"$/g, "");
  return unquoted;
}

function parseLimit(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  if (value < 1 || value > 100) return null;
  return value;
}

function isIANAZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function linkView(row: {
  id: string;
  label: string;
  token: string;
  expires_at: string;
  revoked_at: string | null;
}): {
  id: string;
  label: string;
  token: string;
  url: string;
  expires_at: string;
  status: "active" | "expired" | "revoked";
} {
  const expired = new Date(row.expires_at).getTime() <= Date.now();
  const status = row.revoked_at ? "revoked" : expired ? "expired" : "active";
  return {
    id: row.id,
    label: row.label,
    token: row.token,
    url: `/listen/${row.token}`,
    expires_at: new Date(row.expires_at).toISOString(),
    status,
  };
}

async function projectView(app: Earshot, row: ProjectRow): Promise<unknown> {
  const stems = await app.db.query<StemRow>(
    `SELECT * FROM stems WHERE project_id = $1 ORDER BY layer ASC`,
    [row.id],
  );
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    credit_type: row.credit_type,
    credit_line: row.credit_line,
    role: row.role,
    blurb: row.blurb,
    tags: row.tags,
    visibility: row.visibility,
    position: row.position,
    thresholds: {
      bed: row.bed_threshold,
      pulse: row.pulse_threshold,
      lead: row.lead_threshold,
      stinger: row.stinger_threshold,
    },
    status: row.status,
    stems: stems.map((stem) => ({
      id: stem.id,
      layer: stem.layer,
      format: stem.format,
      bytes: stem.bytes,
      duration_ms: stem.duration_ms,
    })),
  };
}

async function nextPosition(app: Earshot): Promise<number> {
  const rows = await app.db.query<{ next: number | null }>(
    `SELECT max(position) + 1 AS next FROM projects`,
  );
  return rows[0].next ?? 1;
}

interface ValidatedProject {
  slug: string;
  title: string;
  credit_type: "shipped" | "jam" | "redesign";
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[] | null;
  visibility: "public" | "nda";
  position: number;
  thresholds: { bed: number; pulse: number; lead: number; stinger: number };
}

function validateProjectInput(
  body: Record<string, unknown>,
  isCreate: boolean,
  rawBody?: Record<string, unknown>,
): ValidatedProject {
  const errors: Record<string, string> = {};
  // Writable fields only (DP-53); every other key answers 422 naming it.
  const writable = new Set([
    "slug",
    "title",
    "credit_type",
    "credit_line",
    "role",
    "blurb",
    "tags",
    "visibility",
    "position",
    "thresholds",
  ]);
  const source = rawBody ?? body;
  for (const key of Object.keys(source)) {
    if (!writable.has(key)) errors[key] = "Field is not writable.";
  }
  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) {
    errors.slug = "Use 3 to 48 lowercase letters, digits and hyphens.";
  }
  const title = typeof body.title === "string" ? body.title : "";
  if (charCount(title) < 1 || charCount(title) > 120 || !isSingleLineText(title)) {
    errors.title = "Enter a title on one line, up to 120 characters.";
  }
  const creditType = body.credit_type;
  if (creditType !== "shipped" && creditType !== "jam" && creditType !== "redesign") {
    errors.credit_type = "Choose a credit type.";
  }
  const creditLine = typeof body.credit_line === "string" ? body.credit_line : "";
  if (charCount(creditLine) < 1 || charCount(creditLine) > 200 || !isSingleLineText(creditLine)) {
    errors.credit_line = "Enter a credit line on one line, up to 200 characters.";
  }
  const role = typeof body.role === "string" ? body.role : "";
  if (charCount(role) < 1 || charCount(role) > 120 || !isSingleLineText(role)) {
    errors.role = "Enter a role on one line, up to 120 characters.";
  }
  const blurb = typeof body.blurb === "string" ? body.blurb : "";
  if (charCount(blurb) < 1 || charCount(blurb) > 1000 || !isMultiLineText(blurb)) {
    errors.blurb = "Write a blurb of up to 1,000 characters.";
  }
  let tags: string[] | null = null;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      errors.tags = "Enter tags as a list.";
    } else {
      if (body.tags.length > 10) errors.tags = "Use at most 10 tags.";
      for (const tag of body.tags) {
        if (typeof tag !== "string" || charCount(tag) < 1 || charCount(tag) > 30 || !isSingleLineText(tag)) {
          errors.tags = "Each tag holds 1 to 30 characters.";
          break;
        }
      }
      if (!errors.tags) tags = body.tags as string[];
    }
  }
  let visibility: "public" | "nda" | null = null;
  if (body.visibility !== undefined) {
    if (body.visibility !== "public" && body.visibility !== "nda") {
      errors.visibility = "Choose public or NDA.";
    } else {
      visibility = body.visibility;
    }
  }
  let position: number | null = null;
  if (body.position !== undefined) {
    if (typeof body.position !== "number" || !Number.isInteger(body.position) || body.position < 1 || body.position > 999) {
      errors.position = "Choose a position from 1 to 999.";
    } else {
      position = body.position;
    }
  }
  let thresholds: { bed: number; pulse: number; lead: number; stinger: number } | null = null;
  if (body.thresholds !== undefined) {
    const value = body.thresholds;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.thresholds = "Set a threshold for each of the four layers.";
    } else {
      const keys = Object.keys(value);
      const allowed = ["bed", "pulse", "lead", "stinger"];
      for (const key of keys) {
        if (!allowed.includes(key)) errors[key === "" ? "thresholds" : `thresholds.${key}`] = "Field is not writable.";
      }
      for (const key of allowed) {
        if (!(key in value)) {
          errors.thresholds = "Set a threshold for each of the four layers.";
          break;
        }
      }
      const bed = (value as Record<string, unknown>).bed;
      const pulse = (value as Record<string, unknown>).pulse;
      const lead = (value as Record<string, unknown>).lead;
      const stinger = (value as Record<string, unknown>).stinger;
      const validNumber = (candidate: unknown, min: number): candidate is number =>
        typeof candidate === "number" && Number.isInteger(candidate) && candidate >= min && candidate <= 100;
      if (
        !validNumber(bed, 0) ||
        !validNumber(pulse, 1) ||
        !validNumber(lead, 1) ||
        !validNumber(stinger, 1) ||
        bed !== 0 ||
        !(pulse > bed && lead > pulse && stinger > lead)
      ) {
        errors.thresholds = "The bed starts at 0 and the four thresholds must increase.";
      } else {
        thresholds = { bed, pulse, lead, stinger };
      }
    }
  }
  if (isCreate && Object.keys(body).length === 0) {
    errors.body = "Send a JSON body.";
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);
  return {
    slug,
    title,
    credit_type: creditType as "shipped" | "jam" | "redesign",
    credit_line: creditLine,
    role,
    blurb,
    tags,
    visibility: (visibility ?? "public") as "public" | "nda",
    position: position ?? 0,
    thresholds: thresholds ?? { bed: 0, pulse: 25, lead: 50, stinger: 75 },
  };
}

function money(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsPart = (abs % 100).toString().padStart(2, "0");
  return `${dollars}.${centsPart}`;
}

async function invoiceMilestone(
  app: Earshot,
  enquiryId: string,
  ifMatch: string | null,
  number: number,
): Promise<unknown> {
  // Milestone invoicing holds the enquiry for the whole step (DP-56).
  return app.db.transaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`enquiry:${enquiryId}`]);
    const current = (
      await client.query<{
        status: string;
        version: number;
        reference: string;
        invoiced_milestones: number[];
        kb_account_id: string | null;
        m2_cents: number;
        m3_cents: number;
        m4_cents: number;
        kb_milestone_invoice_ids: string[];
        kb_milestone_invoice_numbers: string[];
        kb_milestone_item_dates: string[];
      }>(
        `SELECT e.status, e.version, e.reference, p.invoiced_milestones, p.kb_account_id,
                p.m2_cents, p.m3_cents, p.m4_cents, p.kb_milestone_invoice_ids,
                p.kb_milestone_invoice_numbers, p.kb_milestone_item_dates
           FROM enquiries e JOIN proposals p ON p.enquiry_id = e.id
          WHERE e.id = $1 FOR UPDATE OF e`,
        [enquiryId],
      )
    ).rows[0];
    if (!current) throw notFound("That enquiry does not exist.");
    if (ifMatch === null) throw preconditionRequired();
    if (String(current.version) !== ifMatch) {
      const enquiry = await app.store.getEnquiry(enquiryId);
      throw staleVersion(enquiry);
    }
    if (current.status !== "booked") {
      throw illegalTransition(current.status, "milestone_invoice");
    }
    if (current.invoiced_milestones.includes(number)) {
      throw conflict("milestone_already_invoiced", "That milestone is already invoiced.");
    }
    const expected = number === 2 ? current.m2_cents : number === 3 ? current.m3_cents : current.m4_cents;
    const needed = [2, 3, 4].filter((candidate) => candidate !== number && candidate < number);
    const missing = needed.filter((candidate) => !current.invoiced_milestones.includes(candidate));
    if (missing.length > 0) {
      throw conflict("milestone_out_of_order", "Invoice the earlier milestones first.");
    }
    if (!current.kb_account_id) {
      throw notFound("The billing account is missing.");
    }
    const names: Record<number, string> = {
      2: "Vertical slice",
      3: "Content complete",
      4: "Final delivery",
    };
    const description = `Milestone ${number} of 4: ${names[number]} (${current.reference})`;
    const businessDate = await app.store.businessDate();
    let invoiceId: string;
    let invoiceNumber: string;
    let invoiceDate: string;
    try {
      const invoices = await app.killbill.listInvoices(current.kb_account_id);
      const existing = invoices.find(
        (invoice) =>
          invoice.status !== "VOID" &&
          invoice.itemDescriptions.some((item) => item.description === description),
      );
      if (existing) {
        const amount = existing.itemDescriptions
          .filter((item) => item.description === description)
          .reduce((sum, item) => sum + item.amountCents, 0);
        if (amount !== expected) {
          throw conflict("milestone_mismatch", "Kill Bill already holds a different amount for that milestone.", {
            number,
          });
        }
        invoiceId = existing.invoiceId;
        invoiceNumber = existing.invoiceNumber;
        invoiceDate = existing.itemStartDate ?? businessDate;
      } else {
        const created = await app.killbill.createExternalChargeInvoice({
          accountId: current.kb_account_id,
          description,
          amountCents: expected,
          startDate: businessDate,
          autoCommit: true,
        });
        invoiceId = created.invoiceId;
        invoiceNumber = created.invoiceNumber;
        invoiceDate = created.itemStartDate ?? businessDate;
      }
    } catch (error) {
      if (error instanceof KillBillUnavailable) {
        throw new AppError(503, "billing_unavailable", "Billing is unreachable. Nothing was invoiced.");
      }
      if (error instanceof AppError) throw error;
      throw error;
    }
    const invoiced = [...current.invoiced_milestones, number].sort((a, b) => a - b);
    await client.query(
      `UPDATE proposals SET invoiced_milestones = $2, kb_milestone_invoice_ids = $3,
          kb_milestone_invoice_numbers = $4, kb_milestone_item_dates = $5
        WHERE enquiry_id = $1`,
      [
        enquiryId,
        invoiced,
        [...current.kb_milestone_invoice_ids, invoiceId],
        [...current.kb_milestone_invoice_numbers, invoiceNumber],
        [...current.kb_milestone_item_dates, invoiceDate],
      ],
    );
    await client.query(`UPDATE enquiries SET version = version + 1 WHERE id = $1`, [enquiryId]);
    const enquiry = await app.store.getEnquiryInTransactionForRoutes(client, enquiryId);
    return {
      status: 201,
      body: {
        milestone: {
          number,
          amount_cents: expected,
          invoice_number: invoiceNumber,
          killbill_invoice_id: invoiceId,
          invoice_date: invoiceDate,
        },
        enquiry,
      },
      headers: { ETag: `"${enquiry!.version}"` },
    };
  });
}

async function buildCsv(app: Earshot): Promise<string> {
  const rows = await app.db.query<{
    reference: string;
    received_at: string;
    status: string;
    name: string;
    email: string;
    studio: string;
    brief: string;
    preferred_month: string | null;
    project_slug: string | null;
    fit_score: number | null;
    receipt_state: string | null;
    project_status: string | null;
    expires_at: string | null;
    accepted_at: string | null;
  }>(
    `SELECT e.reference, e.received_at, e.status, e.name, e.email, e.studio, e.brief,
            e.preferred_month, e.project_slug, e.fit_score, m.state AS receipt_state,
            p.status AS project_status, pr.expires_at, pr.accepted_at
       FROM enquiries e
       LEFT JOIN mail_queue m ON m.enquiry_id = e.id AND m.kind = 'receipt'
       LEFT JOIN projects p ON p.slug = e.project_slug
       LEFT JOIN proposals pr ON pr.enquiry_id = e.id
      ORDER BY e.reference DESC`,
  );
  const header = "reference,received_at,status,name,email,studio,brief,preferred_month,project_slug,fit_score,receipt";
  const lines = [header];
  for (const row of rows) {
    const status = readCsvStatus(row);
    const slug = row.project_status === "withdrawn" ? "" : row.project_slug ?? "";
    const receipt = row.receipt_state === "sent" ? "sent" : "pending";
    const cells = [
      row.reference,
      new Date(row.received_at).toISOString(),
      status,
      row.name,
      row.email,
      row.studio,
      row.brief,
      row.preferred_month ?? "",
      slug,
      row.fit_score === null ? "" : String(row.fit_score),
      receipt,
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function readCsvStatus(row: {
  status: string;
  expires_at: string | null;
  accepted_at: string | null;
}): string {
  if (row.status === "proposal_sent" && !row.accepted_at && row.expires_at) {
    if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  }
  return row.status;
}

/** The single CSV neutralisation rule (DP-23). */
function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\r\n]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, "_");
}

function contentTypeFor(format: string): string {
  switch (format) {
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    default:
      return "application/pdf";
  }
}

export { streamStoredObject };
