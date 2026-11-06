import { route, type Route, type RouteContext } from "./table.js";
import { errors } from "../http/errors.js";
import { getPool, query, one } from "../db.js";
import { config } from "../config.js";
import { jsonBody, status, signOut, clientIp, readMultipartFile, member, director, staff } from "./helpers.js";
import * as members from "../domain/members.js";
import * as boards from "../domain/boards.js";
import * as cast from "../domain/cast.js";
import * as applications from "../domain/applications.js";
import * as packagesDomain from "../domain/packages.js";
import * as storage from "../domain/storage.js";
import * as feeds from "../domain/feeds.js";
import { enforceRateLimit } from "../domain/ratelimit.js";
import { createSession, sessionCookie, publicMember } from "../domain/sessions.js";
import { BOARDS, OFFICES, OFFICE_META, ROLE_HOME, type ApplicationSlot, type Office } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";
import { formatOfficeTime } from "../../shared/format.js";

export const publicRoutes: Route[] = [
  route("GET", "/api/health", async (ctx) => {
    if (ctx.res.locals.starting) {
      ctx.res.status(503).json({ status: "starting" });
      return undefined;
    }
    try {
      await getPool().query("SELECT 1");
      return { status: "ok" };
    } catch {
      ctx.res.status(503).json({ status: "starting" });
      return undefined;
    }
  }),

  route("GET", "/api/offices", async () => {
    const rows = await query<{ office: string; date: string }>(`SELECT office, to_char(date,'YYYY-MM-DD') AS date FROM office_closures ORDER BY office, date`);
    const closures: Record<string, string[]> = { toronto: [], vancouver: [] };
    for (const row of rows) closures[row.office]?.push(row.date);
    return {
      offices: OFFICES.map((office) => ({
        id: office,
        city: OFFICE_META[office].city,
        timeZone: OFFICE_META[office].timeZone,
        closures: closures[office],
      })),
    };
  }),

  route("GET", "/api/public/boards", async () => {
    return boards.boardIndex();
  }),

  route("GET", "/api/public/talent", async (ctx) => {
    const board = String(ctx.req.query.board || "");
    if (!(BOARDS as readonly string[]).includes(board)) throw errors.validation({ board: "Choose a board." });
    const office = String(ctx.req.query.office || "all");
    if (office !== "all" && !(OFFICES as readonly string[]).includes(office)) throw errors.validation({ office: "Choose an office." });
    const sort = String(ctx.req.query.sort || "name");
    if (!["name", "height", "reach"].includes(sort)) throw errors.validation({ sort: "Choose a sort." });
    const page = Number(ctx.req.query.page || 1);
    const q = String(ctx.req.query.q || "");
    return boards.boardTalent({ board: board as never, office, q, sort: sort as never, page: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1 });
  }),

  route("GET", "/api/public/talent/:slug", async (ctx) => {
    return boards.publicProfile(ctx.params.slug);
  }),

  route("GET", "/api/photos/:photoId", async (ctx) => {
    const photo = await boards.photoTalent(ctx.params.photoId);
    if (!photo || photo.state !== "active") throw errors.notFound();
    const data = await storage.loadObject(storage.portfolioKey(photo.talentId, ctx.params.photoId));
    ctx.res.setHeader("Content-Type", "image/jpeg");
    ctx.res.setHeader("Cache-Control", "public, max-age=300");
    ctx.res.send(Buffer.from(data));
    return undefined;
  }),

  // Cast requests
  route("POST", "/api/cast-requests", async (ctx) => {
    await enforceRateLimit(`cast:${clientIp(ctx.req)}`, 5, 60);
    const key = typeof ctx.req.headers["idempotency-key"] === "string" ? ctx.req.headers["idempotency-key"] : "";
    if (!key) throw errors.idempotencyKeyRequired();
    const body = await jsonBody(ctx);
    const input: cast.CastRequestInput = {
      name: String(body.name || ""),
      company: String(body.company || ""),
      email: String(body.email || ""),
      office: String(body.office || ""),
      shootDate: typeof body.shootDate === "string" && body.shootDate ? body.shootDate : null,
      brief: String(body.brief || ""),
      talentSlugs: Array.isArray(body.talentSlugs) ? body.talentSlugs.map(String) : [],
    };
    const hash = JSON.stringify(input);
    const owner = `public:${clientIp(ctx.req)}`;
    const existing = await one<{ status: number; response_body: string; request_hash: string }>(
      `SELECT status, response_body, request_hash FROM idempotency_keys WHERE member_id = $1 AND key = $2`,
      [owner, key]
    );
    if (existing) {
      if (existing.request_hash !== hash) throw errors.idempotencyKeyReused();
      ctx.res.setHeader("Idempotent-Replayed", "true");
      status(ctx, existing.status);
      return JSON.parse(existing.response_body) as Record<string, unknown>;
    }
    const result = await cast.createCastRequest(input);
    await query(
      `INSERT INTO idempotency_keys (member_id, key, endpoint, request_hash, status, response_body)
       VALUES ($1, $2, 'cast-request', $3, 201, $4) ON CONFLICT (member_id, key) DO NOTHING`,
      [owner, key, hash, JSON.stringify(result)]
    );
    status(ctx, 201);
    return result;
  }),

  route("POST", "/api/cast-requests/checks", async (ctx) => {
    const body = await jsonBody(ctx);
    const step = Number(body.step);
    const draft = (body.draft ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(step) || step < 1 || step > 4) throw errors.validation({ step: "Choose a step from 1 to 4." });
    const input: Partial<cast.CastRequestInput> = {};
    if (typeof draft.name === "string") input.name = draft.name;
    if (typeof draft.company === "string") input.company = draft.company;
    if (typeof draft.email === "string") input.email = draft.email;
    if (typeof draft.office === "string") input.office = draft.office;
    if (typeof draft.shootDate === "string") input.shootDate = draft.shootDate;
    if (typeof draft.brief === "string") input.brief = draft.brief;
    if (Array.isArray(draft.talentSlugs)) input.talentSlugs = draft.talentSlugs.map(String);
    const errs = cast.validateCastStep(step, input);
    if (step === 1 && input.talentSlugs) {
      const rows = await query<{ slug: string }>(`SELECT slug FROM talent WHERE state = 'active' AND lower(slug) = ANY($1::text[])`, [input.talentSlugs.map((s) => s.toLowerCase())]);
      const active = new Set(rows.map((r) => r.slug));
      if (input.talentSlugs.some((s) => !active.has(s))) {
        errs.talentSlugs = "Talent in your tray are no longer available; remove them to continue.";
      }
    }
    if (Object.keys(errs).length > 0) throw errors.validation(errs);
    return { ok: true };
  }),

  // Applications (public, token-scoped)
  route("POST", "/api/applications", async (ctx) => {
    await enforceRateLimit(`apply:${clientIp(ctx.req)}`, 3, 60);
    const body = await jsonBody(ctx);
    const office = String(body.office || "");
    if (!(OFFICES as readonly string[]).includes(office)) throw errors.validation({ office: "Choose an office." });
    const row = await applications.createDraft(office);
    status(ctx, 201);
    return { id: row.id, token: row.token, status: row.status };
  }),

  route("GET", "/api/applications/:id", async (ctx) => {
    const row = await loadApp(ctx);
    const photos = await applications.applicationPhotos(row.id);
    return applications.applicationView(row, photos);
  }),

  route("PATCH", "/api/applications/:id", async (ctx) => {
    const row = await loadApp(ctx);
    const body = await jsonBody(ctx);
    const patch: applications.DraftPatch = {};
    if (typeof body.firstName === "string") patch.firstName = body.firstName;
    if (typeof body.lastName === "string") patch.lastName = body.lastName;
    if (typeof body.email === "string") patch.email = body.email;
    if (typeof body.dateOfBirth === "string") patch.dateOfBirth = body.dateOfBirth;
    if (typeof body.office === "string") patch.office = body.office;
    if (body.height && typeof body.height === "object") {
      const h = body.height as { value?: unknown };
      patch.height = { value: (h.value ?? "") as string };
    }
    if (typeof body.instagramFollowers === "number") patch.instagramFollowers = body.instagramFollowers;
    if (typeof body.bio === "string") patch.bio = body.bio;
    if (typeof body.guardianName === "string") patch.guardianName = body.guardianName;
    if (typeof body.guardianEmail === "string") patch.guardianEmail = body.guardianEmail;
    const fresh = await applications.patchDraft(row, patch, new Date());
    const photos = await applications.applicationPhotos(row.id);
    return applications.applicationView(fresh, photos);
  }),

  route("PUT", "/api/applications/:id/photos/:slot", async (ctx) => {
    const row = await loadApp(ctx);
    if (row.status !== "draft") throw errors.conflict("already_submitted");
    const slot = ctx.params.slot;
    if (!["front", "profile", "full_length", "smile"].includes(slot)) throw errors.notFound();
    const upload = await readMultipartFile(ctx.req, storage.APPLICATION_PHOTO_LIMIT);
    const decoded = await storage.decodeCheck(upload.buffer);
    if (!decoded) throw errors.validation({ file: "That file is not a JPEG, PNG or WebP photo." });
    const normalized = await storage.normalizePhoto(upload.buffer);
    await storage.storeObject(storage.applicationKey(row.id, slot), normalized.buffer, "image/jpeg");
    await applications.uploadPhoto(row, slot as ApplicationSlot, normalized.width, normalized.height);
    return { slot, width: normalized.width, height: normalized.height };
  }),

  route("POST", "/api/applications/:id/submit", async (ctx) => {
    const row = await loadApp(ctx);
    const body = await jsonBody(ctx);
    void body;
    const outcome = await applications.submitApplication(row, new Date(), config.consentLinkTtlSeconds);
    return { status: outcome.status, minor: outcome.minor };
  }),

  // Guardian consent
  route("GET", "/api/consents/:token", async (ctx) => {
    const { consent, application } = await applications.loadConsent(ctx.params.token);
    if (!consent) throw errors.notFound();
    if (!application) throw consent.used_at ? errors.gone("link_used") : errors.gone("link_expired");
    return { applicantFirstName: application.first_name, office: application.office, expiresAt: toInstant(consent.expires_at) };
  }),

  route("POST", "/api/consents/:token", async (ctx) => {
    const { consent, application } = await applications.loadConsent(ctx.params.token);
    if (!consent) throw errors.notFound();
    if (!application) throw consent.used_at ? errors.gone("link_used") : errors.gone("link_expired");
    const body = await jsonBody(ctx);
    const decision = body.decision === "approve" ? "approve" : body.decision === "decline" ? "decline" : null;
    if (!decision) throw errors.validation({ decision: "Choose approve or decline." });
    await applications.recordConsent(ctx.params.token, decision, new Date());
    return { decision };
  }),

  // Package links
  route("GET", "/api/p/:token", async (ctx) => {
    const state = await packagesDomain.linkState(ctx.params.token);
    if (!state.row) throw state.dead ? errors.gone(state.dead) : errors.notFound();
    return packagesDomain.packageLinkView(state.row);
  }),

  route("PUT", "/api/p/:token/decisions/:slug", async (ctx) => {
    const state = await packagesDomain.linkState(ctx.params.token);
    if (!state.row) throw state.dead ? errors.gone(state.dead) : errors.notFound();
    const body = await jsonBody(ctx);
    const decision = String(body.decision || "");
    if (!["shortlisted", "passed", "undecided"].includes(decision)) throw errors.validation({ decision: "Choose shortlisted or passed." });
    return packagesDomain.setDecision(ctx.params.token, ctx.params.slug, decision);
  }),

  route("GET", "/api/p/:token/photos.zip", async (ctx) => {
    const state = await packagesDomain.linkState(ctx.params.token);
    if (!state.row) throw state.dead ? errors.gone(state.dead) : errors.notFound();
    const pkg = state.row;
    const talent = await packagesDomain.packageTalent(pkg.id);
    const entries: storage.ZipEntry[] = [];
    const files: Array<{ name: string; bytes: number; sha256: string }> = [];
    let index = 1;
    for (const t of talent) {
      const photos = await query<{ id: string }>(`SELECT id FROM photos WHERE talent_id = $1 ORDER BY position`, [t.talentId]);
      if (photos.length === 0) continue;
      const data = await storage.loadObject(storage.portfolioKey(t.talentId, photos[0].id));
      const name = `${t.slug}/${String(index).padStart(2, "0")}.jpg`;
      entries.push({ name, data });
      files.push({ name, bytes: data.length, sha256: storage.sha256Hex(data) });
      index += 1;
    }
    const manifest = JSON.stringify({ package: pkg.title, generatedAt: toInstant(new Date()), files });
    entries.push({ name: "manifest.json", data: Buffer.from(manifest, "utf8") });
    const zip = storage.buildZip(entries);
    await storage.storeObject(storage.packageZipKey(pkg.id), zip, "application/zip");
    ctx.res.setHeader("Content-Type", "application/zip");
    ctx.res.setHeader("Content-Disposition", `attachment; filename="package.zip"`);
    ctx.res.send(Buffer.from(zip));
    return undefined;
  }),

  // Talent calendar feed
  route("GET", "/feeds/:token", async (ctx) => {
    const token = ctx.params.token.replace(/\.ics$/, "");
    const talent = await one<{ id: string; display_name: string; office: string; state: string }>(`SELECT id, display_name, office, state FROM talent WHERE feed_token = $1`, [token]);
    if (!talent || talent.state !== "active") throw errors.notFound();
    const options = await query<{ id: string; date: string; state: string; rank: number | null; job_title: string; sequence: number; client_company: string; release_at: Date }>(
      `SELECT o.id, to_char(o.date,'YYYY-MM-DD') AS date, o.state, o.rank, o.job_title, o.sequence, c.company AS client_company, o.release_at
       FROM options o JOIN clients c ON c.id = o.client_id WHERE o.talent_id = $1 ORDER BY o.date, o.sequence`,
      [talent.id]
    );
    const office = talent.office as Office;
    const meta = OFFICE_META[office];
    const events = options.map((o) => {
      const time = formatOfficeTime(o.release_at, meta.timeZone, meta.city);
      const ordinalText = o.rank === 1 ? "1st" : o.rank === 2 ? "2nd" : "3rd";
      if (o.state === "confirmed") {
        return { optionId: o.id, date: o.date, status: "CONFIRMED" as const, summary: feeds.bookedSummary(o.job_title, o.client_company), sequence: o.sequence };
      }
      const summary = feeds.tentativeSummary(ordinalText, o.job_title, o.client_company, time);
      return {
        optionId: o.id,
        date: o.date,
        status: (o.state === "placed" || o.state === "challenged" ? "TENTATIVE" : "CANCELLED") as "TENTATIVE" | "CANCELLED",
        summary,
        sequence: o.sequence,
      };
    });
    const ics = feeds.renderFeed(talent.display_name, events);
    ctx.res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    ctx.res.send(ics);
    return undefined;
  }),

  // Session and accounts
  route("POST", "/api/session", async (ctx) => {
    const body = await jsonBody(ctx);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) throw errors.validation({ password: "Enter email and password." });
    const result = await members.signIn(email, password);
    const session = await createSession(result.member.id);
    ctx.res.setHeader("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return { member: publicMember(result.member), home: ROLE_HOME[result.member.role] || "/workspace/board" };
  }),

  route("DELETE", "/api/session", async (ctx) => {
    if (!ctx.auth) throw errors.unauthenticated();
    await signOut(ctx);
    ctx.res.status(204).end();
    return undefined;
  }),

  route("GET", "/api/me", async (ctx) => {
    return publicMember(member(ctx));
  }),

  route("POST", "/api/password-resets", async (ctx) => {
    const body = await jsonBody(ctx);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email) throw errors.validation({ email: "Enter an email address like name@example.com." });
    const message = await members.requestPasswordReset(email);
    status(ctx, 202);
    return { message };
  }),

  route("POST", "/api/password-resets/:token", async (ctx) => {
    const body = await jsonBody(ctx);
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 12) throw errors.validation({ password: "Enter a password of at least 12 characters." });
    const result = await members.completePasswordReset(ctx.params.token, password);
    const session = await createSession(result.id);
    ctx.res.setHeader("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return { member: publicMember(result), home: ROLE_HOME[result.role] || "/workspace/board" };
  }),

  route("POST", "/api/invitations", async (ctx) => {
    const m = director(ctx);
    const body = await jsonBody(ctx);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const roleValue = typeof body.role === "string" ? body.role : "";
    const office = typeof body.office === "string" ? body.office : "";
    const talentId = typeof body.talentId === "string" ? body.talentId : null;
    const errs: Record<string, string> = {};
    if (!name) errs.name = "Enter name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter an email address like name@example.com.";
    if (!["agency_director", "booker", "accounts_lead", "scout", "talent"].includes(roleValue)) errs.role = "Choose a role.";
    if (!(OFFICES as readonly string[]).includes(office)) errs.office = "Choose an office.";
    if (roleValue === "talent" && !talentId) errs.talentId = "Choose the talent record.";
    if (Object.keys(errs).length > 0) throw errors.validation(errs);
    const message = await members.createInvitation({ email, name, role: roleValue, office, talentId }, m);
    status(ctx, 202);
    return { message };
  }),

  route("POST", "/api/invitations/:token/accept", async (ctx) => {
    const body = await jsonBody(ctx);
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 12) throw errors.validation({ password: "Enter a password of at least 12 characters." });
    const result = await members.acceptInvitation(ctx.params.token, password);
    const session = await createSession(result.id);
    ctx.res.setHeader("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return { member: publicMember(result), home: ROLE_HOME[result.role] || "/workspace/board" };
  }),
];

async function loadApp(ctx: RouteContext) {
  const token = typeof ctx.req.headers["x-application-token"] === "string" ? ctx.req.headers["x-application-token"] : "";
  if (!token) throw errors.notFound();
  return applications.loadApplication(ctx.params.id, token);
}

export { staff };
