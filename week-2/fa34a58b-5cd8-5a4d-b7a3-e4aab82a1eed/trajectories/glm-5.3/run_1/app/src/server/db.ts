import { Client } from 'pg';

export const pg = new Client({ connectionString: process.env.DATABASE_URL });
