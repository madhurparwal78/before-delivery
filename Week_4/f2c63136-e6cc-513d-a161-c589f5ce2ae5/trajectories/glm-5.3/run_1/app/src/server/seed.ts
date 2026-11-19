import type { Services } from './index.js';
import { hashPassword } from './api/accounts.js';
import { computeRevisionId, insertRevision } from './store/revisions.js';
import { contentKey } from './storage.js';
import { byteLength, byteOrder } from '../shared/bytes.js';

const SEED_PASSWORD = 'ridgestack-seed-1';

interface SeedUser { username: string; name: string; email: string }

const SEED_USERS: SeedUser[] = [
  { username: 'mira', name: 'Mira Okonkwo', email: 'mira@harbor.example' },
  { username: 'tomas', name: 'Tomas Varga', email: 'tomas@harbor.example' },
  { username: 'priya', name: 'Priya Raman', email: 'priya@harbor.example' },
  { username: 'jonas', name: 'Jonas Beck', email: 'jonas@harbor.example' },
  { username: 'lena', name: 'Lena Fischer', email: 'lena@tidepool.example' },
];

/**
 * Idempotent seed of the published example data. Everything is inserted with
 * ON CONFLICT DO NOTHING so a restart changes nothing.
 */
export async function seed(s: Services): Promise<void> {
  const { db, storage, clock } = s;
  await db.withTransaction(async (tx) => {
    const userIds = new Map<string, number>();
    for (const u of SEED_USERS) {
      const r = await tx.query(
        `INSERT INTO users (username, email, name, password_hash, confirmed, created_at_ms)
         VALUES ($1,$2,$3,$4,true,$5)
         ON CONFLICT (username) DO NOTHING RETURNING id`,
        [u.username, u.email, u.name, hashPassword(SEED_PASSWORD), clock.nowMs()],
      );
      if (r.rows.length > 0) userIds.set(u.username, r.rows[0].id);
      else {
        const existing = await tx.query('SELECT id FROM users WHERE username = $1', [u.username]);
        userIds.set(u.username, existing.rows[0].id);
      }
    }
    // Organisations
    const orgId = async (slug: string, name: string): Promise<number> => {
      const r = await tx.query(
        'INSERT INTO orgs (slug, name) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING RETURNING id',
        [slug, name],
      );
      if (r.rows.length > 0) return r.rows[0].id;
      const existing = await tx.query('SELECT id FROM orgs WHERE slug = $1', [slug]);
      return existing.rows[0].id;
    };
    const harborId = await orgId('harbor', 'Harbor Finance');
    const tidepoolId = await orgId('tidepool', 'Tidepool Labs');
    await tx.query('INSERT INTO org_owners (org_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [harborId, userIds.get('mira')!]);
    await tx.query('INSERT INTO org_owners (org_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tidepoolId, userIds.get('lena')!]);
    await tx.query('INSERT INTO teams (org_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [harborId, 'payments']);
    for (const m of ['priya', 'tomas']) {
      await tx.query('INSERT INTO team_members (org_id, team_name, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [harborId, 'payments', userIds.get(m)!]);
    }
    // harbor/harbor-ledger: private with rules and two changes.
    const ledger = await ensureRepo(tx, harborId, 'harbor-ledger', 'private', 1, ['lint', 'unit'], true, [
      { subject: 'user:mira', role: 'owner' },
      { subject: 'user:tomas', role: 'maintainer' },
      { subject: 'user:priya', role: 'writer' },
      { subject: 'user:jonas', role: 'reader' },
    ]);
    if (ledger.created) {
      // main: Initial revision (empty), then "Add ledger and rates".
      const rootId = computeRevisionId([], 'Initial revision', new Map());
      await insertRevision(tx, ledger.id, rootId, 'Initial revision',
        { username: 'mira', name: 'Mira Okonkwo' }, [null, null], new Map(), clock.nowMs());
      await tx.query("INSERT INTO branches (repo_id, name, revision_id) VALUES ($1,'main',$2) ON CONFLICT DO NOTHING", [ledger.id, rootId]);
      const files = new Map<string, string>([
        ['README.md', '# harbor-ledger\n'],
        ['src/ledger.ts', 'export function total(a: number[]): number {\n  return a.reduce((s, x) => s + x, 0);\n}\n'],
        ['src/rates.ts', 'export const rate = 1.02;\n'],
        ['.review/OWNERS', '* @tomas\n/src/rates.ts @harbor/payments\n'],
      ]);
      for (const path of byteOrder([...files.keys()])) {
        const content = files.get(path)!;
        const key = contentKey(content);
        const seen = await tx.query('SELECT 1 FROM objects WHERE key = $1', [key]);
        if (seen.rows.length === 0) {
          await storage.put(key, content);
          await tx.query('INSERT INTO objects (key, size) VALUES ($1,$2) ON CONFLICT DO NOTHING', [key, byteLength(content)]);
        }
      }
      const revId = computeRevisionId([rootId], 'Add ledger and rates', files);
      const keyMap = new Map<string, { key: string; size: number }>();
      for (const [path, content] of files) keyMap.set(path, { key: contentKey(content), size: byteLength(content) });
      await insertRevision(tx, ledger.id, revId, 'Add ledger and rates',
        { username: 'mira', name: 'Mira Okonkwo' }, [rootId, null], keyMap, clock.nowMs());
      await tx.query("UPDATE branches SET revision_id = $1 WHERE repo_id = $2 AND name = 'main'", [revId, ledger.id]);
      // Two stacked changes by priya.
      const roundTotals = 'export function total(a: number[]): number {\n  const sum = a.reduce((s, x) => s + x, 0);\n  return Math.round(sum * 100) / 100;\n}\n';
      const fixedRate = 'export const rate = 1.025;\n';
      const roundFiles = new Map<string, string>([
        ['README.md', '# harbor-ledger\n'],
        ['src/ledger.ts', roundTotals],
        ['src/rates.ts', 'export const rate = 1.02;\n'],
        ['.review/OWNERS', '* @tomas\n/src/rates.ts @harbor/payments\n'],
      ]);
      const fixedFiles = new Map<string, string>([
        ['README.md', '# harbor-ledger\n'],
        ['src/ledger.ts', roundTotals],
        ['src/rates.ts', fixedRate],
        ['.review/OWNERS', '* @tomas\n/src/rates.ts @harbor/payments\n'],
      ]);
      for (const map of [roundFiles, fixedFiles]) {
        for (const [path, content] of map) {
          const key = contentKey(content);
          const seen = await tx.query('SELECT 1 FROM objects WHERE key = $1', [key]);
          if (seen.rows.length === 0) {
            await storage.put(key, content);
            await tx.query('INSERT INTO objects (key, size) VALUES ($1,$2) ON CONFLICT DO NOTHING', [key, byteLength(content)]);
          }
        }
      }
      const roundId = computeRevisionId([revId], 'Round totals to cents', roundFiles);
      const roundKeys = new Map<string, { key: string; size: number }>();
      for (const [path, content] of roundFiles) roundKeys.set(path, { key: contentKey(content), size: byteLength(content) });
      await insertRevision(tx, ledger.id, roundId, 'Round totals to cents',
        { username: 'priya', name: 'Priya Raman' }, [revId, null], roundKeys, clock.nowMs());
      await tx.query("INSERT INTO branches (repo_id, name, revision_id) VALUES ($1,'round-totals',$2) ON CONFLICT DO NOTHING", [ledger.id, roundId]);
      const fixedId = computeRevisionId([roundId], 'Use fixed rate', fixedFiles);
      const fixedKeys = new Map<string, { key: string; size: number }>();
      for (const [path, content] of fixedFiles) fixedKeys.set(path, { key: contentKey(content), size: byteLength(content) });
      await insertRevision(tx, ledger.id, fixedId, 'Use fixed rate',
        { username: 'priya', name: 'Priya Raman' }, [roundId, null], fixedKeys, clock.nowMs());
      await tx.query("INSERT INTO branches (repo_id, name, revision_id) VALUES ($1,'fixed-rate',$2) ON CONFLICT DO NOTHING", [ledger.id, fixedId]);
      await tx.query(
        `INSERT INTO changes (repo_id, number, title, description, head_branch, base_branch, base_revision, state, draft, author_id, created_at_ms)
         VALUES ($1,1,'Round totals to cents','',$2,'main',$3,'open',false,$4,$5)`,
        [ledger.id, 'round-totals', revId, userIds.get('priya')!, clock.nowMs()],
      );
      await tx.query(
        `INSERT INTO changes (repo_id, number, title, description, head_branch, base_branch, base_revision, state, draft, author_id, created_at_ms)
         VALUES ($1,2,'Use fixed rate','',$2,'round-totals',$3,'open',false,$4,$5)`,
        [ledger.id, 'fixed-rate', roundId, userIds.get('priya')!, clock.nowMs()],
      );
    }
    // tidepool/tidepool-api: public.
    const tidepool = await ensureRepo(tx, tidepoolId, 'tidepool-api', 'public', 1, [], false, [
      { subject: 'user:lena', role: 'owner' },
    ]);
    if (tidepool.created) {
      const rootId = computeRevisionId([], 'Initial revision', new Map());
      await insertRevision(tx, tidepool.id, rootId, 'Initial revision',
        { username: 'lena', name: 'Lena Fischer' }, [null, null], new Map(), clock.nowMs());
      await tx.query("INSERT INTO branches (repo_id, name, revision_id) VALUES ($1,'main',$2) ON CONFLICT DO NOTHING", [tidepool.id, rootId]);
      const files = new Map<string, string>([['README.md', '# tidepool-api\n']]);
      const key = contentKey('# tidepool-api\n');
      const seen = await tx.query('SELECT 1 FROM objects WHERE key = $1', [key]);
      if (seen.rows.length === 0) {
        await storage.put(key, '# tidepool-api\n');
        await tx.query('INSERT INTO objects (key, size) VALUES ($1,$2) ON CONFLICT DO NOTHING', [key, 13]);
      }
      const revId = computeRevisionId([rootId], 'Add readme', files);
      const keyMap = new Map<string, { key: string; size: number }>();
      keyMap.set('README.md', { key, size: 13 });
      await insertRevision(tx, tidepool.id, revId, 'Add readme',
        { username: 'lena', name: 'Lena Fischer' }, [rootId, null], keyMap, clock.nowMs());
      await tx.query("UPDATE branches SET revision_id = $1 WHERE repo_id = $2 AND name = 'main'", [revId, tidepool.id]);
    }
  });
}

async function ensureRepo(
  tx: import('pg').PoolClient,
  orgId: number,
  name: string,
  visibility: 'public' | 'private',
  approvals: number,
  checks: string[],
  queue: boolean,
  roles: Array<{ subject: string; role: string }>,
): Promise<{ id: number; created: boolean }> {
  const existing = await tx.query('SELECT id FROM repos WHERE org_id = $1 AND name = $2', [orgId, name]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };
  const insert = await tx.query(
    'INSERT INTO repos (org_id, name, visibility, required_approvals, required_checks, queue) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [orgId, name, visibility, approvals, checks, queue],
  );
  for (const r of roles) {
    await tx.query('INSERT INTO repo_roles (repo_id, subject, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [insert.rows[0].id, r.subject, r.role]);
  }
  return { id: insert.rows[0].id, created: true };
}
