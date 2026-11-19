import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('drop schema public cascade');
await client.query('create schema public');
await client.end();
console.log('database reset');
