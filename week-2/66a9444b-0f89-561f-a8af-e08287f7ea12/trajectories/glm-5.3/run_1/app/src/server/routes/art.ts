import { randomUUID } from "node:crypto";
import { sniffImageType, decodeImage, resizeLongest, encodeJpeg } from "../services/image.js";
import type { Route, Ctx } from "../http.js";
import { query, withTransaction, type Row } from "../db.js";
import { errors, validationError } from "../errors.js";
import { parseWall, utcIso, festivalDayOf, wallString } from "../../shared/time.js";
import { sessionFromRow } from "../services/seats.js";
import { entryJson, sessionJson } from "../services/shapes.js";
import { isLegalMove, moveRequiresPublishAt, recordHistory, illegalTransition, editableIn } from "../services/state.js";
import { refundLines } from "../services/refunds.js";
import { validFileName } from "./checkout.js";


async function loadEntry(ctx: Ctx, id: string): Promise<Row> {
  const res = await query("select * from entries where id = $1", [id]);
  const row = res.rows[0];
  if (!row) throw errors.notFound();
  const isArtist = ctx.user?.role === "artist" && Number(row.artist_id) === ctx.user.id;
  const isCurator = ctx.user?.role === "curator";
  if (!isArtist && !isCurator) throw errors.notFound();
  return row;
}

function displayKey(entryId: string, imageId: string): string {
  return `artworks/display/${entryId}/${imageId}.jpg`;
}

function originalKey(entryId: string, imageId: string): string {
  return `artworks/originals/${entryId}/${imageId}`;
}

export function artRoutes(): Route[] {
  // Artists see their own entries; curators see every entry.
  const listEntries: Route = {
    method: "GET",
    pattern: "/api/entries",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const user = ctx.user!;
      let rows: Row[];
      if (user.role === "curator") {
        rows = (await query("select * from entries order by id")).rows;
      } else if (user.role === "artist") {
        rows = (await query("select * from entries where artist_id = $1 order by id", [user.id])).rows;
      } else {
        throw errors.forbidden();
      }
      const entries = [];
      for (const row of rows) entries.push(await entryJson(row));
      return { status: 200, body: { entries } };
    },
  };

  const createEntry: Route = {
    method: "POST",
    pattern: "/api/entries",
    roles: "artist",
    bodyLimit: "json",
    async handler(ctx) {
      if (ctx.user!.role !== "artist") throw errors.forbidden();
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const problems = entryFieldErrors(body);
      if (Object.keys(problems).length > 0) throw validationError(problems);
      const id = `e-${randomUUID().slice(0, 8)}`;
      await withTransaction(async (client) => {
        await client.query(
          `insert into entries (id, artist_id, title, statement, discipline, medium, year, status, version)
           values ($1,$2,$3,$4,$5,$6,$7,'draft',1)`,
          [id, ctx.user!.id, String(body.title), String(body.statement ?? ""), String(body.discipline), String(body.medium ?? ""), String(body.year ?? "")],
        );
        await recordHistory(client, "entry", id, "none", "draft", ctx.user!.email, null);
      });
      const row = (await query("select * from entries where id = $1", [id])).rows[0];
      return { status: 201, body: await entryJson(row) };
    },
  };

  const entryDetail: Route = {
    method: "GET",
    pattern: "/api/entries/:id",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const row = await loadEntry(ctx, ctx.params.id);
      return { status: 200, body: await entryJson(row) };
    },
  };

  const updateEntry: Route = {
    method: "PATCH",
    pattern: "/api/entries/:id",
    roles: "signed_in",
    bodyLimit: "json",
    async handler(ctx) {
      const user = ctx.user!;
      const res = await query("select * from entries where id = $1", [ctx.params.id]);
      const row = res.rows[0];
      if (!row || Number(row.artist_id) !== user.id) throw errors.notFound();
      if (String(row.status) !== "draft") throw errors.conflict("not_editable");
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(body)) {
        if (["title", "statement", "discipline", "medium", "year"].includes(key)) fields[key] = String(value);
      }
      const merged = { ...row, ...fields } as Record<string, unknown>;
      const problems = entryFieldErrors(merged);
      if (Object.keys(problems).length > 0) throw validationError(problems);
      await withTransaction(async (client) => {
        await client.query(
          `update entries set title = $2, statement = $3, discipline = $4, medium = $5, year = $6, version = version + 1
           where id = $1`,
          [ctx.params.id, String(merged.title), String(merged.statement ?? ""), String(merged.discipline), String(merged.medium ?? ""), String(merged.year ?? "")],
        );
      });
      const updated = (await query("select * from entries where id = $1", [ctx.params.id])).rows[0];
      return { status: 200, body: await entryJson(updated) };
    },
  };

  const uploadImage: Route = {
    method: "POST",
    pattern: "/api/entries/:id/images",
    roles: "signed_in",
    bodyLimit: "artwork",
    async handler(ctx) {
      const user = ctx.user!;
      const res = await query("select * from entries where id = $1", [ctx.params.id]);
      const row = res.rows[0];
      if (!row || Number(row.artist_id) !== user.id) throw errors.notFound();
      if (String(row.status) !== "draft") throw errors.conflict("not_editable");
      const file = ctx.files.get("file");
      if (!file || file.bytes.length === 0) throw validationError({ file: file ? "empty" : "required" });
      if (!validFileName(file.filename)) throw validationError({ file: "invalid_name" });
      const sniffed = sniffImageType(file.bytes);
      if (sniffed === null) throw validationError({ file: "unsupported_type" });
      let width = 0;
      let height = 0;
      let display: Buffer;
      try {
        const decoded = await decodeImage(sniffed, file.bytes);
        width = decoded.width;
        height = decoded.height;
        if (width <= 0 || height <= 0) throw new Error("undecodable");
        display = encodeJpeg(resizeLongest(decoded, 1200));
      } catch {
        throw validationError({ file: "unsupported_type" });
      }
      const imageId = randomUUID();
      const entryId = ctx.params.id;
      try {
        await ctx.app.s3.put(originalKey(entryId, imageId), file.bytes, sniffed);
        await ctx.app.s3.put(displayKey(entryId, imageId), display, "image/jpeg");
      } catch {
        throw errors.storageUnavailable();
      }
      await withTransaction(async (client) => {
        await client.query(
          "insert into entry_images (id, entry_id, width, height) values ($1,$2,$3,$4)",
          [imageId, entryId, width, height],
        );
      });
      return {
        status: 201,
        body: { image: { id: imageId, width, height, display_url: null } },
      };
    },
  };

  const readImage: Route = {
    method: "POST",
    pattern: "/api/entries/:id/images/:imageId/read",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      await loadEntry(ctx, ctx.params.id);
      const imageRes = await query("select * from entry_images where id = $1 and entry_id = $2", [ctx.params.imageId, ctx.params.id]);
      if (imageRes.rows.length === 0) throw errors.notFound();
      const expiresAt = new Date(Date.now() + ctx.app.config.signedReadSeconds * 1000);
      const token = ctx.app.signFileToken(originalKey(ctx.params.id, ctx.params.imageId), expiresAt);
      return { status: 200, body: { url: `/api/files/${token}`, expires_at: utcIso(expiresAt) } };
    },
  };

  const entryTransition: Route = {
    method: "POST",
    pattern: "/api/entries/:id/transitions",
    roles: "signed_in",
    bodyLimit: "json",
    async handler(ctx) {
      const user = ctx.user!;
      const res = await query("select * from entries where id = $1", [ctx.params.id]);
      const row = res.rows[0];
      if (!row) throw errors.notFound();
      const isArtist = user.role === "artist" && Number(row.artist_id) === user.id;
      const isCurator = user.role === "curator";
      if (!isArtist && !isCurator) throw errors.notFound();
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const to = String(body.to ?? "");
      const from = String(row.status);
      if (!isLegalMove(from, to)) illegalTransition(from, to);

      const imagesRes = await query("select 1 from entry_images where entry_id = $1 limit 1", [ctx.params.id]);
      if (to === "review" && from === "draft" && imagesRes.rows.length === 0) {
        throw validationError({ images: "required" });
      }
      if (from === "draft" && to === "review" && isArtist) {
        await withTransaction(async (client) => {
          await client.query("update entries set status = 'review' where id = $1", [ctx.params.id]);
          await recordHistory(client, "entry", ctx.params.id, from, to, user.email, null);
          await client.query(
            "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'entry_submitted','entry',$3)",
            [user.email, user.role, ctx.params.id],
          );
        });
      } else {
        if (!isCurator) throw errors.forbidden();
        if (moveRequiresPublishAt(from, to)) {
          const parsed = parseWall(body.publish_at as string | undefined);
          if (typeof body.publish_at !== "string" || !parsed.ok) {
            throw validationError({ publish_at: parsed.ok ? "required" : parsed.code });
          }
          if (parsed.at.getTime() <= Date.now()) throw validationError({ publish_at: "not_in_future" });
          await withTransaction(async (client) => {
            await client.query("update entries set status = 'scheduled', publish_at = $2 where id = $1", [ctx.params.id, parsed.at]);
            await recordHistory(client, "entry", ctx.params.id, from, to, user.email, null);
            await client.query(
              "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'entry_scheduled','entry',$3)",
              [user.email, user.role, ctx.params.id],
            );
          });
        } else {
          await withTransaction(async (client) => {
            await client.query("update entries set status = $2 where id = $1", [ctx.params.id, to]);
            await recordHistory(client, "entry", ctx.params.id, from, to, user.email, typeof body.note === "string" ? body.note : null);
            await client.query(
              "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'entry_transition','entry',$3)",
              [user.email, user.role, ctx.params.id],
            );
          });
        }
      }
      const updated = (await query("select * from entries where id = $1", [ctx.params.id])).rows[0];
      const history = await getHistoryInTx(ctx.params.id);
      return { status: 200, body: { entry: await entryJson(updated), history } };
    },
  };

  // Curation of sessions.
  const curateSessions: Route = {
    method: "GET",
    pattern: "/api/curate/sessions",
    roles: "curator",
    bodyLimit: "none",
    async handler(ctx) {
      const status = ctx.query.get("status");
      const res = await query(
        status ? "select * from sessions where status = $1 order by starts_at" : "select * from sessions order by starts_at",
        status ? [status] : [],
      );
      const sessions = [];
      for (const row of res.rows) {
        sessions.push(await sessionJson(sessionFromRow(row), { full: true, seats: true }));
      }
      return { status: 200, body: { sessions } };
    },
  };

  const createSession: Route = {
    method: "POST",
    pattern: "/api/sessions",
    roles: "curator",
    bodyLimit: "json",
    async handler(ctx) {
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const parsedStart = parseWall(body.starts_local as string | undefined);
      const parsedEnd = parseWall(body.ends_local as string | undefined);
      const problems: Record<string, string> = {};
      const fields = sessionFieldErrors(body);
      Object.assign(problems, fields);
      if (!parsedStart.ok) problems.starts_local = body.starts_local ? parsedStart.code : "invalid";
      if (!parsedEnd.ok) problems.ends_local = body.ends_local ? parsedEnd.code : "invalid";
      if (parsedStart.ok && parsedEnd.ok && parsedEnd.at.getTime() <= parsedStart.at.getTime()) {
        problems.ends_local = "ends_before_start";
      }
      const admission = String(body.admission ?? "");
      const capacity = body.capacity === null || body.capacity === undefined ? null : Number(body.capacity);
      const priceFull = body.price_full_cents === null || body.price_full_cents === undefined ? null : Number(body.price_full_cents);
      const priceReduced = body.price_reduced_cents === null || body.price_reduced_cents === undefined ? null : Number(body.price_reduced_cents);
      if (admission === "seat") {
        if (capacity === null) problems.capacity = "required";
        else if (capacity < 1 || capacity > 500) problems.capacity = "out_of_range";
        if (priceFull === null || priceReduced === null) {
          problems.price_full_cents = "required";
          problems.price_reduced_cents = "required";
        }
      }
      if (parsedStart.ok) {
        const edition = (await query("select * from edition where id = 1")).rows[0];
        const day = festivalDayOf(parsedStart.at);
        if (day < String(edition.first_day) || day > String(edition.last_day)) {
          problems.starts_local = "outside_edition";
        }
      }
      if (Object.keys(problems).length > 0) throw validationError(problems);
      const startAt = parsedStart.ok ? parsedStart.at : null;
      const endAt = parsedEnd.ok ? parsedEnd.at : null;
      if (!startAt || !endAt) throw validationError({ starts_local: "invalid" });

      const id = `s-${randomUUID().slice(0, 8)}`;
      await withTransaction(async (client) => {
        await client.query(
          `insert into sessions (id, title, description, discipline, venue_id, admission, capacity,
             price_full_cents, price_reduced_cents, starts_at, ends_at, festival_day, status, version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',1)`,
          [
            id,
            String(body.title),
            String(body.description ?? ""),
            String(body.discipline),
            String(body.venue_id),
            admission,
            admission === "seat" ? capacity : null,
            admission === "seat" ? priceFull : null,
            admission === "seat" ? priceReduced : null,
            startAt,
            endAt,
            festivalDayOf(startAt),
          ],
        );
        await recordHistory(client, "session", id, "none", "draft", ctx.user!.email, null);
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'session_created','session',$3)",
          [ctx.user!.email, ctx.user!.role, id],
        );
      });
      const row = (await query("select * from sessions where id = $1", [id])).rows[0];
      return { status: 201, body: await sessionJson(sessionFromRow(row), { full: true }) };
    },
  };

  const updateSession: Route = {
    method: "PATCH",
    pattern: "/api/sessions/:id",
    roles: "curator",
    bodyLimit: "json",
    async handler(ctx) {
      const res = await query("select * from sessions where id = $1", [ctx.params.id]);
      const row = res.rows[0];
      if (!row) throw errors.notFound();
      if (!editableIn(String(row.status))) throw errors.conflict("not_editable");
      const ifMatch = ctx.req.headers["if-match"];
      if (ifMatch === undefined) throw errors.versionRequired();
      const version = Number(ifMatch);
      if (version !== Number(row.version)) throw errors.staleVersion(Number(row.version));

      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = {
        title: row.title,
        description: row.description,
        discipline: row.discipline,
        venue_id: row.venue_id,
        admission: row.admission,
        capacity: row.capacity,
        price_full_cents: row.price_full_cents,
        price_reduced_cents: row.price_reduced_cents,
        starts_local: bodyToWall(new Date(String(row.starts_at))),
        ends_local: bodyToWall(new Date(String(row.ends_at))),
      };
      for (const key of ["title", "description", "discipline", "venue_id", "admission"]) {
        if (body[key] !== undefined) merged[key] = String(body[key]);
      }
      for (const key of ["capacity", "price_full_cents", "price_reduced_cents"]) {
        if (body[key] !== undefined) merged[key] = body[key] === null ? null : Number(body[key]);
      }
      if (body.starts_local !== undefined) merged.starts_local = String(body.starts_local);
      if (body.ends_local !== undefined) merged.ends_local = String(body.ends_local);

      const parsedStart = parseWall(merged.starts_local as string);
      const parsedEnd = parseWall(merged.ends_local as string);
      const problems: Record<string, string> = sessionFieldErrors(merged);
      if (!parsedStart.ok) problems.starts_local = parsedStart.code;
      if (!parsedEnd.ok) problems.ends_local = parsedEnd.code;
      if (parsedStart.ok && parsedEnd.ok && parsedEnd.at.getTime() <= parsedStart.at.getTime()) {
        problems.ends_local = "ends_before_start";
      }
      const admission = String(merged.admission);
      const capacity = merged.capacity === null || merged.capacity === undefined ? null : Number(merged.capacity);
      if (admission === "seat") {
        if (capacity === null) problems.capacity = "required";
        else if (capacity < 1 || capacity > 500) problems.capacity = "out_of_range";
        if (merged.price_full_cents === null || merged.price_reduced_cents === null) {
          problems.price_full_cents = "required";
          problems.price_reduced_cents = "required";
        }
      }
      if (parsedStart.ok) {
        const edition = (await query("select * from edition where id = 1")).rows[0];
        const day = festivalDayOf(parsedStart.at);
        if (day < String(edition.first_day) || day > String(edition.last_day)) {
          problems.starts_local = "outside_edition";
        }
      }
      if (Object.keys(problems).length > 0) throw validationError(problems);
      const startAt = parsedStart.ok ? parsedStart.at : null;
      const endAt = parsedEnd.ok ? parsedEnd.at : null;
      if (!startAt || !endAt) throw validationError({ starts_local: "invalid" });

      await withTransaction(async (client) => {
        await client.query(
          `update sessions set title=$2, description=$3, discipline=$4, venue_id=$5, admission=$6, capacity=$7,
             price_full_cents=$8, price_reduced_cents=$9, starts_at=$10, ends_at=$11, festival_day=$12, version = version + 1
           where id = $1`,
          [
            ctx.params.id,
            String(merged.title),
            String(merged.description ?? ""),
            String(merged.discipline),
            String(merged.venue_id),
            admission,
            admission === "seat" ? capacity : null,
            admission === "seat" ? Number(merged.price_full_cents) : null,
            admission === "seat" ? Number(merged.price_reduced_cents) : null,
            startAt,
            endAt,
            festivalDayOf(startAt),
          ],
        );
        await client.query(
          "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'session_updated','session',$3)",
          [ctx.user!.email, ctx.user!.role, ctx.params.id],
        );
      });
      const updated = (await query("select * from sessions where id = $1", [ctx.params.id])).rows[0];
      return { status: 200, body: await sessionJson(sessionFromRow(updated), { full: true }) };
    },
  };

  const sessionTransition: Route = {
    method: "POST",
    pattern: "/api/sessions/:id/transitions",
    roles: "curator",
    bodyLimit: "json",
    async handler(ctx) {
      const res = await query("select * from sessions where id = $1", [ctx.params.id]);
      const row = res.rows[0];
      if (!row) throw errors.notFound();
      const from = String(row.status);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const to = String(body.to ?? "");
      if (!isLegalMove(from, to)) illegalTransition(from, to);

      let refundsStarted = 0;
      if (moveRequiresPublishAt(from, to)) {
        const parsed = parseWall(body.publish_at as string | undefined);
        if (typeof body.publish_at !== "string" || !parsed.ok) {
          throw validationError({ publish_at: parsed.ok ? "required" : parsed.code });
        }
        if (parsed.at.getTime() <= Date.now()) throw validationError({ publish_at: "not_in_future" });
        await withTransaction(async (client) => {
          await client.query("update sessions set status = 'scheduled', publish_at = $2 where id = $1", [ctx.params.id, parsed.at]);
          await recordHistory(client, "session", ctx.params.id, from, to, ctx.user!.email, null);
          await client.query(
            "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'session_scheduled','session',$3)",
            [ctx.user!.email, ctx.user!.role, ctx.params.id],
          );
        });
      } else if (to === "cancelled") {
        refundsStarted = await cancelSession(ctx, ctx.params.id, from);
      } else {
        await withTransaction(async (client) => {
          await client.query("update sessions set status = $2 where id = $1", [ctx.params.id, to]);
          await recordHistory(client, "session", ctx.params.id, from, to, ctx.user!.email, typeof body.note === "string" ? body.note : null);
          await client.query(
            "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'session_transition','session',$3)",
            [ctx.user!.email, ctx.user!.role, ctx.params.id],
          );
        });
      }
      const updated = (await query("select * from sessions where id = $1", [ctx.params.id])).rows[0];
      const history = await getHistoryInTx(ctx.params.id, "session");
      return { status: 200, body: { session: await sessionJson(sessionFromRow(updated), { full: true }), history, refunds_started: refundsStarted } };
    },
  };

  const sessionHistory: Route = {
    method: "GET",
    pattern: "/api/sessions/:id/history",
    roles: "curator",
    bodyLimit: "none",
    async handler(ctx) {
      const res = await query("select 1 from sessions where id = $1", [ctx.params.id]);
      if (res.rows.length === 0) throw errors.notFound();
      const history = await getHistoryInTx(ctx.params.id, "session");
      return { status: 200, body: { history } };
    },
  };

  return [
    listEntries,
    createEntry,
    entryDetail,
    updateEntry,
    uploadImage,
    readImage,
    entryTransition,
    curateSessions,
    createSession,
    updateSession,
    sessionTransition,
    sessionHistory,
  ];
}

function bodyToWall(at: Date): string {
  return wallString(at);
}

function entryFieldErrors(body: Record<string, unknown>): Record<string, string> {
  const problems: Record<string, string> = {};
  const title = String(body.title ?? "").trim();
  if (title.length === 0 || title.length > 200) problems.title = "invalid";
  const statement = String(body.statement ?? "");
  if (statement.length > 2000) problems.statement = "invalid";
  const discipline = String(body.discipline ?? "");
  if (discipline.length === 0) problems.discipline = "invalid";
  return problems;
}

function sessionFieldErrors(body: Record<string, unknown>): Record<string, string> {
  const problems: Record<string, string> = {};
  const title = String(body.title ?? "").trim();
  if (title.length === 0 || title.length > 200) problems.title = "invalid";
  const discipline = String(body.discipline ?? "");
  if (discipline.length === 0) problems.discipline = "invalid";
  const venueId = String(body.venue_id ?? "");
  if (venueId.length === 0) problems.venue_id = "invalid";
  const admission = String(body.admission ?? "");
  if (admission !== "pass" && admission !== "seat") problems.admission = "invalid";
  return problems;
}

// Cancelling a session refunds every line for that session on every order.
async function cancelSession(ctx: Ctx, sessionId: string, from: string): Promise<number> {
  return withTransaction(async (client) => {
    await client.query("update sessions set status = 'cancelled', version = version + 1 where id = $1", [sessionId]);
    await recordHistory(client, "session", sessionId, from, "cancelled", ctx.user!.email, null);
    await client.query(
      "insert into audit (actor, actor_role, action, target_type, target_id) values ($1,$2,'session_cancelled','session',$3)",
      [ctx.user!.email, ctx.user!.role, sessionId],
    );
    // Holds are released and the waitlist closes without mail.
    await client.query("update holds set status = 'released' where session_id = $1 and status = 'active'", [sessionId]);
    await client.query("update waitlist_entries set status = 'closed' where session_id = $1 and status in ('waiting','offered')", [sessionId]);
    const ordersRes = await client.query(
      `select distinct o.* from orders o join lines l on l.order_id = o.id
       where l.session_id = $1 and l.state in ('captured','transferred','proof_pending')`,
      [sessionId],
    );
    const affected = [];
    for (const order of ordersRes.rows) {
      const linesRes = await client.query(
        "select * from lines where order_id = $1 and session_id = $2 and state in ('captured','transferred','proof_pending')",
        [String(order.id), sessionId],
      );
      affected.push({ order, lines: linesRes.rows });
    }
    const refundsStarted = await refundLines(ctx.app, client, affected, "session cancelled");
    return refundsStarted;
  });
}

async function getHistoryInTx(itemId: string, kind: "session" | "entry" = "entry"): Promise<Array<Record<string, unknown>>> {
  const res = await query(
    "select from_status, to_status, at, by from item_history where item_type = $1 and item_id = $2 order by at, id",
    [kind, itemId],
  );
  return res.rows.map((r) => ({
    from: String(r.from_status),
    to: String(r.to_status),
    at: r.at,
    by: String(r.by),
  }));
}
