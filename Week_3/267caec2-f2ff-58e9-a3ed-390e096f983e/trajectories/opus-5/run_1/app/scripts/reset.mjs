import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await client.end();
await fetch('http://mailpit:8025/api/v1/messages', { method: 'DELETE' });
console.log('database and mailbox reset');
