function required(name) {
    const value = process.env[name];
    if (!value)
        throw new Error(`${name} must be set`);
    return value;
}
function seconds(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "")
        return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0)
        throw new Error(`${name} must be a positive number of seconds`);
    return value;
}
const port = Number(process.env.APP_PUBLIC_PORT || 4173);
const publicUrl = (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");
export const config = {
    port,
    publicUrl,
    publicOrigin: new URL(publicUrl).origin,
    databaseUrl: required("DATABASE_URL"),
    s3: {
        endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
        region: required("S3_REGION"),
        bucket: required("S3_BUCKET"),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        accessKeyId: required("S3_ACCESS_KEY_ID"),
        secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    smtp: {
        host: required("SMTP_HOST"),
        port: Number(required("SMTP_PORT")),
        from: required("MAIL_FROM"),
    },
    magicLinkTtlSeconds: seconds("MAGIC_LINK_TTL_SECONDS", 900),
    reviewerLinkHourSeconds: seconds("REVIEWER_LINK_HOUR_SECONDS", 3600),
    checkpointUploadDeadlineSeconds: seconds("CHECKPOINT_UPLOAD_DEADLINE_SECONDS", 86400),
    importPlanTtlSeconds: seconds("IMPORT_PLAN_TTL_SECONDS", 3600),
};
