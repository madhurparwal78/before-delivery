// Step 3 of the error order: look up a resource the signed-in person may see, else 404.
// A player sees only their visible folders, the parts in them and those parts' marked-part scans.

import { isSeated, folderVisible } from "./domain/seating.js";
import type { Db } from "./db.js";
import { notFound } from "./errors.js";
import type { Person } from "./people.js";
import { chairKeysOf, loadProgrammes, loadWork, stringCountOf, type PartRow, type ProgrammeModel, type WorkModel } from "./readModel.js";
import { rows } from "./db.js";

/** Whether the person's own folder for this programme is visible now (decided from stored data). */
export function folderVisibleTo(person: Person, model: ProgrammeModel): boolean {
  if (person.seat === null) return false;
  return folderVisible(model.row.status, isSeated(person.seat, stringCountOf(model.row), chairKeysOf(model)));
}

const seesEverything = (person: Person): boolean => person.role !== "player";

export async function visibleProgramme(db: Db, person: Person, id: string): Promise<ProgrammeModel> {
  const [model] = await loadProgrammes(db, [id]);
  if (!model || (!seesEverything(person) && !folderVisibleTo(person, model))) throw notFound();
  return model;
}

export async function visibleWork(db: Db, person: Person, id: string): Promise<{ model: ProgrammeModel; work: WorkModel }> {
  const found = seesEverything(person) ? await loadWork(db, id) : null;
  if (!found) throw notFound();
  return found;
}

interface PartContext {
  model: ProgrammeModel;
  work: WorkModel;
  part: PartRow;
}

/** A part, for a player only when it is their chair's part in a visible folder. */
export async function visiblePart(db: Db, person: Person, id: string): Promise<PartContext> {
  const [owner] = await rows<{ work_id: string }>(db, "SELECT work_id FROM parts WHERE id = $1", [id]);
  const found = owner ? await loadWork(db, owner.work_id) : null;
  const part = found?.work.parts.find((p) => p.id === id);
  if (!found || !part) throw notFound();
  if (!seesEverything(person) && !(folderVisibleTo(person, found.model) && part.chair_key === person.seat?.key)) {
    throw notFound();
  }
  return { ...found, part };
}
