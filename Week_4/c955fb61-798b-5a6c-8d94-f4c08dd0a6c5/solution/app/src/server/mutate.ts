import type { PoolClient } from "pg";
import type { ChangeNote, Item, Moved, Person } from "../shared/types";
import { inTransaction } from "./db";
import { buildProject, loadProject, type LoadedProject } from "./model";
import type { ItemSchedule } from "./schedule";
import { publishProjectChange } from "./live";

interface Change {
  kind: ChangeNote["kind"];
  itemId: string | null;
  itemName: string | null;
  /** Whether the change counts as an edit for the knock-on and the shifted marks. */
  schedule: boolean;
}

export interface Mutated {
  before: LoadedProject;
  after: LoadedProject;
  moved: Moved[];
  rev: number;
}

/** The items other than the edited one whose shown start or end changed, groups left out, in row order. */
function movedItems(before: LoadedProject, after: LoadedProject, editedId: string | null): Moved[] {
  return after.items.flatMap((item) => {
    const now = after.schedule.items[item.id];
    const was = before.schedule.items[item.id] as ItemSchedule | undefined;
    if (item.kind === "group" || item.id === editedId || !was || !now.start || !now.end) return [];
    return was.start === now.start && was.end === now.end ? [] : [{ id: item.id, start: now.start, end: now.end }];
  });
}

export function itemOf(loaded: LoadedProject, itemId: string): Item {
  return buildProject(loaded).items.filter((item) => item.id === itemId)[0];
}

type Pending = Change & { editedId: string | null };
type Work = (tx: PoolClient, before: LoadedProject) => Promise<Pending | null>;

/**
 * One accepted edit: the project is locked, the work runs, the whole project is recomputed once, and the
 * result is pushed to everyone who has it open. Work that finds nothing to change returns null.
 */
export function mutateProject(projectId: string, actor: Person, work: (tx: PoolClient, before: LoadedProject) => Promise<Pending>): Promise<Mutated>;
export function mutateProject(projectId: string, actor: Person, work: Work): Promise<Mutated | null>;
export async function mutateProject(projectId: string, actor: Person, work: Work): Promise<Mutated | null> {
  const done = await inTransaction(async (tx) => {
    const before = await loadProject(tx, projectId, true);
    const change = await work(tx, before);
    if (!change) return null;
    const loaded = await loadProject(tx, projectId);
    const rev = (await tx.query("UPDATE projects SET rev = rev + 1 WHERE id = $1 RETURNING rev", [projectId])).rows[0].rev as number;
    const after = { ...loaded, rev };
    return { before, after, change, moved: movedItems(before, after, change.editedId), rev };
  });
  if (!done) return null;
  const { before, after, change, moved, rev } = done;
  publishProjectChange(after.workspaceId, projectId, {
    type: "project",
    rev,
    project: buildProject(after),
    change: {
      kind: change.kind,
      actor: { id: actor.id, name: actor.name },
      itemId: change.itemId,
      itemName: change.itemName,
      schedule: change.schedule,
      moved: moved.map((entry) => entry.id),
      previousLinks: before.links.map((link) => ({ from: link.from, to: link.to })),
    },
  });
  return { before, after, moved, rev };
}
