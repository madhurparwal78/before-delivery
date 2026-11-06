// Drop the app's tables so the next server start seeds from scratch. Testing only.
import { Client } from 'pg';

const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.DB_URL });
await c.connect();
await c.query('DROP TABLE IF EXISTS users, workspaces, projects, generations, credit_entries, invitations, enquiries, seeds CASCADE');
await c.end();
console.log('[reset] tables dropped');
