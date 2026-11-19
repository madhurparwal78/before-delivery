// One Postgres pool and one place for every query the server runs.
import pg from 'pg';
import { applySchema } from "./schema.js";
let pool = null;
export async function openPool(databaseUrl) {
    if (pool !== null)
        return pool;
    pool = new pg.Pool({ connectionString: databaseUrl, max: 20 });
    for (;;) {
        try {
            await applySchema(pool);
            return pool;
        }
        catch (error) {
            console.error('postgres unavailable, retrying in 2s', error instanceof Error ? error.message : error);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
}
export function getPool() {
    if (pool === null)
        throw new Error('pool not open');
    return pool;
}
export function newId(prefix) {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    return `${prefix}${Array.from(bytes, (b) => b.toString(36)).join('')}`;
}
