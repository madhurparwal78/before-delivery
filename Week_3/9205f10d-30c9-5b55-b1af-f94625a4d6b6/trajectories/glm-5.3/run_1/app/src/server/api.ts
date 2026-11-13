import { Pool } from "pg";
import {
  agencyDateKey, cancellationCutoff, defaultTeamSize, derivedStatus, parseDollars,
  windowsOverlap, type CredentialCode, type RequestStatus, type Setting,
} from "../shared/domain.js";
import { ApiError, notFound } from "./errors.js";
import { Router, type Ctx } from "./http.js";
import { newId, verifyPassword } from "./crypto.js";
import { projectRequest, projectUser, instantIso } from "./projection.js";
import type { App, AuthedCtx } from "./requests.js";
import {
  canReadRequest, fmtAgencyDate, fmtAgencyTime, loadAllCredentials, loadHistory,
  loadRequest, loadSeats, projectForViewer, requestVisibleTo, searchMatch, validateRequestFields,
  viewerHoldsSeat,
} from "./requests.js";
import type { DbCredential, DbOrganisation, DbPerson, DbRequest, DbSeat } from "./db_types.js";
import type { SessionStore } from "./session.js";

const SETTING_WORDS: Record<Setting, string> = { medical: "Medical", education: "Education", legal: "Legal" };

export function buildRouter(app: App, sessions: SessionStore): Router {
  const router = new Router();
  const pool = app.pool;

  router.add("GET", "/api/health", async () => ({ status: 200, body: { status: "ok" } }));

  const sessionCookie = (token: string | null): string => {
    if (!token) return "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
    return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
  };

  function requireAuth(ctx: Ctx): Promise<AuthedCtx> {
    return (async () => {
      const token = readSessionToken(ctx);
      const person = await sessions.person(token);
      if (!person) throw new ApiError("unauthenticated", "Sign in to continue.");
      const organisation = await sessions.organisation(person);
      return { ...ctx, viewer: person, organisation, sessionToken: token };
    })();
  }

  function readSessionToken(ctx: Ctx): string | null {
    const header = ctx.req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === "session") return rest.join("=");
    }
    return null;
  }

  /* ------------------------------------------------------------ session */

  router.add("POST", "/api/session", async (ctx) => {
    const body = ctx.body as { email?: unknown; password?: unknown };
    if (typeof body?.email !== "string" || typeof body?.password !== "string") {
      throw new ApiError("invalid_credentials", "Email or password is incorrect.");
    }
    const { rows } = await pool.query<DbPerson>("SELECT * FROM person WHERE lower(email) = lower($1)", [body.email]);
    const person = rows[0];
    if (!person || !verifyPassword(body.password, person.password_hash)) {
      throw new ApiError("invalid_credentials", "Email or password is incorrect.");
    }
    const token = await sessions.create(person.id);
    const organisation = await sessions.organisation(person);
    return {
      status: 200,
      body: { user: projectUser(person, organisation) },
      headers: { "Set-Cookie": sessionCookie(token) },
    };
  });

  router.add("GET", "/api/me", async (ctx) => {
    const auth = await requireAuth(ctx);
    return { status: 200, body: { user: projectUser(auth.viewer, auth.organisation) } };
  });

  router.add("DELETE", "/api/session", async (ctx) => {
    const token = readSessionToken(ctx);
    if (!token) throw new ApiError("unauthenticated", "Sign in to continue.");
    await sessions.delete(token);
    return { status: 204, headers: { "Set-Cookie": sessionCookie(null) } };
  });

  /* ------------------------------------------------------------ requests */

  router.add("GET", "/api/requests", async (ctx) => {
    const auth = await requireAuth(ctx);
    const role = auth.viewer.role;
    if (role !== "coordinator" && role !== "billing_admin" && role !== "client_scheduler") {
      throw new ApiError("forbidden", "This account cannot list requests.");
    }
    const q = ctx.url.searchParams.get("q") ?? "";
    const statusParam = ctx.url.searchParams.get("status");
    const weekParam = ctx.url.searchParams.get("week");
    const statuses = statusParam ? statusParam.split(",").filter((s) => s.length > 0) : null;
    const { rows } = await pool.query<DbRequest & { org_name: string; org_code: string; hourly_rate_cents: number }>(
      `SELECT r.*, o.name AS org_name, o.code AS org_code, o.hourly_rate_cents
         FROM request r JOIN organisation o ON o.id = r.organisation_id
        ${role === "client_scheduler" ? "WHERE r.organisation_id = $1" : ""}
        ORDER BY r.starts_at, r.reference`,
      role === "client_scheduler" ? [auth.organisation?.id] : [],
    );
    const out = [];
    for (const r of rows) {
      const request = toDbRequest(r);
      if (!requestVisibleTo(auth.viewer, auth.organisation?.id ?? null, request)) continue;
      if (statuses && !statuses.includes(request.status)) continue;
      if (weekParam) {
        const mondayKey = weekMondayOf(weekParam);
        const parts = mondayKey.split("-").map((n) => Number(n));
        const weekStart = Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
        const weekEnd = weekStart + 7 * 86_400_000;
        const t = request.starts_at.getTime();
        if (t < weekStart || t >= weekEnd) continue;
      }
      const seats = await loadSeats(pool, request.id);
      const haystacks = [request.reference];
      haystacks.push(request.consumer_name);
      if (!searchMatch(haystacks, q)) continue;
      const org: DbOrganisation = { id: r.organisation_id, name: r.org_name, code: r.org_code, hourly_rate_cents: r.hourly_rate_cents };
      const history = role === "coordinator" || role === "billing_admin"
        ? await loadHistory(pool, request.id)
        : undefined;
      const credentials = await loadAllCredentials(pool);
      const allInterpreters = new Map<string, { credentials: CredentialCode[] }>();
      for (const { interpreter } of seats) {
        if (interpreter) allInterpreters.set(interpreter.id, { credentials: credentialBadgesOf(interpreter.id, credentials) });
      }
      out.push(projectRequestRow(app, auth, { request, organisation: org }, seats, allInterpreters, history));
    }
    return { status: 200, body: { requests: out } };
  });

  router.add("POST", "/api/requests", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "client_scheduler" || !auth.organisation) {
      throw new ApiError("forbidden", "Only a client scheduler can create requests.");
    }
    const checked = validateRequestFields(ctx.body as Record<string, unknown>, true);
    if (!checked.ok) throw new ApiError("validation", "Check the highlighted fields.", { fields: checked.fields });
    const v = checked.value;
    const id = newId("req");
    const reference = await nextReference(pool);
    const cutoff = cancellationCutoff(v.startsAt);
    await pool.query(
      `INSERT INTO request (id, reference, organisation_id, setting, required_credential, starts_at, duration_minutes,
         city, consumer_name, location_address, notes, status, team_size, rotation_minutes, free_cancel_until, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,20,$13,$14, now())`,
      [id, reference, auth.organisation.id, v.setting, v.credential, v.startsAt, v.duration,
        v.city, v.consumer, v.address, v.notes, defaultTeamSize(v.duration), cutoff, auth.viewer.id],
    );
    await pool.query(
      "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'created',$4)",
      [id, auth.viewer.id, auth.viewer.display_name, reference],
    );
    const row = await loadRequest(pool, id);
    if (!row) throw notFound();
    const seats = await loadSeats(pool, id);
    return { status: 201, body: await projectForViewer(app, auth, row, seats) };
  });

  router.add("GET", "/api/requests/:id", async (ctx) => {
    const auth = await requireAuth(ctx);
    const id = ctx.params["id"] ?? "";
    const row = await loadRequest(pool, id);
    if (!row) throw notFound();
    const seats = await loadSeats(pool, id);
    const holds = auth.viewer.role === "interpreter" ? await viewerHoldsSeat(pool, id, auth.viewer.id) : false;
    if (!canReadRequest(auth.viewer, auth.organisation?.id ?? null, row.request, holds)) throw notFound();
    return { status: 200, body: await projectForViewer(app, auth, row, seats) };
  });

  router.add("PATCH", "/api/requests/:id", async (ctx) => {
    const auth = await requireAuth(ctx);
    const id = ctx.params["id"] ?? "";
    if (auth.viewer.role !== "client_scheduler" || !auth.organisation) {
      throw new ApiError("forbidden", "Only the owning client scheduler can edit a request.");
    }
    const row = await loadRequest(pool, id);
    if (!row || row.request.organisation_id !== auth.organisation.id) throw notFound();
    if (row.request.status !== "draft") {
      throw new ApiError("invalid_transition", "Only a draft can be edited.");
    }
    const checked = validateRequestFields(ctx.body as Record<string, unknown>, false);
    if (!checked.ok) throw new ApiError("validation", "Check the highlighted fields.", { fields: checked.fields });
    const v = checked.value;
    const supplied = ctx.body as Record<string, unknown>;
    const merged = {
      setting: supplied["setting"] !== undefined ? v.setting : row.request.setting,
      startsAt: supplied["starts_at"] !== undefined ? v.startsAt : instantIso(row.request.starts_at),
      duration: supplied["duration_minutes"] !== undefined ? v.duration : row.request.duration_minutes,
      consumer: supplied["consumer_name"] !== undefined ? v.consumer : row.request.consumer_name,
      address: supplied["location_address"] !== undefined ? v.address : row.request.location_address,
      city: supplied["city"] !== undefined ? v.city : row.request.city,
      notes: supplied["notes"] !== undefined ? v.notes : row.request.notes,
      credential: supplied["required_credential"] !== undefined ? v.credential : row.request.required_credential,
    };
    const cutoff = cancellationCutoff(merged.startsAt);
    await pool.query(
      `UPDATE request SET setting=$2, required_credential=$3, starts_at=$4, duration_minutes=$5,
         consumer_name=$6, location_address=$7, city=$8, notes=$9, team_size=$10, free_cancel_until=$11
       WHERE id = $1`,
      [id, merged.setting, merged.credential, merged.startsAt, merged.duration, merged.consumer,
        merged.address, merged.city, merged.notes, defaultTeamSize(merged.duration), cutoff],
    );
    const fresh = await loadRequest(pool, id);
    if (!fresh) throw notFound();
    const seats = await loadSeats(pool, id);
    return { status: 200, body: await projectForViewer(app, auth, fresh, seats) };
  });

  router.add("POST", "/api/requests/:id/submit", async (ctx) => {
    const auth = await requireAuth(ctx);
    const id = ctx.params["id"] ?? "";
    if (auth.viewer.role !== "client_scheduler" || !auth.organisation) {
      throw new ApiError("forbidden", "Only the owning client scheduler can submit a request.");
    }
    const row = await loadRequest(pool, id);
    if (!row || row.request.organisation_id !== auth.organisation.id) throw notFound();
    if (row.request.status !== "draft") {
      throw new ApiError("invalid_transition", "Only a draft can be submitted.");
    }
    if (row.request.starts_at.getTime() <= Date.now()) {
      throw new ApiError("validation", "Check the highlighted fields.", { fields: { starts_at: "Enter a start time in the future." } });
    }
    await submitRequest(pool, row.request);
    await pool.query(
      "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'submitted','Seats opened')",
      [id, auth.viewer.id, auth.viewer.display_name],
    );
    const fresh = await loadRequest(pool, id);
    if (!fresh) throw notFound();
    const seats = await loadSeats(pool, id);
    return { status: 200, body: await projectForViewer(app, auth, fresh, seats) };
  });

  router.add("PATCH", "/api/requests/:id/staffing", async (ctx) => {
    const auth = await requireAuth(ctx);
    const id = ctx.params["id"] ?? "";
    if (auth.viewer.role !== "coordinator") {
      throw new ApiError("forbidden", "Only a coordinator can change staffing.");
    }
    const row = await loadRequest(pool, id);
    if (!row) throw notFound();
    const req = row.request;
    if (req.status !== "submitted" && req.status !== "half_staffed" && req.status !== "staffed") {
      throw new ApiError("invalid_transition", "This job can no longer be changed that way.");
    }
    const body = ctx.body as { team_size?: unknown; team_reason?: unknown; rotation_minutes?: unknown };
    const fields: Record<string, string> = {};
    let teamSize: 1 | 2 | null = null;
    if (body.team_size !== undefined) {
      if (body.team_size !== 1 && body.team_size !== 2) fields["team_size"] = "Team size must be 1 or 2.";
      else teamSize = body.team_size;
    }
    let rotation: number | null = null;
    if (body.rotation_minutes !== undefined) {
      if (typeof body.rotation_minutes !== "number" || !Number.isInteger(body.rotation_minutes) ||
          body.rotation_minutes < 20 || body.rotation_minutes > 30) {
        fields["rotation_minutes"] = "Rotation interval must be between 20 and 30 minutes.";
      } else {
        rotation = body.rotation_minutes;
      }
    }
    let reason: string | null = null;
    if (body.team_reason !== undefined) {
      if (typeof body.team_reason !== "string" || body.team_reason.length < 10 || body.team_reason.length > 500) {
        fields["team_reason"] = "Give a reason of 10 to 500 characters.";
      } else {
        reason = body.team_reason;
      }
    }
    const target = teamSize ?? req.team_size;
    if (target !== defaultTeamSize(req.duration_minutes) && target !== req.team_size) {
      if (typeof body.team_reason !== "string" || reason === null || reason === "") {
        fields["team_reason"] = "Give a reason of 10 to 500 characters.";
      }
    }
    if (Object.keys(fields).length > 0) {
      throw new ApiError("validation", "Check the highlighted fields.", { fields });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (teamSize !== null && teamSize !== req.team_size) {
        const seats = (await client.query<{ id: string; label: "A" | "B"; status: "open" | "confirmed" }>(
          "SELECT id, label, status FROM seat WHERE request_id = $1 ORDER BY label FOR UPDATE", [id],
        )).rows;
        const confirmed = seats.filter((s) => s.status === "confirmed");
        if (teamSize === 1 && seats.length === 2 && confirmed.length === 2) {
          throw new ApiError("invalid_transition", "Lowering to one seat would drop a confirmed interpreter.");
        }
        if (teamSize === 2 && seats.length === 1) {
          const label = seats[0]?.label === "A" ? "B" : "A";
          await client.query(
            "INSERT INTO seat (id, request_id, label, status) VALUES ($1,$2,$3,'open')",
            [newId("seat"), id, label],
          );
        }
        if (teamSize === 1 && seats.length === 2) {
          const openSeat = seats.find((s) => s.status === "open") ?? seats.find((s) => s.label === "B");
          if (openSeat) {
            await client.query("DELETE FROM seat WHERE id = $1", [openSeat.id]);
          }
        }
        await client.query("UPDATE request SET team_size = $2, team_reason = $3 WHERE id = $1", [id, teamSize, reason]);
        await client.query(
          "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'team_changed',$4)",
          [id, auth.viewer.id, auth.viewer.display_name, reason ?? ""],
        );
        const after = (await client.query("SELECT count(*)::int AS n FROM seat WHERE request_id = $1 AND status = 'confirmed'", [id])).rows[0]?.n ?? 0;
        const total = (await client.query("SELECT count(*)::int AS n FROM seat WHERE request_id = $1", [id])).rows[0]?.n ?? 0;
        await client.query("UPDATE request SET status = $2 WHERE id = $1", [id, derivedStatus(after, total)]);
      }
      if (rotation !== null && rotation !== req.rotation_minutes) {
        await client.query("UPDATE request SET rotation_minutes = $2 WHERE id = $1", [id, rotation]);
        await client.query(
          "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'rotation_changed',$4)",
          [id, auth.viewer.id, auth.viewer.display_name, `${rotation} minutes`],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    const fresh = await loadRequest(pool, id);
    if (!fresh) throw notFound();
    const seats = await loadSeats(pool, id);
    return { status: 200, body: await projectForViewer(app, auth, fresh, seats) };
  });

  router.add("POST", "/api/requests/:id/broadcast", async (ctx) => {
    const auth = await requireAuth(ctx);
    const id = ctx.params["id"] ?? "";
    if (auth.viewer.role !== "coordinator") {
      throw new ApiError("forbidden", "Only a coordinator can broadcast open seats.");
    }
    const row = await loadRequest(pool, id);
    if (!row) throw notFound();
    const req = row.request;
    if (req.status !== "submitted" && req.status !== "half_staffed") {
      throw new ApiError("invalid_transition", "This job can no longer be changed that way.");
    }
    const seats = await loadSeats(pool, id);
    const openLabels = seats.filter((s) => s.seat.status === "open").map((s) => s.seat.label);
    const people = (await pool.query<DbPerson>("SELECT * FROM person WHERE role = 'interpreter'")).rows;
    const credentials = await loadAllCredentials(pool);
    const assignments = await pool.query<{ request_id: string; starts_at: Date; duration_minutes: number }>(
      `SELECT r.id AS request_id, r.starts_at, r.duration_minutes
         FROM seat s JOIN request r ON r.id = s.request_id
        WHERE s.interpreter_id = $1 AND s.status = 'confirmed'
          AND r.status NOT IN ('cancelled_early','cancelled_late')`,
      [""],
    );
    void assignments;
    const busy = await interpreterBusyMap(pool);
    const dayKey = agencyDateKey(req.starts_at);
    const eligible: DbPerson[] = [];
    for (const p of people) {
      if (!hasValidCredential(p.id, req.required_credential, credentials, dayKey)) continue;
      if (overlapsAny(busy.get(p.id) ?? [], req)) continue;
      eligible.push(p);
    }
    const startEnd = [fmtAgencyTime(instantIso(req.starts_at)), fmtAgencyTime(instantIso(new Date(req.starts_at.getTime() + req.duration_minutes * 60_000)))];
    for (const p of eligible) {
      await app.mail.enqueue(
        p.email,
        `Open seat: ${SETTING_WORDS[req.setting]}, ${req.required_credential}, ${fmtAgencyDate(instantIso(req.starts_at))}, ${startEnd[0]} to ${startEnd[1]}, ${req.city}`,
        `${SETTING_WORDS[req.setting]} appointment on ${fmtAgencyDate(instantIso(req.starts_at))} from ${startEnd[0]} to ${startEnd[1]} in ${req.city}.\n` +
        `Required credential: ${req.required_credential}.\n` +
        `Open seats: ${openLabels.length}.\n` +
        `View and claim at ${app.config.publicUrl}/open-seats\n`,
      );
    }
    await pool.query(
      "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'broadcast',$4)",
      [id, auth.viewer.id, auth.viewer.display_name, `${eligible.length} eligible interpreters`],
    );
    return { status: 200, body: { emailed: eligible.length } };
  });

  router.add("GET", "/api/open-seats", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "interpreter") {
      throw new ApiError("forbidden", "This account cannot list open seats.");
    }
    const { rows } = await pool.query<DbRequest & { seat_id: string; seat_label: "A" | "B"; org_name: string; org_code: string; hourly_rate_cents: number }>(
      `SELECT r.*, s.id AS seat_id, s.label AS seat_label, o.name AS org_name, o.code AS org_code, o.hourly_rate_cents
         FROM seat s
         JOIN request r ON r.id = s.request_id
         JOIN organisation o ON o.id = r.organisation_id
        WHERE s.status = 'open' AND r.status IN ('submitted','half_staffed')
        ORDER BY r.starts_at, r.reference, s.label`,
    );
    const credentials = await loadAllCredentials(pool);
    const busy = await interpreterBusyMap(pool);
    const busyOwn = busy.get(auth.viewer.id) ?? [];
    const out = [];
    for (const r of rows) {
      const request = toDbRequest(r);
      const dayKey = agencyDateKey(request.starts_at);
      if (!hasValidCredential(auth.viewer.id, request.required_credential, credentials, dayKey)) continue;
      if (overlapsAny(busyOwn, request)) continue;
      const org: DbOrganisation = { id: r.organisation_id, name: r.org_name, code: r.org_code, hourly_rate_cents: r.hourly_rate_cents };
      const seats = await loadSeats(pool, request.id);
      const projected = await projectForViewer(app, auth, { request, organisation: org }, seats);
      out.push({ seat_id: r.seat_id, seat_label: r.seat_label, request: projected });
    }
    return { status: 200, body: { open_seats: out } };
  });

  router.add("POST", "/api/seats/:id/claim", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "interpreter") {
      throw new ApiError("forbidden", "Only an interpreter can claim a seat.");
    }
    const seatId = ctx.params["id"] ?? "";
    // API precedence step 3: a claim on a confirmed seat answers seat_taken before visibility checks
    const existing = await pool.query<{ request_id: string; status: string }>(
      "SELECT request_id, status FROM seat WHERE id = $1", [seatId],
    );
    const seatRow = existing.rows[0];
    if (seatRow && seatRow.status === "confirmed") {
      await pool.query(
        "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'claim_lost','seat_taken')",
        [seatRow.request_id, auth.viewer.id, auth.viewer.display_name],
      );
      throw new ApiError("seat_taken", "Another interpreter confirmed this seat first.");
    }
    if (!seatRow) throw notFound();
    const row = await loadRequest(pool, seatRow.request_id);
    if (!row) throw notFound();
    const req = row.request;
    const holds = await viewerHoldsSeat(pool, req.id, auth.viewer.id);
    if (!canReadRequest(auth.viewer, null, req, holds)) throw notFound();
    if (req.status !== "submitted" && req.status !== "half_staffed") {
      await recordClaimLost(pool, req.id, auth.viewer, "invalid_transition");
      throw new ApiError("invalid_transition", "This job is no longer taking claims.");
    }
    const credentials = await loadAllCredentials(pool);
    const dayKey = agencyDateKey(req.starts_at);
    if (!hasValidCredential(auth.viewer.id, req.required_credential, credentials, dayKey)) {
      await recordClaimLost(pool, req.id, auth.viewer, "credential_invalid");
      throw new ApiError("credential_invalid", "Your credential isn't verified through this job's date.");
    }
    const busy = await interpreterBusyMap(pool, auth.viewer.id);
    if (overlapsAny(busy.get(auth.viewer.id) ?? [], req)) {
      await recordClaimLost(pool, req.id, auth.viewer, "schedule_conflict");
      throw new ApiError("schedule_conflict", "You already hold a seat that overlaps this job.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<{ id: string }>(
        "UPDATE seat SET status = 'confirmed', interpreter_id = $2, confirmed_at = now() WHERE id = $1 AND status = 'open' RETURNING id",
        [seatId, auth.viewer.id],
      );
      if (claimed.rowCount === 0) {
        await client.query("ROLLBACK");
        await recordClaimLost(pool, req.id, auth.viewer, "seat_taken");
        throw new ApiError("seat_taken", "Another interpreter confirmed this seat first.");
      }
      const confirmedCount = (await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM seat WHERE request_id = $1 AND status = 'confirmed'", [req.id],
      )).rows[0]?.n ?? 0;
      const totalCount = (await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM seat WHERE request_id = $1", [req.id],
      )).rows[0]?.n ?? 0;
      const newStatus = derivedStatus(confirmedCount, totalCount) as RequestStatus;
      await client.query("UPDATE request SET status = $2 WHERE id = $1", [req.id, newStatus]);
      await client.query(
        "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'claim_won',$4)",
        [req.id, auth.viewer.id, auth.viewer.display_name, "Seat claimed"],
      );
      await client.query("COMMIT");
      const seats = await loadSeats(pool, req.id);
      const other = seats.find((s) => s.seat.id !== seatId && s.seat.status === "confirmed");
      const claimedSeat = seats.find((s) => s.seat.id === seatId);
      const label = claimedSeat?.seat.label ?? "A";
      const window = `${fmtAgencyTime(instantIso(req.starts_at))} to ${fmtAgencyTime(instantIso(new Date(req.starts_at.getTime() + req.duration_minutes * 60_000)))}`;
      await app.mail.enqueue(
        auth.viewer.email,
        `Seat ${label} confirmed: ${req.reference}, ${fmtAgencyDate(instantIso(req.starts_at))}`,
        `Your seat ${label} on ${req.reference} is confirmed for ${fmtAgencyDate(instantIso(req.starts_at))}, ${window}, in ${req.city}.\n` +
        (other?.interpreter ? `You are teaming with ${other.interpreter.display_name}.\n` : `Seat ${label === "A" ? "B" : "A"} is still open.\n`),
      );
      if (other?.interpreter) {
        await app.mail.enqueue(
          other.interpreter.email,
          `Seat ${label} confirmed: ${req.reference}, ${fmtAgencyDate(instantIso(req.starts_at))}`,
          `Your teammate on ${req.reference} is ${auth.viewer.display_name}. The job runs ${window} in ${req.city}.\n`,
        );
      }
      if (newStatus === "staffed") {
        const scheduler = (await pool.query<DbPerson>(
          "SELECT * FROM person WHERE organisation_id = $1 AND role = 'client_scheduler'", [req.organisation_id],
        )).rows[0];
        if (scheduler) {
          const badges = seats.map((s) => s.interpreter ? `${s.interpreter.display_name} (${credentialBadgesOf(s.interpreter.id, credentials).join(", ")})` : "").filter(Boolean).join(", ");
          await app.mail.enqueue(
            scheduler.email,
            `Fully staffed: ${req.reference}, ${fmtAgencyDate(instantIso(req.starts_at))}`,
            `${req.reference} is fully staffed with ${badges}.\n`,
          );
        }
      }
      const fresh = await loadRequest(pool, req.id);
      if (!fresh) throw notFound();
      const seatsAfter = await loadSeats(pool, req.id);
      const projected = await projectForViewer(app, auth, fresh, seatsAfter);
      return { status: 200, body: { seat: projected.seats.find((s) => s.id === seatId) ?? null, request: projected } };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  router.add("GET", "/api/assignments", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "interpreter") {
      throw new ApiError("forbidden", "This account cannot list assignments.");
    }
    const { rows } = await pool.query<DbRequest & { seat_id: string; seat_label: "A" | "B"; org_name: string; org_code: string; hourly_rate_cents: number }>(
      `SELECT r.*, s.id AS seat_id, s.label AS seat_label, o.name AS org_name, o.code AS org_code, o.hourly_rate_cents
         FROM seat s
         JOIN request r ON r.id = s.request_id
         JOIN organisation o ON o.id = r.organisation_id
        WHERE s.interpreter_id = $1 AND s.status = 'confirmed'
        ORDER BY r.starts_at, r.reference`,
      [auth.viewer.id],
    );
    const out = [];
    for (const r of rows) {
      const request = toDbRequest(r);
      const org: DbOrganisation = { id: r.organisation_id, name: r.org_name, code: r.org_code, hourly_rate_cents: r.hourly_rate_cents };
      const seats = await loadSeats(pool, request.id);
      const projected = await projectForViewer(app, auth, { request, organisation: org }, seats);
      out.push({ seat_id: r.seat_id, seat_label: r.seat_label, request: projected });
    }
    return { status: 200, body: { assignments: out } };
  });

  router.add("POST", "/api/requests/:id/complete", async (ctx) => {
    const auth = await requireAuth(ctx);
    const id = ctx.params["id"] ?? "";
    if (auth.viewer.role !== "coordinator") {
      throw new ApiError("forbidden", "Only a coordinator can mark a job completed.");
    }
    const row = await loadRequest(pool, id);
    if (!row) throw notFound();
    if (row.request.status !== "half_staffed" && row.request.status !== "staffed") {
      throw new ApiError("invalid_transition", "Only a half-staffed or staffed job can be completed.");
    }
    const body = ctx.body as { actual_minutes?: unknown };
    const minutes = body?.actual_minutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
      throw new ApiError("validation", "Check the highlighted fields.", {
        fields: { actual_minutes: "Actual minutes must be a whole number from 1 to 720." },
      });
    }
    await pool.query("UPDATE request SET status = 'completed', actual_minutes = $2 WHERE id = $1", [id, minutes]);
    await pool.query(
      "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'completed',$4)",
      [id, auth.viewer.id, auth.viewer.display_name, `${minutes} minutes`],
    );
    const fresh = await loadRequest(pool, id);
    if (!fresh) throw notFound();
    const seats = await loadSeats(pool, id);
    return { status: 200, body: await projectForViewer(app, auth, fresh, seats) };
  });

  return router;
}

/* -------------------------------------------------------------- helpers */

function weekMondayOf(dayKey: string): string {
  const parts = dayKey.split("-").map((n) => Number(n));
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const utc = Date.UTC(y, m - 1, d) + 12 * 3600_000;
  const wd = new Date(utc).getUTCDay();
  const back = wd === 0 ? 6 : wd - 1;
  const monday = new Date(utc - back * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(monday.getTime() + 12 * 3600_000));
}

/** Interpreter id -> alphabetical badge list used when projecting seats. */
function credentialBadgesOf(id: string, credentials: DbCredential[]): CredentialCode[] {
  const today = agencyDateKey(new Date());
  const set = new Set<CredentialCode>();
  for (const c of credentials) {
    if (c.interpreter_id !== id || c.status !== "verified" || !c.expires_on) continue;
    if (c.expires_on.toISOString().slice(0, 10) >= today) set.add(c.credential_type);
  }
  return [...set].sort();
}

function projectRequestRow(
  app: App,
  auth: AuthedCtx,
  row: { request: DbRequest; organisation: DbOrganisation },
  seats: Array<{ seat: DbSeat; interpreter: DbPerson | null }>,
  allInterpreters: Map<string, { credentials: CredentialCode[] }>,
  history: Array<{ at: string; actor: string; action: string; detail: string }> | undefined,
): unknown {
  const viewer = {
    person: auth.viewer,
    organisation: auth.organisation,
    holdsSeatOn: auth.viewer.role === "interpreter" && seats.some((s) => s.seat.interpreter_id === auth.viewer.id && s.seat.status === "confirmed"),
    allInterpreters,
    history,
  };
  return projectRequestRowInner(row.request, row.organisation, seats, viewer);
}

import { projectRequest as projectRequestRowInner } from "./projection.js";

export function toDbRequest(r: DbRequest & Record<string, unknown>): DbRequest {
  return {
    id: r.id,
    reference: r.reference,
    organisation_id: r.organisation_id,
    setting: r.setting,
    required_credential: r.required_credential,
    starts_at: r.starts_at,
    duration_minutes: r.duration_minutes,
    city: r.city,
    consumer_name: r.consumer_name,
    location_address: r.location_address,
    notes: r.notes,
    status: r.status,
    team_size: r.team_size,
    team_reason: r.team_reason,
    rotation_minutes: r.rotation_minutes,
    actual_minutes: r.actual_minutes,
    free_cancel_until: r.free_cancel_until,
    created_by: r.created_by,
    created_at: r.created_at,
  };
}

async function nextReference(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ max: string | null }>(
    "SELECT max((regexp_match(reference, '^CR-([0-9]+)$'))[1]) AS max FROM request",
  );
  const current = Number(rows[0]?.max ?? "1000");
  return `CR-${current + 1}`;
}

async function submitRequest(pool: Pool, req: DbRequest): Promise<void> {
  const size = defaultTeamSize(req.duration_minutes);
  const labels: Array<"A" | "B"> = size === 2 ? ["A", "B"] : ["A"];
  for (const label of labels) {
    await pool.query(
      "INSERT INTO seat (id, request_id, label, status) VALUES ($1,$2,$3,'open') ON CONFLICT DO NOTHING",
      [newId("seat"), req.id, label],
    );
  }
  await pool.query("UPDATE request SET status = 'submitted', team_size = $2 WHERE id = $1", [req.id, size]);
}

async function recordClaimLost(pool: Pool, requestId: string, viewer: DbPerson, code: string): Promise<void> {
  await pool.query(
    "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'claim_lost',$4)",
    [requestId, viewer.id, viewer.display_name, code],
  );
}

/** Interpreter id -> list of confirmed, non-cancelled time windows. */
async function interpreterBusyMap(pool: Pool, only?: string): Promise<Map<string, DbRequest[]>> {
  const { rows } = await pool.query<DbRequest & { interpreter_id: string }>(
    `SELECT r.*, s.interpreter_id
       FROM seat s JOIN request r ON r.id = s.request_id
      WHERE s.status = 'confirmed'
        AND r.status NOT IN ('cancelled_early','cancelled_late')
        ${only ? "AND s.interpreter_id = $1" : ""}`,
    only ? [only] : [],
  );
  const map = new Map<string, DbRequest[]>();
  for (const r of rows) {
    const list = map.get(r.interpreter_id) ?? [];
    list.push(toDbRequest(r));
    map.set(r.interpreter_id, list);
  }
  return map;
}

function overlapsAny(busy: DbRequest[], req: DbRequest): boolean {
  const start = req.starts_at.getTime();
  const end = start + req.duration_minutes * 60_000;
  return busy.some((b) => {
    if (b.id === req.id) return true;
    const bStart = b.starts_at.getTime();
    const bEnd = bStart + b.duration_minutes * 60_000;
    return windowsOverlap(new Date(start), new Date(end), new Date(bStart), new Date(bEnd));
  });
}

/** Eligibility: a verified credential of the required code, unexpired on the job's date. */
function hasValidCredential(interpreterId: string, code: CredentialCode, credentials: DbCredential[], dayKey: string): boolean {
  return credentials.some((c) =>
    c.interpreter_id === interpreterId &&
    c.credential_type === code &&
    c.status === "verified" &&
    c.expires_on !== null &&
    c.expires_on.toISOString().slice(0, 10) >= dayKey,
  );
}

export { hasValidCredential, interpreterBusyMap, overlapsAny, nextReference, recordClaimLost, submitRequest };
