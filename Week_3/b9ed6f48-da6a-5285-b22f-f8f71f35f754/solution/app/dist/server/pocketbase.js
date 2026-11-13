// PocketBase: accounts, saved paths, bookmarks and preferences (brief: Services › PocketBase).
// The server signs in as the provided admin; every call names the user it acts for explicitly,
// so no request ever reads or writes another person's records.
import { config } from "./config.js";
export class AccountsUnreachable extends Error {
}
let adminToken = null;
async function raw(method, path, body, token) {
    let response;
    try {
        response = await fetch(`${config.pocketbase.url}${path}`, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(8000),
        });
    }
    catch {
        throw new AccountsUnreachable();
    }
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : {} };
}
async function signInAdmin() {
    const { status, data } = await raw("POST", "/api/admins/auth-with-password", {
        identity: config.pocketbase.email,
        password: config.pocketbase.password,
    });
    if (status !== 200)
        throw new Error(`PocketBase admin sign-in returned ${status}`);
    adminToken = data.token;
    return adminToken;
}
/** An admin call; renews the admin token once on 401. */
async function admin(method, path, body) {
    const first = await raw(method, path, body, adminToken ?? (await signInAdmin()));
    if (first.status !== 401 && first.status !== 403)
        return first;
    return raw(method, path, body, await signInAdmin());
}
function expectOk(result, what) {
    if (result.status >= 300)
        throw new Error(`PocketBase ${what} returned ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`);
    return result.data;
}
function toUser(record) {
    return { id: String(record.id), email: String(record.email), name: String(record.name), role: record.role };
}
const ADMIN_ONLY = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
async function ensureCollection(name, schema, indexes) {
    const existing = await admin("GET", `/api/collections/${name}`);
    if (existing.status === 200) {
        const fields = existing.data.schema ?? [];
        const missing = schema.filter((f) => !fields.some((e) => e.name === f.name));
        if (missing.length)
            expectOk(await admin("PATCH", `/api/collections/${name}`, { schema: [...fields, ...missing] }), `update ${name}`);
        return;
    }
    const created = await admin("POST", "/api/collections", { name, type: "base", schema, indexes, ...ADMIN_ONLY });
    if (created.status === 400 && (await admin("GET", `/api/collections/${name}`)).status === 200)
        return; // another instance won
    expectOk(created, `create ${name}`);
}
const ROLES = ["visitor", "curator", "lead_curator", "manager"];
export const SEED_ACCOUNTS = [
    { name: "Ines Varela", email: "ines@halden.test", role: "curator" },
    { name: "Priya Okonkwo", email: "priya@halden.test", role: "curator" },
    { name: "Tomas Reiland", email: "tomas@halden.test", role: "lead_curator" },
    { name: "Marta Solberg", email: "marta@halden.test", role: "manager" },
    { name: "Ada Brennan", email: "ada@visitor.test", role: "visitor" },
    { name: "Kenji Arai", email: "kenji@visitor.test", role: "visitor" },
];
const SEED_PASSWORD = "Halden-demo-2026";
/** Collections and seeded accounts, idempotently (brief: Services › PocketBase › Collections). */
export async function ensureAccountsSetup() {
    const users = expectOk(await admin("GET", "/api/collections/users"), "read users");
    const usersId = String(users.id);
    const userFields = users.schema ?? [];
    const wanted = [
        { name: "name", type: "text", options: { min: null, max: null, pattern: "" } },
        { name: "role", type: "select", options: { maxSelect: 1, values: ROLES } },
    ];
    const missing = wanted.filter((f) => !userFields.some((e) => e.name === f.name));
    if (missing.length)
        expectOk(await admin("PATCH", "/api/collections/users", { schema: [...userFields, ...missing] }), "update users");
    const user = { name: "user", type: "relation", required: true, options: { collectionId: usersId, cascadeDelete: true, maxSelect: 1, minSelect: null, displayFields: null } };
    await ensureCollection("saved_paths", [user, { name: "resolved", type: "json", options: { maxSize: 20000 } }, { name: "last_chapter", type: "number", options: { min: null, max: null, noDecimal: true } }, { name: "last_exhibit", type: "text", options: { min: null, max: null, pattern: "" } }], ["CREATE UNIQUE INDEX idx_saved_paths_user ON saved_paths (user)"]);
    await ensureCollection("bookmarks", [user, { name: "target_type", type: "text", required: true, options: { min: null, max: null, pattern: "" } }, { name: "target_id", type: "text", required: true, options: { min: null, max: null, pattern: "" } }], ["CREATE UNIQUE INDEX idx_bookmarks_target ON bookmarks (user, target_type, target_id)"]);
    await ensureCollection("preferences", [user, { name: "motion", type: "bool", options: {} }, { name: "sound", type: "bool", options: {} }], ["CREATE UNIQUE INDEX idx_preferences_user ON preferences (user)"]);
    for (const account of SEED_ACCOUNTS) {
        const found = await admin("GET", `/api/collections/users/records?perPage=1&filter=${encodeURIComponent(`email = "${account.email}"`)}`);
        if ((expectOk(found, "find seed account").items ?? []).length)
            continue;
        const created = await admin("POST", "/api/collections/users/records", {
            ...account,
            password: SEED_PASSWORD,
            passwordConfirm: SEED_PASSWORD,
            emailVisibility: true,
            verified: true,
        });
        if (created.status !== 400)
            expectOk(created, "create seed account");
    }
}
// Accounts
export async function registerUser(name, email, password) {
    const created = await admin("POST", "/api/collections/users/records", {
        name,
        email,
        password,
        passwordConfirm: password,
        role: "visitor",
        emailVisibility: true,
    });
    // The format was checked before this call, so PocketBase's "invalid or already in use" means taken.
    const emailError = created.data.data?.email?.code;
    if (created.status === 400 && (emailError === "validation_invalid_email" || emailError === "validation_not_unique"))
        return "email_taken";
    return toUser(expectOk(created, "register"));
}
export async function signIn(email, password) {
    const result = await raw("POST", "/api/collections/users/auth-with-password", { identity: email, password });
    if (result.status === 400)
        return null;
    return toUser(expectOk(result, "sign in").record);
}
// Per-user records
async function findOne(collection, filter) {
    const found = expectOk(await admin("GET", `/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(filter)}`), `find ${collection}`);
    return (found.items ?? [])[0] ?? null;
}
/** Updates the user's single record in `collection`, creating it the first time. */
async function upsertForUser(collection, userId, values) {
    const existing = await findOne(collection, `user = "${userId}"`);
    if (existing)
        return expectOk(await admin("PATCH", `/api/collections/${collection}/records/${existing.id}`, values), `update ${collection}`);
    const created = await admin("POST", `/api/collections/${collection}/records`, { user: userId, ...values });
    if (created.status === 400) {
        const raced = await findOne(collection, `user = "${userId}"`);
        if (raced)
            return expectOk(await admin("PATCH", `/api/collections/${collection}/records/${raced.id}`, values), `update ${collection}`);
    }
    return expectOk(created, `create ${collection}`);
}
export const DEFAULT_PREFERENCES = { motion: true, sound: false };
export async function readPreferences(userId) {
    const record = await findOne("preferences", `user = "${userId}"`);
    return record ? { motion: record.motion === true, sound: record.sound === true } : DEFAULT_PREFERENCES;
}
export async function writePreferences(userId, preferences) {
    const record = await upsertForUser("preferences", userId, { ...preferences });
    return { motion: record.motion === true, sound: record.sound === true };
}
export async function readPath(userId) {
    const record = await findOne("saved_paths", `user = "${userId}"`);
    if (!record)
        return { resolved: [], last_chapter: null, last_exhibit: "" };
    const lastChapter = Number(record.last_chapter);
    return {
        resolved: Array.isArray(record.resolved) ? record.resolved : [],
        last_chapter: lastChapter > 0 ? lastChapter : null,
        last_exhibit: String(record.last_exhibit ?? ""),
    };
}
export async function writePath(userId, path) {
    await upsertForUser("saved_paths", userId, { resolved: path.resolved, last_chapter: path.last_chapter ?? 0, last_exhibit: path.last_exhibit });
    return path;
}
export async function listBookmarks(userId) {
    const found = expectOk(await admin("GET", `/api/collections/bookmarks/records?perPage=500&sort=-created,-id&filter=${encodeURIComponent(`user = "${userId}"`)}`), "list bookmarks");
    return (found.items ?? []).map((r) => ({
        id: String(r.id),
        target_type: r.target_type,
        target_id: String(r.target_id),
    }));
}
export async function addBookmark(userId, targetType, targetId) {
    const filter = `user = "${userId}" && target_type = "${targetType}" && target_id = "${targetId}"`;
    const existing = await findOne("bookmarks", filter);
    if (existing)
        return { bookmark: { id: String(existing.id), target_type: targetType, target_id: targetId }, created: false };
    const created = await admin("POST", "/api/collections/bookmarks/records", { user: userId, target_type: targetType, target_id: targetId });
    if (created.status === 400) {
        const raced = await findOne("bookmarks", filter);
        if (raced)
            return { bookmark: { id: String(raced.id), target_type: targetType, target_id: targetId }, created: false };
    }
    const record = expectOk(created, "add bookmark");
    return { bookmark: { id: String(record.id), target_type: targetType, target_id: targetId }, created: true };
}
/** Deletes the bookmark only when it belongs to `userId`. */
export async function removeBookmark(userId, bookmarkId) {
    const record = await admin("GET", `/api/collections/bookmarks/records/${encodeURIComponent(bookmarkId)}`);
    if (record.status !== 200 || record.data.user !== userId)
        return false;
    expectOk(await admin("DELETE", `/api/collections/bookmarks/records/${encodeURIComponent(bookmarkId)}`), "remove bookmark");
    return true;
}
