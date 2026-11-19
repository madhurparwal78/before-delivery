import { Context, Earshot } from "../context.js";
import { RouteContext } from "../http-core.js";
import {
  AppError,
  conflict,
  notFound,
  readOnly,
  storageUnavailable,
  validationError,
} from "../errors.js";
import { parseMultipart } from "../multipart.js";
import { CREDIT_LABELS, LAYERS, Station, StationStem, Thresholds } from "../../shared/domain.js";
import { isBareAddress, isMultiLineText, isSingleLineText, charCount } from "../../shared/text-rules.js";
import { isMonthString } from "../../shared/dates.js";
import { isAcceptableReference, isSafeFilename, oggDurationMs, wavDurationMs } from "../media-sniff.js";
import { sha256Hex } from "../crypto.js";
import { displayAddress } from "../mailer.js";
import { StemRow, ProjectRow } from "./records.js";
import { StorageUnavailable } from "../storage.js";
import { PoolClient } from "pg";

/**
 * Public API: journey, search, stems, months, the brief endpoint and private
 * listening (DP-02 to DP-20, DP-48, DP-52).
 */

export function publicApi(context: Context): void {
  const { app, router } = context;

  router.add("GET", "/api/health", async () => ({ status: 200, body: { status: "ok" } }));

  router.add("GET", "/api/journey", async () => journey(app));

  router.add("GET", "/api/search", async (route) => {
    const q = (route.query.get("q") || "").trim();
    if (q.length === 0 || q.length > 100) {
      throw validationError({ q: "Type between 1 and 100 characters." });
    }
    const needle = q.toLowerCase();
    const projects = await publicStationRows(app);
    const results = projects
      .filter((project) => {
        const haystacks = [project.title, project.credit_line, project.blurb, ...project.tags];
        return haystacks.some((text) => text.toLowerCase().includes(needle));
      })
      .map((project) => ({
        slug: project.slug,
        title: project.title,
        credit_label: CREDIT_LABELS[project.credit_type as "shipped" | "jam" | "redesign"],
      }));
    return { status: 200, body: { results } };
  });

  router.add("GET", "/api/stems/:id", async (route) => publicStem(app, route.params.id));

  router.add("GET", "/api/months", async () => {
    const months = await app.store.openMonths();
    return {
      status: 200,
      body: { months: months.map((month) => ({ month: month.month, label: month.label })) },
    };
  });

  router.add("POST", "/api/enquiries", async (route) => createEnquiry(app, route));

  router.add("GET", "/api/listen/:token", async (route) => listenData(app, route.params.token));
  router.add("GET", "/api/listen/:token/stems/:id", async (route) =>
    listenStem(app, route.params.token, route.params.id),
  );
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    router.add(method, "/api/listen/:token", async () => {
      throw readOnly();
    });
    router.add(method, "/api/listen/:token/stems/:id", async () => {
      throw readOnly();
    });
  }
}

async function journey(app: Earshot): Promise<{ status: number; body: { stations: Station[] } }> {
  const rows = await publicStationRows(app);
  const stations: Station[] = [];
  for (const project of rows) {
    stations.push(await stationForProject(app, project, "public"));
  }
  return { status: 200, body: { stations } };
}

async function publicStationRows(app: Earshot): Promise<ProjectRow[]> {
  return app.db.query<ProjectRow>(
    `SELECT * FROM projects WHERE status = 'published' AND visibility = 'public'
      ORDER BY position ASC, title ASC`,
  );
}

async function stationForProject(
  app: Earshot,
  project: ProjectRow,
  audience: "public" | "listen",
  token?: string,
): Promise<Station> {
  const stems = await app.db.query<StemRow>(`SELECT * FROM stems WHERE project_id = $1`, [project.id]);
  const playable = await stationPlayable(app, project.id, stems);
  const stemList: StationStem[] = [];
  if (playable) {
    for (const layer of LAYERS) {
      const stem = stems.find((entry) => entry.layer === layer);
      if (!stem) continue;
      const url =
        audience === "listen" && token
          ? `/api/listen/${token}/stems/${stem.id}`
          : `/api/stems/${stem.id}`;
      stemList.push({ id: stem.id, layer, url });
    }
  }
  const thresholds: Thresholds = {
    bed: project.bed_threshold,
    pulse: project.pulse_threshold,
    lead: project.lead_threshold,
    stinger: project.stinger_threshold,
  };
  return {
    slug: project.slug,
    title: project.title,
    credit_type: project.credit_type as "shipped" | "jam" | "redesign",
    credit_label: CREDIT_LABELS[project.credit_type as "shipped" | "jam" | "redesign"],
    credit_line: project.credit_line,
    role: project.role,
    blurb: project.blurb,
    tags: project.tags,
    thresholds,
    playable,
    stems: playable ? stemList : [],
  };
}

async function stationPlayable(app: Earshot, projectId: string, stems: StemRow[]): Promise<boolean> {
  if (stems.length < 4) return false;
  const keys = stems.map((stem) => `projects/${projectId}/stems/${stem.id}.${stem.format}`);
  try {
    return await app.storage.stationPlayable(projectId, keys);
  } catch {
    return false;
  }
}

async function publicStem(app: Earshot, stemId: string): Promise<unknown> {
  const rows = await app.db.query<StemRow & { project_status: string; project_visibility: string }>(
    `SELECT s.*, p.status AS project_status, p.visibility AS project_visibility
       FROM stems s JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [stemId],
  );
  if (rows.length === 0) throw notFound();
  const row = rows[0];
  // Public stem URLs serve only published public projects (DP-16).
  if (row.project_status !== "published" || row.project_visibility !== "public") throw notFound();
  return streamStoredObject(app, `projects/${row.project_id}/stems/${row.id}.${row.format}`, row.format, "no-store");
}

export async function streamStoredObject(
  app: Earshot,
  key: string,
  format: string,
  cacheControl: string,
): Promise<{
  status: number;
  body: Buffer | null;
  headers: Record<string, string | number>;
  kind: "media";
}> {
  const contentType =
    format === "wav"
      ? "audio/wav"
      : format === "ogg"
        ? "audio/ogg"
        : format === "mp3"
          ? "audio/mpeg"
          : "application/pdf";
  try {
    const stored = await app.storage.get(key);
    return {
      status: 200,
      body: stored.body,
      headers: {
        "Content-Type": contentType,
        "Content-Length": stored.body.length,
        "Cache-Control": cacheControl,
      },
      kind: "media",
    };
  } catch (error) {
    if (error instanceof Error && (error as Error & { missing?: boolean }).missing) {
      throw notFound();
    }
    if (error instanceof StorageUnavailable) {
      throw storageUnavailable();
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Enquiry creation (DP-18 to DP-21, DP-46, DP-65)
// ---------------------------------------------------------------------------

interface BriefFields {
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferred_month?: string;
  project_slug?: string;
  listen_token?: string;
}

async function createEnquiry(app: Earshot, route: RouteContext): Promise<unknown> {
  const contentType = route.request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw validationError({ body: "Send the brief as multipart form data." });
  }
  let parsed;
  try {
    parsed = parseMultipart(route.body, contentType);
  } catch {
    throw new AppError(400, "malformed_multipart", "That request body could not be read.");
  }
  const fields: BriefFields = {
    name: parsed.fields.get("name") || "",
    email: parsed.fields.get("email") || "",
    studio: parsed.fields.get("studio") || "",
    brief: parsed.fields.get("brief") || "",
    preferred_month: parsed.fields.get("preferred_month") || undefined,
    project_slug: parsed.fields.get("project_slug") || undefined,
    listen_token: parsed.fields.get("listen_token") || undefined,
  };
  const attachment = parsed.files.get("attachment");
  const idempotencyKeyHeader = singleHeader(route.request.headers["idempotency-key"]);
  const errors: Record<string, string> = {};
  let idempotencyKey: string | null = null;
  if (idempotencyKeyHeader !== undefined) {
    idempotencyKey = visibleAscii(idempotencyKeyHeader);
    if (idempotencyKey === null) {
      errors["Idempotency-Key"] = "Send a key of 1 to 100 visible ASCII characters.";
    }
  }

  const fieldErrors: Record<string, string> = {};
  if (!fields.name || charCount(fields.name) > 120 || !isSingleLineText(fields.name)) {
    fieldErrors.name = "Enter your name on one line, up to 120 characters.";
  }
  if (!fields.email || !isBareAddress(fields.email)) {
    fieldErrors.email = "Enter one email address without extra text.";
  }
  if (!fields.studio || charCount(fields.studio) > 120 || !isSingleLineText(fields.studio)) {
    fieldErrors.studio = "Enter your studio on one line, up to 120 characters.";
  }
  if (!fields.brief || charCount(fields.brief) < 20 || charCount(fields.brief) > 4000 || !isMultiLineText(fields.brief)) {
    fieldErrors.brief = "Write at least 20 characters, up to 4,000.";
  }
  let preferredMonth: string | null = null;
  if (fields.preferred_month && fields.preferred_month.trim() !== "") {
    if (!isMonthString(fields.preferred_month)) {
      fieldErrors.preferred_month = "Choose a month in YYYY-MM form.";
    } else {
      preferredMonth = fields.preferred_month;
    }
  }
  if (attachment && !isSafeFilename(attachment.filename)) {
    fieldErrors.attachment = "File name is not allowed.";
  }

  let attachmentFormat: string | null = null;
  if (attachment && !fieldErrors.attachment) {
    if (attachment.bytes.length > 10000000) {
      fieldErrors.attachment = "That file is too large. The limit is 10,000,000 bytes.";
    } else {
      const sniffed = isAcceptableReference(attachment.bytes);
      if (!sniffed) {
        fieldErrors.attachment = "That file type isn't accepted. Send WAV, OGG, MP3 or PDF.";
      } else {
        if (sniffed.format === "wav" || sniffed.format === "ogg") {
          const durationMs =
            sniffed.format === "wav" ? wavDurationMs(attachment.bytes) : oggDurationMs(attachment.bytes);
          if (durationMs !== null && durationMs > 600000) {
            fieldErrors.attachment = "That reference is too long. The limit is 10 minutes.";
          }
        }
        attachmentFormat = sniffed.format;
      }
    }
  }

  if (preferredMonth && !fieldErrors.preferred_month) {
    const months = await app.store.openMonths();
    if (!months.some((month) => month.month === preferredMonth)) {
      fieldErrors.preferred_month = "Choose an open production month.";
    }
  }

  const fingerprint = briefFingerprint(parsed, attachment);
  const replay: ReplayOutcome | null = idempotencyKey
    ? await findBriefReplay(app, idempotencyKey, fingerprint)
    : null;
  if (replay && replay.outcome === "stored") {
    return { status: replay.status, body: replay.body };
  }
  if (replay && replay.outcome === "conflict") {
    throw conflict("idempotency_conflict", "That key was used for a different brief.");
  }
  if (replay && replay.outcome === "in_progress") {
    throw conflict("request_in_progress", "That brief is still being saved.");
  }

  if (Object.keys(errors).length > 0) {
    throw validationError({ ...fieldErrors, ...errors });
  }
  if (Object.keys(fieldErrors).length > 0) {
    if (idempotencyKey) {
      await storeBriefResponse(app, idempotencyKey, fingerprint, 422, {
        error: "validation",
        message: "Check the highlighted fields.",
        errors: fieldErrors,
      });
    }
    throw validationError(fieldErrors);
  }

  const retryAfter = await checkPacing(app, fields.email, route.ip);
  if (retryAfter !== null) {
    throw new AppError(429, "rate_limited", "You have sent several briefs in a short time. Try again later.", {
      retry_after_seconds: retryAfter,
    });
  }

  // Resolve project context: a live link wins, otherwise a published public
  // project slug, otherwise nothing (DP: References and project context).
  let projectSlug: string | null = null;
  if (fields.listen_token) {
    const link = await liveLinkByToken(app, fields.listen_token);
    if (link) projectSlug = link.project_slug;
  }
  if (!projectSlug && fields.project_slug) {
    const rows = await app.db.query<{ slug: string }>(
      `SELECT slug FROM projects WHERE slug = $1 AND status = 'published' AND visibility = 'public'`,
      [fields.project_slug],
    );
    if (rows.length > 0) projectSlug = rows[0].slug;
  }

  try {
    return await saveEnquiry(app, {
      fields,
      preferredMonth,
      projectSlug,
      attachment: attachment ? { filename: attachment.filename, bytes: attachment.bytes, format: attachmentFormat! } : null,
      fingerprint,
      idempotencyKey,
      ip: route.ip,
    });
  } catch (error) {
    if (error instanceof AppError && idempotencyKey && error.status !== 429 && error.status !== 503) {
      await storeBriefResponse(app, idempotencyKey, fingerprint, error.status, {
        error: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}

interface SaveEnquiryInput {
  fields: BriefFields;
  preferredMonth: string | null;
  projectSlug: string | null;
  attachment: { filename: string; bytes: Buffer; format: string } | null;
  fingerprint: string;
  idempotencyKey: string | null;
  ip: string;
}

async function saveEnquiry(app: Earshot, input: SaveEnquiryInput): Promise<unknown> {
  if (input.idempotencyKey) {
    const claimed = await app.db.transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO idempotency_briefs (key, state, fingerprint, status, body)
         VALUES ($1, 'in_progress', $2, 0, 'null')
         ON CONFLICT (key) DO NOTHING`,
        [input.idempotencyKey, input.fingerprint],
      );
      return result.rowCount ?? 0;
    });
    if (claimed === 0) {
      const replay = await findBriefReplay(app, input.idempotencyKey!, input.fingerprint);
      if (replay.outcome === "conflict") {
        throw conflict("idempotency_conflict", "That key was used for a different brief.");
      }
      if (replay.outcome === "in_progress") {
        throw conflict("request_in_progress", "That brief is still being saved.");
      }
      if (replay.outcome === "stored") {
        return { status: replay.status, body: replay.body };
      }
    }
  }
  let stored = false;
  let begunId = "";
  try {
    const begun = await beginEnquiry(app, input);
    stored = true;
    begunId = begun.id;
    if (input.attachment) {
      const key = `briefs/${begun.id}/${begun.attachmentId}.${input.attachment.format}`;
      await app.storage.put(key, input.attachment.bytes, contentTypeFor(input.attachment.format));
    }
    return await finishEnquiry(app, begun, input);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      // Storage was needed only for the attachment: undo the enquiry row so no
      // enquiry is saved without its attachment (DP-19), and answer 503.
      if (stored) {
        await app.db.query(`DELETE FROM enquiries WHERE id = $1`, [begunId]);
      }
      if (input.idempotencyKey) {
        await app.db.query(`DELETE FROM idempotency_briefs WHERE key = $1`, [input.idempotencyKey]);
      }
      throw storageUnavailable();
    }
    if (stored && input.idempotencyKey) {
      // The enquiry row was saved; the replay rule still holds because the
      // response was never stored under the key.
      await app.db.query(`DELETE FROM idempotency_briefs WHERE key = $1`, [input.idempotencyKey]);
    } else if (input.idempotencyKey && !(error instanceof AppError)) {
      await app.db.query(`DELETE FROM idempotency_briefs WHERE key = $1`, [input.idempotencyKey]);
    }
    throw error;
  }
}

interface BegunEnquiry {
  id: string;
  reference: string;
  attachmentId: string | null;
}

async function beginEnquiry(app: Earshot, input: SaveEnquiryInput): Promise<BegunEnquiry> {
  return app.db.transaction(async (client) => {
    // The limit check and the saving are one step, one at a time per sender
    // and per IP (DP-20).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `sender:${input.fields.email.toLowerCase()}`,
    ]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ip:${input.ip}`]);
    const senderCount = await countRecent(app, client, `sender:${input.fields.email.toLowerCase()}`);
    if (senderCount >= app.config.enquiryLimits.perSender) {
      throw pacingError(await retryAfterFor(app, client, `sender:${input.fields.email.toLowerCase()}`));
    }
    const ipCount = await countRecent(app, client, `ip:${input.ip}`);
    if (ipCount >= app.config.enquiryLimits.perIp) {
      throw pacingError(await retryAfterFor(app, client, `ip:${input.ip}`));
    }
    const reference = await app.store.nextEnquiryReference(client);
    const result = await client.query<{ id: string }>(
      `INSERT INTO enquiries (reference, name, email, studio, brief, preferred_month, project_slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        reference,
        input.fields.name,
        input.fields.email,
        input.fields.studio,
        input.fields.brief,
        input.preferredMonth,
        input.projectSlug,
      ],
    );
    const id = result.rows[0].id;
    let attachmentId: string | null = null;
    if (input.attachment) {
      const attachmentResult = await client.query<{ id: string }>(
        `INSERT INTO attachments (enquiry_id, format) VALUES ($1, $2) RETURNING id`,
        [id, input.attachment.format],
      );
      attachmentId = attachmentResult.rows[0].id;
      await client.query(
        `UPDATE enquiries SET attachment_id = $2, attachment_filename = $3, attachment_bytes = $4,
            attachment_format = $5 WHERE id = $1`,
        [id, attachmentId, input.attachment.filename, input.attachment.bytes.length, input.attachment.format],
      );
    }
    await recordPacing(app, client, input.fields.email, input.ip);
    return { id, reference, attachmentId };
  });
}

function pacingError(retryAfter: number): AppError {
  return new AppError(429, "rate_limited", "You have sent several briefs in a short time. Try again later.", {
    retry_after_seconds: retryAfter,
  });
}

async function finishEnquiry(app: Earshot, begun: BegunEnquiry, input: SaveEnquiryInput): Promise<unknown> {
  const settings = await app.store.readSettings();
  const body: { reference: string; status: string; receipt: "pending" | "sent" } = {
    reference: begun.reference,
    status: "new",
    receipt: "pending",
  };
  await queueReceiptAndAlert(app, begun.id, begun.reference, input.fields, settings);
  const receiptState = await app.mailQueue.tryDeliverNewlyQueued(begun.id, "receipt");
  await app.mailQueue.tryDeliverNewlyQueued(begun.id, "alert");
  body.receipt = receiptState;
  if (input.idempotencyKey) {
    await storeBriefResponse(app, input.idempotencyKey, input.fingerprint, 201, body);
  }
  return { status: 201, body };
}

async function queueReceiptAndAlert(
  app: Earshot,
  enquiryId: string,
  reference: string,
  fields: BriefFields,
  settings: { time_zone: string; operator_email: string },
): Promise<void> {
  const receiptBody = [
    `Thank you for your brief, ${fields.name}.`,
    ``,
    `Your reference is ${reference}. Keep it for any follow-up.`,
    ``,
    `You wrote:`,
    ``,
    fields.brief,
    ``,
    `Kettlehole Audio`,
  ].join("\r\n");
  await app.mailQueue.queue({
    enquiryId,
    kind: "receipt",
    recipient: displayAddress(fields.name, fields.email),
    subject: `Your brief reached Kettlehole Audio (${reference})`,
    body: receiptBody,
    from: app.config.smtp.from,
  });
  const alertBody = [
    `New brief ${reference} from ${fields.studio}.`,
    ``,
    `From: ${fields.name} <${fields.email}>`,
    `Studio: ${fields.studio}`,
    fields.project_slug ? `Project: ${fields.project_slug}` : "",
    fields.preferred_month ? `Preferred month: ${fields.preferred_month}` : "",
    ``,
    `Brief:`,
    ``,
    fields.brief,
    ``,
    `Reply to this email to answer the director directly.`,
  ]
    .filter((line) => line !== "")
    .join("\r\n");
  await app.mailQueue.queue({
    enquiryId,
    kind: "alert",
    recipient: displayAddress(fields.name, fields.email),
    subject: `New brief ${reference} from ${fields.studio}`,
    body: alertBody,
    from: app.config.smtp.from,
    replyTo: displayAddress(fields.name, fields.email),
  });
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function visibleAscii(value: string): string | null {
  if (value.length < 1 || value.length > 100) return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) return null;
  }
  return value;
}

function briefFingerprint(
  parsed: ReturnType<typeof parseMultipart>,
  attachment: { filename: string; bytes: Buffer } | undefined,
): string {
  const parts: string[] = [];
  for (const [name, value] of [...parsed.fields.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`${name}=${value}`);
  }
  if (attachment) {
    parts.push(`attachment.filename=${attachment.filename}`);
    parts.push(`attachment.sha256=${sha256Hex(attachment.bytes)}`);
  }
  return sha256Hex(parts.join("\n"));
}

type ReplayOutcome =
  | { outcome: "none" }
  | { outcome: "stored"; status: number; body: unknown }
  | { outcome: "conflict" }
  | { outcome: "in_progress" };

async function findBriefReplay(app: Earshot, key: string, fingerprint: string): Promise<ReplayOutcome> {
  const rows = await app.db.query<{ state: string; status: number; body: unknown; fingerprint: string }>(
    `SELECT state, status, body, fingerprint FROM idempotency_briefs WHERE key = $1`,
    [key],
  );
  if (rows.length === 0) return { outcome: "none" };
  const row = rows[0];
  if (row.state === "in_progress") return { outcome: "in_progress" };
  if (row.fingerprint !== fingerprint) return { outcome: "conflict" };
  const body = typeof row.body === "string" ? JSON.parse(row.body) : row.body;
  return { outcome: "stored", status: row.status, body };
}

async function storeBriefResponse(
  app: Earshot,
  key: string,
  fingerprint: string,
  status: number,
  body: unknown,
): Promise<void> {
  await app.db.query(
    `INSERT INTO idempotency_briefs (key, state, fingerprint, status, body)
     VALUES ($1, 'stored', $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET state = 'stored', fingerprint = $2, status = $3, body = $4`,
    [key, fingerprint, status, JSON.stringify(body)],
  );
}

async function checkPacing(app: Earshot, email: string, ip: string): Promise<number | null> {
  return app.db.transaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`sender:${email.toLowerCase()}`]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ip:${ip}`]);
    if (
      (await countRecent(app, client, `sender:${email.toLowerCase()}`)) >= app.config.enquiryLimits.perSender
    ) {
      return retryAfterFor(app, client, `sender:${email.toLowerCase()}`);
    }
    if ((await countRecent(app, client, `ip:${ip}`)) >= app.config.enquiryLimits.perIp) {
      return retryAfterFor(app, client, `ip:${ip}`);
    }
    return null;
  });
}

async function countRecent(app: Earshot, client: PoolClient, key: string): Promise<number> {
  const rows = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM brief_rate_events
      WHERE key = $1 AND policy = $2 AND saved_at > now() - make_interval(secs => $3::numeric)`,
    [key, pacingPolicy(app), app.config.enquiryLimits.windowSeconds],
  );
  return Number(rows.rows[0].count);
}

async function retryAfterFor(app: Earshot, client: PoolClient, key: string): Promise<number> {
  const rows = await client.query<{ oldest: Date | null }>(
    `SELECT min(saved_at) AS oldest FROM brief_rate_events
      WHERE key = $1 AND policy = $2 AND saved_at > now() - make_interval(secs => $3::numeric)`,
    [key, pacingPolicy(app), app.config.enquiryLimits.windowSeconds],
  );
  const first = rows.rows[0].oldest;
  if (!first) return 1;
  const windowEnd = new Date(first).getTime() + app.config.enquiryLimits.windowSeconds * 1000;
  return Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000));
}

function pacingPolicy(app: Earshot): string {
  const limits = app.config.enquiryLimits;
  return `${limits.perSender}/${limits.perIp}/${limits.windowSeconds}`;
}

async function recordPacing(app: Earshot, client: PoolClient, email: string, ip: string): Promise<void> {
  const policy = pacingPolicy(app);
  await client.query(`INSERT INTO brief_rate_events (key, policy) VALUES ($1, $2), ($3, $4)`, [
    `sender:${email.toLowerCase()}`,
    policy,
    `ip:${ip}`,
    policy,
  ]);
}

// ---------------------------------------------------------------------------
// Private listening (DP-14 to DP-17, DP-48, DP-52)
// ---------------------------------------------------------------------------

async function listenData(app: Earshot, token: string): Promise<unknown> {
  const rows = await app.db.query<
    {
      id: string;
      project_id: string;
      label: string;
      token: string;
      expires_at: string;
      revoked_at: string | null;
      created_at: string;
      project_slug: string;
      project_status: string;
      project_visibility: string;
    }
  >(
    `SELECT l.*, p.slug AS project_slug, p.status AS project_status, p.visibility AS project_visibility
       FROM listening_links l JOIN projects p ON p.id = l.project_id
      WHERE l.token = $1`,
    [token],
  );
  if (rows.length === 0) return linkNotFound();
  const link = rows[0];
  if (link.revoked_at) return linkNotFound();
  if (link.project_status === "withdrawn") return linkNotFound();
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return {
      status: 410,
      body: { error: "link_expired", message: "This listening link has expired. Ask Kettlehole Audio for a new one." },
      headers: { "Cache-Control": "no-store" },
    };
  }
  const projects = await app.db.query<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [link.project_id]);
  if (projects.length === 0) return linkNotFound();
  const station = await stationForProject(app, projects[0], "listen", token);
  return {
    status: 200,
    body: {
      station,
      expires_at: new Date(link.expires_at).toISOString(),
      nda: projects[0].visibility === "nda",
    },
    headers: { "Cache-Control": "no-store" },
  };
}

async function listenStem(app: Earshot, token: string, stemId: string): Promise<unknown> {
  const rows = await app.db.query<{
    project_id: string;
    expires_at: string;
    revoked_at: string | null;
    project_status: string;
  }>(
    `SELECT l.project_id, l.expires_at, l.revoked_at, p.status AS project_status
       FROM listening_links l JOIN projects p ON p.id = l.project_id
      WHERE l.token = $1`,
    [token],
  );
  if (rows.length === 0) return linkNotFound();
  const link = rows[0];
  if (link.revoked_at || link.project_status === "withdrawn") return linkNotFound();
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return {
      status: 410,
      body: { error: "link_expired", message: "This listening link has expired." },
      headers: { "Cache-Control": "no-store" },
    };
  }
  const stems = await app.db.query<StemRow>(`SELECT * FROM stems WHERE id = $1 AND project_id = $2`, [
    stemId,
    link.project_id,
  ]);
  if (stems.length === 0) return linkNotFound();
  return streamStoredObject(
    app,
    `projects/${link.project_id}/stems/${stems[0].id}.${stems[0].format}`,
    stems[0].format,
    "no-store",
  );
}

function linkNotFound(): { status: number; body: unknown; headers: Record<string, string> } {
  return {
    status: 404,
    body: { error: "not_found", message: "This listening link is not available." },
    headers: { "Cache-Control": "no-store" },
  };
}

export async function liveLinkByToken(
  app: Earshot,
  token: string,
): Promise<{ project_slug: string } | null> {
  const rows = await app.db.query<{ slug: string; expires_at: string; revoked_at: string | null; status: string }>(
    `SELECT p.slug, l.expires_at, l.revoked_at, p.status
       FROM listening_links l JOIN projects p ON p.id = l.project_id
      WHERE l.token = $1`,
    [token],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revoked_at || row.status === "withdrawn") return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return { project_slug: row.slug };
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
