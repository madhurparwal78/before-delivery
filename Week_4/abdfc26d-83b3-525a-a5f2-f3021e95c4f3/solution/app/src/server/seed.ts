import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vatCents, VAT_RATES, type Role } from "../shared/rules.js";
import { one, pool, rows, tx, type Tx } from "./db.js";
import * as keycloak from "./keycloak.js";
import { move } from "./ledger.js";
import type { Timeline, Uniform } from "./pieces.js";
import { exportKey } from "./renders.js";
import { objectExists, putObject } from "./s3.js";
import { SEED_SHADERS } from "./seed-shaders.js";
import { nextNumber } from "./sequences.js";
import { saleSplitFor } from "./splits.js";

// The seed state of the brief, applied once per database (and the matching Keycloak users and MinIO objects).

const EXPORTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../seed/exports");

interface SeedPerson extends keycloak.SeedUser {
  roles: Role[];
  sellerAddress: string | null;
}

const PEOPLE: Record<string, SeedPerson> = {
  wren: { username: "wren.okafor", firstName: "Wren", lastName: "Okafor", email: "wren@brightmoss.example", roles: ["founder-operator"], password: "Yard-Founder-2026", sellerAddress: null },
  ilse: { username: "ilse.marrow", firstName: "Ilse", lastName: "Marrow", email: "ilse@studio-marrow.example", roles: ["creator"], password: "Yard-Creator-2026", sellerAddress: "Studio Marrow, 12 Lindenstraat, Utrecht, Netherlands" },
  tobi: { username: "tobi.ansel", firstName: "Tobi", lastName: "Ansel", email: "tobi@ansel-loops.example", roles: ["creator"], password: "Yard-Creator-2026", sellerAddress: "Ansel Loops, 4 Hafenweg, Bremen, Germany" },
  odile: { username: "odile.renn", firstName: "Odile", lastName: "Renn", email: "odile@renn-signal.example", roles: ["creator"], password: "Yard-Creator-2026", sellerAddress: "Renn Signal, 9 Rue des Lampes, Lyon, France" },
  june: { username: "june.halloway", firstName: "June", lastName: "Halloway", email: "june@collectors.example", roles: ["collector"], password: "Yard-Collector-2026", sellerAddress: null },
  pax: { username: "pax.ferreira", firstName: "Pax", lastName: "Ferreira", email: "pax@collectors.example", roles: ["collector"], password: "Yard-Collector-2026", sellerAddress: null },
  nell: { username: "nell.quist", firstName: "Nell", lastName: "Quist", email: "nell@collectors.example", roles: ["collector"], password: "Yard-Collector-2026", sellerAddress: null },
};
type Person = keyof typeof PEOPLE;

const uniforms = (hue: number, film: number, drift: number): Uniform[] => [
  { name: "uHue", label: "Hue", min: 0, max: 1, value: hue },
  { name: "uFilm", label: "Film thickness", min: 0, max: 1, value: film },
  { name: "uDrift", label: "Drift", min: 0, max: 2, value: drift },
];
const STILL: Timeline = { duration_s: 10, tracks: [], audio_asset_id: null };

interface SeedPiece {
  slug: keyof typeof SEED_SHADERS | "halo-undertow";
  title: string;
  creator: Person;
  run: number | null;
  price: number | null;
  uniforms: Uniform[];
  timeline: Timeline;
  publishedAt: string | null;
  featured?: boolean;
  remixOf?: string;
}

const PIECES: SeedPiece[] = [
  { slug: "tidewire-bloom", title: "Tidewire Bloom", creator: "ilse", run: 40, price: 2400, uniforms: uniforms(0.52, 0.45, 0.9), timeline: STILL, publishedAt: "2026-09-20T18:00:00Z", featured: true },
  { slug: "salt-halo", title: "Salt Halo", creator: "ilse", run: 12, price: 999, uniforms: uniforms(0.08, 0.6, 0.6), timeline: STILL, publishedAt: "2026-09-24T18:00:00Z" },
  { slug: "lantern-static", title: "Lantern Static", creator: "tobi", run: 3, price: 1200, uniforms: uniforms(0.1, 0.5, 0.7), timeline: STILL, publishedAt: "2026-09-26T18:00:00Z" },
  { slug: "halo-undertow", title: "Halo Undertow", creator: "tobi", run: 25, price: 1999, uniforms: uniforms(0.55, 0.3, 1.1), timeline: STILL, publishedAt: "2026-09-28T18:00:00Z", remixOf: "salt-halo" },
  {
    slug: "night-loom",
    title: "Night Loom",
    creator: "ilse",
    run: null,
    price: null,
    uniforms: uniforms(0.12, 0.7, 0.5),
    timeline: {
      duration_s: 10,
      tracks: [{ uniform: "uHue", keyframes: [{ time_s: 0, value: 0.12, easing: "ease-in-out" }, { time_s: 5, value: 0.4, easing: "ease-in-out" }] }],
      audio_asset_id: null,
    },
    publishedAt: null,
  },
];

const ORDERS: { paid: string; slug: string; edition: number; buyer: Person; country: keyof typeof VAT_RATES }[] = [
  { paid: "2026-10-02T12:00:00Z", slug: "tidewire-bloom", edition: 1, buyer: "june", country: "US" },
  { paid: "2026-10-02T12:00:00Z", slug: "lantern-static", edition: 1, buyer: "pax", country: "FR" },
  { paid: "2026-10-03T12:00:00Z", slug: "halo-undertow", edition: 4, buyer: "june", country: "DE" },
  { paid: "2026-10-04T12:00:00Z", slug: "lantern-static", edition: 2, buyer: "june", country: "US" },
  { paid: "2026-10-05T12:00:00Z", slug: "tidewire-bloom", edition: 5, buyer: "pax", country: "FR" },
];

const GRANTS: [Person, number][] = [["ilse", 600], ["tobi", 40], ["odile", 0]];

const exportFile = (slug: string): Buffer => readFileSync(path.join(EXPORTS_DIR, `${slug}.mp4`));

/** Creates the realm roles and the seeded people in Keycloak when missing; returns their user ids. */
export async function ensureIdentities(): Promise<Record<Person, string>> {
  for (const role of ["creator", "collector", "founder-operator"]) await keycloak.ensureRealmRole(role);
  const ids = {} as Record<Person, string>;
  for (const [key, person] of Object.entries(PEOPLE)) {
    const id = await keycloak.ensureUser(person);
    await keycloak.grantRealmRoles(id, person.roles);
    ids[key] = id;
  }
  return ids;
}

/** Applies the seed to an empty database, once, under a lock shared with every instance on it. */
export async function applySeed(ids: Record<Person, string>): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('phosphene-yard seed'))");
    for (const [key, person] of Object.entries(PEOPLE)) {
      await client.query(
        `INSERT INTO users (id, username, display_name, email, seller_address) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET seller_address = EXCLUDED.seller_address`,
        [ids[key], person.username, `${person.firstName} ${person.lastName}`, person.email, person.sellerAddress],
      );
    }
    if (await one(client, "SELECT 1 FROM seed_applied WHERE name = 'brief'")) return;
    await seedPieces(client, ids);
    for (const [who, credits] of GRANTS) await move(client, "grant", ids[who] as string, credits);
    await client.query("INSERT INTO seed_applied (name) VALUES ('brief')");
  });
}

async function seedPieces(client: Tx, ids: Record<Person, string>): Promise<void> {
  const pieceIds = new Map<string, string>();
  for (const piece of PIECES) {
    const id = randomUUID();
    pieceIds.set(piece.slug, id);
    const source = SEED_SHADERS[(piece.remixOf ?? piece.slug) as keyof typeof SEED_SHADERS];
    await client.query(
      `INSERT INTO pieces (id, slug, title, creator_id, state, version, fragment_source, uniforms, timeline, remix_of_id,
                           edition_count, price_cents, featured, published_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($13::timestamptz - interval '2 days', now()))`,
      [id, piece.slug, piece.title, ids[piece.creator], piece.publishedAt ? "published" : "draft", source, JSON.stringify(piece.uniforms),
        JSON.stringify(piece.timeline), piece.remixOf ? pieceIds.get(piece.remixOf) : null, piece.run, piece.price, piece.featured ?? false, piece.publishedAt],
    );
    if (!piece.publishedAt) continue;
    const renderId = randomUUID();
    const rendered = new Date(new Date(piece.publishedAt).getTime() - 2 * 3600_000).toISOString();
    await client.query(
      `INSERT INTO renders (id, piece_id, creator_id, state, cost_credits, attempts, format, resolution, duration_s, aspect, sha256,
                            history, fragment_source, uniforms, timeline, published_at, created_at)
       VALUES ($1, $2, $3, 'ready', 20, 1, 'mp4', '1080p', 10, '16:9', $4, $5, $6, $7, $8, $9, $9)`,
      [renderId, id, ids[piece.creator], createHash("sha256").update(exportFile(piece.slug)).digest("hex"),
        JSON.stringify(["accepted", "queued", "rendering", "stored", "ready"].map((state) => ({ state, at: rendered }))),
        source, JSON.stringify(piece.uniforms), JSON.stringify(piece.timeline), rendered],
    );
    await client.query("UPDATE pieces SET export_render_id = $2 WHERE id = $1", [id, renderId]);
  }
  for (const order of ORDERS) {
    const piece = PIECES.find((p) => p.slug === order.slug) as SeedPiece;
    const net = piece.price as number;
    const rate = VAT_RATES[order.country];
    const vat = vatCents(net, rate);
    const buyer = PEOPLE[order.buyer] as SeedPerson;
    const orderId = randomUUID();
    await client.query(
      `INSERT INTO orders (id, piece_id, collector_id, edition, state, billing_name, email, billing_country, net_cents, vat_rate_percent,
                           vat_cents, gross_cents, invoice_number, invoice_status, receipt_status, paid_at, seed, created_at)
       VALUES ($1, $2, $3, $4, 'receipted', $5, $6, $7, $8, $9, $10, $11, $12, 'pending', 'sent', $13, true, $13::timestamptz - interval '5 minutes')`,
      [orderId, pieceIds.get(order.slug), ids[order.buyer], order.edition, `${buyer.firstName} ${buyer.lastName}`, buyer.email, order.country,
        net, rate, vat, net + vat, await nextNumber(client, "invoice", new Date(order.paid).getUTCFullYear()), order.paid],
    );
    const source = piece.remixOf ? (PIECES.find((p) => p.slug === piece.remixOf) as SeedPiece) : null;
    for (const share of saleSplitFor(net, ids[piece.creator] as string, source ? (ids[source.creator] as string) : null)) {
      await client.query("INSERT INTO split_rows (order_id, party, holder_id, kind, amount_cents, at) VALUES ($1, $2, $3, 'sale', $4, $5)", [
        orderId, share.party, share.holderId, share.amount, order.paid,
      ]);
    }
  }
}

/** Stores the seeded exports in MinIO when missing; false while storage cannot be reached. */
export async function ensureSeedObjects(): Promise<boolean> {
  const seeded = await rows<{ id: string; slug: string }>(
    pool,
    "SELECT r.id, p.slug FROM renders r JOIN pieces p ON p.export_render_id = r.id WHERE p.slug = ANY($1)",
    [PIECES.filter((p) => p.publishedAt).map((p) => p.slug)],
  );
  try {
    for (const render of seeded) {
      const key = exportKey(render.id, "mp4");
      if (!(await objectExists(key))) await putObject(key, exportFile(render.slug), "video/mp4");
    }
    return true;
  } catch (error) {
    console.error("seed exports not stored yet:", error instanceof Error ? error.message : error);
    return false;
  }
}
