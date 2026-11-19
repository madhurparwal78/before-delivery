import { db, withAdvisoryLock } from './db.ts';
import { storageReachable } from './s3.ts';
import { setupWorld } from './grading.ts';

const PASSWORD = 'ridgestack-seed-1';

const LEDGER = 'export function total(a: number[]): number {\n  return a.reduce((s, x) => s + x, 0);\n}\n';

const user = (username: string, name: string, domain: string) => ({ email: `${username}@${domain}`, username, name, password: PASSWORD });

const SEED = {
  users: [
    user('mira', 'Mira Okonkwo', 'harbor.example'),
    user('tomas', 'Tomas Varga', 'harbor.example'),
    user('priya', 'Priya Raman', 'harbor.example'),
    user('jonas', 'Jonas Beck', 'harbor.example'),
    user('lena', 'Lena Fischer', 'tidepool.example'),
  ],
  orgs: [
    { slug: 'harbor', name: 'Harbor Finance', owner: 'mira', members: ['tomas', 'priya', 'jonas'], teams: [{ name: 'payments', members: ['priya', 'tomas'] }] },
    { slug: 'tidepool', name: 'Tidepool Labs', owner: 'lena', members: [], teams: [] },
  ],
  repos: [
    {
      org: 'harbor',
      name: 'harbor-ledger',
      visibility: 'private',
      roles: [
        { subject: 'user:mira', role: 'owner' },
        { subject: 'user:tomas', role: 'maintainer' },
        { subject: 'user:priya', role: 'writer' },
        { subject: 'user:jonas', role: 'reader' },
      ],
      settings: { required_approvals: 1, required_checks: ['lint', 'unit'], queue: true },
      steps: [
        {
          as: 'mira',
          key: 'base',
          push: {
            branch: 'main',
            message: 'Add ledger and rates',
            files: { 'README.md': '# harbor-ledger\n', 'src/ledger.ts': LEDGER, 'src/rates.ts': 'export const rate = 1.02;\n', '.review/OWNERS': '* @tomas\n/src/rates.ts @harbor/payments\n' },
          },
        },
        {
          as: 'priya',
          key: 'round',
          push: {
            branch: 'round-totals',
            from: 'main',
            message: 'Round totals to cents',
            files: { 'src/ledger.ts': 'export function total(a: number[]): number {\n  return Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100;\n}\n' },
          },
        },
        { as: 'priya', key: 'c1', change: { title: 'Round totals to cents', head: 'round-totals', base: 'main', draft: false } },
        { as: 'priya', key: 'fixed', push: { branch: 'fixed-rate', from: 'round-totals', message: 'Use fixed rate', files: { 'src/rates.ts': 'export const rate = 1.05;\n' } } },
        { as: 'priya', key: 'c2', change: { title: 'Use fixed rate', head: 'fixed-rate', base: 'round-totals', draft: false } },
      ],
    },
    {
      org: 'tidepool',
      name: 'tidepool-api',
      visibility: 'public',
      roles: [],
      settings: { required_approvals: 1, required_checks: [], queue: false },
      steps: [{ as: 'lena', key: 'readme', push: { branch: 'main', message: 'Add readme', files: { 'README.md': '# tidepool-api\n' } } }],
    },
  ],
};

/** Creates the invented organisations, people and repositories of the brief once; retries until storage is up. */
export async function seedWhenReady(): Promise<void> {
  for (;;) {
    try {
      if (await storageReachable()) {
        await withAdvisoryLock(7120002, async () => {
          if (!(await db.q(`SELECT 1 FROM users WHERE username = 'mira'`)).length) await setupWorld(SEED);
        });
        return;
      }
    } catch (error) {
      console.error('seed failed, retrying', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
