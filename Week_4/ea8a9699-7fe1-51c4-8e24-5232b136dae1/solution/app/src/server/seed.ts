// Schema and seed (brief: Seed data), applied idempotently at every start; seed objects are written to the
// bucket as soon as storage is reachable.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { hashPassword, tokenHash } from "./access.js";
import { many, pool, returning, transaction } from "./db.js";
import { toLiftLocal } from "./embargo.js";
import { renderPlate, type Motif, type Plate, type Rgb } from "./plates.js";
import { SCHEMA } from "./schema.js";
import { objectExists, objectKey, putObject } from "./storage.js";
import type { PlanId } from "./billing.js";

const PASSWORD = "rushes-demo-2026";
const CLIP_FILE = new URL("../assets/capstan-reel.webm", import.meta.url);
const CLIP_MOTIF = "clip";

const GROUPS = ["Halden Group", "Vartan Studio"];

type Slug = "northvale" | "kesto" | "brisk-tonic" | "vartan";

const WORKSPACES: Array<{ slug: Slug; name: string; group: string; timeZone: string; plan: PlanId }> = [
  { slug: "northvale", name: "Northvale", group: "Halden Group", timeZone: "Europe/London", plan: "rushes-pro-5" },
  { slug: "kesto", name: "Kesto", group: "Halden Group", timeZone: "America/New_York", plan: "rushes-pro-10" },
  { slug: "brisk-tonic", name: "Brisk Tonic", group: "Halden Group", timeZone: "Australia/Sydney", plan: "rushes-pro-5" },
  { slug: "vartan", name: "Vartan Studio", group: "Vartan Studio", timeZone: "Europe/Berlin", plan: "rushes-pro-5" },
];

type Role = "ops_lead" | "designer" | "follower";
const ACCOUNTS: Array<{ name: string; handle: string; email: string; role: Role; home: string | null; seat: boolean }> = [
  { name: "Mara Quill", handle: "mara", email: "mara@halden.example", role: "ops_lead", home: "Halden Group", seat: false },
  { name: "Dev Okafor", handle: "dev", email: "dev@halden.example", role: "ops_lead", home: "Halden Group", seat: false },
  { name: "Juno Park", handle: "juno", email: "juno@northvale.example", role: "designer", home: "northvale", seat: true },
  { name: "Tomas Reyes", handle: "tomas", email: "tomas@northvale.example", role: "designer", home: "northvale", seat: true },
  { name: "Ines Laurent", handle: "ines", email: "ines@northvale.example", role: "designer", home: "northvale", seat: true },
  { name: "Priya Shah", handle: "priya", email: "priya@northvale.example", role: "designer", home: "northvale", seat: true },
  { name: "Ola Berg", handle: "ola", email: "ola@northvale.example", role: "designer", home: "northvale", seat: false },
  { name: "Kit Morrow", handle: "kit", email: "kit@northvale.example", role: "designer", home: "northvale", seat: false },
  { name: "Sam Ilori", handle: "sam", email: "sam@kesto.example", role: "designer", home: "kesto", seat: true },
  { name: "Remy Doucet", handle: "remy", email: "remy@kesto.example", role: "designer", home: "kesto", seat: true },
  { name: "Bea Lund", handle: "bea", email: "bea@brisktonic.example", role: "designer", home: "brisk-tonic", seat: true },
  { name: "Ilse Vartan", handle: "ilse", email: "ilse@vartan.example", role: "designer", home: "vartan", seat: true },
  { name: "Lee Chen", handle: "lee", email: "lee@followers.example", role: "follower", home: null, seat: false },
  { name: "Noor Haddad", handle: "noor", email: "noor@followers.example", role: "follower", home: null, seat: false },
];

const hex = (value: string): Rgb => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
const PALETTES: Record<Slug, readonly [Rgb, Rgb, Rgb]> = {
  northvale: [hex("#1e2a2f"), hex("#5d7a7f"), hex("#c8c2ae")],
  kesto: [hex("#2a2622"), hex("#7a6b5a"), hex("#c9bba2")],
  "brisk-tonic": [hex("#26301f"), hex("#8f9a5c"), hex("#e2dcb4")],
  vartan: [hex("#232a26"), hex("#6d8668"), hex("#cfc8b0")],
};
const ASPECTS = [4 / 3, 1, 3 / 4, 9 / 16, 5 / 4];

const REFERENCES: Array<{ ws: Slug; title: string; motif: Motif; by: string }> = [
  { ws: "northvale", title: "Salt-stained canvas", motif: "weave", by: "juno" },
  { ws: "northvale", title: "Rope coil", motif: "coil", by: "juno" },
  { ws: "northvale", title: "Harbour sodium light", motif: "glow", by: "juno" },
  { ws: "northvale", title: "Oilskin fold", motif: "folds", by: "juno" },
  { ws: "northvale", title: "Net mender's hands", motif: "net", by: "tomas" },
  { ws: "northvale", title: "Tide chart", motif: "tide", by: "juno" },
  { ws: "northvale", title: "Rusted cleat", motif: "rust", by: "juno" },
  { ws: "northvale", title: "Fog over slipway", motif: "fog", by: "tomas" },
  { ws: "kesto", title: "Trail grit macro", motif: "rust", by: "sam" },
  { ws: "kesto", title: "Midsole foam cut", motif: "cells", by: "sam" },
  { ws: "kesto", title: "Ridge at dawn", motif: "ridges", by: "remy" },
  { ws: "kesto", title: "SS27 lace study", motif: "lace", by: "sam" },
  { ws: "kesto", title: "Scree field", motif: "scree", by: "remy" },
  { ws: "brisk-tonic", title: "Citrus peel spiral", motif: "spiral", by: "bea" },
  ...Array.from({ length: 24 }, (_, i) => ({
    ws: "vartan" as const,
    title: `Field Study ${String(i + 1).padStart(2, "0")} plate`,
    motif: (["ridges", "folds", "cells", "tide", "lace", "fog", "scree", "weave"] as const)[i % 8] ?? "fog",
    by: "ilse",
  })),
];

const at = (iso: string): Date => new Date(iso);
const HOUR = 3_600_000;

type ClusterSeed = {
  ws: string;
  title: string;
  owner: string;
  status: "draft" | "in_review" | "public";
  publishedAt?: Date;
  note?: string;
  entries: Array<{ title: string; private?: boolean; by?: string }>;
};

const CLUSTERS: ClusterSeed[] = [
  {
    ws: "northvale",
    title: "SS27 Coastal Workwear",
    owner: "juno",
    status: "draft",
    note: "Do not share before buyer preview on 12 Nov.",
    entries: [
      { title: "Salt-stained canvas" },
      { title: "Rope coil" },
      { title: "Harbour sodium light" },
      { title: "Oilskin fold" },
      { title: "Net mender's hands" },
      { title: "Tide chart", private: true },
    ],
  },
  {
    ws: "northvale",
    title: "AW26 Night Shift",
    owner: "juno",
    status: "public",
    publishedAt: at("2026-10-01T08:00:00.000Z"),
    note: "Lighting budget pending.",
    entries: [
      { title: "Harbour sodium light", by: "juno" },
      { title: "Fog over slipway", by: "tomas" },
      { title: "Rusted cleat", private: true, by: "juno" },
      { title: "Oilskin fold", by: "juno" },
    ],
  },
  { ws: "northvale", title: "SS27 Harbour Lights", owner: "tomas", status: "in_review", entries: [{ title: "Harbour sodium light" }, { title: "Net mender's hands" }] },
  { ws: "kesto", title: "SS27 Trail Runner Direction", owner: "sam", status: "draft", entries: [{ title: "Trail grit macro" }, { title: "Midsole foam cut" }, { title: "SS27 lace study" }] },
  { ws: "kesto", title: "Kesto Studio Pulls", owner: "remy", status: "public", publishedAt: at("2026-09-20T12:00:00.000Z"), entries: [{ title: "Ridge at dawn" }, { title: "Scree field" }] },
  { ws: "brisk-tonic", title: "Summer Fizz Palette", owner: "bea", status: "draft", entries: [{ title: "Citrus peel spiral" }] },
  ...Array.from({ length: 24 }, (_, i): ClusterSeed => {
    const n = i + 1;
    const tied = n >= 13 && n <= 16;
    return {
      ws: "vartan",
      title: `Field Study ${String(n).padStart(2, "0")}`,
      owner: "ilse",
      status: "public",
      publishedAt: tied ? at("2026-09-01T22:00:00.000Z") : new Date(at("2026-09-01T10:00:00.000Z").getTime() + (n - 1) * HOUR),
      entries: [{ title: `Field Study ${String(n).padStart(2, "0")} plate` }],
    };
  }),
];

const FOLLOWS: Array<[string, string]> = [["lee", "juno"], ["lee", "ilse"], ["noor", "juno"]];

async function seed(client: PoolClient): Promise<void> {
  const groupIds = new Map<string, string>();
  for (const name of GROUPS) groupIds.set(name, (await returning<{ id: string }>(client, "INSERT INTO groups (name) VALUES ($1) RETURNING id", [name])).id);
  const workspaceIds = new Map<string, string>();
  for (const [i, ws] of WORKSPACES.entries()) {
    const row = await returning<{ id: string }>(
      client,
      "INSERT INTO workspaces (group_id, slug, name, time_zone, sort_order, seeded_plan, plan) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id",
      [groupIds.get(ws.group), ws.slug, ws.name, ws.timeZone, i, ws.plan],
    );
    workspaceIds.set(ws.slug, row.id);
  }
  const accountIds = new Map<string, string>();
  for (const a of ACCOUNTS) {
    const workspaceId = a.role === "designer" && a.home ? workspaceIds.get(a.home) : null;
    const groupId = a.role === "ops_lead" && a.home ? groupIds.get(a.home) : null;
    const row = await returning<{ id: string }>(
      client,
      "INSERT INTO accounts (email, display_name, handle, password_hash, role, group_id, workspace_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [a.email, a.name, a.handle, await hashPassword(PASSWORD), a.role, groupId ?? null, workspaceId ?? null],
    );
    accountIds.set(a.handle, row.id);
    if (a.seat && workspaceId) await client.query("INSERT INTO seats (account_id, workspace_id) VALUES ($1, $2)", [row.id, workspaceId]);
  }
  const referenceIds = new Map<string, string>();
  const base = at("2026-08-03T09:00:00.000Z").getTime();
  for (const [i, r] of REFERENCES.entries()) {
    const id = randomUUID();
    const plate: Plate = { motif: r.motif, palette: PALETTES[r.ws], aspect: ASPECTS[i % ASPECTS.length] ?? 1, seed: i + 7 };
    await client.query(
      `INSERT INTO "references" (id, workspace_id, kind, title, content_type, ext, created_at, created_by, seed_motif)
       VALUES ($1, $2, 'image', $3, 'image/png', 'png', $4, $5, $6)`,
      [id, workspaceIds.get(r.ws), r.title, new Date(base + i * 7 * 60_000), accountIds.get(r.by), JSON.stringify(plate)],
    );
    referenceIds.set(`${r.ws}:${r.title}`, id);
  }
  await client.query(
    `INSERT INTO "references" (id, workspace_id, kind, title, content_type, ext, created_at, created_by, frame_rate, duration_ms, total_frames, seed_motif)
     VALUES ($1, $2, 'clip', 'Capstan reel', 'video/webm', 'webm', $3, $4, 25, 2000, 50, $5)`,
    [randomUUID(), workspaceIds.get("northvale"), new Date(base + REFERENCES.length * 7 * 60_000), accountIds.get("juno"), CLIP_MOTIF],
  );
  const clusterIds = new Map<string, string>();
  for (const [i, c] of CLUSTERS.entries()) {
    const ws = WORKSPACES.find((w) => w.slug === c.ws);
    const changed = c.publishedAt ?? new Date(at("2026-10-20T09:00:00.000Z").getTime() + i * 60_000);
    const lift = c.publishedAt ?? null;
    const row = await returning<{ id: string }>(
      client,
      `INSERT INTO clusters (workspace_id, title, internal_note, status, owner_id, version, lift_local, lifts_at, published_at, created_at, changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $9) RETURNING id`,
      [workspaceIds.get(c.ws), c.title, c.note ?? "", c.status, accountIds.get(c.owner), 1 + c.entries.length, lift && ws ? toLiftLocal(lift, ws.timeZone) : null, lift, changed],
    );
    clusterIds.set(c.title, row.id);
    for (const [p, e] of c.entries.entries()) {
      await client.query(
        "INSERT INTO entries (cluster_id, reference_id, position, is_private, added_by, added_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [row.id, referenceIds.get(`${c.ws}:${e.title}`), p + 1, e.private === true, accountIds.get(e.by ?? c.owner), new Date(changed.getTime() - (c.entries.length - p) * 60_000)],
      );
    }
  }
  const aw26 = clusterIds.get("AW26 Night Shift");
  await client.query("INSERT INTO comments (cluster_id, author_name, body, account_id, created_at) VALUES ($1, 'Tomas Reyes', $2, $3, $4)", [
    aw26,
    "Swap the third frame for the wider crop.",
    accountIds.get("tomas"),
    at("2026-09-28T15:20:00.000Z"),
  ]);
  await client.query(
    "INSERT INTO review_links (cluster_id, email, token_hash, expires_at, can_comment, created_at) VALUES ($1, $2, $3, $4, true, $5)",
    [clusterIds.get("SS27 Harbour Lights"), "ren@freelance.example", tokenHash("rv-seed-harbour-0001"), at("2099-12-31T23:59:59.000Z"), at("2026-10-20T10:00:00.000Z")],
  );
  for (const [follower, curator] of FOLLOWS) {
    await client.query("INSERT INTO follows (follower_id, curator_id) VALUES ($1, $2)", [accountIds.get(follower), accountIds.get(curator)]);
  }
}

/** Applies the schema, then the seed once per database. Serialised across instances by an advisory lock. */
export async function migrate(): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rushes:migrate'))");
    await client.query(SCHEMA);
    const done = await many(client, "SELECT 1 FROM app_settings WHERE key = 'seeded'");
    if (done.length) return;
    await seed(client);
    await client.query("INSERT INTO app_settings (key, value) VALUES ('seeded', 'true')");
  });
}

/** Writes any seed object missing from the bucket; throws `storage_unavailable` while storage is down. */
export async function writeSeedObjects(): Promise<void> {
  if ((await many(pool, "SELECT 1 FROM app_settings WHERE key = 'seed_objects'")).length) return;
  const rows = await many<{ id: string; slug: string; ext: string; content_type: string; seed_motif: string }>(
    pool,
    `SELECT r.id, w.slug, r.ext, r.content_type, r.seed_motif FROM "references" r JOIN workspaces w ON w.id = r.workspace_id WHERE r.seed_motif IS NOT NULL`,
  );
  for (const row of rows) {
    const key = objectKey(row.slug, row.id, row.ext);
    if (await objectExists(key)) continue;
    const data = row.seed_motif === CLIP_MOTIF ? await readFile(CLIP_FILE) : renderPlate(JSON.parse(row.seed_motif) as Plate);
    await putObject(key, data, row.content_type);
  }
  await pool.query("INSERT INTO app_settings (key, value) VALUES ('seed_objects', 'true') ON CONFLICT DO NOTHING");
}
