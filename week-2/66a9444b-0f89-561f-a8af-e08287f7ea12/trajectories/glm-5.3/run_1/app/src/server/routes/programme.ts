import type { Route, Ctx } from "../http.js";
import { query, withTransaction, type Row } from "../db.js";
import { ApiError, errors, validationError } from "../errors.js";
import { sessionFromRow, effectiveStatus } from "../services/seats.js";
import { sessionJson, entryJson } from "../services/shapes.js";
import { festivalDayEnd, festivalDayStart, dayLabel, utcIso } from "../../shared/time.js";


async function healthBody(ctx: Ctx): Promise<Record<string, unknown>> {
  const pg = await (async () => {
    try {
      await query("select 1");
      return "up";
    } catch {
      return "down";
    }
  })();
  const [killbill, mailpit, minio] = await Promise.all([
    ctx.app.killbill.health(),
    ctx.app.smtpHealth(),
    ctx.app.s3.health(),
  ]);
  return {
    status: "ok",
    services: {
      postgres: pg,
      killbill: killbill ? "up" : "down",
      mailpit: mailpit ? "up" : "down",
      minio: minio ? "up" : "down",
    },
  };
}

function festivalDays(firstDay: string, lastDay: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const start = new Date(`${firstDay}T00:00:00Z`);
  const end = new Date(`${lastDay}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
    const day = d.toISOString().slice(0, 10);
    out.push({
      date: day,
      label: dayLabel(day),
      starts_at: utcIso(festivalDayStart(day)),
      ends_at: utcIso(festivalDayEnd(day)),
    });
  }
  return out;
}

export function programmeRoutes(): Route[] {
  const health: Route = {
    method: "GET",
    pattern: "/api/health",
    roles: "public",
    bodyLimit: "none",
    async handler(ctx) {
      return { status: 200, body: await healthBody(ctx) };
    },
  };

  const programme: Route = {
    method: "GET",
    pattern: "/api/programme",
    roles: "public",
    bodyLimit: "none",
    async handler(ctx) {
      const day = ctx.query.get("day");
      const venue = ctx.query.get("venue");
      const discipline = ctx.query.get("discipline");
      const fieldErrors: Record<string, string> = {};
      if (day !== null) {
        const found = await query("select 1 from edition where first_day <= $1 and last_day >= $1", [day]);
        if (found.rows.length === 0) fieldErrors.day = "unknown";
      }
      if (venue !== null) {
        const found = await query("select 1 from venues where id = $1", [venue]);
        if (found.rows.length === 0) fieldErrors.venue = "unknown";
      }
      if (discipline !== null) {
        const found = await query("select 1 from disciplines where id = $1", [discipline]);
        if (found.rows.length === 0) fieldErrors.discipline = "unknown";
      }
      if (Object.keys(fieldErrors).length > 0) throw validationError(fieldErrors);

      const edition = (await query("select * from edition where id = 1")).rows[0];
      const venues = (await query("select * from venues order by id")).rows;
      const disciplines = (await query("select * from disciplines order by id")).rows;
      const sessionsRes = await query("select * from sessions order by starts_at, id");
      const now = new Date();
      const visible = sessionsRes.rows
        .map(sessionFromRow)
        .map((s) => ({ row: s, eff: effectiveStatus(s.status, s.publish_at, now) }))
        .filter((s) => s.eff === "published" || s.eff === "cancelled")
        .filter((s) => (day !== null ? s.row.festival_day === day : true))
        .filter((s) => (venue !== null ? s.row.venue_id === venue : true))
        .filter((s) => (discipline !== null ? s.row.discipline === discipline : true));

      const sessions: Record<string, unknown>[] = [];
      for (const s of visible) {
        sessions.push(await sessionJson({ ...s.row, status: s.eff }, { full: false, seats: true }));
      }
      return {
        status: 200,
        body: {
          edition: {
            name: String(edition.name),
            first_day: String(edition.first_day),
            last_day: String(edition.last_day),
            time_zone: "Europe/Brussels",
          },
          festival_days: festivalDays(String(edition.first_day), String(edition.last_day)),
          venues: venues.map((v) => ({ id: String(v.id), name: String(v.name) })),
          disciplines: disciplines.map((d) => ({ id: String(d.id), name: String(d.name) })),
          sessions,
        },
      };
    },
  };

  const sessionDetail: Route = {
    method: "GET",
    pattern: "/api/sessions/:id",
    roles: "public",
    bodyLimit: "none",
    async handler(ctx) {
      const id = ctx.params.id;
      const res = await query("select * from sessions where id = $1", [id]);
      const row = res.rows[0];
      if (!row) throw errors.notFound();
      const s = sessionFromRow(row);
      const isCurator = ctx.user?.role === "curator";
      const now = new Date();
      const eff = effectiveStatus(s.status, s.publish_at, now);
      if (isCurator) {
        return { status: 200, body: await sessionJson(s, { full: true, seats: true }) };
      }
      if (eff !== "published" && eff !== "cancelled") throw errors.notFound();
      return { status: 200, body: await sessionJson({ ...s, status: eff }, { full: false, seats: true }) };
    },
  };

  const gallery: Route = {
    method: "GET",
    pattern: "/api/gallery",
    roles: "public",
    bodyLimit: "none",
    async handler() {
      const res = await query("select * from entries order by id");
      const now = new Date();
      const entries: Record<string, unknown>[] = [];
      for (const row of res.rows) {
        const eff = effectiveStatus(String(row.status), row.publish_at ? new Date(String(row.publish_at)) : null, now);
        if (eff !== "published") continue;
        entries.push(await entryJson(row));
      }
      return { status: 200, body: { entries } };
    },
  };

  const artworkMedia: Route = {
    method: "GET",
    pattern: "/api/media/artworks/:imageId",
    roles: "public",
    bodyLimit: "none",
    async handler(ctx) {
      const imageId = ctx.params.imageId;
      const res = await query(
        `select e.status, e.publish_at from entry_images i join entries e on e.id = i.entry_id where i.id = $1`,
        [imageId],
      );
      const row: Row | undefined = res.rows[0];
      if (!row) throw errors.notFound();
      const eff = effectiveStatus(String(row.status), row.publish_at ? new Date(String(row.publish_at)) : null, new Date());
      if (eff !== "published") throw errors.notFound();
      const entryIdRes = await query("select entry_id from entry_images where id = $1", [imageId]);
      const entryId = String(entryIdRes.rows[0].entry_id);
      const objectKey = `artworks/display/${entryId}/${imageId}.jpg`;
      try {
        const obj = await ctx.app.s3.get(objectKey);
        return {
          status: 200,
          body: obj.body,
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
        };
      } catch {
        throw errors.storageUnavailable();
      }
    },
  };

  const signedFile: Route = {
    method: "GET",
    pattern: "/api/files/:token",
    roles: "public",
    bodyLimit: "none",
    async handler(ctx) {
      const token = ctx.params.token;
      const verified = ctx.app.verifyFileToken(token);
      if (!verified) throw errors.notFound();
      if (verified.expiresAt.getTime() <= Date.now()) {
        throw new ApiError(410, { error: "link_expired" });
      }
      try {
        const obj = await ctx.app.s3.get(verified.objectKey);
        return {
          status: 200,
          body: obj.body,
          headers: { "Content-Type": obj.contentType, "Cache-Control": "no-store" },
        };
      } catch {
        throw errors.storageUnavailable();
      }
    },
  };

  const voucherBalanceRoute: Route = {
    method: "GET",
    pattern: "/api/vouchers/:code",
    roles: "signed_in",
    bodyLimit: "none",
    async handler(ctx) {
      const code = ctx.params.code;
      const balance = await withTransaction(async (tx) => {
        const exists = await tx.query("select 1 from vouchers where code = $1", [code]);
        if (exists.rows.length === 0) throw errors.notFound();
        const res = await tx.query(
          `select coalesce(sum(case when side = 'credit' then amount_cents else -amount_cents end), 0) as balance
           from ledger_entries where account = $1`,
          [`voucher:${code}`],
        );
        return Number(res.rows[0].balance);
      });
      return { status: 200, body: { code, balance_cents: balance } };
    },
  };

  return [health, programme, sessionDetail, gallery, artworkMedia, signedFile, voucherBalanceRoute];
}
