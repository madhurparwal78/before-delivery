import { Queryable, db, lockNamed, tx } from '../db';
import { Policy } from '../types';

export interface PolicyVersionRow {
  version: number;
  saved_by: { id: string; name: string };
  saved_at: string;
}

export async function currentPolicy(client: Queryable = db): Promise<Policy> {
  const { rows } = await client.query<{ version: number; document: Policy }>(
    'SELECT version, document FROM policy_versions ORDER BY version DESC LIMIT 1',
  );
  const row = rows[0];
  if (!row) throw new Error('No policy version is stored');
  return { ...row.document, version: row.version };
}

export async function policyVersions(): Promise<PolicyVersionRow[]> {
  const { rows } = await db.query<{ version: number; saved_at: Date; member_id: string; member_name: string }>(
    `SELECT p.version, p.saved_at, m.id AS member_id, m.name AS member_name
       FROM policy_versions p JOIN members m ON m.id = p.saved_by
      ORDER BY p.version DESC`,
  );
  return rows.map((row) => ({
    version: row.version,
    saved_by: { id: row.member_id, name: row.member_name },
    saved_at: row.saved_at.toISOString(),
  }));
}

export type PolicySaveResult =
  | { kind: 'saved'; policy: Policy }
  | { kind: 'stale'; currentVersion: number };

export async function savePolicy(document: Policy, basedOn: number, savedBy: string): Promise<PolicySaveResult> {
  return tx(async (client) => {
    await lockNamed(client, 'policy');
    const existing = await currentPolicy(client);
    if (existing.version !== basedOn) return { kind: 'stale', currentVersion: existing.version };
    const version = existing.version + 1;
    const stored: Policy = { ...document, version };
    await client.query(
      'INSERT INTO policy_versions (version, document, saved_by, saved_at) VALUES ($1, $2, $3, now())',
      [version, JSON.stringify(stored), savedBy],
    );
    return { kind: 'saved', policy: stored };
  });
}

export function teamPolicyOf(policy: Policy, teamId: string) {
  const team = policy.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new Error(`Team ${teamId} is missing from the policy`);
  return team;
}
