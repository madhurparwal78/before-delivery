import { db, newId, withTransaction, type Queryable } from '../db.js';
import { addDays, today } from './clock.js';
import { daysInForce } from './policies.js';
import { writeLedger } from './ledger.js';
import { grantIsLive } from './access.js';
import type { GrantRow } from './rows.js';
import type { Role } from '../../shared/types.js';

export const MAX_GRANT_SPAN_DAYS = 365;

export const grantDateRange = (): { today: string; max: string } => {
  const now = today();
  return { today: now, max: addDays(now, MAX_GRANT_SPAN_DAYS) };
};

export const defaultEndDate = async (tx: Queryable = db): Promise<string> => {
  const now = today();
  return addDays(now, await daysInForce('partner_grant_days', now, tx));
};

export const activeGrantsOn = async (
  itemType: 'folder' | 'file',
  itemId: string,
  tx: Queryable = db,
): Promise<GrantRow[]> => {
  const { rows } = await tx.query<GrantRow>(
    `SELECT id, item_type, item_id, person_id, role, end_date, status, ended_reason
       FROM grants WHERE item_type = $1 AND item_id = $2 AND status = 'active'`,
    [itemType, itemId],
  );
  return rows.filter(grantIsLive);
};

export const grantById = async (id: string, tx: Queryable = db): Promise<GrantRow | null> => {
  const { rows } = await tx.query<GrantRow>(
    `SELECT id, item_type, item_id, person_id, role, end_date, status, ended_reason
       FROM grants WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const activeGrantsOfPerson = async (
  personId: string,
  tx: Queryable = db,
): Promise<GrantRow[]> => {
  const { rows } = await tx.query<GrantRow>(
    `SELECT id, item_type, item_id, person_id, role, end_date, status, ended_reason
       FROM grants WHERE person_id = $1 AND status = 'active'`,
    [personId],
  );
  return rows.filter(grantIsLive);
};

export const createGrant = async (
  actorId: string,
  input: {
    itemType: 'folder' | 'file';
    itemId: string;
    itemName: string;
    personId: string;
    personName: string;
    role: Role;
    endDate: string;
    folderId: string | null;
    fileId: string | null;
  },
): Promise<GrantRow> =>
  withTransaction(async (tx) => {
    const id = newId();
    const { rows } = await tx.query<GrantRow>(
      `INSERT INTO grants (id, item_type, item_id, person_id, role, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')
       RETURNING id, item_type, item_id, person_id, role, end_date, status, ended_reason`,
      [id, input.itemType, input.itemId, input.personId, input.role, input.endDate],
    );
    const grant = rows[0];
    if (grant === undefined) throw new Error('grant insert returned nothing');
    await writeLedger(tx, {
      actorId,
      action: 'shared',
      fileId: input.fileId,
      folderId: input.folderId,
      detail: {
        personName: input.personName,
        role: input.role,
        endDate: input.endDate,
        folderName: input.itemName,
      },
    });
    return grant;
  });

export const patchGrant = async (
  actorId: string,
  grant: GrantRow,
  changes: { role?: Role; endDate?: string },
  context: { itemName: string; folderId: string | null; fileId: string | null; personName: string },
): Promise<GrantRow> =>
  withTransaction(async (tx) => {
    const role = changes.role ?? grant.role;
    const endDate = changes.endDate ?? grant.end_date;
    const { rows } = await tx.query<GrantRow>(
      `UPDATE grants SET role = $2, end_date = $3 WHERE id = $1
       RETURNING id, item_type, item_id, person_id, role, end_date, status, ended_reason`,
      [grant.id, role, endDate],
    );
    const updated = rows[0];
    if (updated === undefined) throw new Error('grant update returned nothing');
    await writeLedger(tx, {
      actorId,
      action: 'access_changed',
      fileId: context.fileId,
      folderId: context.folderId,
      detail: {
        personName: context.personName,
        role,
        endDate,
        folderName: context.itemName,
      },
    });
    return updated;
  });

export const removeGrant = async (
  actorId: string,
  grant: GrantRow,
  context: { itemName: string; folderId: string | null; fileId: string | null; personName: string },
): Promise<void> => {
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE grants SET status = 'ended', ended_reason = 'removed' WHERE id = $1`,
      [grant.id],
    );
    await writeLedger(tx, {
      actorId,
      action: 'access_removed',
      fileId: context.fileId,
      folderId: context.folderId,
      detail: { personName: context.personName, folderName: context.itemName },
    });
  });
};
