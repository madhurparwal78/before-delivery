import type { Account } from "../auth.js";
import { oneAgendaWriteAtATime, pool } from "../db.js";
import { reservationsWhere } from "../reservations.js";
import { notFound, validation } from "../http.js";
import {
  createRecord,
  deleteRecord,
  listRecords,
  updateRecord,
  type ContentKind,
  type ContentRecord,
} from "../pocketbase.js";
import { SOLD_STATES, tierOf } from "../rules.js";
import { HANDS_ON_ERROR, handsOnShareHolds } from "../../shared/handsOn.js";
import { publicRoute, route } from "../router.js";
import { fields, integer, text } from "../validate.js";

const KINDS: readonly ContentKind[] = ["sessions", "hospitality", "hotels", "faq"];

function kindOf(value: string | undefined): ContentKind {
  const kind = KINDS.find((k) => k === value);
  if (!kind) throw notFound();
  return kind;
}

type Clean = { values: Record<string, string | number>; errors: Record<string, string> };

function clean(kind: ContentKind, body: Record<string, unknown>): Clean {
  const values: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  const want = (name: string, value: string | number | null, message: string) => {
    if (value === null) errors[name] = message;
    else values[name] = value;
  };
  const day = integer(body.day, 1, 2);
  switch (kind) {
    case "sessions": {
      want("number", integer(body.number, 1, 100_000), "Use a positive whole number.");
      want("day", day, "Day is 1 or 2.");
      want("title", text(body.title, 1, 120), "Enter a title of 1 to 120 characters.");
      want("format", body.format === "lecture" || body.format === "hands-on" ? body.format : null, "Format is lecture or hands-on.");
      want("minutes", integer(body.minutes, 15, 480), "Minutes are a whole number from 15 to 480.");
      want("outcomes", typeof body.outcomes === "string" && body.outcomes.length <= 600 ? body.outcomes.trim() : null, "Outcomes are up to 600 characters.");
      break;
    }
    case "hospitality": {
      want("title", text(body.title, 1, 120), "Enter a title of 1 to 120 characters.");
      want("day", day, "Day is 1 or 2.");
      const startsAt = typeof body.starts_at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.starts_at) ? body.starts_at : null;
      want("starts_at", startsAt, "Use a 24-hour time such as 18:30.");
      want("venue", text(body.venue, 1, 120), "Enter a venue of 1 to 120 characters.");
      want("tier", body.tier === "all" || body.tier === "atelier" ? body.tier : null, "Tier is all or atelier.");
      want("description", text(body.description, 1, 600), "Enter a description of 1 to 600 characters.");
      break;
    }
    case "hotels": {
      want("name", text(body.name, 1, 120), "Enter a name of 1 to 120 characters.");
      want("distance", text(body.distance, 1, 60), "Enter a distance such as 0.4 miles.");
      want("rate", text(body.rate, 1, 60), "Enter a rate such as from $289 a night.");
      want("map_url", httpsUrl(body.map_url), "Use an https:// map link.");
      break;
    }
    case "faq": {
      want("question", text(body.question, 1, 200), "Enter a question of 1 to 200 characters.");
      want("answer", text(body.answer, 1, 2000), "Enter an answer of 1 to 2,000 characters.");
      want("sort", integer(body.sort, -100_000, 100_000), "Sort is a whole number.");
      break;
    }
  }
  return { values, errors };
}

function httpsUrl(value: unknown): string | null {
  const found = text(value, 1, 500);
  if (!found) return null;
  try {
    return new URL(found).protocol === "https:" ? found : null;
  } catch {
    return null;
  }
}

/** Validation on the agenda as it would be after the change: field rules, unique numbers, hands-on share. */
function checkSessions(after: readonly ContentRecord[], changed: ContentRecord | null, errors: Record<string, string>): void {
  if (changed && after.some((s) => s.id !== changed.id && s.number === changed.number)) {
    errors.number = "Another session already has this number.";
  }
  const agenda = after.map((s) => ({ format: String(s.format), minutes: Number(s.minutes) }));
  if (!errors.minutes && !handsOnShareHolds(agenda)) errors.minutes = HANDS_ON_ERROR;
}

/** Session writes go one at a time across processes; the other kinds write straight through. */
function serialised<T>(kind: ContentKind, work: () => Promise<T>): Promise<T> {
  return kind === "sessions" ? oneAgendaWriteAtATime(work) : work();
}

async function save(kind: ContentKind, id: string | null, body: unknown) {
  const existing = await listRecords(kind);
  const current = id ? existing.find((record) => record.id === id) : null;
  if (id && !current) throw notFound();
  const merged = { ...(current ?? {}), ...fields(body) };
  const { values, errors } = clean(kind, merged);
  if (kind === "sessions") {
    const changed: ContentRecord = { ...values, id: id ?? "" };
    checkSessions([...existing.filter((record) => record.id !== id), changed], changed, errors);
  }
  if (Object.keys(errors).length) throw validation(errors);
  return id ? updateRecord(kind, id, values) : createRecord(kind, values);
}

route({
  method: "GET",
  path: "/api/desk/content/:kind",
  access: ["director"],
  handle: async (ctx) => ({ status: 200, body: { items: await listRecords(kindOf(ctx.params.kind)) } }),
});

route({
  method: "POST",
  path: "/api/desk/content/:kind",
  access: ["director"],
  handle: async (ctx) => {
    const kind = kindOf(ctx.params.kind);
    return { status: 201, body: { item: await serialised(kind, () => save(kind, null, ctx.body)) } };
  },
});

route({
  method: "PATCH",
  path: "/api/desk/content/:kind/:id",
  access: ["director"],
  handle: async (ctx) => {
    const kind = kindOf(ctx.params.kind);
    return { status: 200, body: { item: await serialised(kind, () => save(kind, ctx.params.id ?? "", ctx.body)) } };
  },
});

route({
  method: "DELETE",
  path: "/api/desk/content/:kind/:id",
  access: ["director"],
  handle: async (ctx) => {
    const kind = kindOf(ctx.params.kind);
    await serialised(kind, async () => {
      const existing = await listRecords(kind);
      if (!existing.some((record) => record.id === ctx.params.id)) throw notFound();
      if (kind === "sessions") {
        const errors: Record<string, string> = {};
        checkSessions(existing.filter((record) => record.id !== ctx.params.id), null, errors);
        if (Object.keys(errors).length) throw validation(errors);
      }
      await deleteRecord(kind, ctx.params.id ?? "");
    });
    return { status: 204 };
  },
});

/** Atelier-only evening details go to the director and to buyers or attendees of a paid Atelier seat. */
async function revealsAtelierEvenings(account: Account | null): Promise<boolean> {
  if (!account) return false;
  if (account.role === "director") return true;
  const seats = await reservationsWhere(pool, "r.state = ANY($2) AND (r.buyer_id = $1 OR (r.attendee_accepted AND r.attendee_account_id = $1))", [
    account.id,
    SOLD_STATES,
  ]);
  return seats.some((seat) => tierOf(seat.bench) === "atelier");
}

publicRoute({
  method: "GET",
  path: "/api/content",
  handle: async (ctx) => {
    const [sessions, hospitality, hotels, faq] = await Promise.all([
      listRecords("sessions"),
      listRecords("hospitality"),
      listRecords("hotels"),
      listRecords("faq"),
    ]);
    const reveal = await revealsAtelierEvenings(ctx.account);
    return {
      status: 200,
      body: {
        sessions: sessions.sort((a, b) => Number(a.day) - Number(b.day) || Number(a.number) - Number(b.number)),
        hospitality: hospitality
          .sort((a, b) => Number(a.day) - Number(b.day) || String(a.starts_at).localeCompare(String(b.starts_at)))
          .map((item) => (item.tier === "atelier" && !reveal ? { id: item.id, title: item.title, day: item.day, tier: "atelier", gated: true } : item)),
        hotels,
        faq: faq.sort((a, b) => Number(a.sort) - Number(b.sort)),
      },
    };
  },
});
