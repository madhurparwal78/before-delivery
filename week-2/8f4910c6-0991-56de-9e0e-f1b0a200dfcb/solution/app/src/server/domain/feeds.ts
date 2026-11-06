// Each talent's private calendar feed: one VEVENT per option in every state, all-day with an exclusive end.

import { exec, one, pool, rows } from "../db.js";
import { memberRoute, publicRoute, json, type MemberCtx } from "../http.js";
import { notFound } from "../errors.js";
import { randomToken } from "../auth.js";
import { appLink } from "../mail.js";
import { calendar, escapeText, icsDate, icsStamp } from "../ics.js";
import { formatOfficeTime, ordinal } from "../../shared/format.js";
import { addDays } from "../../shared/zones.js";
import { OPTION_SELECT, releaseAtOf, type OptionRow } from "./options.js";

const feedUrl = (token: string): string => appLink(`/feeds/${token}.ics`);

function talentOf(ctx: MemberCtx): string {
  ctx.allow("talent");
  if (!ctx.member.talentId) throw notFound();
  return ctx.member.talentId;
}

memberRoute("GET", "/api/me/calendar-feed", async (ctx) => {
  const talentId = talentOf(ctx);
  await exec(pool, "INSERT INTO feed_tokens (talent_id, token) VALUES ($1, $2) ON CONFLICT (talent_id) DO NOTHING",
    [talentId, randomToken()]);
  const row = await one<{ token: string }>(pool, "SELECT token FROM feed_tokens WHERE talent_id = $1", [talentId]);
  if (!row) throw notFound();
  return json(200, { url: feedUrl(row.token) });
});

memberRoute("POST", "/api/me/calendar-feed", async (ctx) => {
  const talentId = talentOf(ctx);
  await ctx.json();
  const token = randomToken();
  await exec(pool, `INSERT INTO feed_tokens (talent_id, token) VALUES ($1, $2)
    ON CONFLICT (talent_id) DO UPDATE SET token = EXCLUDED.token`, [talentId, token]);
  return json(201, { url: feedUrl(token) });
});

function summary(row: OptionRow): string {
  if (row.state === "confirmed") return `Booked: ${row.job_title} for ${row.client_company}`;
  return `${ordinal(row.rank ?? row.last_rank)} option: ${row.job_title} for ${row.client_company}, releases ${
    formatOfficeTime(releaseAtOf(row).getTime(), row.office_id)}`;
}

const STATUS: Record<OptionRow["state"], string> = {
  placed: "TENTATIVE",
  challenged: "TENTATIVE",
  confirmed: "CONFIRMED",
  released: "CANCELLED",
  expired: "CANCELLED",
};

publicRoute("GET", "/feeds/:token.ics", async (ctx) => {
  const talent = await one<{ id: string; display_name: string }>(
    pool,
    `SELECT t.id, t.display_name FROM feed_tokens f JOIN talent t ON t.id = f.talent_id
      WHERE f.token = $1 AND t.state = 'active'`,
    [ctx.params.token],
  );
  if (!talent) throw notFound();
  const options = await rows<OptionRow>(pool, `${OPTION_SELECT} WHERE o.talent_id = $1 ORDER BY o.job_date, o.placed_at`,
    [talent.id]);
  const stamp = icsStamp(ctx.now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vesper & Rowe Talent//Rungboard//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(`${talent.display_name} — Rungboard`)}`,
    ...options.flatMap((row) => [
      "BEGIN:VEVENT",
      `UID:option-${row.id}@rungboard.vesperrowe.example`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(row.job_date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(row.job_date, 1))}`,
      `SEQUENCE:${row.sequence}`,
      `STATUS:${STATUS[row.state]}`,
      `SUMMARY:${escapeText(summary(row))}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return { status: 200, raw: calendar(lines), contentType: "text/calendar; charset=utf-8" };
});
