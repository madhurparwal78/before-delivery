/**
 * The owner projection, decided here once: every record builder produces the full shape, and an owner caller
 * receives only what this module lets through (no notes, revisions, store keys, claims, lot, assignment,
 * decider or recorder).
 */
import type { Boat, Drawing, Role, SailAccount, Submission } from "../shared/types.js";

const isOwner = (role: Role): boolean => role === "yacht-owner";

export function projectBoat(boat: Boat, role: Role): Boat {
  if (!isOwner(role)) return boat;
  return {
    code: boat.code,
    name: boat.name,
    class_name: boat.class_name,
    owner: boat.owner,
    foretriangle: boat.foretriangle,
    dimensions: boat.dimensions.map((dimension) => ({
      ...dimension,
      measurements: dimension.measurements.map((m) => ({ ...m, photo: m.photo ? { size: m.photo.size, sha256: m.photo.sha256 } : null })),
    })),
  };
}

export function projectDrawing(drawing: Drawing, role: Role): Drawing {
  if (!isOwner(role)) return drawing;
  const sheet = drawing.cut_sheet;
  return {
    code: drawing.code,
    boat_code: drawing.boat_code,
    boat_name: drawing.boat_name,
    sail: drawing.sail,
    status: drawing.status,
    area: drawing.area,
    panels: drawing.panels.map((panel) => ({
      number: panel.number,
      outline: panel.outline,
      length_mm: panel.length_mm,
      width_mm: panel.width_mm,
      area_mm2: panel.area_mm2,
      area_m2: panel.area_m2,
      area_ft2: panel.area_ft2,
      cut: panel.cut,
    })),
    cut_sheet: sheet ? { sha256: sheet.sha256, size: sheet.size, superseded_by: sheet.superseded_by } : null,
    predecessor: drawing.predecessor,
    successor: drawing.successor,
  };
}

export function projectSubmission(submission: Submission, role: Role): Submission {
  if (!isOwner(role)) return submission;
  const { decided_by: _decider, ...shown } = submission;
  return shown;
}

export function projectSailAccount(account: SailAccount, role: Role): SailAccount {
  if (!isOwner(role)) return account;
  return { ...account, entries: account.entries.map(({ recorded_by: _recorder, ...entry }) => entry) };
}
