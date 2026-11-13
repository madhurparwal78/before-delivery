// Configuration from the environment. Every service URL and credential is read here at
// start and never reaches the browser or an API response.
import { SOLO_THRESHOLD_MINUTES, AGENCY_NAME, AGENCY_TIME_ZONE } from '../shared/terms.js';
function intEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '')
        return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0)
        return fallback;
    return n;
}
function strEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '')
        return fallback;
    return raw;
}
export function loadConfig() {
    return {
        port: intEnv('APP_PUBLIC_PORT', 4173),
        databaseUrl: strEnv('DATABASE_URL', 'postgresql://localhost:5432/relayline'),
        smtp: { host: strEnv('SMTP_HOST', 'localhost'), port: intEnv('SMTP_PORT', 1025) },
        mailFrom: strEnv('MAIL_FROM', 'Relayline <dispatch@tandemhands.example>'),
        killbill: {
            url: strEnv('KILLBILL_URL', 'http://localhost:8080'),
            username: strEnv('KILLBILL_USERNAME', 'admin'),
            password: strEnv('KILLBILL_PASSWORD', 'password'),
            apiKey: strEnv('KILLBILL_API_KEY', 'relayline'),
            apiSecret: strEnv('KILLBILL_API_SECRET', 'relayline-secret'),
        },
        s3: {
            endpoint: strEnv('S3_ENDPOINT', 'http://localhost:9000'),
            region: strEnv('S3_REGION', 'us-east-1'),
            bucket: strEnv('S3_BUCKET', 'relayline'),
            forcePathStyle: strEnv('S3_FORCE_PATH_STYLE', 'true') !== 'false',
            accessKeyId: strEnv('S3_ACCESS_KEY_ID', ''),
            secretAccessKey: strEnv('S3_SECRET_ACCESS_KEY', ''),
        },
        openCallLeadMinutes: intEnv('OPEN_CALL_LEAD_MINUTES', 1440),
        prepAccessGraceMinutes: intEnv('PREP_ACCESS_GRACE_MINUTES', 4320),
        prepLinkTtlSeconds: intEnv('PREP_LINK_TTL_SECONDS', 300),
    };
}
export const AGENCY = {
    name: AGENCY_NAME,
    time_zone: AGENCY_TIME_ZONE,
    solo_threshold_minutes: SOLO_THRESHOLD_MINUTES,
};
