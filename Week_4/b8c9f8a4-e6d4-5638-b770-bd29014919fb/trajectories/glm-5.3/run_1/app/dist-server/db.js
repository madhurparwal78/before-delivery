import pg from 'pg';
export function loadConfig() {
    const env = (k) => process.env[k] ?? '';
    const intEnv = (k, d) => {
        const raw = env(k).trim();
        if (!/^\d+$/.test(raw))
            return d;
        return parseInt(raw, 10);
    };
    return {
        databaseUrl: env('DATABASE_URL'),
        s3: {
            endpoint: env('S3_ENDPOINT'),
            region: env('S3_REGION'),
            bucket: env('S3_BUCKET'),
            forcePathStyle: env('S3_FORCE_PATH_STYLE') === 'true',
            accessKeyId: env('S3_ACCESS_KEY_ID'),
            secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
        },
        wiremockUrl: env('WIREMOCK_URL').replace(/\/$/, ''),
        gotenbergUrl: env('GOTENBERG_URL').replace(/\/$/, ''),
        ntfy: { url: env('NTFY_URL').replace(/\/$/, ''), username: env('NTFY_USERNAME'), password: env('NTFY_PASSWORD') },
        offerLapseSeconds: intEnv('OFFER_LAPSE_SECONDS', 172_800),
        offerWarningSeconds: intEnv('OFFER_WARNING_SECONDS', 14_400),
        linkTtlSeconds: intEnv('LINK_TTL_SECONDS', 1_209_600),
        recordPullMaxAgeSeconds: intEnv('RECORD_PULL_MAX_AGE_SECONDS', 2_592_000),
        publicPort: intEnv('APP_PUBLIC_PORT', 4173),
    };
}
export const pool = new pg.Pool({ connectionString: loadConfig().databaseUrl, max: 20 });
export async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        try {
            await client.query('ROLLBACK');
        }
        catch { /* connection already gone */ }
        throw err;
    }
    finally {
        client.release();
    }
}
