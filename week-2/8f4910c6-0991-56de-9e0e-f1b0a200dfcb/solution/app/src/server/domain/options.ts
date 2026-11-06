// The option ladder: placement, ranks, release, challenge, hold-until and the sweep's expiries.
// Every change to a talent-day runs under that day's advisory lock, so ranks stay distinct and gapless
// and each sweep effect happens once however many app copies run.

import type { PoolClient } from "pg";
import { exec, lockKey, one, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, json, type MemberCtx, type Reply } from "../http.js";
import { ApiError, FieldErrors, conflict, isoInstant, notFound, optionalInstant, required, staleVersion } from "../errors.js";
import { config } from "../config.js";
import { enqueue } from "../mail.js";
import { asObject, newId, str, type Body } from "../util.js";
import { OFFICES, isIsoDate, localToInstant, type OfficeId } from "../../shared/zones.js";
import { formatDate, formatOfficeTime } from "../../shared/format.js";
import { autoReleaseAt, closuresOf } from "./offices.js";

export type OptionState = "placed" | "challenged" | "confirmed" | "released" | "expired";
export type ReleaseReason = "manual" | "challenge_timeout" | "day_booked" | "hold_expired" | "auto_release";

export interface OptionRow {
  id: string;
  talent_id: string;
  client_id: string;
  client_company: string;
  office_id: OfficeId;
  talent_name: string;
  job_date: string;
  job_title: string;
  note: string;
  rank: number | null;
  last_rank: number;
  state: OptionState;
  auto_release_at: Date;
  hold_until: Date | null;
  hold_until_local: string | null;
  challenge_deadline: Date | null;
  placed_by_id: string;
  placed_by_name: string;
  placed_at: Date;
  released_at: Date | null;
  release_reason: ReleaseReason | null;
  booking_id: string | null;
  version: number;
  sequence: number;
  saved_by: string;
  saved_at: Date;
}

const LIVE = "('placed', 'challenged')";
const LAST_JOB_DAY = "2027-12-31";
const JOB_DAY_COPY =
  "Options can be placed only while this day's automatic release is still ahead, up to 31 Dec 2027.";

export const OPTION_SELECT = `SELECT o.*, c.company AS client_company, t.office_id, t.display_name AS talent_name
  FROM options o JOIN clients c ON c.id = o.client_id JOIN talent t ON t.id = o.talent_id`;

export function releaseAtOf(row: OptionRow): Date {
  return row.hold_until && row.hold_until < row.auto_release_at ? row.hold_until : row.auto_release_at;
}

function optionBody(row: OptionRow): Record<string, unknown> {
  return {
    id: row.id,
    talentId: row.talent_id,
    clientId: row.client_id,
    clientCompany: row.client_company,
    date: row.job_date,
    jobTitle: row.job_title,
    note: row.note,
    rank: row.rank,
    state: row.state,
    autoReleaseAt: isoInstant(row.auto_release_at),
    holdUntil: optionalInstant(row.hold_until),
    holdUntilLocal: row.hold_until_local,
    releaseAt: isoInstant(releaseAtOf(row)),
    challengeDeadline: optionalInstant(row.challenge_deadline),
    placedBy: { id: row.placed_by_id, name: row.placed_by_name },
    placedAt: isoInstant(row.placed_at),
    releasedAt: optionalInstant(row.released_at),
    releaseReason: row.release_reason,
    version: row.version,
  };
}

export async function lockDay(client: PoolClient, talentId: string, date: string): Promise<void> {
  await lockKey(client, `day:${talentId}:${date}`);
}

export async function optionById(db: Db, id: string): Promise<OptionRow | null> {
  return one<OptionRow>(db, `${OPTION_SELECT} WHERE o.id = $1`, [id]);
}

/** Re-reads an option this request already holds. */
export async function getOption(db: Db, id: string): Promise<OptionRow> {
  const row = await optionById(db, id);
  if (!row) throw new Error(`option ${id} vanished`);
  return row;
}

async function dayOptions(db: Db, talentId: string, date: string): Promise<OptionRow[]> {
  return rows<OptionRow>(
    db,
    `${OPTION_SELECT} WHERE o.talent_id = $1 AND o.job_date = $2
      ORDER BY o.rank NULLS LAST, o.placed_at, o.id`,
    [talentId, date],
  );
}

export async function liveLadder(db: Db, talentId: string, date: string): Promise<OptionRow[]> {
  return (await dayOptions(db, talentId, date)).filter((row) => row.state === "placed" || row.state === "challenged");
}

/** Renumbers the live options of a day 1…n in their current order. */
async function closeGaps(client: PoolClient, talentId: string, date: string, actor: string | null, now: number): Promise<void> {
  const live = await liveLadder(client, talentId, date);
  for (const [index, row] of live.entries()) {
    if (row.rank !== index + 1) {
      await exec(
        client,
        `UPDATE options SET rank = $2, last_rank = $2, version = version + 1, sequence = sequence + 1,
           saved_by = coalesce($3, saved_by), saved_at = CASE WHEN $3::text IS NULL THEN saved_at ELSE $4 END
         WHERE id = $1`,
        [row.id, index + 1, actor, new Date(now)],
      );
    }
  }
}

export async function challengeOutcome(client: Db, first: OptionRow, challenger: OptionRow, firstCopy: string,
  challengerCopy: string): Promise<void> {
  const subject = `Option update: ${first.talent_name} on ${formatDate(first.job_date)}`;
  const contacts = await rows<{ contact_name: string; contact_email: string }>(
    client,
    `SELECT c.contact_name, c.contact_email FROM unnest($1::text[]) WITH ORDINALITY AS u(id, n)
       JOIN clients c ON c.id = u.id ORDER BY u.n`,
    [[first.client_id, challenger.client_id]],
  );
  const outcomes = [[first, firstCopy], [challenger, challengerCopy]] as const;
  for (const [index, [row, copy]] of outcomes.entries()) {
    const contact = contacts[index];
    await enqueue(client, {
      to: contact.contact_email,
      subject,
      text: [
        `Hello ${contact.contact_name},`,
        "",
        `${copy}`,
        "",
        `Talent: ${row.talent_name}`,
        `Day: ${formatDate(row.job_date)}`,
        `Job: ${row.job_title}`,
        "",
        "Vesper & Rowe Talent",
      ].join("\n"),
      talentIds: [row.talent_id],
    });
  }
}

/**
 * Takes an option off the ladder. Options below move up; a challenged 1st that leaves sends both clients
 * their challenge outcome; a challenger that leaves returns the 1st to `placed` without emails.
 */
export async function takeOffLadder(client: PoolClient, row: OptionRow, state: "released" | "expired",
  reason: ReleaseReason, actor: string | null, now: number): Promise<void> {
  const live = await liveLadder(client, row.talent_id, row.job_date);
  const first = live.find((option) => option.rank === 1);
  const challenger = live.find((option) => option.rank === 2);
  await exec(
    client,
    `UPDATE options SET state = $2, rank = NULL, last_rank = coalesce(rank, last_rank), released_at = $3,
       release_reason = $4, version = version + 1, sequence = sequence + 1,
       saved_by = coalesce($5, saved_by), saved_at = CASE WHEN $5::text IS NULL THEN saved_at ELSE $3 END
     WHERE id = $1`,
    [row.id, state, new Date(now), reason, actor],
  );
  if (first?.state === "challenged" && challenger) {
    if (row.id === challenger.id) {
      await exec(client, `UPDATE options SET state = 'placed', challenge_deadline = NULL, version = version + 1,
        sequence = sequence + 1 WHERE id = $1`, [first.id]);
    } else if (row.id === first.id && reason !== "day_booked") {
      await challengeOutcome(client, first, challenger, "Your 1st option was released.", "Your option is now 1st.");
    }
  }
  await closeGaps(client, row.talent_id, row.job_date, actor, now);
}

type HoldCheck = { kind: "ok"; ms: number } | { kind: "error"; copy: string };

/** Resolves an office-local hold-until in the talent's zone and applies the hold-until rules. */
function checkHold(local: string, office: OfficeId, now: number, autoRelease: number): HoldCheck {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!match || !isIsoDate(`${match[1]}-${match[2]}-${match[3]}`) || Number(match[4]) > 23 || Number(match[5]) > 59) {
    return { kind: "error", copy: "Enter hold until as a date and time like 2027-03-11T15:00." };
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const resolved = localToInstant({ year, month, day, hour, minute, second }, OFFICES[office].timeZone);
  if (resolved.kind === "gap") {
    return { kind: "error", copy: `That time does not exist in ${OFFICES[office].city}: clocks skip that hour.` };
  }
  if (resolved.ms <= now) return { kind: "error", copy: "Choose a time in the future." };
  if (resolved.ms >= autoRelease) {
    return { kind: "error", copy: `Choose a time before the automatic release at ${formatOfficeTime(autoRelease, office)}.` };
  }
  return { kind: "ok", ms: resolved.ms };
}

/** The 409 for an option that can no longer change, or null when it is still on the ladder. */
async function closedOption(db: Db, row: OptionRow): Promise<ApiError | null> {
  if (row.state === "released" || row.state === "expired") {
    return conflict("option_released", { releasedAt: optionalInstant(row.released_at) });
  }
  if (row.state === "confirmed") return alreadyBooked(db, row);
  return null;
}

export async function alreadyBooked(db: Db, row: OptionRow): Promise<ApiError> {
  const booking = await one<{ id: string; confirmed_by: string; confirmed_at: Date }>(
    db, "SELECT id, confirmed_by, confirmed_at FROM bookings WHERE id = $1", [row.booking_id]);
  return conflict("already_booked", {
    bookedBy: booking?.confirmed_by ?? "",
    bookedAt: booking ? isoInstant(booking.confirmed_at) : null,
    bookingId: booking?.id ?? null,
  });
}

/** Step 4 for option paths: talent members may read no option, so every id answers like an unknown one. */
async function visibleOption(ctx: MemberCtx): Promise<OptionRow> {
  const row = ctx.isTalent() ? null : await optionById(pool, ctx.params.id);
  if (!row) throw notFound();
  return row;
}

async function lockedOption(client: PoolClient, row: OptionRow): Promise<OptionRow> {
  await lockDay(client, row.talent_id, row.job_date);
  return getOption(client, row.id);
}

memberRoute("POST", "/api/options", async (ctx) => {
  ctx.allow("booker", "agency_director");
  const body = asObject(await ctx.json());
  return ctx.idempotent(`member:${ctx.member.id}`, body, () => placeOption(ctx, body));
});

async function placeOption(ctx: MemberCtx, body: Body): Promise<Reply> {
  const date = str(body, "date");
  const jobTitle = str(body, "jobTitle").trim();
  const note = str(body, "note");
  const hold = body.holdUntilLocal;
  return tx(async (client) => {
    const talent = await one<{ id: string; office_id: OfficeId; state: string }>(
      client, "SELECT id, office_id, state FROM talent WHERE id = $1", [str(body, "talentId")]);
    const customer = await one<{ id: string }>(client, "SELECT id FROM clients WHERE id = $1", [str(body, "clientId")]);
    const errors: FieldErrors = new FieldErrors();
    let rank = 1;
    if (talent && isIsoDate(date)) {
      await lockDay(client, talent.id, date);
      const day = await dayOptions(client, talent.id, date);
      const live = day.filter((row) => row.state === "placed" || row.state === "challenged");
      if (day.some((row) => row.state === "confirmed")) throw conflict("day_booked");
      if (customer && live.some((row) => row.client_id === customer.id)) throw conflict("client_already_holds");
      if (live.length >= 3) throw conflict("ladder_full");
      rank = live.length + 1;
    }
    if (!talent || talent.state !== "active") errors.add("talentId", "Choose a talent on the roster.");
    if (!customer) errors.add("clientId", required("Client"));
    if (!jobTitle) errors.add("jobTitle", required("Job title"));
    let autoRelease = 0;
    if (!isIsoDate(date) || date > LAST_JOB_DAY) {
      errors.add("date", JOB_DAY_COPY);
    } else if (talent) {
      autoRelease = autoReleaseAt(date, talent.office_id, await closuresOf(client, talent.office_id));
      if (autoRelease <= ctx.now) errors.add("date", JOB_DAY_COPY);
    }
    let holdUntil: number | null = null;
    if (hold !== null && hold !== undefined && hold !== "") {
      if (typeof hold !== "string") errors.add("holdUntilLocal", "Enter hold until as a date and time like 2027-03-11T15:00.");
      else if (talent && autoRelease) {
        const checked = checkHold(hold, talent.office_id, ctx.now, autoRelease);
        if (checked.kind === "error") errors.add("holdUntilLocal", checked.copy);
        else holdUntil = checked.ms;
      }
    }
    if (errors.any() || !talent || !customer) errors.fail();
    const id = newId();
    const at = new Date(ctx.now);
    await exec(
      client,
      `INSERT INTO options (id, talent_id, client_id, job_date, job_title, note, rank, last_rank, state, auto_release_at,
         hold_until, hold_until_local, placed_by_id, placed_by_name, placed_at, saved_by, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'placed', $8, $9, $10, $11, $12, $13, $12, $13)`,
      [id, talent.id, customer.id, date, jobTitle, note, rank, new Date(autoRelease),
        holdUntil === null ? null : new Date(holdUntil), holdUntil === null ? null : hold, ctx.member.id,
        ctx.member.name, at],
    );
    return json(201, { option: optionBody(await getOption(client, id)) });
  });
}

memberRoute("GET", "/api/options/:id", async (ctx) => {
  const row = await visibleOption(ctx);
  return json(200, { option: optionBody(row) });
});

memberRoute("PATCH", "/api/options/:id", async (ctx) => {
  const found = await visibleOption(ctx);
  ctx.allow("booker", "agency_director");
  const body = asObject(await ctx.json());
  return tx(async (client) => {
    const row = await lockedOption(client, found);
    const closed = await closedOption(client, row);
    if (closed) throw closed;
    if (body.version !== row.version) throw staleVersion(row.saved_by, row.saved_at);
    const errors: FieldErrors = new FieldErrors();
    let holdUntil = row.hold_until;
    let holdLocal = row.hold_until_local;
    if ("holdUntilLocal" in body) {
      const hold = body.holdUntilLocal;
      if (hold === null || hold === "") {
        holdUntil = null;
        holdLocal = null;
      } else if (typeof hold !== "string") {
        errors.add("holdUntilLocal", "Enter hold until as a date and time like 2027-03-11T15:00.");
      } else {
        const checked = checkHold(hold, row.office_id, ctx.now, row.auto_release_at.getTime());
        if (checked.kind === "error") errors.add("holdUntilLocal", checked.copy);
        else {
          holdUntil = new Date(checked.ms);
          holdLocal = hold;
        }
      }
    }
    if ("note" in body && typeof body.note !== "string") errors.add("note", "Enter the note as text.");
    errors.throwIfAny();
    const holdChanged = (holdUntil?.getTime() ?? null) !== (row.hold_until?.getTime() ?? null);
    await exec(
      client,
      `UPDATE options SET hold_until = $2, hold_until_local = $3, note = $4, version = version + 1,
         sequence = sequence + $5, saved_by = $6, saved_at = $7 WHERE id = $1`,
      [row.id, holdUntil, holdLocal, typeof body.note === "string" ? body.note : row.note, holdChanged ? 1 : 0,
        ctx.member.name, new Date(ctx.now)],
    );
    return json(200, { option: optionBody(await getOption(client, row.id)) });
  });
});

memberRoute("POST", "/api/options/:id/release", async (ctx) => {
  const found = await visibleOption(ctx);
  ctx.allow("booker", "agency_director");
  await ctx.json();
  return tx(async (client) => {
    const row = await lockedOption(client, found);
    const closed = await closedOption(client, row);
    if (closed) throw closed;
    if (row.state === "challenged" && row.challenge_deadline && row.challenge_deadline.getTime() <= ctx.now) {
      throw conflict("challenge_expired", { challengeDeadline: isoInstant(row.challenge_deadline) });
    }
    await takeOffLadder(client, row, "released", "manual", ctx.member.name, ctx.now);
    const ladder = await liveLadder(client, row.talent_id, row.job_date);
    return json(200, { option: optionBody(await getOption(client, row.id)), ladder: ladder.map(optionBody) });
  });
});

memberRoute("POST", "/api/options/:id/challenge", async (ctx) => {
  const found = await visibleOption(ctx);
  ctx.allow("booker", "agency_director");
  await ctx.json();
  return tx(async (client) => {
    const row = await lockedOption(client, found);
    if (row.state === "released" || row.state === "expired") {
      throw conflict("option_released", { releasedAt: optionalInstant(row.released_at) });
    }
    if (row.state !== "placed" || row.rank !== 2) throw conflict("not_second");
    const [first] = await liveLadder(client, row.talent_id, row.job_date);
    if (first.state === "challenged") {
      throw conflict("already_challenged", { challengeDeadline: optionalInstant(first.challenge_deadline) });
    }
    const deadline = new Date((Math.floor(ctx.now / 1000) + config.optionChallengeSeconds) * 1000);
    await exec(client, `UPDATE options SET state = 'challenged', challenge_deadline = $2, version = version + 1,
      sequence = sequence + 1 WHERE id = $1`, [first.id, deadline]);
    const ladder = await liveLadder(client, row.talent_id, row.job_date);
    return json(200, { ladder: ladder.map(optionBody) });
  });
});

/** A director's new closure moves the automatic release of that office's live options still ahead. */
export async function recomputeAutoRelease(client: PoolClient, office: OfficeId, now: number, actor: string): Promise<void> {
  const closures = await closuresOf(client, office);
  const live = await rows<OptionRow>(
    client,
    `${OPTION_SELECT} WHERE o.state IN ${LIVE} AND t.office_id = $1 AND o.auto_release_at > $2 ORDER BY o.id`,
    [office, new Date(now)],
  );
  for (const row of live) {
    const moved = autoReleaseAt(row.job_date, office, closures);
    if (moved !== row.auto_release_at.getTime()) {
      await lockDay(client, row.talent_id, row.job_date);
      await exec(client, `UPDATE options SET auto_release_at = $2, version = version + 1, sequence = sequence + 1,
        saved_by = $3, saved_at = $4 WHERE id = $1`, [row.id, new Date(moved), actor, new Date(now)]);
    }
  }
}

/** Expires holds past their release instant and releases challenged 1st options past their deadline. */
export async function sweepOptions(now: number): Promise<void> {
  const due = await rows<{ id: string }>(
    pool,
    `SELECT id FROM options WHERE state IN ${LIVE}
       AND (least(hold_until, auto_release_at) <= $1 OR (state = 'challenged' AND challenge_deadline <= $1))
     ORDER BY job_date LIMIT 100`,
    [new Date(now)],
  );
  for (const { id } of due) {
    await tx(async (client) => {
      const row = await lockedOption(client, await getOption(client, id));
      if (row.state !== "placed" && row.state !== "challenged") return;
      const releaseAt = releaseAtOf(row).getTime();
      const deadline = row.challenge_deadline?.getTime() ?? Infinity;
      if (deadline <= now && deadline <= releaseAt) {
        await takeOffLadder(client, row, "released", "challenge_timeout", null, now);
      } else if (releaseAt <= now) {
        const reason = row.hold_until && row.hold_until < row.auto_release_at ? "hold_expired" : "auto_release";
        await takeOffLadder(client, row, "expired", reason, null, now);
      }
    });
  }
}

memberRoute("GET", "/api/talent/:id/ladder", async (ctx) => {
  const talent = await one<{ id: string; office_id: OfficeId }>(pool, "SELECT id, office_id FROM talent WHERE id = $1",
    [ctx.params.id]);
  if (!talent || (ctx.isTalent() && ctx.member.talentId !== talent.id)) throw notFound();
  const from = ctx.query.get("from") ?? "";
  const days = Number(ctx.query.get("days") ?? 14);
  const errors: FieldErrors = new FieldErrors();
  if (!isIsoDate(from)) errors.add("from", "Enter a start date like 2027-03-15.");
  if (!Number.isInteger(days) || days < 1 || days > 62) errors.add("days", "Choose 1 to 62 days.");
  errors.throwIfAny();
  const found = await rows<OptionRow>(
    pool,
    `${OPTION_SELECT} WHERE o.talent_id = $1 AND o.job_date >= $2::date AND o.job_date < $2::date + $3::int
      ORDER BY o.job_date, o.rank NULLS LAST, o.placed_at, o.id`,
    [talent.id, from, days],
  );
  const list = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const options = found.filter((row) => row.job_date === date);
    const booked = options.find((row) => row.state === "confirmed");
    list.push({
      date,
      dayState: booked ? "booked" : options.some((row) => row.state === "placed" || row.state === "challenged") ? "held" : "open",
      options: options.map(optionBody),
      bookingId: booked?.booking_id ?? null,
    });
  }
  return json(200, { talentId: talent.id, office: talent.office_id, days: list });
});
