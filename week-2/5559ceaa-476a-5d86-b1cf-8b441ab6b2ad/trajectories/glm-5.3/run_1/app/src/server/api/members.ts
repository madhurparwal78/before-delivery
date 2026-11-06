import type { Pool } from "pg";
import type { Member, EmailStatus } from "../../shared/types.js";

export async function membersOf(pool: Pool, projectId: string): Promise<Member[]> {
  const r = await pool.query(
    `SELECT m.user_id, m.role, u.name, m.joined_at,
       COALESCE(ies.status, 'none') AS email_status,
       (u.email IS NULL) AS is_demo
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN invite_email_status ies ON ies.project_id = m.project_id AND ies.user_id = m.user_id
     WHERE m.project_id = $1
     ORDER BY (m.role = 'mentor') DESC, m.joined_at ASC`,
    [projectId],
  );
  return r.rows.map((row: { user_id: string; role: string; name: string; email_status: string }) => ({
    user_id: row.user_id,
    name: row.name,
    role: row.role === "mentor" ? "mentor" : "student",
    online: false,
    email_status: row.email_status as EmailStatus,
  }));
}
