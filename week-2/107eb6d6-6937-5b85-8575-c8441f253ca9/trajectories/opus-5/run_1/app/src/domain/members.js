import { db, withTransaction } from '../db.js';
import { publicMember } from './auth.js';
import { COPY, conflict, notFound } from './errors.js';
import { buildRole } from './validation.js';

export async function listMembers() {
  const { rows } = await db.query('SELECT id, name, email, role FROM members ORDER BY id');
  return rows.map(publicMember);
}

export async function setMemberRole({ memberId, body }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, name, email, role FROM members
       WHERE id = $1 OR role = 'admin'
       ORDER BY id FOR UPDATE`,
      [memberId]
    );
    const target = rows.find((row) => row.id === memberId);
    if (!target) throw notFound();
    const role = buildRole(body);

    const admins = rows.filter((row) => row.role === 'admin');
    if (target.role === 'admin' && role !== 'admin' && admins.length === 1) {
      throw conflict(COPY.lastAdmin);
    }

    const updated = await client.query(
      'UPDATE members SET role = $2 WHERE id = $1 RETURNING id, name, email, role',
      [memberId, role]
    );
    return publicMember(updated.rows[0]);
  });
}
