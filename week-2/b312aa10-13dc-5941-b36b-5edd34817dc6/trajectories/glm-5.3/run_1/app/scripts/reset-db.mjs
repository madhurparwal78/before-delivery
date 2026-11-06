import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tables = [
  'inspector_access', 'inspector_tokens', 'inspector_links', 'sanitation_reports', 'sanitation_entries',
  'expiry_notices', 'documents', 'committed_invoices', 'frozen_figures', 'close_names', 'invoice_state',
  'kb_items', 'hour_ledger', 'bookings', 'out_of_service_windows', 'rate_versions', 'stations',
  'signin_failures', 'sessions', 'idempotency', 'outbox', 'kb_accounts', 'seed_objects_pending',
  'members', 'people', 'kitchens',
];
await pool.query(`DROP TABLE IF EXISTS ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
console.log('db reset');
await pool.end();
