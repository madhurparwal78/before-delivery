import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import {
  pool,
  all,
  one,
  id,
  now,
  transaction,
  advisory,
  saveApplication,
  saveRequisition,
  saveBenefits,
  audit,
  enqueueMail,
  type DB,
} from "./db.js";
import {
  fail,
  publicNotFound,
  notFound,
  validation,
  str,
  list,
  requireVersion,
  checkVersion,
} from "./errors.js";
import {
  capability,
  digest,
  encryptToken,
  decryptToken,
  requireRole,
  staffRoles,
} from "./auth.js";
import { config } from "./config.js";
import {
  normalizeEmail,
  validEmail,
  validName,
  withinLength,
  offices,
  regions,
  validSlug,
  validDate,
  requisitionMove,
  stageMove,
  stageLabels,
  activeStage,
} from "./domain.js";
import { putObject, deleteObject, storage } from "./media.js";
import { indexRole, unindex } from "./search.js";
import type {
  Application,
  ApplicationReceipt,
  Requisition,
  Tracking,
  Stage,
  Benefits,
} from "./types.js";
import type { ApiContext, ApiResult } from "./content.js";
export interface Multipart {
  fields: Record<string, string>;
  resume?: Buffer;
}
const trackedShape = (a: Application, r: Requisition): Tracking => ({
  role: { title: r.title, office: offices[r.office].label },
  stage: a.stage,
  stage_label: stageLabels[a.stage],
  submitted_at: a.submitted_at,
  stage_changed_at: a.stage_changed_at,
});
function applicationShape(
  a: Application,
): Omit<
  Application,
  | "resume_key"
  | "token_digest"
  | "token_ciphertext"
  | "receipt"
  | "erased"
  | "requisition_id"
  | "stage_changed_at"
> {
  return {
    id: a.id,
    reference: a.reference,
    name: a.name,
    email: a.email,
    stage: a.stage,
    version: a.version,
    submitted_at: a.submitted_at,
    decisions: a.decisions,
    notes: a.notes,
  };
}
// A link lives while its requisition is open, then until the deadline fixed at close.
const trackingLive = (r: Requisition): boolean =>
  r.status !== "closed" || Date.now() < Date.parse(r.erase_after!);
const candidate = (a: Application): { name: string; email: string } => ({
  name: a.name,
  email: a.email,
});
function rotate(a: Application): string {
  const token = capability();
  a.token_digest = digest(token);
  a.token_ciphertext = encryptToken(token);
  return `${config.publicBaseUrl}/track/${token}`;
}
const trackingLink = (a: Application): string =>
  `${config.publicBaseUrl}/track/${decryptToken(a.token_ciphertext!)}`;
async function moveApplication(
  db: PoolClient,
  a: Application,
  r: Requisition,
  to: Stage,
  rationale: string,
  actor: string,
): Promise<void> {
  stageMove(a.stage, to);
  const expected = a.version;
  const from = a.stage;
  a.stage = to;
  a.stage_changed_at = now();
  a.version++;
  a.decisions.push({ from, to, rationale, by: actor, at: a.stage_changed_at });
  await saveApplication(db, a, expected);
  await audit(db, actor, "application.stage", "application", a.id, {
    reference: a.reference,
    requisition: r.id,
    from,
    to,
  });
  if (actor !== "candidate")
    await enqueueMail(
      db,
      candidate(a),
      "Update on your Aldermoor application",
      `${r.title}\nYour application is now at: ${stageLabels[to]}.\n${trackingLink(a)}`,
    );
}
const requisitionBySlug = async (
  db: DB,
  slug: string,
): Promise<Requisition | undefined> =>
  (
    await db.query<{ data: Requisition }>(
      "SELECT data FROM requisitions WHERE slug=$1",
      [slug],
    )
  ).rows[0]?.data;
export async function submitApplication(
  slug: string,
  form: Multipart,
): Promise<ApiResult> {
  const { fields, resume } = form;
  const name = (fields.name || "").trim(),
    email = normalizeEmail(fields.email || "");
  const role = await requisitionBySlug(pool, slug);
  if (!role || role.status === "draft") publicNotFound();
  const errors: Record<string, string> = {};
  if (!validName(name)) errors.name = "Enter your full name.";
  if (!validEmail(fields.email || ""))
    errors.email = "Enter a valid email address.";
  if (fields.consent !== "yes")
    errors.consent = "Please confirm your consent to apply.";
  if (
    !resume ||
    resume.length < 1 ||
    resume.length > 5000000 ||
    resume.subarray(0, 5).toString("latin1") !== "%PDF-"
  )
    errors.resume = "Attach a PDF résumé of at most 5,000,000 bytes.";
  if (Object.keys(errors).length) validation(errors);
  let uploadedKey: string | undefined;
  try {
    return await transaction(async (db) => {
      await advisory(db, `application:${role.id}:${email}`);
      const duplicate = (
        await db.query<{ data: Application }>(
          "SELECT data FROM applications WHERE requisition_id=$1 AND email=$2",
          [role.id, email],
        )
      ).rows[0]?.data;
      if (duplicate) return { status: 200, data: duplicate.receipt };
      // A share lock makes a concurrent close wait for this application, then decline it.
      const r = (
        await db.query<{ data: Requisition }>(
          "SELECT data FROM requisitions WHERE id=$1 FOR SHARE",
          [role.id],
        )
      ).rows[0].data;
      if (r.status !== "open")
        fail(
          409,
          "requisition_closed",
          "This role is no longer accepting applications.",
        );
      const reference =
        "AR-" +
        Array.from(
          randomBytes(8),
          (n) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[n % 32],
        ).join("");
      const submitted_at = now();
      const receipt: ApplicationReceipt = {
        application: {
          reference,
          role: { slug: r.slug, title: r.title },
          stage: "submitted",
          submitted_at,
        },
      };
      const key = `resumes/${r.id}/${randomBytes(16).toString("hex")}.pdf`;
      try {
        await putObject(key, resume!, "application/pdf");
        uploadedKey = key;
      } catch {
        fail(
          503,
          "storage_unavailable",
          "We couldn't store your résumé just now. Nothing was submitted; please try again in a few minutes.",
        );
      }
      const a: Application = {
        id: id(),
        requisition_id: r.id,
        reference,
        name,
        email,
        stage: "submitted",
        version: 1,
        submitted_at,
        stage_changed_at: submitted_at,
        decisions: [],
        notes: [],
        resume_key: key,
        token_digest: null,
        token_ciphertext: null,
        receipt,
        erased: false,
      };
      const link = rotate(a);
      await saveApplication(db, a);
      await enqueueMail(
        db,
        candidate(a),
        `Application received: ${r.title}`,
        `${name}\n${r.title}\nReference: ${reference}\nFollow your application: ${link}`,
      );
      return { status: 201, data: receipt };
    });
  } catch (error) {
    if (uploadedKey) await deleteObject(uploadedKey).catch(() => undefined);
    throw error;
  }
}
const invalidLink = (): never =>
  fail(404, "not_found", "This tracking link is not valid.");
export async function tracking(
  token: string,
  withdraw = false,
): Promise<Tracking> {
  return transaction(async (db) => {
    const a = (
      await db.query<{ data: Application }>(
        `SELECT data FROM applications WHERE token_digest=$1${withdraw ? " FOR UPDATE" : ""}`,
        [digest(token)],
      )
    ).rows[0]?.data;
    if (!a) invalidLink();
    const r = (await one<Requisition>(db, "requisitions", a.requisition_id))!;
    if (!trackingLive(r)) invalidLink();
    if (withdraw)
      await moveApplication(
        db,
        a,
        r,
        "withdrawn",
        "Withdrawn by candidate",
        "candidate",
      );
    return trackedShape(a, r);
  });
}
export async function resendLinks(emailValue: string): Promise<ApiResult> {
  if (!validEmail(emailValue))
    validation({ email: "Enter a valid email address." });
  const email = normalizeEmail(emailValue);
  await transaction(async (db) => {
    await advisory(db, `resend:${email}`);
    const recent = await db.query(
      "SELECT 1 FROM resend_requests WHERE email=$1 AND at > now() - make_interval(secs=>$2)",
      [email, config.resendWindow],
    );
    if (recent.rowCount! >= 3) return;
    await db.query("INSERT INTO resend_requests(email) VALUES($1)", [email]);
    const selected = await db.query<{ data: Application }>(
      "SELECT data FROM applications WHERE email=$1 FOR UPDATE",
      [email],
    );
    const lines: string[] = [];
    let recipient: { name: string; email: string } | undefined;
    for (const { data: a } of selected.rows) {
      const r = (await one<Requisition>(db, "requisitions", a.requisition_id))!;
      if (!trackingLive(r)) continue;
      lines.push(`${r.title}: ${rotate(a)}`);
      await saveApplication(db, a, a.version);
      recipient = candidate(a);
    }
    if (recipient)
      await enqueueMail(
        db,
        recipient,
        "Your Aldermoor application links",
        lines.join("\n"),
      );
  });
  return {
    status: 202,
    data: {
      message:
        "If that address has applied for a role with us, we've sent its tracking links to it.",
    },
  };
}
async function benefitsApi(ctx: ApiContext): Promise<ApiResult> {
  const { body, staff } = ctx;
  requireRole(staff, "recruiter");
  const region = str(body.region),
    effective_from = str(body.effective_from),
    summary = str(body.summary).trim();
  const fields: Record<string, string> = {};
  if (!regions[region]) fields.region = "Choose a listed region.";
  if (!validDate(effective_from))
    fields.effective_from = "Use a real date in the form YYYY-MM-DD.";
  if (!withinLength(summary, 500))
    fields.summary = "Enter a summary of at most 500 characters.";
  if (Object.keys(fields).length) validation(fields);
  return transaction(async (db) => {
    await advisory(db, `benefits:${region}`);
    if (
      (
        await db.query(
          "SELECT 1 FROM benefits WHERE region=$1 AND effective_from=$2",
          [region, effective_from],
        )
      ).rowCount
    )
      fail(
        409,
        "entry_exists",
        "That region already has an entry from this date.",
      );
    const entry: Benefits = { id: id(), region, effective_from, summary };
    await saveBenefits(db, entry);
    await audit(db, staff.email, "benefits.create", "benefits", entry.id, {
      region,
      effective_from,
    });
    return { status: 201, data: { entry } };
  });
}
const counted = (r: Requisition, apps: Application[]): object => ({
  ...r,
  counts: Object.fromEntries(
    Object.keys(stageLabels).map((s) => [
      s,
      apps.filter((a) => a.requisition_id === r.id && a.stage === s).length,
    ]),
  ),
});
async function createRequisition(ctx: ApiContext): Promise<ApiResult> {
  const { body, staff } = ctx;
  const slug = str(body.slug).trim(),
    title = str(body.title).trim(),
    description = str(body.description).trim(),
    office = str(body.office),
    discipline = str(body.discipline);
  const recruiters = [
    ...new Set([...list(body.recruiters).map(normalizeEmail), staff.email]),
  ];
  return transaction(async (db) => {
    await advisory(db, "requisition-slugs");
    const fields: Record<string, string> = {};
    if (!validSlug(slug))
      fields.slug =
        "Use lowercase letters, numbers and single hyphens, up to 80 characters.";
    else if (await requisitionBySlug(db, slug))
      fields.slug = "That slug is already in use.";
    if (!withinLength(title, 120))
      fields.title = "Enter a title of at most 120 characters.";
    if (
      !["research", "engineering", "policy", "operations"].includes(discipline)
    )
      fields.discipline = "Choose research, engineering, policy or operations.";
    if (!offices[office]) fields.office = "Choose a listed office.";
    if (!withinLength(description, 8000))
      fields.description = "Enter a description of at most 8,000 characters.";
    for (const email of recruiters)
      if (!(await staffRoles(db, email)).some((g) => g.role === "recruiter"))
        fields.recruiters = "Each recruiter must hold the recruiter role.";
    if (Object.keys(fields).length) validation(fields);
    const requisition: Requisition = {
      id: id(),
      slug,
      title,
      discipline,
      office,
      description,
      recruiters,
      status: "draft",
      opened_at: null,
      closed_at: null,
      erase_after: null,
      version: 1,
    };
    await saveRequisition(db, requisition);
    await audit(
      db,
      staff.email,
      "requisition.create",
      "requisition",
      requisition.id,
      { slug },
    );
    return { status: 201, data: { requisition }, version: 1 };
  });
}
async function requisitionAction(
  ctx: ApiContext,
  rid: string,
  verb: string,
): Promise<ApiResult> {
  const { method, body, staff, version } = ctx;
  return transaction(async (db) => {
    const r = await one<Requisition>(db, "requisitions", rid, method !== "GET");
    if (!r || !r.recruiters.includes(staff.email)) notFound();
    requireRole(staff, "recruiter");
    if (method === "GET") {
      if (verb === "applications")
        return {
          status: 200,
          data: {
            applications: (
              await db.query<{ data: Application }>(
                "SELECT data FROM applications WHERE requisition_id=$1 ORDER BY data->>'submitted_at'",
                [r.id],
              )
            ).rows.map(({ data: a }) => ({
              id: a.id,
              reference: a.reference,
              name: a.name,
              email: a.email,
              stage: a.stage,
              submitted_at: a.submitted_at,
              version: a.version,
            })),
          },
        };
      return { status: 200, data: { requisition: r }, version: r.version };
    }
    const expected = requireVersion(version);
    const reason = str(body.reason).trim();
    if (verb === "close" && !withinLength(reason, 2000))
      validation({ reason: "Say why this requisition is closing." });
    checkVersion(expected, r.version);
    const to = verb === "open" ? "open" : "closed";
    requisitionMove(r.status, to);
    r.status = to;
    r.version++;
    if (to === "open") {
      r.opened_at = now();
      await indexRole(db, r);
    } else {
      r.closed_at = now();
      r.erase_after = new Date(
        Date.parse(r.closed_at) + config.retention * 1000,
      ).toISOString();
      await unindex(db, "role", r.slug);
      const apps = await db.query<{ data: Application }>(
        "SELECT data FROM applications WHERE requisition_id=$1 ORDER BY id FOR UPDATE",
        [r.id],
      );
      for (const { data: a } of apps.rows)
        if (activeStage(a.stage))
          await moveApplication(
            db,
            a,
            r,
            "declined",
            `Requisition closed: ${reason}`,
            staff.email,
          );
    }
    await saveRequisition(db, r, expected);
    await audit(
      db,
      staff.email,
      `requisition.${verb}`,
      "requisition",
      r.id,
      verb === "close" ? { reason } : {},
    );
    return { status: 200, data: { requisition: r }, version: r.version };
  });
}
async function applicationAction(
  ctx: ApiContext,
  aid: string,
  verb: string,
): Promise<ApiResult> {
  const { method, body, staff, version } = ctx;
  return transaction(async (db) => {
    const a = await one<Application>(db, "applications", aid, method !== "GET");
    const r =
      a && (await one<Requisition>(db, "requisitions", a.requisition_id));
    if (!a || !r || !r.recruiters.includes(staff.email)) notFound();
    requireRole(staff, "recruiter");
    if (method === "GET") {
      if (verb !== "resume")
        return {
          status: 200,
          data: { application: applicationShape(a) },
          version: a.version,
        };
      if (a.erased) notFound();
      let response: Response;
      try {
        response = await storage("GET", a.resume_key);
      } catch {
        fail(503, "storage_unavailable", "Résumés are unavailable right now.");
      }
      if (!response.ok)
        fail(503, "storage_unavailable", "Résumés are unavailable right now.");
      return {
        status: 200,
        data: Buffer.from(await response.arrayBuffer()),
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="resume-${a.reference}.pdf"`,
        },
      };
    }
    if (verb === "stage") {
      const expected = requireVersion(version);
      const fields: Record<string, string> = {};
      if (!withinLength(str(body.rationale), 2000))
        fields.rationale = "Record the reason for this decision.";
      if (!Object.hasOwn(stageLabels, str(body.to)))
        fields.to = "Choose a stage.";
      if (Object.keys(fields).length) validation(fields);
      checkVersion(expected, a.version);
      await moveApplication(
        db,
        a,
        r,
        body.to as Stage,
        str(body.rationale).trim(),
        staff.email,
      );
      return {
        status: 200,
        data: { application: applicationShape(a) },
        version: a.version,
      };
    }
    if (verb === "notes") {
      if (!withinLength(str(body.body), 4000))
        validation({
          body: "Enter an interview note of at most 4,000 characters.",
        });
      const note = {
        id: id(),
        body: str(body.body).trim(),
        by: staff.email,
        at: now(),
      };
      a.notes.push(note);
      await saveApplication(db, a, a.version);
      await audit(db, staff.email, "application.note", "application", a.id, {
        reference: a.reference,
      });
      return { status: 201, data: { note } };
    }
    if (!trackingLive(r))
      fail(
        409,
        "link_retired",
        "This application's retention period has ended.",
      );
    const link = rotate(a);
    await saveApplication(db, a, a.version);
    await enqueueMail(
      db,
      candidate(a),
      `Your new tracking link: ${r.title}`,
      `${r.title}\nYour new tracking link: ${link}`,
    );
    await audit(db, staff.email, "tracking_link.reissue", "application", a.id, {
      reference: a.reference,
    });
    return { status: 200, data: { reissued_at: now() } };
  });
}
export async function careersApi(ctx: ApiContext): Promise<ApiResult | null> {
  const { path, method, staff } = ctx;
  if (path === "/api/console/benefits") return benefitsApi(ctx);
  if (path === "/api/console/requisitions") {
    requireRole(staff, "recruiter");
    if (method === "POST") return createRequisition(ctx);
    const apps = await all<Application>(pool, "applications");
    return {
      status: 200,
      data: {
        requisitions: (await all<Requisition>(pool, "requisitions"))
          .filter((r) => r.recruiters.includes(staff.email))
          .map((r) => counted(r, apps)),
      },
    };
  }
  const requisition = path.match(
    /^\/api\/console\/requisitions\/([^/]+)(?:\/(open|close|applications))?$/,
  );
  if (requisition)
    return requisitionAction(ctx, requisition[1], requisition[2] || "");
  const application = path.match(
    /^\/api\/console\/applications\/([^/]+)(?:\/(stage|notes|resume|tracking-link\/reissue))?$/,
  );
  if (application)
    return applicationAction(ctx, application[1], application[2] || "");
  return null;
}
