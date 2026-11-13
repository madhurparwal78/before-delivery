import type { FolderPage } from '../../shared/api.js';
import type { ProgrammeAggregate, WorkAggregate } from '../data/programmes.js';
import { loadProgrammeAggregates, stringCountOf } from '../data/programmes.js';
import type { Queryable } from '../db/pool.js';
import { folderIsVisible } from '../domain/seating.js';
import type { Person } from '../http/context.js';
import { notFound } from '../http/errors.js';
import { scanView } from '../view/programme-view.js';

function chairOfPerson(person: Person) {
  const chair = person.chair;
  if (!chair) throw notFound();
  return chair;
}

/** Folders are visible only while the programme is published or in performance and the player is seated. */
export async function visibleFolders(db: Queryable, person: Person): Promise<ProgrammeAggregate[]> {
  const chair = chairOfPerson(person);
  const aggregates = await loadProgrammeAggregates(db, null);
  return aggregates.filter((aggregate) =>
    folderIsVisible(
      aggregate.row.status,
      chair,
      stringCountOf(aggregate.row),
      new Set(aggregate.works.flatMap((work) => work.parts.map((part) => part.chair_key))),
    ),
  );
}

export async function visibleFolder(
  db: Queryable,
  person: Person,
  programmeId: string,
): Promise<ProgrammeAggregate> {
  const folders = await visibleFolders(db, person);
  const folder = folders.find((aggregate) => aggregate.row.id === programmeId);
  if (!folder) throw notFound();
  return folder;
}

export function folderPages(aggregate: ProgrammeAggregate, chairKey: string): FolderPage[] {
  return aggregate.works.flatMap((work) =>
    work.parts.filter((part) => part.chair_key === chairKey).map((part) => folderPage(work, part.id)),
  );
}

export function folderPage(work: WorkAggregate, partId: string): FolderPage {
  const part = work.parts.find((entry) => entry.id === partId);
  if (!part) throw notFound();
  const latest = work.latestScans.get(part.id)?.marked_part;
  const scan = latest ? scanView(latest) : null;
  return {
    part_id: part.id,
    work_id: work.row.id,
    work_title: work.row.title,
    composer: work.row.composer,
    part_name: part.name,
    bars_from: part.bars_from,
    bars_to: part.bars_to,
    cuts: work.cuts.map((cut) => ({ from_bar: cut.from_bar, to_bar: cut.to_bar })),
    rehearsal_letters: work.letters
      .filter((letter) => !work.cuts.some((cut) => letter.bar >= cut.from_bar && letter.bar <= cut.to_bar))
      .map((letter) => ({ letter: letter.letter, bar: letter.bar })),
    marked_scan:
      scan === null
        ? null
        : {
            id: scan.id,
            file_name: scan.file_name,
            content_type: scan.content_type,
            size_bytes: scan.size_bytes,
          },
  };
}

export async function visibleFolderPage(
  db: Queryable,
  person: Person,
  programmeId: string,
  partId: string,
): Promise<FolderPage> {
  const chair = chairOfPerson(person);
  const folder = await visibleFolder(db, person, programmeId);
  for (const work of folder.works) {
    const part = work.parts.find((entry) => entry.id === partId);
    if (part && part.chair_key === chair.key) return folderPage(work, partId);
  }
  throw notFound();
}

/** A player may download only the marked-part scans of the parts in their visible folders. */
export async function playerMaySeeScan(
  db: Queryable,
  person: Person,
  partId: string,
  kind: string,
): Promise<boolean> {
  if (kind !== 'marked_part') return false;
  const chair = person.chair;
  if (!chair) return false;
  const folders = await visibleFolders(db, person);
  return folders.some((folder) =>
    folder.works.some((work) =>
      work.parts.some((part) => part.id === partId && part.chair_key === chair.key),
    ),
  );
}
