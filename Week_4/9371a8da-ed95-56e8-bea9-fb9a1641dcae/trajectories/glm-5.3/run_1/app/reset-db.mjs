import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tables = [
  'mention_emails', 'saved_saves', 'citation_reports', 'exports', 'share_links', 'invites',
  'labels', 'ledger_entries', 'comments', 'threads', 'suggestions', 'project_revisions',
  'file_versions', 'files', 'memberships', 'projects', 'sessions', 'workspace_members',
  'users', 'workspaces',
];
for (const t of tables) {
  await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`).catch(() => {});
}
await pool.end();
console.log('dropped all');
