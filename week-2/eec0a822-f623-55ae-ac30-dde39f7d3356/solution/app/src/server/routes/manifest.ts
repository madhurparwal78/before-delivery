import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "../config";
import { one, pool, rows, transaction, type Db } from "../db";
import { conflict, notFound, readUpload, unavailable, type Json } from "../http";
import { route, type Ctx } from "../router";
import { asBody, Fields } from "../validate";
import { FIELD } from "../../shared/copy";
import { COUNTRY_CODES } from "../../shared/countries";
import { formatDay, formatTime } from "../../shared/format";
import { addDays, isoInstant } from "../../shared/zones";
import { sendMail } from "../mail";
import { deleteObject, getObject, putObject } from "../storage";
import { processPhoto } from "../images";
import { charterById, type CharterRow } from "../domain/charters";
import { endPages, issuePage, latestPage, livePage, pageStatusJson, type PageRow } from "../domain/pages";
import { splitToday, weekEnd } from "../domain/weeks";
import { staffCharter } from "./holds";

const PHOTO_LIMIT = 5_000_000;

interface GuestRow {
  id: string;
  charter_id: string;
  full_name: string;
  nationality: string | null;
  date_of_birth: string | null;
  passport_number: string | null;
  photo_key: string | null;
  photo_type: string | null;
}

async function guestsOf(db: Db, charterId: string): Promise<GuestRow[]> {
  return rows<GuestRow>(db, "SELECT * FROM guests WHERE charter_id = $1 ORDER BY sort", [charterId]);
}

/** What the manifest page itself may show: flags, never the stored passport values. */
function publicGuest(g: GuestRow): Json {
  return {
    id: g.id,
    fullName: g.full_name,
    nationality: g.nationality,
    passportOnFile: g.passport_number !== null,
    dateOfBirthOnFile: g.date_of_birth !== null,
    photoOnFile: g.photo_key !== null,
  };
}

function fullGuest(g: GuestRow): Json {
  return {
    id: g.id,
    fullName: g.full_name,
    nationality: g.nationality,
    dateOfBirth: g.date_of_birth,
    passportNumber: g.passport_number,
    photoOnFile: g.photo_key !== null,
  };
}

/** Passport data reaches only the captain and the fleet director. */
function seesPassports(ctx: Ctx): boolean {
  return ctx.member.role === "captain" || ctx.member.role === "fleet_director";
}

route("GET", "/api/w/:ws/charters/:id/manifest", {
  staff: true,
  handle: async (ctx) => {
    const charter = await staffCharter(ctx);
    ctx.allow(["charter_manager", "captain"]);
    const page = await latestPage(pool, ctx.params.ws, "manifest", charter.id);
    const withPath = ctx.member.role === "charter_manager" || ctx.member.role === "fleet_director";
    const guests = await guestsOf(pool, charter.id);
    return {
      status: 200,
      body: {
        page: pageStatusJson(page, ctx.now, withPath),
        guests: guests.map((g) => (seesPassports(ctx) ? fullGuest(g) : { id: g.id, fullName: g.full_name })),
      },
    };
  },
});

route("GET", "/api/w/:ws/charters/:id/manifest/guests/:guest/photo", {
  staff: true,
  handle: async (ctx) => {
    const charter = await staffCharter(ctx);
    const guest = /^[0-9a-f-]{36}$/i.test(ctx.params.guest)
      ? await one<GuestRow>(pool, "SELECT * FROM guests WHERE id = $1 AND charter_id = $2", [ctx.params.guest, charter.id])
      : undefined;
    if (!guest) throw notFound();
    ctx.allow(["captain"]);
    if (!guest.photo_key) throw notFound();
    const data = await getObject(guest.photo_key);
    return { raw: true, status: 200, headers: { "Content-Type": guest.photo_type!, "Cache-Control": "no-store" }, body: data };
  },
});

function manifestMail(charter: CharterRow, page: PageRow, email: string) {
  return {
    to: email,
    subject: `Guest manifest for ${charter.yacht_name}, week of ${formatDay(charter.week_start)}`,
    text: [
      `Please complete the guest manifest for ${charter.yacht_name}, week of ${formatDay(charter.week_start)}.`,
      "",
      `${config.publicUrl}/m/${page.token}`,
      "",
      `This link works until ${formatTime(page.ends_at.toISOString())}.`,
    ].join("\n"),
  };
}

route("POST", "/api/w/:ws/charters/:id/manifest-page", {
  staff: true,
  handle: async (ctx) => {
    await staffCharter(ctx);
    ctx.allow(["charter_manager"]);
    const body = asBody(await ctx.json());
    const page = await transaction(async (db) => {
      const charter = await staffCharter(ctx, db, true);
      if (charter.status === "closed") throw conflict("charter_closed");
      const fields = new Fields();
      fields.text("leadGuestName", body.leadGuestName, 80);
      const email = fields.email("leadGuestEmail", body.leadGuestEmail);
      fields.check();
      const issued = await issuePage(db, ctx.params.ws, "manifest", charter.id);
      await sendMail(manifestMail(charter, issued, email!)).catch((error: Error) => {
        console.error(`mail: ${error.message}`);
        throw unavailable("mail_unavailable");
      });
      return issued;
    });
    return { status: 201, body: { page: pageStatusJson(page, Date.now(), true) } };
  },
});

route("POST", "/api/w/:ws/charters/:id/manifest-page/end", {
  staff: true,
  handle: async (ctx) => {
    const charter = await staffCharter(ctx);
    ctx.allow(["charter_manager"]);
    const ended = await endPages(pool, ctx.params.ws, "manifest", charter.id);
    if (!ended) throw conflict("page_not_live");
    return { status: 200, body: { page: pageStatusJson(await latestPage(pool, ctx.params.ws, "manifest", charter.id), Date.now(), true) } };
  },
});

async function manifestCharter(db: Db, ctx: Ctx): Promise<{ page: PageRow; charter: CharterRow }> {
  const page = await livePage(db, "manifest", ctx.params.token, ctx.now);
  return { page, charter: (await charterById(db, page.workspace_slug, page.charter_id!))! };
}

const maxGuests = (charter: CharterRow): number => charter.yacht_cabins * 2;

route("GET", "/api/manifest/:token", {
  handle: async (ctx) => {
    const { page, charter } = await manifestCharter(pool, ctx);
    return {
      status: 200,
      body: {
        yachtName: charter.yacht_name,
        weekStart: charter.week_start,
        weekEnd: weekEnd(charter.week_start),
        maxGuests: maxGuests(charter),
        status: "live",
        endsAt: isoInstant(page.ends_at.getTime()),
        guests: (await guestsOf(pool, charter.id)).map(publicGuest),
      },
    };
  },
});

route("POST", "/api/manifest/:token/guests", {
  handle: async (ctx) => {
    await manifestCharter(pool, ctx);
    const body = asBody(await ctx.json());
    const guest = await transaction(async (db) => {
      const { charter } = await manifestCharter(db, ctx);
      await db.query("SELECT 1 FROM charters WHERE id = $1 FOR UPDATE", [charter.id]);
      const count = (await guestsOf(db, charter.id)).length;
      if (count >= maxGuests(charter)) throw conflict("manifest_full", { maxGuests: maxGuests(charter) });
      const fields = new Fields();
      const fullName = fields.text("fullName", body.fullName, 80);
      fields.check();
      return (await one<GuestRow>(db, "INSERT INTO guests (id, charter_id, full_name, created_at) VALUES ($1,$2,$3, now()) RETURNING *",
        [randomUUID(), charter.id, fullName]))!;
    });
    return { status: 201, body: { guest: publicGuest(guest) } };
  },
});

route("PUT", "/api/manifest/:token/guests", {
  handle: async (ctx) => {
    await manifestCharter(pool, ctx);
    const body = asBody(await ctx.json());
    const guests = await transaction(async (db) => {
      const { charter } = await manifestCharter(db, ctx);
      const stored = new Map((await guestsOf(db, charter.id)).map((g) => [g.id, g]));
      const items = Array.isArray(body.guests) ? body.guests.map(asBody) : [];
      for (const item of items) if (typeof item.id !== "string" || !stored.has(item.id)) throw notFound();
      const fields = new Fields();
      if (!Array.isArray(body.guests)) fields.fail("guests", FIELD.required);
      const today = splitToday(ctx.now);
      const oldest = addDays(today, -Math.round(120 * 365.2425));
      const updates = items.map((item, i) => {
        const current = stored.get(item.id as string)!;
        const fullName = fields.text(`guests.${i}.fullName`, item.fullName, 80);
        const nationality = fields.option(`guests.${i}.nationality`, item.nationality, [...COUNTRY_CODES]);
        let dateOfBirth = current.date_of_birth;
        if (typeof item.dateOfBirth === "string" && item.dateOfBirth.trim() !== "") {
          const date = fields.date(`guests.${i}.dateOfBirth`, item.dateOfBirth.trim());
          if (date && (date >= today || date < oldest)) fields.fail(`guests.${i}.dateOfBirth`, FIELD.birth);
          dateOfBirth = date;
        } else if (!current.date_of_birth) {
          fields.fail(`guests.${i}.dateOfBirth`, FIELD.required);
        }
        let passport = current.passport_number;
        if (typeof item.passportNumber === "string" && item.passportNumber.trim() !== "") {
          passport = item.passportNumber.trim();
          if (!/^[A-Z0-9]{5,20}$/.test(passport)) fields.fail(`guests.${i}.passportNumber`, FIELD.passport);
        } else if (!current.passport_number) {
          fields.fail(`guests.${i}.passportNumber`, FIELD.required);
        }
        return { id: current.id, fullName, nationality, dateOfBirth, passport };
      });
      fields.check();
      for (const u of updates) {
        await db.query("UPDATE guests SET full_name = $2, nationality = $3, date_of_birth = $4, passport_number = $5 WHERE id = $1",
          [u.id, u.fullName, u.nationality, u.dateOfBirth, u.passport]);
      }
      return guestsOf(db, charter.id);
    });
    return { status: 200, body: { guests: guests.map(publicGuest) } };
  },
});

async function manifestGuest(db: Db, ctx: Ctx): Promise<{ charter: CharterRow; guest: GuestRow }> {
  const { charter } = await manifestCharter(db, ctx);
  const guest = /^[0-9a-f-]{36}$/i.test(ctx.params.guest)
    ? await one<GuestRow>(db, "SELECT * FROM guests WHERE id = $1 AND charter_id = $2", [ctx.params.guest, charter.id])
    : undefined;
  if (!guest) throw notFound();
  return { charter, guest };
}

route("DELETE", "/api/manifest/:token/guests/:guest", {
  handle: async (ctx) => {
    await transaction(async (db) => {
      const { guest } = await manifestGuest(db, ctx);
      await db.query("DELETE FROM guests WHERE id = $1", [guest.id]);
      if (guest.photo_key) await deleteObject(guest.photo_key);
    });
    return { status: 204 };
  },
});

route("POST", "/api/manifest/:token/guests/:guest/photo", {
  handle: async (ctx) => {
    const { charter } = await manifestGuest(pool, ctx);
    const upload = await readUpload(ctx.req, "photo", PHOTO_LIMIT);
    const fields = new Fields();
    const photo = upload ? processPhoto(upload.data) : null;
    if (!upload) fields.fail("photo", FIELD.required);
    else if (!photo) fields.fail("photo", FIELD.photo);
    fields.check();
    const guest = await transaction(async (db: pg.PoolClient) => {
      const { guest: current } = await manifestGuest(db, ctx);
      const key = `passport-photos/${charter.id}/${current.id}.${photo!.extension}`;
      const saved = (await one<GuestRow>(db, "UPDATE guests SET photo_key = $2, photo_type = $3 WHERE id = $1 RETURNING *",
        [current.id, key, photo!.contentType]))!;
      await putObject(key, photo!.data, photo!.contentType);
      if (current.photo_key && current.photo_key !== key) await deleteObject(current.photo_key);
      return saved;
    });
    return { status: 201, body: { guest: publicGuest(guest) } };
  },
});

