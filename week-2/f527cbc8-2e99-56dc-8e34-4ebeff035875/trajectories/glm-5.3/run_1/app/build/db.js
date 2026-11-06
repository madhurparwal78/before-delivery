import pg from 'pg';
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(23, (v) => parseInt(v, 10));
pg.types.setTypeParser(21, (v) => parseInt(v, 10));
pg.types.setTypeParser(700, parseFloat);
pg.types.setTypeParser(701, parseFloat);
pg.types.setTypeParser(1114, (v) => v);
pg.types.setTypeParser(1184, (v) => new Date(v));
pg.types.setTypeParser(1082, (v) => v);
let pool = null;
export function connectDb() {
    if (!pool) {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30000 });
    }
    return pool;
}
export async function withTx(fn) {
    const p = connectDb();
    const client = await p.connect();
    let released = false;
    const tx = {
        query: (sql, params) => client.query(sql, params).then(r => r.rows),
        release: () => { if (!released) {
            released = true;
            client.release();
        } }
    };
    try {
        await client.query('BEGIN');
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
    }
    catch (e) {
        try {
            await client.query('ROLLBACK');
        }
        catch { }
        throw e;
    }
    finally {
        tx.release();
    }
}
export async function txQuery(sql, params) {
    return withTx(tx => tx.query(sql, params));
}
