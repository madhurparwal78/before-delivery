import { query } from '../db/pool.js';
import { hashSecret } from '../domain/credentials.js';

export function bearerToken(request) {
  const header = request.headers.authorization || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const value = header.slice(7).trim();
  return value.length ? value : null;
}

/** Reads the caller's membership, role and organization fresh on every request. */
export async function resolvePrincipal(token) {
  const tokenHash = hashSecret(token);
  const session = await query(
    `SELECT m.*, o.id AS organization_id, o.name AS organization_name, o.app_id, o.webhook_secret, s.id AS session_id
       FROM sessions s JOIN members m ON m.id = s.member_id JOIN organizations o ON o.id = m.organization_id
      WHERE s.token_hash = $1`,
    [tokenHash]
  );
  if (session.rows.length) {
    const row = session.rows[0];
    return {
      type: 'member',
      role: row.role,
      sessionId: row.session_id,
      member: { id: row.id, name: row.name, email: row.email, role: row.role, created_at: row.created_at },
      apiKey: null,
      actor: row.email,
      organization: {
        id: row.organization_id,
        name: row.organization_name,
        app_id: row.app_id,
        webhook_secret: row.webhook_secret
      }
    };
  }

  const key = await query(
    `SELECT k.*, o.name AS organization_name, o.app_id, o.webhook_secret
       FROM api_keys k JOIN organizations o ON o.id = k.organization_id
       JOIN members creator ON creator.id = k.created_by
      WHERE k.secret_hash = $1 AND k.revoked_at IS NULL`,
    [tokenHash]
  );
  if (key.rows.length) {
    const row = key.rows[0];
    return {
      type: 'api_key',
      role: row.role,
      sessionId: null,
      member: null,
      apiKey: {
        id: row.id,
        name: row.name,
        role: row.role,
        prefix: row.prefix,
        created_by: row.created_by,
        created_at: row.created_at,
        revoked_at: row.revoked_at
      },
      actor: `api_key:${row.prefix}`,
      organization: {
        id: row.organization_id,
        name: row.organization_name,
        app_id: row.app_id,
        webhook_secret: row.webhook_secret
      }
    };
  }
  return null;
}

export const ROLE_GATES = {
  readers: () => true,
  members: (principal) => principal.type === 'member',
  owner: (principal) => principal.type === 'member' && principal.role === 'owner',
  sender: (principal) => (principal.type === 'member' && ['owner', 'operator'].includes(principal.role))
    || (principal.type === 'api_key' && principal.role === 'operator'),
  canceller: (principal) => (principal.type === 'member' && ['owner', 'operator'].includes(principal.role))
    || (principal.type === 'api_key' && principal.role === 'operator'),
  auditReader: (principal) => (principal.type === 'member' && ['owner', 'auditor'].includes(principal.role))
    || (principal.type === 'api_key' && principal.role === 'auditor')
};
