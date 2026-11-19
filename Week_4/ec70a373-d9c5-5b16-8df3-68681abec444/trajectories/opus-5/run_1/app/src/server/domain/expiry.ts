import { nowMs } from '../clock';
import { pool, query, tx } from '../db';
import { expireMemberLots, isLotExpired, lotRows, withMemberLock } from './ledger';
import type { MemberRecord } from './members';

export interface ExpirySubject {
  id: string;
  tenant_id: string;
  home_zone: string;
}

async function hasLapsedHours(member: ExpirySubject, atMs: number): Promise<boolean> {
  const lots = await lotRows(pool, member.id);
  return lots.some(
    (lot) => lot.remainder > 0 && isLotExpired(lot.valid_through, member.home_zone, atMs),
  );
}

/** Puts a member's lapsed pack hours out of reach before any answer reports them. */
export async function sweepMemberExpiry(member: ExpirySubject | MemberRecord): Promise<void> {
  const subject: ExpirySubject = {
    id: member.id,
    tenant_id: member.tenant_id,
    home_zone: member.home_zone,
  };
  if (!(await hasLapsedHours(subject, nowMs()))) return;
  await tx(async (client) => {
    await withMemberLock(client, subject.id, async () => {
      await expireMemberLots(client, subject, nowMs());
    });
  });
}

/** The periodic pass, so lapsed hours leave within seconds even with nobody looking. */
export async function sweepAllExpiry(): Promise<void> {
  const members = await query<ExpirySubject>(
    `select distinct m.id, m.tenant_id, s.time_zone as home_zone
       from lots l
       join members m on m.id = l.member_id
       join sites s on s.id = m.home_site_id
      where l.valid_through is not null`,
  );
  for (const member of members) {
    await sweepMemberExpiry(member);
  }
}
