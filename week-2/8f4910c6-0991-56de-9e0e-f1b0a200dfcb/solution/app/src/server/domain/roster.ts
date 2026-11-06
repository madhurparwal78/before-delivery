// Legacy roster import (matching, unit parsing, merge, orphans) and the roster export.

import { exec, pool, rows, tx } from "../db.js";
import { memberRoute, json } from "../http.js";
import { ApiError } from "../errors.js";
import { csv, number, parseCsv, text } from "../csv.js";
import { parseGirth, parseHeight } from "../../shared/measure.js";
import { normalName } from "../../shared/text.js";
import { isIsoDate, type OfficeId } from "../../shared/zones.js";
import type { Board } from "./fees.js";
import { createTalent, type TalentRow } from "./talent.js";

const ROSTER_HEADER = ["Email", "First Name", "Last Name", "Date of Birth", "Office", "Division", "Height",
  "Chest", "Waist", "Hips", "Instagram", "TikTok", "YouTube"];
const ROSTER_LIMIT = 2_000_000;
const HEADER_COPY = "The header row does not match the roster export format.";

const OFFICE_NAMES: Record<string, OfficeId> = { toronto: "toronto", tor: "toronto", vancouver: "vancouver", van: "vancouver" };
const DIVISIONS: Record<string, Board> = { women: "women", men: "men", creators: "creators", digital: "creators",
  "new faces": "new_faces" };
const OFFICE_LABEL: Record<OfficeId, string> = { toronto: "Toronto", vancouver: "Vancouver" };
const DIVISION_LABEL: Record<Board, string> = { women: "Women", men: "Men", creators: "Creators", new_faces: "New Faces" };

type Outcome = "created" | "merged" | "unchanged" | "orphan";
type Fillable = "email" | "dateOfBirth" | "heightCm" | "chestCm" | "waistCm" | "hipsCm" | "instagram" | "tiktok" | "youtube";
const COLUMN: Record<Fillable, keyof TalentRow> = {
  email: "email", dateOfBirth: "date_of_birth", heightCm: "height_cm", chestCm: "chest_cm", waistCm: "waist_cm",
  hipsCm: "hips_cm", instagram: "instagram", tiktok: "tiktok", youtube: "youtube",
};

interface ReportRow {
  row: number;
  outcome: Outcome;
  talentId: string | null;
  reason: string | null;
  filled: string[];
}

function reachValue(raw: string): number | null {
  const value = raw.trim();
  return /^(\d{1,3}(,\d{3})+|\d+)$/.test(value) ? Number(value.replace(/,/g, "")) : null;
}

memberRoute("POST", "/api/roster/imports", async (ctx) => {
  ctx.allow("agency_director");
  const file = await ctx.upload(ROSTER_LIMIT);
  const lines = parseCsv((file?.data ?? Buffer.alloc(0)).toString("utf8").replace(/^﻿/, ""));
  const header = lines[0]?.map((cell) => cell.trim());
  if (!header || header.join(",") !== ROSTER_HEADER.join(",")) {
    throw new ApiError(422, "validation", { errors: { file: HEADER_COPY } });
  }
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('roster-import', 0))");
    const known = await rows<TalentRow>(client, "SELECT * FROM talent WHERE state <> 'erased' ORDER BY created_at, id");
    const report: ReportRow[] = [];
    for (const [index, cells] of lines.slice(1).entries()) {
      const at = index + 2;
      const cell = (name: string) => (cells[ROSTER_HEADER.indexOf(name)] ?? "").trim();
      const orphan = (reason: string) => report.push({ row: at, outcome: "orphan", talentId: null, reason, filled: [] });
      const email = cell("Email");
      const dobText = cell("Date of Birth");
      if (!email && !dobText) {
        orphan("no_identity");
        continue;
      }
      const office = OFFICE_NAMES[cell("Office").toLowerCase()];
      if (!office) {
        orphan("unknown_office");
        continue;
      }
      const board = DIVISIONS[cell("Division").toLowerCase().replace(/\s+/g, " ")];
      if (!board) {
        orphan("unknown_division");
        continue;
      }
      const dob = dobText && isIsoDate(dobText) ? dobText : null;
      const name = normalName(`${cell("First Name")} ${cell("Last Name")}`);
      const match = (email && known.find((t) => t.email && t.email.trim().toLowerCase() === email.toLowerCase()))
        || (dob && known.find((t) => t.date_of_birth === dob && normalName(t.display_name) === name)) || null;
      const heightText = cell("Height");
      const height = heightText ? parseHeight(heightText) : null;
      if (!match && heightText && height === null) {
        orphan("bad_height");
        continue;
      }
      if (dobText && !dob) {
        orphan("bad_date");
        continue;
      }
      const values: Record<Fillable, string | number | null> = {
        email: email || null,
        dateOfBirth: dob,
        heightCm: height,
        chestCm: cell("Chest") ? parseGirth(cell("Chest")) : null,
        waistCm: cell("Waist") ? parseGirth(cell("Waist")) : null,
        hipsCm: cell("Hips") ? parseGirth(cell("Hips")) : null,
        instagram: reachValue(cell("Instagram")),
        tiktok: reachValue(cell("TikTok")),
        youtube: reachValue(cell("YouTube")),
      };
      if (match) {
        const filled = (Object.keys(values) as Fillable[]).filter((key) => values[key] !== null && match[COLUMN[key]] === null);
        if (filled.length) {
          await exec(
            client,
            `UPDATE talent SET ${filled.map((key, i) => `${COLUMN[key]} = $${i + 4}`).join(", ")},
               version = version + 1, saved_by = $2, saved_at = $3 WHERE id = $1`,
            [match.id, ctx.member.name, new Date(ctx.now), ...filled.map((key) => values[key])],
          );
          for (const key of filled) Object.assign(match, { [COLUMN[key]]: values[key] });
        }
        report.push({ row: at, outcome: filled.length ? "merged" : "unchanged", talentId: match.id, reason: null, filled });
        continue;
      }
      const displayName = `${cell("First Name")} ${cell("Last Name")}`.trim().replace(/\s+/g, " ");
      const numeric = (value: string | number | null) => (typeof value === "number" ? value : null);
      const id = await createTalent(client, {
        displayName, office, board, email: email || null, dateOfBirth: dob, heightCm: numeric(values.heightCm),
        chestCm: numeric(values.chestCm), waistCm: numeric(values.waistCm), hipsCm: numeric(values.hipsCm),
        instagram: numeric(values.instagram), tiktok: numeric(values.tiktok), youtube: numeric(values.youtube),
      }, ctx.member.name);
      known.push(...(await rows<TalentRow>(client, "SELECT * FROM talent WHERE id = $1", [id])));
      report.push({ row: at, outcome: "created", talentId: id, reason: null, filled: [] });
    }
    const count = (outcome: Outcome) => report.filter((row) => row.outcome === outcome).length;
    return json(200, {
      counts: { created: count("created"), merged: count("merged"), unchanged: count("unchanged"), orphan: count("orphan") },
      rows: report,
    });
  });
});

memberRoute("GET", "/api/roster/export.csv", async (ctx) => {
  ctx.allow("agency_director");
  const active = await rows<TalentRow>(pool,
    `SELECT * FROM talent WHERE state = 'active' ORDER BY display_name COLLATE "und-x-icu", id`);
  const cm = (value: number | null) => text(value === null ? "" : `${value} cm`);
  const body = active.map((row) => {
    const split = row.display_name.lastIndexOf(" ");
    return [
      text(row.email), text(split > 0 ? row.display_name.slice(0, split) : row.display_name),
      text(split > 0 ? row.display_name.slice(split + 1) : ""), text(row.date_of_birth),
      text(OFFICE_LABEL[row.office_id]), text(DIVISION_LABEL[row.board]), cm(row.height_cm), cm(row.chest_cm),
      cm(row.waist_cm), cm(row.hips_cm), number(row.instagram), number(row.tiktok), number(row.youtube),
    ];
  });
  return {
    status: 200,
    raw: csv(ROSTER_HEADER, body),
    contentType: "text/csv; charset=utf-8",
    headers: { "Content-Disposition": 'attachment; filename="roster.csv"' },
  };
});
