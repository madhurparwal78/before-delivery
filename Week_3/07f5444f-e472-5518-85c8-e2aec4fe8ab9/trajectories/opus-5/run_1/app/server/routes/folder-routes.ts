import type { Folder, FolderListEntry } from '../../shared/api.js';
import { isoWithLondonOffset } from '../../shared/london.js';
import { folderPages, visibleFolder, visibleFolderPage, visibleFolders } from '../data/folders.js';
import { pool } from '../db/pool.js';
import { requireRole } from '../http/access.js';
import type { RequestContext } from '../http/context.js';
import { FOLDER_ROLES, signedInPerson } from '../http/context.js';
import { notFound } from '../http/errors.js';
import { sendJson } from '../http/http-io.js';
import { storageIsUp } from '../services/storage.js';

export async function listFolders(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  requireRole(person, FOLDER_ROLES);
  const chair = person.chair;
  if (!chair) throw notFound();
  const visible = await visibleFolders(pool, person);
  const folders: FolderListEntry[] = visible.map((aggregate) => ({
    programme_id: aggregate.row.id,
    number: String(aggregate.row.number).padStart(2, '0'),
    title: aggregate.row.title,
    status: aggregate.row.status,
    first_rehearsal: isoWithLondonOffset(aggregate.row.first_rehearsal.getTime()),
    chair_label: chair.label,
    part_count: folderPages(aggregate, chair.key).length,
  }));
  sendJson(context.response, 200, { folders });
}

export async function readFolder(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  requireRole(person, FOLDER_ROLES);
  const chair = person.chair;
  if (!chair) throw notFound();
  const aggregate = await visibleFolder(pool, person, context.params.programmeId ?? '');
  const body: Folder = {
    programme: {
      id: aggregate.row.id,
      number: String(aggregate.row.number).padStart(2, '0'),
      title: aggregate.row.title,
      status: aggregate.row.status,
      first_rehearsal: isoWithLondonOffset(aggregate.row.first_rehearsal.getTime()),
    },
    chair,
    scans_available: await storageIsUp(),
    pages: folderPages(aggregate, chair.key),
  };
  sendJson(context.response, 200, body);
}

export async function readFolderPage(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  requireRole(person, FOLDER_ROLES);
  const page = await visibleFolderPage(
    pool,
    person,
    context.params.programmeId ?? '',
    context.params.partId ?? '',
  );
  sendJson(context.response, 200, page);
}
