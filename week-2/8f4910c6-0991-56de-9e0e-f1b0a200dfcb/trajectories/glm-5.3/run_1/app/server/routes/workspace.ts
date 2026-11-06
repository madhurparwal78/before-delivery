import { route, type Route } from "./table.js";
import { errors } from "../http/errors.js";
import { query, one, withTransaction, poolReader } from "../db.js";
import { config } from "../config.js";
import { member, staff, director, role, jsonBody, status, readMultipartFile } from "./helpers.js";
import * as talentDomain from "../domain/talent.js";
import * as ladder from "../domain/ladder.js";
import * as bookingsDomain from "../domain/bookings.js";
import * as licences from "../domain/licences.js";
import * as ledger from "../domain/ledger.js";
import * as packagesDomain from "../domain/packages.js";
import * as applications from "../domain/applications.js";
import * as roster from "../domain/roster.js";
import * as storage from "../domain/storage.js";
import * as members from "../domain/members.js";
import { idempotentRun, requireIdempotencyKey } from "../domain/idempotency.js";
import { resolveLocal, autoReleaseInstant, addDays } from "../domain/time.js";
import { OFFICES, OFFICE_META, BOARDS, randomToken, type Office, type Board } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";

const STAFF = ["agency_director", "booker", "accounts_lead", "scout"];
const BOOKER_ROLES = ["agency_director", "booker"];
const ACCOUNTS_ROLES = ["agency_director", "accounts_lead"];

export const workspaceRoutes: Route[] = [
  // Members
  route("GET", "/api/members", async (ctx) => {
    staff(ctx);
    return members.listMembers();
  }),

  route("GET", "/api/members/:id", async (ctx) => {
    const m = member(ctx);
    if (STAFF.includes(m.role)) return members.getMember(ctx.params.id);
    if (ctx.params.id !== m.id) throw errors.notFound();
    return members.getMember(ctx.params.id);
  }),

  route("PATCH", "/api/members/:id", async (ctx) => {
    const m = director(ctx);
    const target = await one<{ id: string }>(`SELECT id FROM members WHERE id = $1 AND removed_at IS NULL`, [ctx.params.id]);
    if (!target) throw errors.notFound();
    const body = await jsonBody(ctx);
    const roleValue = typeof body.role === "string" ? body.role : "";
    if (!["agency_director", "booker", "accounts_lead", "scout", "talent"].includes(roleValue)) throw errors.validation({ role: "Choose a role." });
    return members.changeRole(ctx.params.id, roleValue, m);
  }),

  route("DELETE", "/api/members/:id", async (ctx) => {
    const m = director(ctx);
    const target = await one<{ id: string }>(`SELECT id FROM members WHERE id = $1 AND removed_at IS NULL`, [ctx.params.id]);
    if (!target) throw errors.notFound();
    await members.removeMember(ctx.params.id, m);
    ctx.res.status(204).end();
    return undefined;
  }),

  // Talent records
  route("GET", "/api/talent", async (ctx) => {
    staff(ctx);
    const office = typeof ctx.req.query.office === "string" ? ctx.req.query.office : "";
    const state = typeof ctx.req.query.state === "string" ? ctx.req.query.state : "";
    const params: unknown[] = [];
    let where = `TRUE`;
    if (office) {
      params.push(office);
      where += ` AND office = $${params.length}`;
    }
    if (state) {
      params.push(state);
      where += ` AND state = $${params.length}`;
    }
    const rows = await query<talentDomain.TalentRow>(`SELECT * FROM talent WHERE ${where} ORDER BY lower(display_name)`, params);
    const out = [];
    for (const row of rows) {
      const portfolio = await talentDomain.talentPortfolio(row.id);
      out.push(talentDomain.talentView(row, portfolio, true));
    }
    return { talent: out };
  }),

  route("GET", "/api/talent/:id", async (ctx) => {
    const m = member(ctx);
    const row = await one<talentDomain.TalentRow>(`SELECT * FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!row || row.state === "erased") throw errors.notFound();
    if (!STAFF.includes(m.role)) {
      if (m.talentId !== row.id) throw errors.notFound();
    }
    const portfolio = await talentDomain.talentPortfolio(row.id);
    return talentDomain.talentView(row, portfolio, true);
  }),

  route("POST", "/api/talent", async (ctx) => {
    director(ctx);
    const body = await jsonBody(ctx);
    const displayName = String(body.displayName || "").trim();
    const office = String(body.office || "");
    const board = String(body.board || "");
    const errs: Record<string, string> = {};
    if (!displayName) errs.displayName = "Enter display name.";
    if (!(OFFICES as readonly string[]).includes(office)) errs.office = "Choose an office.";
    if (!(BOARDS as readonly string[]).includes(board)) errs.board = "Choose a board.";
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter an email address like name@example.com.";
    const measurements = parseMeasurements(body.measurements);
    if (Object.keys(errs).length > 0) throw errors.validation(errs);
    const created = await withTransaction(async (tx) => {
      return talentDomain.createTalent(tx, { displayName, email, office: office as Office, board: board as Board, heightCm: measurements.heightCm, chestCm: measurements.chestCm, waistCm: measurements.waistCm, hipsCm: measurements.hipsCm });
    });
    status(ctx, 201);
    return talentDomain.talentView(created, [], true);
  }),

  route("PATCH", "/api/talent/:id", async (ctx) => {
    const m = role(ctx, BOOKER_ROLES);
    const row = await one<talentDomain.TalentRow>(`SELECT * FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!row || row.state === "erased") throw errors.notFound();
    const body = await jsonBody(ctx);
    const version = Number(body.version);
    if (!Number.isInteger(version)) throw errors.validation({ version: "Choose the version you are editing." });
    if (version !== row.version) {
      const lastSaver = await one<{ name: string; saved_at: Date | null }>(
        `SELECT COALESCE(ms.name, t.last_saved_by, 'Rungboard') AS name, t.last_saved_at AS saved_at
         FROM talent t LEFT JOIN members ms ON ms.id = t.last_saved_by WHERE t.id = $1`, [row.id]);
      throw errors.precondition("stale_version", { savedBy: lastSaver?.name || "Rungboard", savedAt: toInstant(lastSaver?.saved_at || new Date(0)) });
    }
    const updates: Record<string, unknown> = {};
    if (typeof body.displayName === "string" && body.displayName.trim()) updates.display_name = body.displayName.trim();
    if (typeof body.officeNote === "string") updates.office_note = body.officeNote;
    const measurements = parseMeasurements(body.measurements);
    if (measurements.heightCm !== undefined) updates.height_cm = measurements.heightCm;
    if (measurements.chestCm !== undefined) updates.chest_cm = measurements.chestCm;
    if (measurements.waistCm !== undefined) updates.waist_cm = measurements.waistCm;
    if (measurements.hipsCm !== undefined) updates.hips_cm = measurements.hipsCm;
    const reach = (body.reach ?? {}) as Record<string, unknown>;
    if (typeof reach.instagram === "number") updates.instagram = reach.instagram;
    if (typeof reach.tiktok === "number") updates.tiktok = reach.tiktok;
    if (typeof reach.youtube === "number") updates.youtube = reach.youtube;
    if (typeof body.office === "string" && (OFFICES as readonly string[]).includes(body.office)) updates.office = body.office;
    if (typeof body.board === "string" && (BOARDS as readonly string[]).includes(body.board)) updates.board = body.board;
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      keys.push("version", "last_saved_by", "last_saved_at");
      updates.version = row.version + 1;
      updates.last_saved_by = m.id;
      updates.last_saved_at = new Date();
      await query(`UPDATE talent SET ${keys.map((k, i) => `${toSnake(k)} = $${i + 1}`).join(", ")} WHERE id = $${keys.length + 1}`, [...keys.map((k) => updates[k]), row.id]);
    }
    const fresh = await one<talentDomain.TalentRow>(`SELECT * FROM talent WHERE id = $1`, [row.id]);
    const portfolio = await talentDomain.talentPortfolio(row.id);
    return talentDomain.talentView(fresh!, portfolio, true);
  }),

  route("POST", "/api/talent/:id/photos", async (ctx) => {
    role(ctx, BOOKER_ROLES);
    const row = await one<talentDomain.TalentRow>(`SELECT * FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!row || row.state === "erased") throw errors.notFound();
    const upload = await readMultipartFile(ctx.req, storage.PORTFOLIO_PHOTO_LIMIT);
    const decoded = await storage.decodeCheck(upload.buffer);
    if (!decoded) throw errors.validation({ file: "That file is not a JPEG, PNG or WebP photo." });
    const photoId = `ph_${randomToken(12)}`;
    const normalized = await storage.normalizePhoto(upload.buffer);
    // Object first, then the row; remove the object if the row fails
    await storage.storeObject(storage.portfolioKey(row.id, photoId), normalized.buffer, "image/jpeg");
    try {
      await withTransaction(async (tx) => {
        const position = await tx.one<{ next: number }>(`SELECT COALESCE(MAX(position) + 1, 0)::int AS next FROM photos WHERE talent_id = $1`, [row.id]);
        await tx.query(`INSERT INTO photos (id, talent_id, position, width, height) VALUES ($1, $2, $3, $4, $5)`, [photoId, row.id, position?.next ?? 0, normalized.width, normalized.height]);
        await tx.query(`UPDATE talent SET portfolio_version = portfolio_version + 1 WHERE id = $1`, [row.id]);
      });
      const fresh = await one<{ portfolio_version: number }>(`SELECT portfolio_version FROM talent WHERE id = $1`, [row.id]);
      status(ctx, 201);
      return { photoId, url: `/api/photos/${photoId}`, width: normalized.width, height: normalized.height, portfolioVersion: fresh?.portfolio_version ?? 0 };
    } catch (err) {
      await storage.deleteObject(storage.portfolioKey(row.id, photoId)).catch(() => {});
      throw err;
    }
  }),

  route("DELETE", "/api/talent/:id/photos/:photoId", async (ctx) => {
    role(ctx, BOOKER_ROLES);
    const row = await one<talentDomain.TalentRow>(`SELECT * FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!row || row.state === "erased") throw errors.notFound();
    const photo = await one<{ id: string; position: number }>(`SELECT id, position FROM photos WHERE id = $1 AND talent_id = $2`, [ctx.params.photoId, row.id]);
    if (!photo) throw errors.notFound();
    await withTransaction(async (tx) => {
      await tx.query(`DELETE FROM photos WHERE id = $1`, [photo.id]);
      await tx.query(`UPDATE photos SET position = position - 1 WHERE talent_id = $1 AND position > $2`, [row.id, photo.position]);
      await tx.query(`UPDATE talent SET portfolio_version = portfolio_version + 1 WHERE id = $1`, [row.id]);
    });
    await storage.deleteObject(storage.portfolioKey(row.id, photo.id)).catch(() => {});
    ctx.res.status(204).end();
    return undefined;
  }),

  route("PUT", "/api/talent/:id/photos/order", async (ctx) => {
    const m = role(ctx, BOOKER_ROLES);
    const row = await one<talentDomain.TalentRow>(`SELECT * FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!row || row.state === "erased") throw errors.notFound();
    const body = await jsonBody(ctx);
    const version = Number(body.portfolioVersion);
    if (!Number.isInteger(version)) throw errors.validation({ portfolioVersion: "Choose the version you are editing." });
    if (version !== row.portfolio_version) {
      const lastSaver = await one<{ name: string; saved_at: Date | null }>(
        `SELECT COALESCE(ms.name, t.last_saved_by, 'Rungboard') AS name, t.last_saved_at AS saved_at
         FROM talent t LEFT JOIN members ms ON ms.id = t.last_saved_by WHERE t.id = $1`, [row.id]);
      throw errors.precondition("stale_version", { savedBy: lastSaver?.name || "Rungboard", savedAt: toInstant(lastSaver?.saved_at || new Date(0)) });
    }
    const photoIds = Array.isArray(body.photoIds) ? body.photoIds.map(String) : null;
    if (!photoIds) throw errors.validation({ photoIds: "Choose the new order." });
    const current = await query<{ id: string }>(`SELECT id FROM photos WHERE talent_id = $1`, [row.id]);
    const currentIds = new Set(current.map((p) => p.id));
    if (photoIds.length !== currentIds.size || photoIds.some((id) => !currentIds.has(id))) {
      throw errors.validation({ photoIds: "The photo set has changed; reload and try again." });
    }
    await withTransaction(async (tx) => {
      for (const [index, id] of photoIds.entries()) {
        await tx.query(`UPDATE photos SET position = $2 WHERE id = $1 AND talent_id = $3`, [id, index, row.id]);
      }
      await tx.query(`UPDATE talent SET portfolio_version = portfolio_version + 1, last_saved_by = $2, last_saved_at = $3 WHERE id = $1`, [row.id, m.id, new Date()]);
    });
    const fresh = await one<{ portfolio_version: number }>(`SELECT portfolio_version FROM talent WHERE id = $1`, [row.id]);
    return { portfolioVersion: fresh?.portfolio_version ?? version + 1, photoIds };
  }),

  // Withdraw, restore, erase
  route("POST", "/api/talent/:id/withdraw", async (ctx) => {
    director(ctx);
    await roster.withdrawTalent(ctx.params.id);
    return talentForStaff(ctx.params.id);
  }),

  route("POST", "/api/talent/:id/restore", async (ctx) => {
    director(ctx);
    await roster.restoreTalent(ctx.params.id);
    return talentForStaff(ctx.params.id);
  }),

  route("POST", "/api/talent/:id/erase", async (ctx) => {
    director(ctx);
    await roster.eraseTalent(ctx.params.id, "Rungboard");
    return talentForStaff(ctx.params.id);
  }),

  // Roster import/export
  route("POST", "/api/roster/imports", async (ctx) => {
    director(ctx);
    const upload = await readMultipartFile(ctx.req, 2_000_000);
    const text = upload.buffer.toString("utf8");
    const report = await roster.importRoster(text);
    return report;
  }),

  route("GET", "/api/roster/export.csv", async (ctx) => {
    director(ctx);
    const csv = await roster.exportRoster();
    ctx.res.setHeader("Content-Type", "text/csv; charset=utf-8");
    ctx.res.setHeader("Content-Disposition", `attachment; filename="roster.csv"`);
    ctx.res.send(csv);
    return undefined;
  }),

  // Options
  route("GET", "/api/talent/:id/ladder", async (ctx) => {
    staff(ctx);
    const row = await one<{ id: string; office: string }>(`SELECT id, office FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!row || (await isErased(ctx.params.id))) throw errors.notFound();
    const from = typeof ctx.req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(ctx.req.query.from)) ? String(ctx.req.query.from) : new Date().toISOString().slice(0, 10);
    const days = Math.min(Math.max(Number(ctx.req.query.days) || 14, 1), 31);
    const options = await query<ladder.OptionRow & { client_company: string; placed_by_name: string; office: string }>(
      `SELECT o.*, c.company AS client_company, m.name AS placed_by_name, t.office AS office
       FROM options o JOIN clients c ON c.id = o.client_id JOIN members m ON m.id = o.placed_by JOIN talent t ON t.id = o.talent_id
       WHERE o.talent_id = $1 AND o.date >= $2::date AND o.date < $3::date
       ORDER BY o.date, (CASE WHEN o.state IN ('placed','challenged') THEN 0 ELSE 1 END), o.rank NULLS LAST, o.sequence`,
      [ctx.params.id, from, addDays(from, days)]
    );
    const byDate = new Map<string, Array<Record<string, unknown>>>();
    const bookingIds = new Set<string>();
    for (const o of options) {
      const dayKey = typeof o.date === "string" ? o.date.slice(0, 10) : o.date.toISOString().slice(0, 10);
      if (!byDate.has(dayKey)) byDate.set(dayKey, []);
      byDate.get(dayKey)!.push(ladder.optionView(o));
      if (o.state === "confirmed" && o.booked_booking_id) bookingIds.add(o.booked_booking_id);
    }
    const bookingByDate = new Map<string, string>();
    for (const id of bookingIds) {
      const b = await one<{ id: string; date: string }>(`SELECT id, to_char(date,'YYYY-MM-DD') AS date FROM bookings WHERE id = $1`, [id]);
      if (b) bookingByDate.set(b.date, b.id);
    }
    const dayList: Array<Record<string, unknown>> = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      const opts = byDate.get(date) || [];
      const dayState = opts.some((o) => o.state === "confirmed") ? "booked" : opts.some((o) => o.state === "placed" || o.state === "challenged") ? "held" : "open";
      dayList.push({ date, dayState, options: opts, bookingId: bookingByDate.get(date) ?? null });
    }
    return { talentId: ctx.params.id, office: row.office, days: dayList };
  }),

  route("POST", "/api/options", async (ctx) => {
    const m = role(ctx, BOOKER_ROLES);
    const key = requireIdempotencyKey(ctx.req);
    const body = await jsonBody(ctx);
    const now = new Date();
    const outcome = await idempotentRun({
      memberId: m.id,
      key,
      body,
      endpoint: "options",
      withTransaction: withTransaction,
      execute: async (tx) => {
        const talentId = String(body.talentId || "");
        const clientId = String(body.clientId || "");
        const date = String(body.date || "");
        const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle : "";
        const note = typeof body.note === "string" && body.note ? body.note : null;
        const holdUntil = body.holdUntilLocal !== undefined && body.holdUntilLocal !== null ? String(body.holdUntilLocal) : null;
        if (!talentId || !clientId || !date) throw errors.validation({ talentId: "Choose talent." });
        const talent = await tx.one<{ id: string; office: string; state: string }>(`SELECT id, office, state FROM talent WHERE id = $1`, [talentId]);
        if (!talent || talent.state === "erased") throw errors.notFound();
        const client = await tx.one<{ id: string }>(`SELECT id FROM clients WHERE id = $1`, [clientId]);
        if (!client) throw errors.notFound();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation({ date: "Enter a date like 2027-03-15." });
        if (date > "2027-12-31") throw errors.validation({ date: "Options can be placed only while this day's automatic release is still ahead, up to 31 Dec 2027." });
        const closures = await ladder.closuresFor(tx, talent.office as Office);
        const auto = autoReleaseInstant(date, talent.office as Office, closures);
        if (auto.getTime() <= now.getTime()) throw errors.validation({ date: "Options can be placed only while this day's automatic release is still ahead, up to 31 Dec 2027." });
        let holdInstant: Date | null = null;
        if (holdUntil) {
          const resolved = resolveLocal(holdUntil, OFFICE_META[talent.office as Office].timeZone);
          if (!resolved) throw errors.validation({ holdUntilLocal: `That time does not exist in ${OFFICE_META[talent.office as Office].city}: clocks skip that hour.` });
          if (resolved.getTime() <= now.getTime()) throw errors.validation({ holdUntilLocal: "Choose a time in the future." });
          if (resolved.getTime() >= auto.getTime()) throw errors.validation({ holdUntilLocal: "Choose a time before the automatic release." });
          holdInstant = resolved;
        }
        const placed = await ladder.placeOption(tx, { talentId, clientId, date, jobTitle, note, holdUntil: holdInstant, member: m, now });
        const clientCompany = (await tx.one<{ company: string }>(`SELECT company FROM clients WHERE id = $1`, [clientId]))!.company;
        const view = ladder.optionView({ ...placed.row, client_company: clientCompany, placed_by_name: m.name, office: talent.office });
        return [201, { option: view }] as [number, unknown];
      },
    });
    status(ctx, outcome.status);
    return outcome.body;
  }),

  route("GET", "/api/options/:id", async (ctx) => {
    staff(ctx);
    const row = await withTransaction(async (tx) => {
      await ladder.loadOption(tx, ctx.params.id);
      return ladder.optionWithClient(tx, ctx.params.id);
    });
    if (!row) throw errors.notFound();
    return { option: ladder.optionView(row) };
  }),

  route("PATCH", "/api/options/:id", async (ctx) => {
    const m = role(ctx, BOOKER_ROLES);
    const body = await jsonBody(ctx);
    await withTransaction(async (tx) => {
      const row = await ladder.loadOption(tx, ctx.params.id);
      const version = Number(body.version);
      if (!Number.isInteger(version)) throw errors.validation({ version: "Choose the version you are editing." });
      if (version !== row.version) {
        const lastSaver = await tx.one<{ name: string; saved_at: Date | null }>(
          `SELECT COALESCE(ms.name, o.last_saved_by, 'Rungboard') AS name, o.last_saved_at AS saved_at
           FROM options o LEFT JOIN members ms ON ms.id = o.last_saved_by WHERE o.id = $1`, [row.id]);
        throw errors.precondition("stale_version", { savedBy: lastSaver?.name || "Rungboard", savedAt: toInstant(lastSaver?.saved_at || row.placed_at) });
      }
      if (row.state === "released" || row.state === "expired") {
        throw errors.conflict("option_released", { releasedAt: toInstant(row.released_at || new Date()) });
      }
      const talent = await tx.one<{ office: string; state: string }>(`SELECT office, state FROM talent WHERE id = $1`, [row.talent_id]);
      const closures = await ladder.closuresFor(tx, talent!.office as Office);
      const auto = autoReleaseInstant(typeof row.date === "string" ? row.date.slice(0, 10) : row.date.toISOString().slice(0, 10), talent!.office as Office, closures);
      if (body.holdUntilLocal === null) {
        await tx.query(`UPDATE options SET hold_until = NULL, release_at = auto_release_at, version = version + 1, last_saved_by = $2, last_saved_at = $3 WHERE id = $1`, [row.id, m.id, new Date()]);
        return;
      }
      const holdUntil = String(body.holdUntilLocal || "");
      const resolved = resolveLocal(holdUntil, OFFICE_META[talent!.office as Office].timeZone);
      if (!resolved) throw errors.validation({ holdUntilLocal: `That time does not exist in ${OFFICE_META[talent!.office as Office].city}: clocks skip that hour.` });
      const now = new Date();
      if (resolved.getTime() <= now.getTime()) throw errors.validation({ holdUntilLocal: "Choose a time in the future." });
      if (resolved.getTime() >= auto.getTime()) throw errors.validation({ holdUntilLocal: "Choose a time before the automatic release." });
      const releaseAt = resolved.getTime() < auto.getTime() ? resolved : auto;
      await tx.query(`UPDATE options SET hold_until = $2, release_at = $3, version = version + 1, last_saved_by = $4, last_saved_at = $5 WHERE id = $1`, [row.id, resolved, releaseAt, m.id, new Date()]);
      if (typeof body.note === "string") {
        await tx.query(`UPDATE options SET note = $2 WHERE id = $1`, [row.id, body.note || null]);
      }
    });
    const fresh = await withTransaction(async (tx) => {
      await ladder.loadOption(tx, ctx.params.id);
      return ladder.optionWithClient(tx, ctx.params.id);
    });
    return { option: ladder.optionView(fresh!) };
  }),

  route("POST", "/api/options/:id/release", async (ctx) => {
    role(ctx, BOOKER_ROLES);
    await jsonBody(ctx);
    const now = new Date();
    const outcome = await withTransaction(async (tx) => {
      const row = await ladder.loadOption(tx, ctx.params.id);
      if (row.state === "released" || row.state === "expired") throw errors.conflict("option_released", { releasedAt: toInstant(row.released_at || now) });
      if (row.challenge_deadline && row.challenge_deadline.getTime() <= now.getTime()) {
        throw errors.conflict("challenge_expired", { challengeDeadline: toInstant(row.challenge_deadline) });
      }
      const wasFirst = row.rank === 1;
      await tx.query(`UPDATE options SET state = 'released', released_at = $2, release_reason = 'manual', rank = NULL, version = version + 1, challenge_deadline = NULL WHERE id = $1`, [row.id, now]);
      await ladder.reladder(tx, row.talent_id, row.date);
      const next = await ladder.ladderForDay(tx, row.talent_id, row.date);
      const promoted = wasFirst ? next.find((o) => o.rank === 1 && o.id !== row.id) : null;
      if (promoted) {
        await ladder.queueChallengeOutcomeEmails(tx, {
          releasedOption: { talentId: row.talent_id, clientId: row.client_id, date: typeof row.date === "string" ? row.date.slice(0, 10) : row.date.toISOString().slice(0, 10), state: row.state, rank: row.rank },
          promotedClientId: promoted.client_id,
          booked: false,
          talentName: (await tx.one<{ display_name: string }>(`SELECT display_name FROM talent WHERE id = $1`, [row.talent_id]))!.display_name,
        });
      }
      const ladderRows = await ladder.ladderForDay(tx, row.talent_id, row.date);
      return { option: (await ladder.optionWithClient(tx, row.id))!, ladder: ladderRows.filter((o) => ["placed", "challenged"].includes(o.state) || o.id === row.id).map((o) => ladder.optionView(o)) };
    });
    return outcome;
  }),

  route("POST", "/api/options/:id/challenge", async (ctx) => {
    role(ctx, BOOKER_ROLES);
    await jsonBody(ctx);
    const now = new Date();
    return withTransaction(async (tx) => {
      const row = await ladder.loadOption(tx, ctx.params.id);
      if (row.state === "released" || row.state === "expired") throw errors.conflict("option_released", { releasedAt: toInstant(row.released_at || now) });
      if (row.rank !== 2) throw errors.conflict("not_second");
      const dayRows = await ladder.ladderForDay(tx, row.talent_id, row.date);
      const first = dayRows.find((o) => o.rank === 1);
      if (!first) throw errors.conflict("not_second");
      if (first.state === "challenged") throw errors.conflict("already_challenged", { challengeDeadline: toInstant(first.challenge_deadline!) });
      const deadline = new Date(Math.floor((now.getTime() + config.optionChallengeSeconds * 1000) / 1000) * 1000);
      await tx.query(`UPDATE options SET state = 'challenged', challenge_deadline = $2, version = version + 1 WHERE id = $1`, [first.id, deadline]);
      const ladderRows = await ladder.ladderForDay(tx, row.talent_id, row.date);
      return { ladder: ladderRows.map((o) => ladder.optionView(o)) };
    });
  }),

  // Bookings
  route("POST", "/api/bookings", async (ctx) => {
    const m = role(ctx, BOOKER_ROLES);
    const body = await jsonBody(ctx);
    const raw = Array.isArray(body.options) ? body.options : [];
    const options = raw.map((item) => {
      const o = item as Record<string, unknown>;
      return {
        optionId: String(o.optionId || ""),
        dayType: o.dayType === "half_day" ? ("half_day" as const) : ("full_day" as const),
        overtimeMinutes: Number(o.overtimeMinutes) || 0,
        usage: Array.isArray(o.usage) ? o.usage.map((u) => u as Record<string, unknown>).map((u) => ({ media: String(u.media || ""), territory: String(u.territory || ""), termMonths: Number(u.termMonths) || 0 })) : [],
      };
    });
    if (options.length === 0) throw errors.validation({ options: "Confirm at least one option." });
    for (const item of options) {
      if (!item.optionId) throw errors.validation({ options: "Confirm at least one option." });
      if (!Number.isInteger(item.overtimeMinutes) || item.overtimeMinutes < 0 || item.overtimeMinutes > 600) {
        throw errors.validation({ options: "Overtime minutes must be a whole number from 0 to 600." });
      }
    }
    const now = new Date();
    const result = await withTransaction(async (tx) => {
      const outcome = await bookingsDomain.confirmBooking(tx, { options, member: m, now });
      return { booking: await bookingsDomain.bookingView(tx, outcome.booking) };
    });
    status(ctx, 201);
    return result;
  }),

  route("GET", "/api/bookings", async (ctx) => {
    role(ctx, ["agency_director", "booker", "accounts_lead"]);
    const office = typeof ctx.req.query.office === "string" ? ctx.req.query.office : "";
    const month = typeof ctx.req.query.month === "string" ? ctx.req.query.month : "";
    const params: unknown[] = [];
    let where = `TRUE`;
    if (office) {
      params.push(office);
      where += ` AND office = $${params.length}`;
    }
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      params.push(`${month}-01`);
      where += ` AND date >= $${params.length} AND date < ($${params.length}::date + interval '1 month')`;
    }
    const rows = await query<bookingsDomain.BookingRow>(`SELECT * FROM bookings WHERE ${where} ORDER BY date DESC, reference`, params);
    const out = [];
    for (const row of rows) {
      out.push(await bookingsDomain.bookingView(poolReader(), row));
    }
    return { bookings: out };
  }),

  route("GET", "/api/bookings/:id", async (ctx) => {
    role(ctx, ["agency_director", "booker", "accounts_lead"]);
    const row = await bookingsDomain.loadBooking(ctx.params.id);
    return { booking: await bookingsDomain.bookingView(poolReader(), row) };
  }),

  route("POST", "/api/bookings/:id/issue", async (ctx) => {
    const m = role(ctx, ACCOUNTS_ROLES);
    await jsonBody(ctx);
    const row = await bookingsDomain.issueInvoice(ctx.params.id, m, new Date());
    return { booking: await bookingsDomain.bookingView(poolReader(), row) };
  }),

  // Clients
  route("GET", "/api/clients", async (ctx) => {
    staff(ctx);
    const rows = await query<{ id: string; slug: string; company: string; contact_name: string; contact_email: string; time_zone: string }>(`SELECT id, slug, company, contact_name, contact_email, time_zone FROM clients ORDER BY company`);
    return { clients: rows.map((r) => ({ id: r.id, slug: r.slug, company: r.company, contactName: r.contact_name, contactEmail: r.contact_email, timeZone: r.time_zone })) };
  }),

  route("POST", "/api/clients", async (ctx) => {
    role(ctx, ["agency_director", "booker", "accounts_lead"]);
    const body = await jsonBody(ctx);
    const company = String(body.company || "").trim();
    const contactName = String(body.contactName || "").trim();
    const contactEmail = String(body.contactEmail || "").trim();
    const timeZone = String(body.timeZone || "");
    const errs: Record<string, string> = {};
    if (!company) errs.company = "Enter the company.";
    if (!contactName) errs.contactName = "Enter the contact name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) errs.contactEmail = "Enter an email address like name@example.com.";
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone });
    } catch {
      errs.timeZone = "Choose a valid time zone.";
    }
    if (Object.keys(errs).length > 0) throw errors.validation(errs);
    const id = `cli_${randomToken(8)}`;
    const slug = company.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `client-${randomToken(4)}`;
    const exists = await one<{ id: string }>(`SELECT id FROM clients WHERE slug = $1`, [slug]);
    const finalSlug = exists ? `${slug}-${randomToken(3).toLowerCase()}` : slug;
    await query(`INSERT INTO clients (id, slug, company, contact_name, contact_email, time_zone) VALUES ($1, $2, $3, $4, $5, $6)`, [id, finalSlug, company, contactName, contactEmail, timeZone]);
    status(ctx, 201);
    return { id, slug: finalSlug, company, contactName, contactEmail, timeZone };
  }),

  // Rate cards
  route("GET", "/api/rate-cards", async (ctx) => {
    staff(ctx);
    const cards = await query<{ id: string; name: string; effective_from: string }>(`SELECT id, name, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM rate_cards ORDER BY effective_from DESC`);
    const out = [];
    for (const card of cards) {
      const boardsRows = await query<{ board: string; full_day_cents: number; half_day_cents: number; overtime_qh_cents: number }>(`SELECT board, full_day_cents, half_day_cents, overtime_qh_cents FROM rate_card_boards WHERE rate_card_id = $1`, [card.id]);
      const usage = await query<{ media: string; base_cents: number }>(`SELECT media, base_cents FROM rate_card_usage WHERE rate_card_id = $1`, [card.id]);
      out.push({
        id: card.id,
        name: card.name,
        effectiveFrom: card.effective_from,
        boards: Object.fromEntries(boardsRows.map((b) => [b.board, { fullDayCents: b.full_day_cents, halfDayCents: b.half_day_cents, overtimeQuarterHourCents: b.overtime_qh_cents }])),
        usageBaseCents: Object.fromEntries(usage.map((u) => [u.media, u.base_cents])),
      });
    }
    return { rateCards: out };
  }),

  route("POST", "/api/rate-cards", async (ctx) => {
    director(ctx);
    const body = await jsonBody(ctx);
    const name = String(body.name || "").trim();
    const effectiveFrom = String(body.effectiveFrom || "");
    const boardsInput = (body.boards ?? {}) as Record<string, unknown>;
    const usageInput = (body.usageBaseCents ?? {}) as Record<string, unknown>;
    if (!name) throw errors.validation({ name: "Enter a name." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw errors.validation({ effectiveFrom: "Enter a date like 2027-04-01." });
    const latest = await one<{ effective_from: string }>(`SELECT to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM rate_cards ORDER BY effective_from DESC LIMIT 1`);
    if (latest && effectiveFrom <= latest.effective_from) throw errors.validation({ effectiveFrom: "The effective date must be later than every existing card's." });
    for (const board of BOARDS) {
      const b = boardsInput[board];
      if (!b || typeof b !== "object") throw errors.validation({ boards: "Every board needs its rates." });
    }
    const id = `rc_${randomToken(8)}`;
    await withTransaction(async (tx) => {
      await tx.query(`INSERT INTO rate_cards (id, name, effective_from) VALUES ($1, $2, $3)`, [id, name, effectiveFrom]);
      for (const board of BOARDS) {
        const b = boardsInput[board] as { fullDayCents: number; halfDayCents: number; overtimeQuarterHourCents: number };
        await tx.query(`INSERT INTO rate_card_boards (rate_card_id, board, full_day_cents, half_day_cents, overtime_qh_cents) VALUES ($1, $2, $3, $4, $5)`, [id, board, Number(b.fullDayCents), Number(b.halfDayCents), Number(b.overtimeQuarterHourCents)]);
      }
      for (const media of ["digital", "print", "out_of_home", "broadcast"]) {
        await tx.query(`INSERT INTO rate_card_usage (rate_card_id, media, base_cents) VALUES ($1, $2, $3)`, [id, media, Number(usageInput[media] || 0)]);
      }
    });
    status(ctx, 201);
    return { id, name, effectiveFrom };
  }),

  // Closures
  route("POST", "/api/offices/:office/closures", async (ctx) => {
    director(ctx);
    const office = ctx.params.office;
    if (!(OFFICES as readonly string[]).includes(office)) throw errors.notFound();
    const body = await jsonBody(ctx);
    const date = String(body.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation({ date: "Enter a date like 2027-08-20." });
    const year = Number(date.slice(0, 4));
    if (year < 2026 || year > 2027) throw errors.validation({ date: "Choose a date in 2026 or 2027." });
    const existing = await one<{ office: string }>(`SELECT office FROM office_closures WHERE office = $1 AND date = $2::date`, [office, date]);
    if (existing) throw errors.validation({ date: "That date is already a closure." });
    await query(`INSERT INTO office_closures (office, date) VALUES ($1, $2)`, [office, date]);
    await recomputeAutoReleases(office);
    const rows = await query<{ date: string }>(`SELECT to_char(date,'YYYY-MM-DD') AS date FROM office_closures WHERE office = $1 ORDER BY date`, [office]);
    status(ctx, 201);
    return { office, closures: rows.map((r) => r.date) };
  }),

  route("GET", "/api/offices/:office/closures", async (ctx) => {
    staff(ctx);
    const office = ctx.params.office;
    if (!(OFFICES as readonly string[]).includes(office)) throw errors.notFound();
    const rows = await query<{ date: string }>(`SELECT to_char(date,'YYYY-MM-DD') AS date FROM office_closures WHERE office = $1 ORDER BY date`, [office]);
    return { office, closures: rows.map((r) => r.date) };
  }),

  // Packages (staff)
  route("GET", "/api/packages", async (ctx) => {
    role(ctx, ["agency_director", "booker"]);
    const list = await packagesDomain.listPackages();
    return {
      packages: list.map((p) => ({
        ...packagesDomain.packageView(p.row, p.talent.map((t) => ({ talentId: t.talentId, displayName: t.displayName, decision: t.decision }))),
        shortlistedCount: p.shortlistedCount,
      })),
    };
  }),

  route("GET", "/api/packages/:id", async (ctx) => {
    role(ctx, ["agency_director", "booker"]);
    const pkg = await packagesDomain.getPackage(ctx.params.id);
    const talent = await packagesDomain.packageTalent(pkg.id);
    return { package: packagesDomain.packageView(pkg, talent.map((t) => ({ talentId: t.talentId, displayName: t.displayName, decision: t.decision }))) };
  }),

  route("POST", "/api/packages", async (ctx) => {
    const m = role(ctx, ["agency_director", "booker"]);
    const body = await jsonBody(ctx);
    const title = String(body.title || "").trim();
    const recipientName = String(body.recipientName || "").trim();
    const recipientEmail = String(body.recipientEmail || "").trim();
    const talentIds = Array.isArray(body.talentIds) ? body.talentIds.map(String) : [];
    const errs: Record<string, string> = {};
    if (!title) errs.title = "Enter a title.";
    if (!recipientName) errs.recipientName = "Enter the recipient name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) errs.recipientEmail = "Enter an email address like name@example.com.";
    if (talentIds.length === 0) errs.talentIds = "Choose at least one talent.";
    if (Object.keys(errs).length > 0) throw errors.validation(errs);
    void m;
    const pkg = await packagesDomain.createPackage({ title, recipientName, recipientEmail, talentIds, member: m, ttlSeconds: config.packageLinkTtlSeconds });
    status(ctx, 201);
    const talent = await packagesDomain.packageTalent(pkg.id);
    return { package: packagesDomain.packageView(pkg, talent.map((t) => ({ talentId: t.talentId, displayName: t.displayName, decision: t.decision }))) };
  }),

  route("POST", "/api/packages/:id/revoke", async (ctx) => {
    role(ctx, ["agency_director", "booker"]);
    await jsonBody(ctx);
    const pkg = await packagesDomain.revokePackage(ctx.params.id);
    const talent = await packagesDomain.packageTalent(pkg.id);
    return { package: packagesDomain.packageView(pkg, talent.map((t) => ({ talentId: t.talentId, displayName: t.displayName, decision: t.decision }))) };
  }),

  route("POST", "/api/packages/:id/regenerate", async (ctx) => {
    role(ctx, ["agency_director", "booker"]);
    await jsonBody(ctx);
    const pkg = await packagesDomain.regeneratePackage(ctx.params.id, config.packageLinkTtlSeconds);
    const talent = await packagesDomain.packageTalent(pkg.id);
    return { package: packagesDomain.packageView(pkg, talent.map((t) => ({ talentId: t.talentId, displayName: t.displayName, decision: t.decision }))) };
  }),

  // Applications (staff)
  route("GET", "/api/applications", async (ctx) => {
    role(ctx, ["agency_director", "scout"]);
    const statusFilter = typeof ctx.req.query.status === "string" ? ctx.req.query.status : "";
    return { applications: await applications.listApplications(statusFilter || undefined) };
  }),

  route("GET", "/api/applications/:id/photos/:slot", async (ctx) => {
    role(ctx, ["agency_director", "scout"]);
    const row = await applications.loadApplicationForStaff(ctx.params.id);
    const slot = ctx.params.slot;
    if (!["front", "profile", "full_length", "smile"].includes(slot)) throw errors.notFound();
    const data = await storage.loadObject(storage.applicationKey(row.id, slot));
    ctx.res.setHeader("Content-Type", "image/jpeg");
    ctx.res.send(Buffer.from(data));
    return undefined;
  }),

  route("POST", "/api/applications/:id/decision", async (ctx) => {
    const m = role(ctx, ["agency_director", "scout"]);
    const row = await applications.loadApplicationForStaff(ctx.params.id);
    const body = await jsonBody(ctx);
    const decision = body.decision === "approve" ? "approve" : body.decision === "decline" ? "decline" : null;
    if (!decision) throw errors.validation({ decision: "Choose approve or decline." });
    const fresh = await applications.decideApplication(row, decision, m, new Date());
    const photos = await applications.applicationPhotos(row.id);
    return applications.applicationView(fresh, photos);
  }),

  route("POST", "/api/applications/:id/sign", async (ctx) => {
    role(ctx, ["agency_director", "scout"]);
    const row = await applications.loadApplicationForStaff(ctx.params.id);
    if (row.status !== "approved") throw errors.conflict("not_approved");
    const { signApplication } = await import("../domain/applications.js");
    const result = await withTransaction(async (tx) => {
      return signApplication(tx, row);
    });
    status(ctx, 201);
    return { talent: { id: result.id, slug: result.slug, displayName: result.displayName } };
  }),

  // Licences
  route("POST", "/api/licences", async (ctx) => {
    const m = role(ctx, ACCOUNTS_ROLES);
    const body = await jsonBody(ctx);
    const clientId = String(body.clientId || "");
    const talentId = String(body.talentId || "");
    const media = String(body.media || "");
    const territory = String(body.territory || "");
    const firstUseDate = String(body.firstUseDate || "");
    const termMonths = Number(body.termMonths);
    const monthlyFeeCents = Number(body.monthlyFeeCents);
    const errs: Record<string, string> = {};
    if (!clientId) errs.clientId = "Choose a client.";
    if (!talentId) errs.talentId = "Choose talent.";
    if (!["digital", "print", "out_of_home", "broadcast"].includes(media)) errs.media = "Choose a media.";
    if (!["canada", "north_america", "worldwide"].includes(territory)) errs.territory = "Choose a territory.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstUseDate)) errs.firstUseDate = "Enter a date like 2027-01-31.";
    if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 36) errs.termMonths = "Choose whole months from 1 to 36.";
    if (!Number.isInteger(monthlyFeeCents) || monthlyFeeCents < 0) errs.monthlyFeeCents = "Enter a monthly fee.";
    if (Object.keys(errs).length > 0) throw errors.validation(errs);
    void m;
    const row = await withTransaction(async (tx) => {
      return licences.recordLicence(tx, { clientId, talentId, media: media as never, territory: territory as never, firstUseDate, termMonths, monthlyFeeCents, member: m });
    });
    status(ctx, 201);
    return { licence: await licenceViewRow(row) };
  }),

  route("GET", "/api/licences", async (ctx) => {
    role(ctx, ACCOUNTS_ROLES);
    const statusFilter = typeof ctx.req.query.status === "string" ? ctx.req.query.status : "";
    const list = await licences.listLicences(statusFilter || undefined);
    const out = [];
    for (const row of list.rows) {
      out.push(await licenceViewRow(row));
    }
    return { counts: list.counts, licences: out };
  }),

  route("GET", "/api/licences/:id", async (ctx) => {
    role(ctx, ACCOUNTS_ROLES);
    const row = await withTransaction(async (tx) => licences.loadLicence(tx, ctx.params.id));
    return { licence: await licenceViewRow(row) };
  }),

  route("POST", "/api/licences/:id/extensions", async (ctx) => {
    const m = role(ctx, ACCOUNTS_ROLES);
    const key = requireIdempotencyKey(ctx.req);
    const body = await jsonBody(ctx);
    const months = Number(body.months);
    const version = Number(body.version);
    const now = new Date();
    const outcome = await idempotentRun({
      memberId: m.id,
      key,
      body,
      endpoint: "licence-extension",
      withTransaction: withTransaction,
      execute: async (tx) => {
        if (!Number.isInteger(months) || months < 1 || months > 36) throw errors.validation({ months: "Choose whole months from 1 to 36." });
        if (!Number.isInteger(version)) throw errors.validation({ version: "Choose the version you are extending." });
        const result = await licences.extendLicence(tx, ctx.params.id, months, version, m, now);
        return [201, { licence: await licenceViewRow(result.licence), extension: result.extension }] as [number, unknown];
      },
    });
    status(ctx, outcome.status);
    return outcome.body;
  }),

  // Ledger, advances, reversals, statements
  route("POST", "/api/talent/:id/advances", async (ctx) => {
    const m = role(ctx, ACCOUNTS_ROLES);
    const body = await jsonBody(ctx);
    const amountCents = Number(body.amountCents);
    const note = typeof body.note === "string" ? body.note : "";
    if (!Number.isInteger(amountCents) || amountCents === 0) throw errors.validation({ amountCents: "Enter an amount." });
    if (amountCents < 0) throw errors.validation({ amountCents: "Enter an amount." });
    const row = await one<{ office: string; state: string }>(`SELECT office, state FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!row || row.state === "erased") throw errors.notFound();
    const movement = await ledger.recordAdvance(ctx.params.id, amountCents, note, m, new Date(), row.office);
    const entries = (await ledger.movementEntries([movement.id])).get(movement.id) || [];
    status(ctx, 201);
    return { movement: ledger.movementView(movement, entries) };
  }),

  route("GET", "/api/talent/:id/ledger", async (ctx) => {
    const m = member(ctx);
    const row = await one<{ id: string; state: string }>(`SELECT id, state FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!row || row.state === "erased") throw errors.notFound();
    if (!STAFF.includes(m.role) && m.talentId !== row.id) throw errors.notFound();
    return ledger.ledgerForTalent(ctx.params.id);
  }),

  route("POST", "/api/ledger/movements/:id/reversal", async (ctx) => {
    const m = role(ctx, ACCOUNTS_ROLES);
    const body = await jsonBody(ctx);
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!reason.trim()) throw errors.validation({ reason: "Enter a reason." });
    const movement = await ledger.reverseMovement(ctx.params.id, reason, m, new Date());
    const entries = (await ledger.movementEntries([movement.id])).get(movement.id) || [];
    status(ctx, 201);
    return { movement: ledger.movementView(movement, entries) };
  }),

  route("GET", "/api/talent/:id/statements/:month", async (ctx) => {
    const m = member(ctx);
    const monthParam = ctx.params.month;
    const talent = await one<{ id: string; slug: string; office: string; state: string }>(`SELECT id, slug, office, state FROM talent WHERE id = $1`, [ctx.params.id]);
    if (!talent || talent.state === "erased") throw errors.notFound();
    if (!STAFF.includes(m.role) && m.talentId !== talent.id) throw errors.notFound();
    const month = monthParam.endsWith(".csv") ? monthParam.slice(0, -4) : monthParam;
    if (!/^\d{4}-\d{2}$/.test(month)) throw errors.notFound();
    const statement = await ledger.buildStatement(talent.id, month, talent.office);
    if (!monthParam.endsWith(".csv")) return statement;
    const csv = ledger.statementCsv(statement);
    const key = storage.statementKey(talent.id, month);
    await storage.storeObject(key, Buffer.from(csv, "utf8"), "text/csv");
    ctx.res.setHeader("Content-Type", "text/csv; charset=utf-8");
    ctx.res.setHeader("Content-Disposition", `attachment; filename="statement-${talent.slug}-${month}.csv"`);
    ctx.res.send(csv);
    return undefined;
  }),

  // Calendar feed management
  route("GET", "/api/me/calendar-feed", async (ctx) => {
    const m = role(ctx, ["talent"]);
    const row = await one<{ feed_token: string }>(`SELECT feed_token FROM talent WHERE id = $1`, [m.talentId]);
    if (!row || !row.feed_token) throw errors.notFound();
    return { url: `${config.baseUrl}/feeds/${row.feed_token}.ics` };
  }),

  route("POST", "/api/me/calendar-feed", async (ctx) => {
    const m = role(ctx, ["talent"]);
    const token = randomToken(40);
    await query(`UPDATE talent SET feed_token = $2 WHERE id = $1`, [m.talentId, token]);
    status(ctx, 201);
    return { url: `${config.baseUrl}/feeds/${token}.ics` };
  }),

  // Overview (director)
  route("GET", "/api/overview", async (ctx) => {
    director(ctx);
    const now = new Date();
    const month = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit" }).format(now);
    const offices = await query<{ office: string; held: number; booked: number }>(
      `SELECT t.office, COUNT(*) FILTER (WHERE o.state IN ('placed','challenged'))::int AS held, COUNT(*) FILTER (WHERE o.state = 'confirmed')::int AS booked
       FROM options o JOIN talent t ON t.id = o.talent_id GROUP BY t.office`
    );
    const licencesList = await licences.listLicences();
    return {
      month,
      offices: OFFICES.map((office) => {
        const row = offices.find((o) => o.office === office);
        return { office, heldDays: row?.held || 0, bookingsThisMonth: row?.booked || 0, licences: licencesList.counts, statementsDue: 0 };
      }),
    };
  }),
];

async function licenceViewRow(row: licences.LicenceRow): Promise<Record<string, unknown>> {
  const client = await one<{ company: string; time_zone: string }>(`SELECT company, time_zone FROM clients WHERE id = $1`, [row.client_id]);
  const talent = await one<{ display_name: string }>(`SELECT display_name FROM talent WHERE id = $1`, [row.talent_id]);
  let lastExtension: { months: number; extendedAt: Date; extendedBy: string } | null = null;
  if (row.last_extension_by) {
    lastExtension = { months: 0, extendedAt: row.last_extension_at || new Date(), extendedBy: row.last_extension_by };
    const ext = await one<{ months: number }>(`SELECT months FROM licence_extensions WHERE licence_id = $1 ORDER BY extended_at DESC LIMIT 1`, [row.id]);
    if (ext) lastExtension = { months: ext.months, extendedAt: row.last_extension_at || new Date(), extendedBy: (await one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [row.last_extension_by]))?.name || "" };
  }
  return licences.licenceView(row, client!, talent!, lastExtension ? { months: lastExtension.months, extendedAt: lastExtension.extendedAt, extendedBy: lastExtension.extendedBy } : null);
}

async function talentForStaff(id: string): Promise<Record<string, unknown>> {
  const row = await one<talentDomain.TalentRow>(`SELECT * FROM talent WHERE id = $1`, [id]);
  if (!row) throw errors.notFound();
  const portfolio = await talentDomain.talentPortfolio(id);
  return talentDomain.talentView(row, portfolio, true) as unknown as Record<string, unknown>;
}

async function isErased(id: string): Promise<boolean> {
  const row = await one<{ state: string }>(`SELECT state FROM talent WHERE id = $1`, [id]);
  return !row || row.state === "erased";
}

function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

interface ParsedMeasurements {
  heightCm?: number | null;
  chestCm?: number | null;
  waistCm?: number | null;
  hipsCm?: number | null;
}

function parseMeasurements(input: unknown): ParsedMeasurements {
  const out: ParsedMeasurements = {};
  if (!input || typeof input !== "object") return out;
  const fields: Array<[keyof ParsedMeasurements, string]> = [["heightCm", "height"], ["chestCm", "chest"], ["waistCm", "waist"], ["hipsCm", "hips"]];
  for (const [key, field] of fields) {
    const raw = (input as Record<string, unknown>)[field];
    if (raw === undefined) continue;
    if (raw === null) {
      out[key] = null;
      continue;
    }
    if (typeof raw === "object") {
      const value = (raw as { value?: unknown }).value;
      const unit = (raw as { unit?: unknown }).unit;
      if (typeof value === "number") out[key] = Math.round(value);
      else if (typeof value === "string") out[key] = talentDomain.parseMeasurement(value);
      void unit;
    } else if (typeof raw === "number") {
      out[key] = Math.round(raw);
    } else if (typeof raw === "string") {
      out[key] = talentDomain.parseMeasurement(raw);
    }
  }
  return out;
}

async function recomputeAutoReleases(office: string): Promise<void> {
  const closures = new Set((await query<{ date: string }>(`SELECT to_char(date,'YYYY-MM-DD') AS date FROM office_closures WHERE office = $1`, [office])).map((r) => r.date));
  const rows = await query<{ id: string; date: string }>(
    `SELECT o.id, to_char(o.date,'YYYY-MM-DD') AS date FROM options o JOIN talent t ON t.id = o.talent_id WHERE o.state IN ('placed','challenged') AND t.office = $1`,
    [office]
  );
  for (const row of rows) {
    const auto = autoReleaseInstant(row.date, office as Office, closures);
    await query(`UPDATE options SET auto_release_at = $2, release_at = CASE WHEN hold_until IS NOT NULL AND hold_until < $2 THEN hold_until ELSE $2 END WHERE id = $1`, [row.id, auto]);
  }
}


