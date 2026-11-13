// The one place the environment is read (brief: Configuration and secrets). Nothing here is
// ever sent to the browser.
function required(name) {
    const value = process.env[name];
    if (!value)
        throw new Error(`${name} is not set`);
    return value;
}
function seconds(name, fallback) {
    const value = process.env[name];
    return value && /^\d+$/.test(value) ? Number.parseInt(value, 10) : fallback;
}
const port = seconds("APP_PUBLIC_PORT", 4173);
export const config = {
    port,
    publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ""),
    databaseUrl: required("DATABASE_URL"),
    pocketbase: {
        url: required("POCKETBASE_URL").replace(/\/$/, ""),
        email: required("POCKETBASE_ADMIN_EMAIL"),
        password: required("POCKETBASE_ADMIN_PASSWORD"),
    },
    killbill: {
        url: required("KILLBILL_URL").replace(/\/$/, ""),
        username: required("KILLBILL_USERNAME"),
        password: required("KILLBILL_PASSWORD"),
        apiKey: required("KILLBILL_API_KEY"),
        apiSecret: required("KILLBILL_API_SECRET"),
    },
    mail: {
        host: required("SMTP_HOST"),
        port: seconds("SMTP_PORT", 25),
        from: required("MAIL_FROM"),
    },
    s3: {
        endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
        region: required("S3_REGION"),
        bucket: required("S3_BUCKET"),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        accessKeyId: required("S3_ACCESS_KEY_ID"),
        secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    dunningRetrySeconds: seconds("DUNNING_RETRY_SECONDS", 259200),
    mediaLinkSeconds: seconds("MEDIA_LINK_SECONDS", 300),
};
