import { pool } from '../pool.js';
import type { InspectionLinkRecord } from '../../domain/types.js';

interface LinkRow {
  id: string;
  tenant_id: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
}

function toLink(row: LinkRow): InspectionLinkRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    token: row.token,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function replaceInspectionLink(
  id: string,
  tenantId: string,
  token: string,
  expiresAt: Date,
  now: Date,
): Promise<void> {
  await pool.query(
    'UPDATE inspection_links SET revoked_at = $2 WHERE tenant_id = $1 AND revoked_at IS NULL',
    [tenantId, now],
  );
  await pool.query(
    'INSERT INTO inspection_links (id, tenant_id, token, expires_at) VALUES ($1,$2,$3,$4)',
    [id, tenantId, token, expiresAt],
  );
}

export async function liveInspectionLink(
  tenantId: string,
  now: Date,
): Promise<InspectionLinkRecord | null> {
  const result = await pool.query<LinkRow>(
    `SELECT * FROM inspection_links
      WHERE tenant_id = $1 AND revoked_at IS NULL AND expires_at > $2
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, now],
  );
  const row = result.rows[0];
  return row ? toLink(row) : null;
}

export async function revokeInspectionLinks(tenantId: string, now: Date): Promise<number> {
  const result = await pool.query(
    `UPDATE inspection_links SET revoked_at = $2
      WHERE tenant_id = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [tenantId, now],
  );
  return result.rowCount ?? 0;
}

export async function findInspectionLinkByToken(
  token: string,
): Promise<InspectionLinkRecord | null> {
  const result = await pool.query<LinkRow>('SELECT * FROM inspection_links WHERE token = $1', [
    token,
  ]);
  const row = result.rows[0];
  return row ? toLink(row) : null;
}
