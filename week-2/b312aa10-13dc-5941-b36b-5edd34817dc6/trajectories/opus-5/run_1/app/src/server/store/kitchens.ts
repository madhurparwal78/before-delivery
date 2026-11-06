import type { DocumentType } from '../../shared/format.js';
import { db, type Queryable } from '../db/pool.js';
import type { Kitchen, Member, PeakWindow, Person, Role } from '../domain/types.js';

type KitchenRow = {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  peak_windows: PeakWindow[];
  required_documents: DocumentType[];
  rules_version: number;
  first_start_date: string;
  first_start_at: Date;
};

function toKitchen(row: KitchenRow): Kitchen {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timeZone: row.time_zone,
    peakWindows: row.peak_windows,
    requiredDocuments: row.required_documents,
    rulesVersion: row.rules_version,
    firstStartDate: row.first_start_date,
    firstStartAtMs: row.first_start_at.getTime(),
  };
}

const kitchenSelect = `select id, name, slug, time_zone, peak_windows, required_documents,
                              rules_version, first_start_date, first_start_at from kitchens`;

export async function loadKitchen(client: Queryable, kitchenId: string): Promise<Kitchen> {
  const result = await client.query<KitchenRow>(`${kitchenSelect} where id = $1`, [kitchenId]);
  return toKitchen(result.rows[0]!);
}

export async function allKitchens(): Promise<Kitchen[]> {
  const result = await db().query<KitchenRow>(`${kitchenSelect} order by id`);
  return result.rows.map(toKitchen);
}

type PersonRow = {
  id: string;
  kitchen_id: string;
  email: string;
  name: string;
  role: Role;
  member_id: string | null;
};

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    kitchenId: row.kitchen_id,
    email: row.email,
    name: row.name,
    role: row.role,
    memberId: row.member_id,
  };
}

export async function personBySession(sessionId: string): Promise<Person | null> {
  const result = await db().query<PersonRow>(
    `select p.id, p.kitchen_id, p.email, p.name, p.role, m.id as member_id
       from sessions s
       join people p on p.id = s.person_id
       left join members m on m.person_id = p.id
      where s.id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  return row ? toPerson(row) : null;
}

export async function personByEmail(
  email: string,
): Promise<(Person & { passwordHash: string }) | null> {
  const result = await db().query<PersonRow & { password_hash: string }>(
    `select p.id, p.kitchen_id, p.email, p.name, p.role, p.password_hash, m.id as member_id
       from people p
       left join members m on m.person_id = p.id
      where lower(p.email) = $1`,
    [email],
  );
  const row = result.rows[0];
  return row ? { ...toPerson(row), passwordHash: row.password_hash } : null;
}

type MemberRow = {
  id: string;
  kitchen_id: string;
  person_id: string;
  business_name: string;
  allowance_quarters: number;
  name: string;
  email: string;
};

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    kitchenId: row.kitchen_id,
    personId: row.person_id,
    name: row.name,
    email: row.email,
    businessName: row.business_name,
    allowanceQuarters: row.allowance_quarters,
  };
}

const memberSelect = `select m.id, m.kitchen_id, m.person_id, m.business_name, m.allowance_quarters,
                             p.name, p.email
                        from members m join people p on p.id = m.person_id`;

export async function loadMember(
  client: Queryable,
  kitchenId: string,
  memberId: string,
): Promise<Member | null> {
  const result = await client.query<MemberRow>(
    `${memberSelect} where m.id = $1 and m.kitchen_id = $2`,
    [memberId, kitchenId],
  );
  const row = result.rows[0];
  return row ? toMember(row) : null;
}

export async function loadMembers(client: Queryable, kitchenId: string): Promise<Member[]> {
  const result = await client.query<MemberRow>(
    `${memberSelect} where m.kitchen_id = $1 order by m.business_name, m.id`,
    [kitchenId],
  );
  return result.rows.map(toMember);
}

export async function allMembers(): Promise<Member[]> {
  const result = await db().query<MemberRow>(`${memberSelect} order by m.id`);
  return result.rows.map(toMember);
}

export async function saveBusinessName(
  client: Queryable,
  memberId: string,
  businessName: string,
): Promise<void> {
  await client.query(`update members set business_name = $2 where id = $1`, [
    memberId,
    businessName,
  ]);
  await client.query(`insert into kb_name_updates (member_id, name) values ($1, $2)`, [
    memberId,
    businessName,
  ]);
}

export async function saveKitchenRules(
  client: Queryable,
  kitchenId: string,
  change: { peakWindows?: PeakWindow[]; requiredDocuments?: DocumentType[] },
): Promise<void> {
  if (change.peakWindows) {
    await client.query(
      `update kitchens set peak_windows = $2::jsonb, rules_version = rules_version + 1 where id = $1`,
      [kitchenId, JSON.stringify(change.peakWindows)],
    );
  }
  if (change.requiredDocuments) {
    await client.query(
      `update kitchens set required_documents = $2::jsonb, rules_version = rules_version + 1 where id = $1`,
      [kitchenId, JSON.stringify(change.requiredDocuments)],
    );
  }
}
