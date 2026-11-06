import type { PoolClient } from 'pg';

export async function getPersonEmail(client: PoolClient, memberId: string): Promise<string> {
  const result = await client.query<{ email: string }>(
    `SELECT p.email FROM people p JOIN members m ON m.person_id=p.id WHERE m.id=$1`,
    [memberId],
  );
  return result.rows[0].email;
}
