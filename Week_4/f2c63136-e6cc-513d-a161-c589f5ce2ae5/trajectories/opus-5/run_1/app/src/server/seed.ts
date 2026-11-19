import { serverNow } from './clock.js';
import { withTx, type Db } from './db.js';
import { EventSink } from './live.js';
import { createUser } from '../domain/accounts.js';
import { getRepo, getUserByUsername, type RepoRow } from '../domain/model.js';
import { performPush } from '../domain/push.js';
import { createRevision, setBranchRevision } from '../domain/revisions.js';

const PASSWORD = 'ridgestack-seed-1';

const PEOPLE = [
  { username: 'mira', name: 'Mira Okonkwo', email: 'mira@harbor.example' },
  { username: 'tomas', name: 'Tomas Varga', email: 'tomas@harbor.example' },
  { username: 'priya', name: 'Priya Raman', email: 'priya@harbor.example' },
  { username: 'jonas', name: 'Jonas Beck', email: 'jonas@harbor.example' },
  { username: 'lena', name: 'Lena Fischer', email: 'lena@tidepool.example' },
];

const LEDGER = 'export function total(a: number[]): number {\n  return a.reduce((s, x) => s + x, 0);\n}\n';
const LEDGER_ROUNDED =
  'export function total(a: number[]): number {\n  return Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100;\n}\n';

async function createChangeRow(
  tx: Db,
  repo: RepoRow,
  input: { number: number; title: string; author: number; head: string; base: string; baseRevision: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO rs_changes (repo_id, number, title, description, author_user_id, head_branch, base_branch,
       base_revision, state, created_at) VALUES ($1, $2, $3, '', $4, $5, $6, $7, 'open', $8)`,
    [repo.id, input.number, input.title, input.author, input.head, input.base, input.baseRevision, serverNow()],
  );
  await tx.query('UPDATE rs_repos SET next_change_number = $2 WHERE id = $1', [repo.id, input.number + 1]);
}

/** Creates the invented seed workspace once. */
export async function seed(): Promise<void> {
  const already = await withTx((tx) => getUserByUsername(tx, 'mira'));
  if (already) return;

  const sink = new EventSink();
  await withTx(async (tx) => {
    const ids = new Map<string, number>();
    for (const person of PEOPLE) {
      const created = await createUser(tx, { ...person, password: PASSWORD, confirmed: true });
      ids.set(person.username, created.id);
    }

    const harbor = await tx.query<{ id: string }>(
      'INSERT INTO rs_orgs (slug, name, owner_user_id) VALUES ($1, $2, $3) RETURNING id',
      ['harbor', 'Harbor Finance', ids.get('mira')],
    );
    const tidepool = await tx.query<{ id: string }>(
      'INSERT INTO rs_orgs (slug, name, owner_user_id) VALUES ($1, $2, $3) RETURNING id',
      ['tidepool', 'Tidepool Labs', ids.get('lena')],
    );
    const payments = await tx.query<{ id: string }>(
      'INSERT INTO rs_teams (org_id, name) VALUES ($1, $2) RETURNING id',
      [harbor[0].id, 'payments'],
    );
    for (const member of ['priya', 'tomas']) {
      await tx.query('INSERT INTO rs_team_members (team_id, user_id) VALUES ($1, $2)', [
        payments[0].id,
        ids.get(member),
      ]);
    }

    const ledgerRepo = await tx.query<{ id: string }>(
      `INSERT INTO rs_repos (org_id, name, visibility, default_branch, required_approvals, required_checks, queue_on)
       VALUES ($1, 'harbor-ledger', 'private', 'main', 1, $2, true) RETURNING id`,
      [harbor[0].id, ['lint', 'unit']],
    );
    const ledgerId = Number(ledgerRepo[0].id);
    const grants: Array<[string, string]> = [
      ['mira', 'owner'],
      ['tomas', 'maintainer'],
      ['priya', 'writer'],
      ['jonas', 'reader'],
    ];
    for (const [username, role] of grants) {
      await tx.query("INSERT INTO rs_roles (repo_id, subject_type, subject_id, role) VALUES ($1, 'user', $2, $3)", [
        ledgerId,
        ids.get(username),
        role,
      ]);
    }

    const root = await createRevision(tx, ledgerId, {
      parents: [],
      message: 'Initial revision',
      authorUsername: 'mira',
      authorName: 'Mira Okonkwo',
      contents: new Map(),
    });
    await setBranchRevision(tx, ledgerId, 'main', root);
    const repo = (await getRepo(tx, 'harbor', 'harbor-ledger'))!;

    await performPush(
      tx,
      repo,
      {
        branch: 'main',
        expectedHead: root,
        from: null,
        message: 'Add ledger and rates',
        files: [
          { path: 'README.md', content: '# harbor-ledger\n' },
          { path: 'src/ledger.ts', content: LEDGER },
          { path: 'src/rates.ts', content: 'export const rate = 1.02;\n' },
          { path: '.review/OWNERS', content: '* @tomas\n/src/rates.ts @harbor/payments\n' },
        ],
        actor: { username: 'mira', name: 'Mira Okonkwo' },
      },
      sink,
    );

    const mainHead = (
      await tx.query<{ revision_id: string }>('SELECT revision_id FROM rs_branches WHERE repo_id = $1 AND name = $2', [
        ledgerId,
        'main',
      ])
    )[0].revision_id;

    await performPush(
      tx,
      repo,
      {
        branch: 'round-totals',
        expectedHead: null,
        from: 'main',
        message: 'Round totals to cents',
        files: [{ path: 'src/ledger.ts', content: LEDGER_ROUNDED }],
        actor: { username: 'priya', name: 'Priya Raman' },
      },
      sink,
    );
    await createChangeRow(tx, repo, {
      number: 1,
      title: 'Round totals to cents',
      author: ids.get('priya')!,
      head: 'round-totals',
      base: 'main',
      baseRevision: mainHead,
    });

    const roundHead = (
      await tx.query<{ revision_id: string }>('SELECT revision_id FROM rs_branches WHERE repo_id = $1 AND name = $2', [
        ledgerId,
        'round-totals',
      ])
    )[0].revision_id;

    await performPush(
      tx,
      repo,
      {
        branch: 'fixed-rate',
        expectedHead: null,
        from: 'round-totals',
        message: 'Use fixed rate',
        files: [{ path: 'src/rates.ts', content: 'export const rate = 1.05;\n' }],
        actor: { username: 'priya', name: 'Priya Raman' },
      },
      sink,
    );
    await createChangeRow(tx, repo, {
      number: 2,
      title: 'Use fixed rate',
      author: ids.get('priya')!,
      head: 'fixed-rate',
      base: 'round-totals',
      baseRevision: roundHead,
    });

    const apiRepo = await tx.query<{ id: string }>(
      `INSERT INTO rs_repos (org_id, name, visibility, default_branch, required_approvals, required_checks, queue_on)
       VALUES ($1, 'tidepool-api', 'public', 'main', 1, '{}', false) RETURNING id`,
      [tidepool[0].id],
    );
    const apiId = Number(apiRepo[0].id);
    await tx.query("INSERT INTO rs_roles (repo_id, subject_type, subject_id, role) VALUES ($1, 'user', $2, 'owner')", [
      apiId,
      ids.get('lena'),
    ]);
    const apiRoot = await createRevision(tx, apiId, {
      parents: [],
      message: 'Initial revision',
      authorUsername: 'lena',
      authorName: 'Lena Fischer',
      contents: new Map(),
    });
    await setBranchRevision(tx, apiId, 'main', apiRoot);
    const api = (await getRepo(tx, 'tidepool', 'tidepool-api'))!;
    await performPush(
      tx,
      api,
      {
        branch: 'main',
        expectedHead: apiRoot,
        from: null,
        message: 'Add readme',
        files: [{ path: 'README.md', content: '# tidepool-api\n' }],
        actor: { username: 'lena', name: 'Lena Fischer' },
      },
      sink,
    );
  });
  console.log('[ridgestack] seed data created');
}
