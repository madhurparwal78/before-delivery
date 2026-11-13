import type { Material, Member, Workspace } from '../../shared/api.js';
import type { Db } from '../db.js';
import { pool } from '../db.js';

export const WORKSPACE_ID = 'ostra-lighting';

type MemberRow = Member & { password_hash: string; workspace_id: string };

export async function findMemberByEmail(email: string): Promise<MemberRow | null> {
  const { rows } = await pool.query<MemberRow>(
    'select id, workspace_id, name, email, password_hash, role, units, precision from members where lower(email) = lower($1)',
    [email],
  );
  return rows[0] ?? null;
}

export async function findMemberBySession(token: string): Promise<Member | null> {
  const { rows } = await pool.query<Member>(
    `select m.id, m.name, m.email, m.role, m.units, m.precision
       from sessions s join members m on m.id = s.member_id
      where s.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

export async function createSession(token: string, memberId: string): Promise<void> {
  await pool.query('insert into sessions (token, member_id) values ($1, $2)', [token, memberId]);
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('delete from sessions where token = $1', [token]);
}

export async function updatePreferences(
  memberId: string,
  units: Member['units'] | null,
  precision: number | null,
): Promise<Member> {
  const { rows } = await pool.query<Member>(
    `update members
        set units = coalesce($2, units), precision = coalesce($3, precision)
      where id = $1
      returning id, name, email, role, units, precision`,
    [memberId, units, precision],
  );
  return rows[0] as Member;
}

export async function getWorkspace(): Promise<Workspace> {
  type Row = { name: string; product_assembly_id: string; product_name: string };
  const { rows } = await pool.query<Row>(
    `select w.name, w.product_assembly_id, a.name as product_name
       from workspaces w join assemblies a on a.id = w.product_assembly_id
      where w.id = $1`,
    [WORKSPACE_ID],
  );
  const row = rows[0] as Row;
  const { rows: members } = await pool.query<{ id: string; name: string; role: Member['role'] }>(
    'select id, name, role from members where workspace_id = $1 order by role desc, name',
    [WORKSPACE_ID],
  );
  return {
    name: row.name,
    product: { assembly_id: row.product_assembly_id, name: row.product_name },
    members,
  };
}

export async function listMaterials(db: Db = pool): Promise<Material[]> {
  const { rows } = await db.query<Material>(
    'select id, name, density_g_cm3 from materials where workspace_id = $1 order by name',
    [WORKSPACE_ID],
  );
  return rows;
}

export async function findMaterial(db: Db, id: string): Promise<Material | null> {
  const { rows } = await db.query<Material>(
    'select id, name, density_g_cm3 from materials where workspace_id = $1 and id = $2',
    [WORKSPACE_ID, id],
  );
  return rows[0] ?? null;
}

/** Names are unique across parts, purchased parts and assemblies, ignoring letter case. */
export async function nameTaken(db: Db, name: string, exceptId: string | null): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `select id from parts where workspace_id = $1 and lower(name) = lower($2)
     union all
     select id from purchased_parts where workspace_id = $1 and lower(name) = lower($2)
     union all
     select id from assemblies where workspace_id = $1 and lower(name) = lower($2)`,
    [WORKSPACE_ID, name],
  );
  return rows.some((row) => row.id !== exceptId);
}
