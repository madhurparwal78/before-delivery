import { createHash } from "node:crypto";
import { config } from "./config.js";
import { accountsUnavailable } from "./http.js";
// PocketBase holds accounts, saved addresses and reviews, and is the realtime feed for stock-left
// counts and approved reviews. The server talks to it as an admin; browsers never do.
const BASE = config.pocketbase.url;
let adminToken = null;
export class PocketBaseError extends Error {
    status;
    data;
    constructor(status, data) {
        super(`PocketBase answered ${status}`);
        this.status = status;
        this.data = data;
    }
}
async function authenticate() {
    let response;
    try {
        response = await fetch(`${BASE}/api/admins/auth-with-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identity: config.pocketbase.email, password: config.pocketbase.password }),
            signal: AbortSignal.timeout(5000),
        });
    }
    catch {
        throw accountsUnavailable();
    }
    if (response.status !== 200)
        throw accountsUnavailable();
    adminToken = (await response.json()).token;
    return adminToken;
}
async function raw(method, path, body, retry = true) {
    const token = adminToken ?? (await authenticate());
    let response;
    try {
        response = await fetch(BASE + path, {
            method,
            headers: { Authorization: token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(8000),
        });
    }
    catch {
        throw accountsUnavailable();
    }
    if (response.status === 401 && retry) {
        adminToken = null;
        return raw(method, path, body, false);
    }
    if (response.status >= 500)
        throw accountsUnavailable();
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
}
async function pb(method, path, body) {
    const answer = await raw(method, path, body);
    if (answer.status >= 300) {
        throw new PocketBaseError(answer.status, (answer.body.data ?? {}));
    }
    return answer.body;
}
export async function probePocketBase() {
    try {
        const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
        return response.status === 200;
    }
    catch {
        return false;
    }
}
/** A PocketBase filter string literal. */
export const literal = (value) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
async function list(collection, filter, sort = "") {
    const params = new URLSearchParams({ perPage: "500", filter, ...(sort ? { sort } : {}) });
    return (await pb("GET", `/api/collections/${collection}/records?${params}`)).items;
}
const text = (name, required = true) => ({ name, type: "text", required, options: {} });
const number = (name) => ({ name, type: "number", required: false, options: {} });
const flag = (name) => ({ name, type: "bool", required: false, options: {} });
const COLLECTIONS = [
    {
        name: "addresses",
        schema: [text("user"), text("name"), text("line1"), text("line2", false), text("city"), text("province"), text("postal_code"), flag("is_default")],
        indexes: ["CREATE INDEX idx_addresses_user ON addresses (user)"],
    },
    {
        name: "reviews",
        schema: [text("scope"), text("flavour"), text("user"), text("author_first_name"), number("rating"), text("body"), text("status")],
        indexes: ["CREATE INDEX idx_reviews_scope ON reviews (scope, flavour)"],
    },
    {
        name: "stock_levels",
        schema: [text("scope"), text("flavour"), number("stock_left")],
        indexes: ["CREATE UNIQUE INDEX idx_stock_scope_flavour ON stock_levels (scope, flavour)"],
    },
];
/** Creates the missing collections and the `role` field on users; admin-only rules everywhere. */
export async function ensureCollections() {
    const users = await pb("GET", "/api/collections/users");
    if (!users.schema.some((f) => f.name === "role")) {
        await pb("PATCH", "/api/collections/users", {
            schema: [...users.schema, text("role")],
            createRule: null,
            updateRule: null,
            deleteRule: null,
        });
    }
    for (const collection of COLLECTIONS) {
        const found = await raw("GET", `/api/collections/${collection.name}`);
        if (found.status === 200)
            continue;
        const created = await raw("POST", "/api/collections", {
            name: collection.name,
            type: "base",
            schema: collection.schema,
            indexes: collection.indexes,
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
        });
        if (created.status >= 300 && (await raw("GET", `/api/collections/${collection.name}`)).status !== 200) {
            throw new PocketBaseError(created.status, {});
        }
    }
}
/**
 * PocketBase caps passwords at 72 bytes (bcrypt); the brief allows 128 characters, so the
 * server hands PocketBase a fixed-length digest of the password instead.
 */
const secret = (password) => createHash("sha256").update(`ceibo:${password}`).digest("hex");
const toUser = (r) => ({ id: r.id, email: r.email, name: r.name, role: r.role });
async function findUserByEmail(email) {
    const [found] = await list("users", `email=${literal(email)}`);
    return found ? toUser(found) : undefined;
}
export async function createUser(email, password, name, role) {
    const record = await pb("POST", "/api/collections/users/records", {
        email,
        emailVisibility: true,
        verified: true,
        password: secret(password),
        passwordConfirm: secret(password),
        name,
        role,
    });
    return toUser(record);
}
/** Returns the user for a matching email and password, or undefined for a mismatch. */
export async function checkPassword(email, password) {
    let response;
    try {
        response = await fetch(`${BASE}/api/collections/users/auth-with-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identity: email, password: secret(password) }),
            signal: AbortSignal.timeout(8000),
        });
    }
    catch {
        throw accountsUnavailable();
    }
    if (response.status >= 500)
        throw accountsUnavailable();
    if (response.status !== 200)
        return undefined;
    return toUser((await response.json()).record);
}
const toAddress = (r) => ({
    id: r.id,
    name: r.name,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    province: r.province,
    postal_code: r.postal_code,
    is_default: r.is_default,
});
export async function addresses(userId) {
    return (await list("addresses", `user=${literal(userId)}`, "created")).map(toAddress);
}
export async function address(userId, id) {
    return (await addresses(userId)).find((a) => a.id === id);
}
/** Saves an address and keeps exactly one default per account. */
export async function saveAddress(userId, fields, id) {
    const existing = await addresses(userId);
    const makeDefault = fields.is_default || existing.filter((a) => a.id !== id).length === 0;
    const record = id
        ? await pb("PATCH", `/api/collections/addresses/records/${id}`, { ...fields, is_default: makeDefault })
        : await pb("POST", "/api/collections/addresses/records", { ...fields, user: userId, is_default: makeDefault });
    if (makeDefault) {
        for (const other of existing) {
            if (other.id !== record.id && other.is_default) {
                await pb("PATCH", `/api/collections/addresses/records/${other.id}`, { is_default: false });
            }
        }
    }
    return toAddress(record);
}
export async function reviews(filter, sort = "-created") {
    return list("reviews", `scope=${literal(config.database)} && ${filter}`, sort);
}
export async function createReview(fields) {
    return pb("POST", "/api/collections/reviews/records", { ...fields, scope: config.database, status: "pending" });
}
export async function decideReview(id, status) {
    return pb("PATCH", `/api/collections/reviews/records/${id}`, { status });
}
// ---- stock levels -------------------------------------------------------------------------
const stockRecordIds = new Map();
/** Mirrors a flavour's stock-left count into PocketBase for this process's scope. */
export async function publishStockLevel(flavour, stockLeft) {
    let id = stockRecordIds.get(flavour);
    if (id === undefined) {
        const [found] = await list("stock_levels", `scope=${literal(config.database)} && flavour=${literal(flavour)}`);
        if (found) {
            id = found.id;
        }
        else {
            const created = await raw("POST", "/api/collections/stock_levels/records", {
                scope: config.database,
                flavour,
                stock_left: stockLeft,
            });
            if (created.status < 300) {
                stockRecordIds.set(flavour, String(created.body.id));
                return;
            }
            const [again] = await list("stock_levels", `scope=${literal(config.database)} && flavour=${literal(flavour)}`);
            id = again.id;
        }
        stockRecordIds.set(flavour, id);
    }
    const updated = await raw("PATCH", `/api/collections/stock_levels/records/${id}`, { stock_left: stockLeft });
    if (updated.status === 404) {
        stockRecordIds.delete(flavour);
        await publishStockLevel(flavour, stockLeft);
    }
}
let realtimeConnected = false;
export const realtimeUp = () => realtimeConnected;
/** Holds one realtime connection to PocketBase, reconnecting while it is unreachable. */
export async function followRealtime(onEvent) {
    for (;;) {
        try {
            const response = await fetch(`${BASE}/api/realtime`, { headers: { Accept: "text/event-stream" } });
            if (!response.body)
                throw new Error("no realtime body");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                let end;
                while ((end = buffer.indexOf("\n\n")) !== -1) {
                    const block = buffer.slice(0, end);
                    buffer = buffer.slice(end + 2);
                    const name = /^event:(.*)$/m.exec(block)?.[1]?.trim();
                    const data = block
                        .split("\n")
                        .filter((l) => l.startsWith("data:"))
                        .map((l) => l.slice(5))
                        .join("\n");
                    if (!name || !data)
                        continue;
                    const payload = JSON.parse(data);
                    if (name === "PB_CONNECT") {
                        await pb("POST", "/api/realtime", {
                            clientId: payload.clientId,
                            subscriptions: ["stock_levels", "reviews"],
                        });
                        realtimeConnected = true;
                    }
                    else if (name === "stock_levels" || name === "reviews") {
                        onEvent({
                            collection: name,
                            action: String(payload.action),
                            record: payload.record,
                        });
                    }
                }
            }
        }
        catch {
            // PocketBase went away; the live feed pauses until it returns.
        }
        realtimeConnected = false;
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}
export async function seedAccounts() {
    const seeds = [
        ["owner@ceibo.test", "Ceibo-owner-2026", "Marisol Ferreyra", "owner", null],
        ["pack@ceibo.test", "Ceibo-pack-2026", "Tomas Leclerc", "fulfilment", null],
        ["help@ceibo.test", "Ceibo-help-2026", "Priya Anand", "support", null],
        [
            "camille@example.test",
            "Shopper-2026-qc",
            "Camille Roy",
            "customer",
            { name: "Camille Roy", line1: "48 rue des Ceibos", line2: "", city: "Montreal", province: "QC", postal_code: "H2X 1Y4", is_default: true },
        ],
        [
            "jordan@example.test",
            "Shopper-2026-on",
            "Jordan Mensah",
            "customer",
            { name: "Jordan Mensah", line1: "77 Canopy Lane", line2: "", city: "Toronto", province: "ON", postal_code: "M5V 2T6", is_default: true },
        ],
    ];
    for (const [email, password, name, role, home] of seeds) {
        let user = await findUserByEmail(email);
        if (!user) {
            try {
                user = await createUser(email, password, name, role);
            }
            catch (error) {
                if (!(error instanceof PocketBaseError))
                    throw error;
                user = await findUserByEmail(email);
                if (!user)
                    throw error;
            }
        }
        if (home && (await addresses(user.id)).length === 0)
            await saveAddress(user.id, home);
    }
}
