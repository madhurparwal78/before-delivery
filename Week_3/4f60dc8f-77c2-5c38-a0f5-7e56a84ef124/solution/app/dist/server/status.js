// Live service probes for /api/status and /api/studio/health, each result no older than 5 seconds.
import { contentReachable } from "./content.js";
import { pool } from "./db.js";
import { documentsReachable } from "./documents.js";
import { billingReachable } from "./killbill.js";
import { emailReachable } from "./mail.js";
import { pushReachable } from "./push.js";
import { queueReachable } from "./queue.js";
import { searchReachable } from "./search.js";
import { storageReachable } from "./storage.js";
async function postgresReachable() {
    try {
        await pool.query("SELECT 1");
        return true;
    }
    catch {
        return false;
    }
}
const PROBES = {
    postgres: postgresReachable,
    killbill: billingReachable,
    minio: storageReachable,
    mailpit: emailReachable,
    pocketbase: contentReachable,
    rabbitmq: queueReachable,
    gotenberg: documentsReachable,
    meilisearch: searchReachable,
    ntfy: pushReachable,
};
let cached = null;
export function health() {
    if (cached && Date.now() - cached.at < 4_000)
        return cached.health;
    const probing = (async () => {
        const entries = await Promise.all(Object.keys(PROBES).map(async (name) => [name, (await PROBES[name]().catch(() => false)) ? "up" : "down"]));
        return Object.fromEntries(entries);
    })();
    cached = { at: Date.now(), health: probing };
    return probing;
}
export async function clientStatus() {
    const h = await health();
    return { billing: h.killbill, storage: h.minio, email: h.mailpit, measuring: h.rabbitmq, documents: h.gotenberg };
}
