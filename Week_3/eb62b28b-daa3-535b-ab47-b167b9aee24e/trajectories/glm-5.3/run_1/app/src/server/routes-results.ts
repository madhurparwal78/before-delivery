import type { Router, Request } from "express";
import type { AppContext } from "./route-context.js";
import { ApiError, sendError } from "./errors.js";
import { requireSession } from "./session.js";
import { copy, FIELD_ERRORS } from "../shared/copy.js";
import { parseResultsFile, flagResult, formatStoredValue } from "./domain.js";
import { MARKER_BY_ID } from "../shared/markers.js";
import { sha256Hex, newId } from "./crypto.js";
import { drawQuery, makeRun, type DrawFull } from "./routes-draws.js";
import { queueMail } from "./mailer.js";
import { instantZ } from "../shared/time.js";
import type { Flag } from "../shared/enums.js";
import { param, query } from "./request-utils.js";

export function registerResultsRoutes(router: Router, ctx: AppContext): void {
  const run = makeRun();

  const loadDraw = async (drawId: string): Promise<DrawFull> => {
    const row = (await drawQuery(`WHERE d.id = $1`, [drawId])(ctx.db))[0];
    if (!row) throw new ApiError(404, "not_found", copy("not_found"));
    return row;
  };

  router.post("/api/draws/:drawId/results-file/preview", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator", "specialist"], async (req2, res2) => {
      const draw = await loadDraw(param(req2, "drawId"));
      if (draw.state !== "collected" && draw.state !== "ready") {
        throw new ApiError(409, "not_collected", copy("not_collected"));
      }
      const parts = readParts(req2);
      const filePart = parts["file"];
      const fileText = typeof filePart === "string" ? filePart : filePart ? filePart.toString("utf8") : "";
      if (fileText.length === 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { file: FIELD_ERRORS.fileHeader });
      }
      const saved = await savedValues(ctx, draw.id);
      const outcome = parseResultsFile(fileText, draw.kit_codes, saved);
      if (!outcome.ok) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { file: outcome.message });
      }
      res2.json({ rows: outcome.rows });
    });
  });

  router.post("/api/draws/:drawId/results-file", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator", "specialist"], async (req2, res2) => {
      const draw = await loadDraw(param(req2, "drawId"));
      if (draw.state !== "collected" && draw.state !== "ready") {
        throw new ApiError(409, "not_collected", copy("not_collected"));
      }
      const parts = readParts(req2);
      const filePart = parts["file"];
      const fileText = typeof filePart === "string" ? filePart : filePart ? filePart.toString("utf8") : "";
      const reportBytes = parts["report"] as Buffer | undefined;
      if (fileText.length === 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { file: FIELD_ERRORS.fileHeader });
      }
      if (!reportBytes || reportBytes.length === 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { report: FIELD_ERRORS.reportRequired });
      }
      if (reportBytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { report: FIELD_ERRORS.reportPdf });
      }
      const existingReport = await ctx.db.one<{ object_key: string; sha256: string }>(
        `SELECT object_key, sha256 FROM draw_reports WHERE draw_id = $1`,
        [draw.id]
      );
      const reportHash = sha256Hex(reportBytes);
      if (existingReport && existingReport.sha256 !== reportHash) {
        throw new ApiError(409, "report_exists", copy("report_exists"));
      }
      const saved = await savedValues(ctx, draw.id);
      const outcome = parseResultsFile(fileText, draw.kit_codes, saved);
      if (!outcome.ok) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { file: outcome.message });
      }
      const member = await ctx.db.one<{ sex: string | null; date_of_birth: string | null; time_zone: string }>(
        `SELECT sex, date_of_birth::text AS date_of_birth, time_zone FROM members WHERE id = $1`,
        [draw.member_id]
      );
      let savedCount = 0;
      let unchangedCount = 0;
      // Store the report first: no result row is written if MinIO is unavailable.
      if (!existingReport) {
        const key = ctx.store.reportKey(draw.member_id, draw.id);
        const stored = await ctx.store.put(key, reportBytes, "application/pdf");
        if (stored === "unavailable") {
          throw new ApiError(503, "report_store_unavailable", copy("report_store_unavailable"));
        }
        await ctx.db.exec(
          `INSERT INTO draw_reports (draw_id, object_key, sha256, size_bytes) VALUES ($1, $2, $3, $4)`,
          [draw.id, key, reportHash, reportBytes.length]
        );
      }
      for (const row of outcome.rows) {
        if (row.status !== "matched") continue;
        if (saved.has(row.marker) && saved.get(row.marker) === row.value) {
          unchangedCount += 1;
          continue;
        }
        if (saved.has(row.marker)) continue;
        const flagged = await flagResult(
          ctx.db,
          row.marker,
          row.value,
          member?.sex ?? "female",
          member?.date_of_birth ?? "1990-01-01",
          member?.time_zone ?? "phoenix",
          draw.collected_at ?? draw.starts_at
        );
        await ctx.db.exec(
          `INSERT INTO results (id, draw_id, member_id, marker, value, flag, age_band,
            range_low, range_high, range_optimal_low, range_optimal_high, range_effective_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            newId("res"),
            draw.id,
            draw.member_id,
            row.marker,
            row.value,
            flagged?.flag ?? "inRange",
            flagged?.ageBand ?? "age18To39",
            flagged?.range.low ?? "0",
            flagged?.range.high ?? "0",
            flagged?.range.optimalLow ?? "0",
            flagged?.range.optimalHigh ?? "0",
            flagged?.range.effectiveFrom ?? "2020-01-01",
          ]
        );
        savedCount += 1;
      }
      const hasResults =
        (await ctx.db.one<{ count: string }>(`SELECT count(*)::text AS count FROM results WHERE draw_id = $1`, [
          draw.id,
        ]))?.count !== "0";
      if (hasResults && draw.state === "collected") {
        await ctx.db.exec(`UPDATE draws SET state = 'ready' WHERE id = $1`, [draw.id]);
      }
      const updated = (await drawQuery(`WHERE d.id = $1`, [draw.id])(ctx.db))[0];
      if (!updated) throw new ApiError(500, "internal_error", "Something went wrong.");
      const status = savedCount === 0 && existingReport ? 200 : 201;
      res2.status(status).json({
        draw: { id: updated.id, state: updated.state },
        saved: savedCount,
        unchanged: unchangedCount,
      });
    });
  });

  router.post("/api/draws/:drawId/results", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator", "specialist"], async (req2, res2) => {
      const draw = await loadDraw(param(req2, "drawId"));
      if (draw.state !== "collected" && draw.state !== "ready") {
        throw new ApiError(409, "not_collected", copy("not_collected"));
      }
      const body = req2.body as { results?: unknown };
      const results = Array.isArray(body.results) ? body.results : [];
      const fields: Record<string, string> = {};
      const parsed: { marker: string; value: string }[] = [];
      results.forEach((item, index) => {
        if (typeof item === "object" && item !== null) {
          const marker = (item as Record<string, unknown>)["marker"];
          const value = (item as Record<string, unknown>)["value"];
          if (typeof marker === "string" && MARKER_BY_ID.has(marker)) {
            if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
              parsed.push({ marker, value });
              return;
            }
            fields[`results.${index}.value`] = FIELD_ERRORS.valueNumber;
            return;
          }
          fields[`results.${index}.marker`] = FIELD_ERRORS.markerChoice;
          return;
        }
        fields[`results.${index}.marker`] = FIELD_ERRORS.markerChoice;
      });
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const member = await ctx.db.one<{ sex: string | null; date_of_birth: string | null; time_zone: string }>(
        `SELECT sex, date_of_birth::text AS date_of_birth, time_zone FROM members WHERE id = $1`,
        [draw.member_id]
      );
      let savedCount = 0;
      for (const item of parsed) {
        const existing = await ctx.db.one<{ id: string }>(
          `SELECT id FROM results WHERE draw_id = $1 AND marker = $2`,
          [draw.id, item.marker]
        );
        if (existing) continue;
        const formatted = formatStoredValue(item.value, item.marker);
        const flagged = await flagResult(
          ctx.db,
          item.marker,
          formatted,
          member?.sex ?? "female",
          member?.date_of_birth ?? "1990-01-01",
          member?.time_zone ?? "phoenix",
          draw.collected_at ?? draw.starts_at
        );
        await ctx.db.exec(
          `INSERT INTO results (id, draw_id, member_id, marker, value, flag, age_band,
            range_low, range_high, range_optimal_low, range_optimal_high, range_effective_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            newId("res"),
            draw.id,
            draw.member_id,
            item.marker,
            formatted,
            flagged?.flag ?? "inRange",
            flagged?.ageBand ?? "age18To39",
            flagged?.range.low ?? "0",
            flagged?.range.high ?? "0",
            flagged?.range.optimalLow ?? "0",
            flagged?.range.optimalHigh ?? "0",
            flagged?.range.effectiveFrom ?? "2020-01-01",
          ]
        );
        savedCount += 1;
      }
      const report = await ctx.db.one<{ draw_id: string }>(`SELECT draw_id FROM draw_reports WHERE draw_id = $1`, [
        draw.id,
      ]);
      if (report && draw.state === "collected") {
        await ctx.db.exec(`UPDATE draws SET state = 'ready' WHERE id = $1`, [draw.id]);
      }
      const updated = (await drawQuery(`WHERE d.id = $1`, [draw.id])(ctx.db))[0];
      if (!updated) throw new ApiError(500, "internal_error", "Something went wrong.");
      res2.status(201).json({ draw: { id: updated.id, state: updated.state }, saved: savedCount });
    });
  });

  router.post("/api/draws/:drawId/report", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator", "specialist"], async (req2, res2) => {
      const draw = await loadDraw(param(req2, "drawId"));
      if (draw.state !== "collected" && draw.state !== "ready") {
        throw new ApiError(409, "not_collected", copy("not_collected"));
      }
      const parts = readParts(req2);
      const reportBytes = parts["report"] as Buffer | undefined;
      if (!reportBytes || reportBytes.length === 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { report: FIELD_ERRORS.reportRequired });
      }
      if (reportBytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { report: FIELD_ERRORS.reportPdf });
      }
      const existing = await ctx.db.one<{ sha256: string }>(`SELECT sha256 FROM draw_reports WHERE draw_id = $1`, [
        draw.id,
      ]);
      const hash = sha256Hex(reportBytes);
      if (existing && existing.sha256 !== hash) {
        throw new ApiError(409, "report_exists", copy("report_exists"));
      }
      if (!existing) {
        const key = ctx.store.reportKey(draw.member_id, draw.id);
        const stored = await ctx.store.put(key, reportBytes, "application/pdf");
        if (stored === "unavailable") {
          throw new ApiError(503, "report_store_unavailable", copy("report_store_unavailable"));
        }
        await ctx.db.exec(
          `INSERT INTO draw_reports (draw_id, object_key, sha256, size_bytes) VALUES ($1, $2, $3, $4)`,
          [draw.id, key, hash, reportBytes.length]
        );
        const hasResults =
          (await ctx.db.one<{ count: string }>(`SELECT count(*)::text AS count FROM results WHERE draw_id = $1`, [
            draw.id,
          ]))?.count !== "0";
        if (hasResults && draw.state === "collected") {
          await ctx.db.exec(`UPDATE draws SET state = 'ready' WHERE id = $1`, [draw.id]);
        }
      }
      const updated = (await drawQuery(`WHERE d.id = $1`, [draw.id])(ctx.db))[0];
      if (!updated) throw new ApiError(500, "internal_error", "Something went wrong.");
      res2.status(201).json({ draw: { id: updated.id, state: updated.state } });
    });
  });

  router.get("/api/draws/:drawId/report", async (req, res) => {
    await run(ctx, req, res, ["owner", "coordinator", "specialist", "member"], async (req2, res2, person) => {
      const draw = await loadDraw(param(req2, "drawId"));
      if (person.role === "member" && draw.member_id !== person.id) {
        throw new ApiError(404, "not_found", copy("not_found"));
      }
      if (person.role === "member" && draw.state !== "released") {
        throw new ApiError(404, "not_found", copy("not_found"));
      }
      const report = await ctx.db.one<{ object_key: string }>(`SELECT object_key FROM draw_reports WHERE draw_id = $1`, [
        draw.id,
      ]);
      if (!report) throw new ApiError(404, "not_found", copy("not_found"));
      const bytes = await ctx.store.get(report.object_key);
      if (bytes === null || bytes === "unavailable") {
        throw new ApiError(503, "report_store_unavailable", copy("report_store_unavailable"));
      }
      res2.setHeader("Content-Type", "application/pdf");
      res2.send(bytes);
    });
  });

  router.post("/api/draws/:drawId/release", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2, person) => {
      const draw = await loadDraw(param(req2, "drawId"));
      if (draw.state !== "ready") {
        throw new ApiError(409, "not_ready", copy("release_not_ready"));
      }
      await ctx.db.exec(`UPDATE draws SET state = 'released', released_at = now(), released_by = $2 WHERE id = $1`, [
        draw.id,
        person.name,
      ]);
      const member = await ctx.db.one<{ email: string; name: string }>(`SELECT email, name FROM members WHERE id = $1`, [
        draw.member_id,
      ]);
      if (member) {
        await queueMail(ctx.db, {
          to: member.email,
          subject: "Your new results are ready",
          body: `Hello ${member.name.split(" ")[0]},\n\nYour new results are ready to read.\n\nOpen them here: ${ctx.config.publicUrl}/me/results`,
          memberId: draw.member_id,
        });
      }
      const updated = (await drawQuery(`WHERE d.id = $1`, [draw.id])(ctx.db))[0];
      if (!updated) throw new ApiError(500, "internal_error", "Something went wrong.");
      res2.json({ draw: { id: updated.id, state: updated.state } });
    });
  });

  router.patch("/api/results/:resultId", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2, person) => {
      const resultId = param(req2, "resultId");
      const row = await ctx.db.one<{
        id: string;
        member_id: string;
        draw_id: string;
        marker: string;
        value: string;
        note: string | null;
      }>(
        `SELECT id, member_id, draw_id, marker, value, note FROM results WHERE id = $1`,
        [resultId]
      );
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      const draw = await ctx.db.one<{ state: string; collected_at: Date | null; starts_at: Date }>(
        `SELECT state, collected_at, starts_at FROM draws WHERE id = $1`,
        [row.draw_id]
      );
      if (draw && !["collected", "ready", "released"].includes(draw.state)) {
        throw new ApiError(409, "not_collected", copy("not_collected"));
      }
      const body = req2.body as { value?: unknown; note?: unknown };
      const fields: Record<string, string> = {};
      const value = typeof body.value === "string" ? body.value : "";
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        fields["value"] = FIELD_ERRORS.valueNumber;
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const marker = MARKER_BY_ID.get(row.marker);
      const formatted = formatStoredValue(value, row.marker);
      await ctx.db.exec(
        `INSERT INTO result_history (id, result_id, value, note, by, at) VALUES ($1, $2, $3, $4, $5, now())`,
        [newId("resh"), row.id, row.value, row.note, person.name]
      );
      const member = await ctx.db.one<{ sex: string | null; date_of_birth: string | null; time_zone: string }>(
        `SELECT sex, date_of_birth::text AS date_of_birth, time_zone FROM members WHERE id = $1`,
        [row.member_id]
      );
      const flagged = await flagResult(
        ctx.db,
        row.marker,
        formatted,
        member?.sex ?? "female",
        member?.date_of_birth ?? "1990-01-01",
        member?.time_zone ?? "phoenix",
        draw?.collected_at ?? draw?.starts_at ?? new Date()
      );
      const noteValue = typeof body.note === "string" ? body.note : row.note;
      await ctx.db.exec(
        `UPDATE results SET value = $2, flag = $3, note = $4, corrected_by = $5, corrected_at = now()
         WHERE id = $1`,
        [row.id, formatted, flagged?.flag ?? "inRange", noteValue, person.name]
      );
      const markerName = marker?.name ?? row.marker;
      res2.json({
        result: {
          id: row.id,
          marker: row.marker,
          value: formatted,
          flag: (flagged?.flag ?? "inRange") as Flag,
          note: noteValue,
          correctedBy: person.name,
          correctedAt: instantZ(new Date()),
          markerName,
        },
      });
    });
  });

  router.get("/api/results/:resultId/history", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2) => {
      const resultId = param(req2, "resultId");
      const rows = await ctx.db.query<{ value: string; note: string | null; by: string; at: Date }>(
        `SELECT value, note, by, at FROM result_history WHERE result_id = $1 ORDER BY at DESC`,
        [resultId]
      );
      res2.json({
        history: rows.map((row) => ({
          value: row.value,
          note: row.note,
          by: row.by,
          at: instantZ(row.at),
        })),
      });
    });
  });
}

async function savedValues(ctx: AppContext, drawId: string): Promise<Map<string, string>> {
  const rows = await ctx.db.query<{ marker: string; value: string }>(
    `SELECT marker, value FROM results WHERE draw_id = $1`,
    [drawId]
  );
  return new Map(rows.map((row) => [row.marker, row.value]));
}

type MultipartParts = Record<string, string | Buffer | undefined>;

export function readParts(req: Request): MultipartParts {
  const raw = (req as Request & { parsedParts?: MultipartParts }).parsedParts;
  if (raw) return raw;
  return {};
}

