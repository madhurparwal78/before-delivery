// Works, cuts, copies on hand and marks.

import { randomUUID } from "node:crypto";
import type { ProgrammeSummary, WorkDetail } from "../../shared/api.js";
import { visiblePart, visibleWork } from "../access.js";
import { pgCode, pool, rows, transaction } from "../db.js";
import { conflict, forbidden, invalid, notFound, programmeClosed } from "../errors.js";
import { jsonBody, route } from "../http.js";
import { authenticate, hasRole, ownSectionPart, requireRole } from "../people.js";
import {
  overlaps,
  loadProgrammes,
  loadScans,
  loadWork,
  partJson,
  workDetailOf,
  workSummary,
  type ProgrammeModel,
} from "../readModel.js";
import { field, isIntegerIn } from "../validate.js";
import { closedGuard, summaryOf } from "./programmes.js";

route("GET", "/api/works/{id}", "none", async (request) => {
  const person = await authenticate(pool, request);
  const { model, work } = await visibleWork(pool, person, request.params.id ?? "");
  requireRole(person, "PAS");
  return { status: 200, json: await workDetailOf(pool, model, work) };
});

async function cutResponse(workId: string): Promise<{ work: WorkDetail; programme: ProgrammeSummary }> {
  const found = await loadWork(pool, workId);
  if (!found) throw notFound();
  return { work: await workDetailOf(pool, found.model, found.work), programme: await summaryOf(pool, found.model) };
}

route("POST", "/api/works/{id}/cuts", "json", async (request) => {
  const person = await authenticate(pool, request);
  const { model, work } = await visibleWork(pool, person, request.params.id ?? "");
  requireRole(person, "P");
  closedGuard(model);
  const body = jsonBody(request);
  const from = field(body, "from_bar");
  const to = field(body, "to_bar");
  const bars = work.barMap.at(-1)?.to_bar ?? 0;
  const spanValid = isIntegerIn(from, 1, bars) && isIntegerIn(to, 1, bars) && from <= to;
  const cutId = await transaction(async (client) => {
    const [locked] = await rows<{ status: string }>(
      client,
      "SELECT p.status FROM works w JOIN programmes p ON p.id = w.programme_id WHERE w.id = $1 FOR NO KEY UPDATE OF w",
      [work.row.id],
    );
    if (locked?.status === "closed") throw programmeClosed();
    if (!spanValid) {
      const errors: Record<string, string> = {};
      const message = `Enter a whole bar number from 1 to ${bars}.`;
      if (!isIntegerIn(from, 1, bars)) errors.from_bar = message;
      if (!isIntegerIn(to, 1, bars)) errors.to_bar = message;
      if (Object.keys(errors).length === 0) errors.to_bar = "The last bar must not come before the first bar.";
      throw invalid(errors);
    }
    const existing = await rows<{ from_bar: number; to_bar: number }>(client, "SELECT from_bar, to_bar FROM cuts WHERE work_id = $1", [work.row.id]);
    if (existing.some((cut) => cut.from_bar <= to && from <= cut.to_bar)) {
      throw conflict("cut_overlaps", `Bars ${from}–${to} overlap an existing cut.`);
    }
    const removed = existing.reduce((total, cut) => total + cut.to_bar - cut.from_bar + 1, to - from + 1);
    if (removed >= bars) throw conflict("cut_removes_whole_work", "A cut can't remove every bar of a work.");
    const id = `cut-${randomUUID()}`;
    try {
      await client.query("INSERT INTO cuts (id, work_id, from_bar, to_bar, created_at) VALUES ($1, $2, $3, $4, now())", [
        id,
        work.row.id,
        from,
        to,
      ]);
    } catch (error) {
      if (pgCode(error) === "23P01") throw conflict("cut_overlaps", `Bars ${from}–${to} overlap an existing cut.`);
      throw error;
    }
    return id;
  });
  const response = await cutResponse(work.row.id);
  return { status: 201, json: { cut: response.work.cuts.find((cut) => cut.id === cutId), ...response } };
});

route("DELETE", "/api/cuts/{id}", "none", async (request) => {
  const person = await authenticate(pool, request);
  const [owner] = await rows<{ work_id: string }>(pool, "SELECT work_id FROM cuts WHERE id = $1", [request.params.id ?? ""]);
  if (!owner) throw notFound();
  const { model, work } = await visibleWork(pool, person, owner.work_id);
  requireRole(person, "P");
  closedGuard(model);
  await transaction(async (client) => {
    const [locked] = await rows<{ status: string }>(
      client,
      "SELECT p.status FROM works w JOIN programmes p ON p.id = w.programme_id WHERE w.id = $1 FOR NO KEY UPDATE OF w",
      [work.row.id],
    );
    if (locked?.status === "closed") throw programmeClosed();
    const deleted = await client.query("DELETE FROM cuts WHERE id = $1", [request.params.id]);
    if (deleted.rowCount === 0) throw notFound();
  });
  return { status: 200, json: await cutResponse(work.row.id) };
});

async function partResponse(model: ProgrammeModel, partId: string) {
  const [fresh] = await loadProgrammes(pool, [model.row.id]);
  const work = fresh?.works.find((w) => w.parts.some((p) => p.id === partId));
  const part = work?.parts.find((p) => p.id === partId);
  if (!fresh || !work || !part) throw notFound();
  return { fresh, work, part: partJson(fresh, work, part, await loadScans(pool, [partId])) };
}

route("PUT", "/api/parts/{id}/holdings", "json", async (request) => {
  const person = await authenticate(pool, request);
  const { model, part } = await visiblePart(pool, person, request.params.id ?? "");
  requireRole(person, "PA");
  closedGuard(model);
  const copies = field(jsonBody(request), "copies_on_hand");
  if (!isIntegerIn(copies, 0, 99)) throw invalid({ copies_on_hand: "Copies on hand must be a whole number from 0 to 99." });
  const updated = await pool.query(
    `UPDATE parts SET copies_on_hand = $2 WHERE id = $1
     AND (SELECT p.status FROM works w JOIN programmes p ON p.id = w.programme_id WHERE w.id = parts.work_id) <> 'closed'`,
    [part.id, copies],
  );
  if (updated.rowCount === 0) throw programmeClosed();
  const { fresh, work, part: json } = await partResponse(model, part.id);
  return { status: 200, json: { part: json, work: workSummary(fresh, work), programme: await summaryOf(pool, fresh) } };
});

route("POST", "/api/parts/{id}/marks", "json", async (request) => {
  const person = await authenticate(pool, request);
  const { model, work, part } = await visiblePart(pool, person, request.params.id ?? "");
  const cutId = field(jsonBody(request), "cut_id");
  const cut = typeof cutId === "string" ? work.cuts.find((c) => c.id === cutId) : undefined;
  if (typeof cutId === "string" && !cut) throw notFound();
  if (!hasRole(person, "PA") && !ownSectionPart(person, part.chair_key)) throw forbidden();
  closedGuard(model);
  if (!cut) throw invalid({ cut_id: "Choose a cut of this work." });
  if (!overlaps(part, cut)) throw invalid({ cut_id: `${part.name} doesn't play in bars ${cut.from_bar}–${cut.to_bar}.` });
  let stored: boolean;
  try {
    const inserted = await pool.query(
      `INSERT INTO marks (part_id, cut_id, marked_by, marked_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING`,
      [part.id, cut.id, person.id],
    );
    stored = inserted.rowCount === 1;
  } catch (error) {
    if (pgCode(error) === "23503") throw notFound();
    throw error;
  }
  const { part: json } = await partResponse(model, part.id);
  if (!json.marks.some((mark) => mark.cut_id === cut.id)) throw notFound();
  return { status: stored ? 201 : 200, json: { part: json } };
});
