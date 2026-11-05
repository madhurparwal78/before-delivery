import { notFound } from '../errors';
import { loadContractRow, type ContractRow } from '../domain/contracts';
import type { Db } from '../domain/pricing';
import type { User } from '../../shared/types';

/** A parent reaches a contract only through their own children; any other ID is a 404. */
export async function visibleContractRow(db: Db, user: User, contractId: string): Promise<ContractRow> {
  const row = await loadContractRow(db, contractId);
  if (row === null) throw notFound();
  if (user.role === 'parent' && row.family_id !== user.family_id) throw notFound();
  return row;
}
