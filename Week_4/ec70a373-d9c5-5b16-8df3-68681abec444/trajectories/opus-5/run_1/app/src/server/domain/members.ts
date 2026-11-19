import type { PoolClient } from 'pg';
import { one, query, rows } from '../db';
import type { DocumentType, MemberSearchJson } from '../../shared/types';

export interface MemberRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  business_name: string;
  contact_name: string;
  home_site_id: string;
  home_zone: string;
  email: string;
  name: string;
  seeded_certificate_of_insurance: string | null;
  seeded_food_handler_certificate: string | null;
  seeded_business_licence: string | null;
  killbill_account_id: string | null;
}

const MEMBER_SELECT = `
  select m.id, m.user_id, m.tenant_id, m.business_name, m.contact_name, m.home_site_id,
         s.time_zone as home_zone, u.email, u.name,
         to_char(m.seeded_certificate_of_insurance, 'YYYY-MM-DD') as seeded_certificate_of_insurance,
         to_char(m.seeded_food_handler_certificate, 'YYYY-MM-DD') as seeded_food_handler_certificate,
         to_char(m.seeded_business_licence, 'YYYY-MM-DD') as seeded_business_licence,
         m.killbill_account_id
    from members m
    join sites s on s.id = m.home_site_id
    join users u on u.id = m.user_id`;

export async function memberByUser(userId: string): Promise<MemberRecord | null> {
  const found = await query<MemberRecord>(`${MEMBER_SELECT} where m.user_id = $1`, [userId]);
  return found.length === 0 ? null : (found[0] as MemberRecord);
}

export async function memberById(memberId: string): Promise<MemberRecord | null> {
  const found = await query<MemberRecord>(`${MEMBER_SELECT} where m.id = $1`, [memberId]);
  return found.length === 0 ? null : (found[0] as MemberRecord);
}

export async function memberByIdIn(
  client: PoolClient,
  memberId: string,
): Promise<MemberRecord | null> {
  return one<MemberRecord>(client, `${MEMBER_SELECT} where m.id = $1`, [memberId]);
}

export type ValidThrough = Record<DocumentType, string | null>;

const DOCUMENT_TYPES: DocumentType[] = [
  'certificate_of_insurance',
  'food_handler_certificate',
  'business_licence',
];

/** The latest expiry among verified documents of a type, or the seeded date when later. */
export async function validThroughFor(
  client: PoolClient | null,
  member: MemberRecord,
): Promise<ValidThrough> {
  const verified = client === null
    ? await query<{ doc_type: DocumentType; latest: string | null }>(
        `select doc_type, to_char(max(expiry_date), 'YYYY-MM-DD') as latest
           from documents where member_id = $1 and status = 'verified' group by doc_type`,
        [member.id],
      )
    : await rows<{ doc_type: DocumentType; latest: string | null }>(
        client,
        `select doc_type, to_char(max(expiry_date), 'YYYY-MM-DD') as latest
           from documents where member_id = $1 and status = 'verified' group by doc_type`,
        [member.id],
      );
  const seeded: ValidThrough = {
    certificate_of_insurance: member.seeded_certificate_of_insurance,
    food_handler_certificate: member.seeded_food_handler_certificate,
    business_licence: member.seeded_business_licence,
  };
  const result: ValidThrough = {
    certificate_of_insurance: null,
    food_handler_certificate: null,
    business_licence: null,
  };
  for (const type of DOCUMENT_TYPES) {
    const row = verified.find((candidate) => candidate.doc_type === type);
    const fromDocuments = row?.latest ?? null;
    const fromSeed = seeded[type];
    if (fromDocuments === null) result[type] = fromSeed;
    else if (fromSeed === null) result[type] = fromDocuments;
    else result[type] = fromDocuments > fromSeed ? fromDocuments : fromSeed;
  }
  return result;
}

export interface TruckRecord {
  id: string;
  tenant_id: string;
  member_id: string;
  site_id: string;
  name: string;
  permit_number: string;
  business_name: string;
  site_name: string;
  site_address: string;
  time_zone: string;
}

export async function truckByMember(memberId: string): Promise<TruckRecord | null> {
  const found = await query<TruckRecord>(
    `select t.id, t.tenant_id, t.member_id, t.site_id, t.name, t.permit_number,
            m.business_name, s.name as site_name, s.address as site_address, s.time_zone
       from trucks t join members m on m.id = t.member_id join sites s on s.id = t.site_id
      where t.member_id = $1`,
    [memberId],
  );
  return found.length === 0 ? null : (found[0] as TruckRecord);
}

export async function truckById(truckId: string): Promise<TruckRecord | null> {
  const found = await query<TruckRecord>(
    `select t.id, t.tenant_id, t.member_id, t.site_id, t.name, t.permit_number,
            m.business_name, s.name as site_name, s.address as site_address, s.time_zone
       from trucks t join members m on m.id = t.member_id join sites s on s.id = t.site_id
      where t.id = $1`,
    [truckId],
  );
  return found.length === 0 ? null : (found[0] as TruckRecord);
}

/** Member search: a literal, case-insensitive substring match inside the caller's scope. */
export async function searchMembers(
  tenantId: string,
  siteId: string | null,
  term: string,
): Promise<MemberSearchJson[]> {
  const found = await query<{
    id: string;
    business_name: string;
    contact_name: string;
    home_site_id: string;
    truck_id: string | null;
    truck_name: string | null;
  }>(
    `select m.id, m.business_name, m.contact_name, m.home_site_id,
            t.id as truck_id, t.name as truck_name
       from members m left join trucks t on t.member_id = m.id
      where m.tenant_id = $1
        and ($2::uuid is null or m.home_site_id = $2::uuid)
        and (position(lower($3) in lower(m.business_name)) > 0
             or position(lower($3) in lower(m.contact_name)) > 0)
      order by m.business_name asc
      limit 10`,
    [tenantId, siteId, term],
  );
  return found.map((row) => ({
    id: row.id,
    business_name: row.business_name,
    contact_name: row.contact_name,
    home_site_id: row.home_site_id,
    truck: row.truck_id === null || row.truck_name === null
      ? null
      : { id: row.truck_id, name: row.truck_name },
  }));
}
