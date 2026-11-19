import { db, withTransaction } from './db.js';
import { AccessView, grantIsLive, loadFolders } from './domain/access.js';
import { endOfDated, serverNow, today } from './domain/clock.js';
import { writeLedger } from './domain/ledger.js';
import { binRows, purgeFile, purgeIsDue } from './domain/bin.js';
import { handoverHasLapsed, lapseHandover, listHandovers } from './domain/handovers.js';
import {
  abandonUpload,
  clearDebris,
  liveUploads,
  uploadIdleEdge,
} from './domain/uploads.js';
import { activeGrantsOfPerson } from './domain/grants.js';
import { knownPerson } from './domain/people.js';
import { StorageDown } from './services/storage.js';
import { liveCounts } from './domain/serialize.js';
import {
  broadcastClock,
  publishAccessChanged,
  publishBinChanged,
  publishFilesRemoved,
  publishHandovers,
  pushNotice,
  pushUploadExpired,
} from './events.js';
import type { GrantRow } from './domain/rows.js';

let lastCompanyDate = today();
let running = false;

const itemNameOf = async (grant: GrantRow): Promise<string> => {
  const table = grant.item_type === 'folder' ? 'folders' : 'files';
  const { rows } = await db.query<{ name: string }>(
    `SELECT name FROM ${table} WHERE id = $1`,
    [grant.item_id],
  );
  return rows[0]?.name ?? '';
};

const endDatedGrants = async (): Promise<void> => {
  const { rows } = await db.query<GrantRow>(
    `SELECT id, item_type, item_id, person_id, role, end_date, status, ended_reason
       FROM grants WHERE status = 'active'`,
  );
  const due = rows.filter((row) => serverNow().getTime() >= endOfDated(row.end_date).getTime());
  for (const grant of due) {
    const itemName = await itemNameOf(grant);
    await withTransaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE grants SET status = 'ended', ended_reason = 'date'
           WHERE id = $1 AND status = 'active'`,
        [grant.id],
      );
      if (rowCount === 0) return;
      await writeLedger(tx, {
        actorId: null,
        action: 'access_ended',
        fileId: grant.item_type === 'file' ? grant.item_id : null,
        folderId: grant.item_type === 'folder' ? grant.item_id : null,
        detail: {
          personName: (await knownPerson(grant.person_id, tx))?.name ?? '',
          role: grant.role,
          endDate: grant.end_date,
          folderName: itemName,
        },
      });
    });

    const person = await knownPerson(grant.person_id);
    if (person === null) continue;
    const folders = await loadFolders();
    const remaining = await activeGrantsOfPerson(person.id);
    const view = new AccessView(person, folders, remaining.filter(grantIsLive));
    const stillThere =
      grant.item_type === 'folder'
        ? view.folderAccess(grant.item_id)
        : await fileAccessAfter(view, grant.item_id);
    publishAccessChanged(person.id);
    pushNotice(
      person.id,
      stillThere === null ? 'grant_ended' : 'grant_ended_fallback',
      itemName,
      grant.end_date,
    );
  }
};

const fileAccessAfter = async (view: AccessView, fileId: string) => {
  const { rows } = await db.query<{
    id: string;
    name: string;
    folder_id: string;
    size: number;
    content_type: string;
    modified_at: Date;
    locked: boolean;
    state: 'live' | 'binned';
  }>(
    'SELECT id, name, folder_id, size, content_type, modified_at, locked, state FROM files WHERE id = $1',
    [fileId],
  );
  const file = rows[0];
  return file === undefined ? null : view.fileAccess(file);
};

const purgeDueFiles = async (): Promise<void> => {
  const rows = await binRows();
  for (const row of rows) {
    if (!purgeIsDue(row.bin.purge_date)) continue;
    try {
      const outcome = await purgeFile(null, row.file.id);
      const counts = await liveCounts();
      await publishFilesRemoved(
        [outcome.fileId],
        { [outcome.folderId]: counts.get(outcome.folderId) ?? 0 },
        outcome.grantHolders,
      );
      await publishBinChanged();
    } catch (error) {
      if (!(error instanceof StorageDown)) throw error;
    }
  }
};

const lapseDueHandovers = async (): Promise<void> => {
  const rows = await listHandovers();
  const folders = await loadFolders();
  for (const row of rows) {
    if (!handoverHasLapsed(row)) continue;
    const folderName = folders.get(row.folder_id)?.name ?? '';
    await lapseHandover(row, folderName);
    const recipient = await knownPerson(row.to_id);
    pushNotice(row.from_id, 'handover_lapsed', recipient?.name ?? '', folderName);
    await publishHandovers();
  }
};

const expireIdleUploads = async (): Promise<void> => {
  for (const upload of await liveUploads()) {
    if (serverNow().getTime() < uploadIdleEdge(upload).getTime()) continue;
    await abandonUpload(upload);
    pushUploadExpired(upload.person_id, upload.id, upload.name);
  }
};

/** One pass over everything that falls due on the server clock. */
export const runSweep = async (): Promise<void> => {
  if (running) return;
  running = true;
  try {
    await endDatedGrants();
    await purgeDueFiles();
    await lapseDueHandovers();
    await expireIdleUploads();
    await clearDebris();
    const now = today();
    if (now !== lastCompanyDate) {
      lastCompanyDate = now;
      broadcastClock();
    }
  } catch (error) {
    console.error('expiry sweep failed', error);
  } finally {
    running = false;
  }
};

export const startSweep = (): void => {
  setInterval(() => void runSweep(), 2_000).unref();
};
