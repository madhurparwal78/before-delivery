// PocketBase: the studio's editable content (case studies, services, team, insights, marquee), created and seeded idempotently.
import { config } from "./config.js";
import { ApiError } from "./errors.js";
export const PRIMITIVES = ["box", "cylinder", "sphere", "torus", "capsule"];
export const ACCENTS = ["ember", "cobalt", "violet"];
const COLLECTIONS = [
    {
        name: "case_studies",
        unique: "slug",
        fields: [
            { name: "slug", type: "text" },
            { name: "title", type: "text" },
            { name: "client", type: "text" },
            { name: "summary", type: "text" },
            { name: "scene", type: "json" },
            { name: "published", type: "bool" },
            { name: "sort", type: "number" },
        ],
    },
    {
        name: "services",
        unique: "code",
        fields: [
            { name: "code", type: "text" },
            { name: "title", type: "text" },
            { name: "list_price_pence", type: "number" },
            { name: "azimuth_deg", type: "number" },
            { name: "elevation_deg", type: "number" },
            { name: "sort", type: "number" },
        ],
    },
    { name: "team", unique: "name", fields: [{ name: "name", type: "text" }, { name: "role", type: "text" }, { name: "bio", type: "text" }] },
    { name: "insights", unique: "slug", fields: [{ name: "slug", type: "text" }, { name: "title", type: "text" }, { name: "summary", type: "text" }] },
    { name: "marquee", unique: "name", fields: [{ name: "name", type: "text" }, { name: "sort", type: "number" }] },
];
const SEED_CASE_STUDIES = [
    {
        slug: "hollin-h2-headphones",
        title: "Hollin H2 over-ear headphones",
        client: "Hollin Audio",
        summary: "Launch stills for a pair of over-ear headphones, lit to show the stitched headband and the brushed yoke without losing the matte cups to shadow.",
        scene: { primitives: ["torus", "torus", "capsule", "cylinder"], accent: "violet" },
        published: true,
        sort: 1,
    },
    {
        slug: "brant-vale-arc-kettle",
        title: "Brant & Vale Arc kettle",
        client: "Brant & Vale Kitchen",
        summary: "Eight colourways of a stainless kettle, rendered from the factory CAD so the arc handle and the spout's polished lip read true in every finish.",
        scene: { primitives: ["cylinder", "sphere", "torus", "box"], accent: "ember" },
        published: true,
        sort: 2,
    },
    {
        slug: "ridgeway-e7-hub-motor",
        title: "Ridgeway E7 hub motor",
        client: "Ridgeway Cycles",
        summary: "An exploded view of a rear hub motor, every stator plate and bearing pulled apart along the axle for a product page that explains the drive.",
        scene: { primitives: ["cylinder", "cylinder", "torus", "box", "box"], accent: "cobalt" },
        published: true,
        sort: 3,
    },
    {
        slug: "tallow-t18-drill",
        title: "Tallow T18 drill driver",
        client: "Tallow Tools",
        summary: "Turntable and hero stills of a cordless drill driver, with the battery pack and chuck lit as separate studies.",
        scene: { primitives: ["box", "cylinder", "capsule"], accent: "ember" },
        published: false,
        sort: 4,
    },
];
const SEED_SERVICES = [
    { code: "hero_front", title: "Hero front", list_price_pence: 45000, azimuth_deg: 0, elevation_deg: 5, sort: 1 },
    { code: "three_quarter", title: "Three-quarter", list_price_pence: 45000, azimuth_deg: 45, elevation_deg: 20, sort: 2 },
    { code: "top_down", title: "Top-down", list_price_pence: 38000, azimuth_deg: 0, elevation_deg: 90, sort: 3 },
    { code: "detail_macro", title: "Detail macro", list_price_pence: 52000, azimuth_deg: 300, elevation_deg: 15, sort: 4 },
    { code: "turntable_360", title: "360 turntable", list_price_pence: 145000, azimuth_deg: 90, elevation_deg: 10, sort: 5 },
    { code: "exploded_view", title: "Exploded view", list_price_pence: 185000, azimuth_deg: 135, elevation_deg: 30, sort: 6 },
];
const SEED_TEAM = [
    {
        name: "Ines Varga",
        role: "Founder and lead artist",
        bio: "Ines spent a decade lighting cars and phones for agency launches before opening Gloamwork to render hardware straight from each brand's own CAD.",
    },
];
const SEED_INSIGHTS = [
    { slug: "glb-thousand-times-too-big", title: "Why your GLB arrives a thousand times too big", summary: "glTF speaks metres; a millimetre export without conversion is the most common reason a product arrives the size of a stadium." },
    { slug: "what-a-turntable-needs", title: "What a 360 turntable needs from your CAD", summary: "Closed shells, real thickness and every visible face modelled, because a turntable shows the back of the product too." },
];
const SEED_MARQUEE = ["Hollin Audio", "Brant & Vale Kitchen", "Ridgeway Cycles", "Sorane Instruments", "Tallow Tools", "Marrow Optics", "Fenwick Lamps"];
let token = null;
async function authenticate() {
    const response = await fetch(`${config.pocketbase.url}/api/admins/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: config.pocketbase.email, password: config.pocketbase.password }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
        throw new ApiError("content_unavailable");
    token = (await response.json()).token;
    return token;
}
async function pb(method, path, body) {
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            const auth = token ?? (await authenticate());
            const response = await fetch(`${config.pocketbase.url}${path}`, {
                method,
                headers: { Authorization: auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                signal: AbortSignal.timeout(10_000),
            });
            const text = await response.text();
            if (response.status === 401 && attempt === 0) {
                token = null;
                continue;
            }
            if (response.status >= 500)
                throw new ApiError("content_unavailable");
            return { status: response.status, json: text ? JSON.parse(text) : null };
        }
    }
    catch (error) {
        if (error instanceof ApiError)
            throw error;
    }
    throw new ApiError("content_unavailable");
}
async function list(collection, filter = "") {
    const query = new URLSearchParams({ perPage: "500", ...(filter ? { filter } : {}) });
    const response = await pb("GET", `/api/collections/${collection}/records?${query.toString()}`);
    if (response.status !== 200)
        throw new ApiError("content_unavailable");
    return response.json.items;
}
function quoteFilter(value) {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function toCaseStudy(record) {
    const scene = record.scene;
    return {
        slug: String(record.slug),
        title: String(record.title),
        client: String(record.client),
        summary: String(record.summary),
        scene: { primitives: [...scene.primitives], accent: scene.accent },
        published: record.published === true,
        sort: Number(record.sort),
    };
}
function toService(record) {
    return {
        code: String(record.code),
        title: String(record.title),
        list_price_pence: Number(record.list_price_pence),
        azimuth_deg: Number(record.azimuth_deg),
        elevation_deg: Number(record.elevation_deg),
        sort: Number(record.sort),
    };
}
const bySort = (a, b) => a.sort - b.sort;
async function ensureCollection(spec) {
    const existing = await pb("GET", `/api/collections/${spec.name}`);
    if (existing.status === 200)
        return;
    await pb("POST", "/api/collections", {
        name: spec.name,
        type: "base",
        schema: spec.fields.map((field) => ({
            name: field.name,
            type: field.type,
            required: false,
            options: field.type === "json" ? { maxSize: 2_000_000 } : {},
        })),
        indexes: [`CREATE UNIQUE INDEX \`idx_${spec.name}_${spec.unique}\` ON \`${spec.name}\` (\`${spec.unique}\`)`],
    });
    const created = await pb("GET", `/api/collections/${spec.name}`);
    if (created.status !== 200)
        throw new ApiError("content_unavailable");
}
async function seedMissing(collection, key, records) {
    const present = new Set((await list(collection)).map((record) => String(record[key])));
    for (const record of records) {
        // A concurrent instance may win the unique index; its record is the same seed.
        if (!present.has(String(record[key])))
            await pb("POST", `/api/collections/${collection}/records`, record);
    }
}
/** Creates the five collections and their seed records where missing; safe to run from several instances at once. */
export async function prepareContent() {
    for (const spec of COLLECTIONS)
        await ensureCollection(spec);
    await seedMissing("case_studies", "slug", SEED_CASE_STUDIES);
    await seedMissing("services", "code", SEED_SERVICES);
    await seedMissing("team", "name", SEED_TEAM);
    await seedMissing("insights", "slug", SEED_INSIGHTS);
    await seedMissing("marquee", "name", SEED_MARQUEE.map((name, index) => ({ name, sort: index + 1 })));
}
export async function caseStudies(publishedOnly) {
    return (await list("case_studies", publishedOnly ? "published=true" : "")).map(toCaseStudy).sort(bySort);
}
/** The published slug format (3 to 60 lowercase letters, digits and hyphens): the one place it is decided. */
export const SLUG_PATTERN = /^[a-z0-9-]{3,60}$/;
async function caseStudyRecord(slug) {
    if (!SLUG_PATTERN.test(slug))
        return null; // no such slug can exist: refused before any lookup
    return (await list("case_studies", `slug=${quoteFilter(slug)}`))[0] ?? null;
}
export async function caseStudy(slug) {
    const record = await caseStudyRecord(slug);
    return record ? toCaseStudy(record) : null;
}
export async function createCaseStudy(study) {
    if (await caseStudyRecord(study.slug))
        throw new ApiError("slug_taken");
    const created = await pb("POST", "/api/collections/case_studies/records", study);
    if (created.status === 400)
        throw new ApiError("slug_taken");
    if (created.status !== 200)
        throw new ApiError("content_unavailable");
    return toCaseStudy(created.json);
}
export async function updateCaseStudy(slug, changes) {
    const record = await caseStudyRecord(slug);
    if (!record)
        return null;
    const updated = await pb("PATCH", `/api/collections/case_studies/records/${record.id}`, changes);
    if (updated.status !== 200)
        throw new ApiError("content_unavailable");
    return toCaseStudy(updated.json);
}
export async function services() {
    return (await list("services")).map(toService).sort(bySort);
}
export async function updateService(code, changes) {
    const record = (await list("services", `code=${quoteFilter(code)}`))[0];
    if (!record)
        return null;
    const updated = await pb("PATCH", `/api/collections/services/records/${record.id}`, changes);
    if (updated.status !== 200)
        throw new ApiError("content_unavailable");
    return toService(updated.json);
}
async function team() {
    return (await list("team")).map((r) => ({ name: String(r.name), role: String(r.role), bio: String(r.bio) }));
}
export async function insights() {
    return (await list("insights")).map((r) => ({ slug: String(r.slug), title: String(r.title), summary: String(r.summary) })).sort((a, b) => a.slug.localeCompare(b.slug));
}
async function marquee() {
    return (await list("marquee")).map((r) => ({ name: String(r.name), sort: Number(r.sort) })).sort(bySort).map((r) => r.name);
}
/** The published studio content: GET /api/content and the copy inlined into public pages. */
export async function publishedContent() {
    const [studies, list, people, notes, names] = await Promise.all([caseStudies(true), services(), team(), insights(), marquee()]);
    return { case_studies: studies, services: list, team: people, insights: notes, marquee: names };
}
export async function contentReachable() {
    try {
        const response = await fetch(`${config.pocketbase.url}/api/health`, { signal: AbortSignal.timeout(3_000) });
        await response.body?.cancel();
        return response.ok;
    }
    catch {
        return false;
    }
}
