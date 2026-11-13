// Ladder reports: compliance, defects and refusal. A report claims only photos the store confirmed.
import { portStamp } from "../../shared/portTime.js";
import { DEFECTS } from "../../shared/types.js";
import type { App } from "../app.js";
import { illegalTransition, invalid } from "../errors.js";
import type { LadderReportRecord, MoveRecord, PhotoRecord, UserRecord } from "../store.js";
import { Fields, objectBody } from "../validate.js";
import { raiseBillingEvent } from "./billing.js";
import { permits } from "./moveRules.js";
import { endDuty, save } from "./moves.js";
import { ladderNotice } from "./notices.js";

const CODES = new Set(DEFECTS.map((d) => d.code));

export function fileLadderReport(
  app: App,
  user: UserRecord,
  move: MoveRecord,
  photos: PhotoRecord[],
  raw: unknown,
  now: number,
): LadderReportRecord {
  const body = objectBody(raw);
  if (!permits("ladder_report", move)) throw illegalTransition();
  const refuse = body.refuse_boarding === true;
  if (refuse && !permits("refuse_boarding", move)) throw illegalTransition();

  const fields = new Fields(body);
  const compliant = typeof body.compliant === "boolean" ? body.compliant : null;
  if (compliant === null) fields.fail("compliant", "Say whether the ladder is compliant");
  const listed: unknown[] = Array.isArray(body.defects) ? body.defects : [];
  const defects = listed.filter((d): d is string => typeof d === "string" && CODES.has(d));
  if (!Array.isArray(body.defects) || defects.length !== listed.length || new Set(defects).size !== defects.length) {
    fields.fail("defects", "Choose defects from the published list");
  } else if (compliant === false && defects.length === 0) {
    fields.fail("defects", "Mark at least one defect on a non-compliant ladder");
  } else if (compliant === true && defects.length > 0) {
    fields.fail("defects", "A compliant ladder has no defects");
  }
  if (body.refuse_boarding !== undefined && typeof body.refuse_boarding !== "boolean") {
    fields.fail("refuse_boarding", "Refuse boarding is true or false");
  } else if (refuse && compliant !== false) {
    fields.fail("refuse_boarding", "Boarding can be refused only at a non-compliant ladder");
  }
  const location = body.location === undefined || body.location === "deck" ? "deck" : body.location === "pilot_boat" ? "pilot_boat" : null;
  if (location === null) fields.fail("location", "Filed from the deck or the pilot boat");
  const note = body.note === undefined ? "" : typeof body.note === "string" && body.note.length <= 2000 ? body.note : null;
  if (note === null) fields.fail("note", "Keep the note under 2,000 characters");
  if (fields.failed() || compliant === null || location === null || note === null) throw invalid(fields.errors);

  const seq = app.store.next("report", 3001);
  const report: LadderReportRecord = {
    id: `LR-${seq}`,
    seq,
    move_ref: move.ref,
    compliant,
    defects,
    refused: refuse,
    location,
    note,
    photo_ids: photos.map((p) => p.id),
    filed_by: user.name,
    filed_at: portStamp(now),
  };
  app.store.ladderReports.put(report);
  const updated: MoveRecord = { ...move, ladder_reports: [...move.ladder_reports, report.id] };
  if (!report.compliant) ladderNotice(app.store, updated, report, photos);
  if (!refuse) {
    save(app.store, updated, user, now);
    return report;
  }
  endDuty(app.store, move.ref, now);
  save(app.store, raiseBillingEvent(app, { ...updated, pilot_id: null }, "Refused at ladder", now), user, now, "Refused at ladder");
  return report;
}

export function reportView(app: App, report: LadderReportRecord) {
  return {
    id: report.id,
    move_ref: report.move_ref,
    compliant: report.compliant,
    defects: report.defects,
    refused: report.refused,
    location: report.location,
    note: report.note,
    photos: report.photo_ids.flatMap((id) => {
      const photo = app.store.photos.get(id);
      return photo ? [{ photo_id: photo.id, sha256: photo.sha256, size_bytes: photo.size_bytes }] : [];
    }),
    filed_by: report.filed_by,
    filed_at: report.filed_at,
  };
}
