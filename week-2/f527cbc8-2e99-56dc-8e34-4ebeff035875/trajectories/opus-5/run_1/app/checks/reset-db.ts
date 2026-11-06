import { pool } from '../src/server/db.js';
await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await pool.end();
console.log('database reset');
