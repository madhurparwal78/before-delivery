import { createHash } from "node:crypto";
import type pg from "pg";
import { derivePage } from "../shared/derive.ts";
import type { Connector, PageDoc, Point, PortSide, Shape, SystemKind, Zone } from "../shared/model.ts";
import { hashPassword } from "./passwords.ts";
import { SCHEMA } from "./schema.ts";

/** A stable UUID for a seed record, so re-running the seed changes nothing. */
function seedId(name: string): string {
  const h = createHash("sha256").update(`scopewright-seed:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const PEOPLE = [
  { name: "Dana Okafor", email: "dana.okafor@harborlane.test", password: "Harbor-Lead-2026!" },
  { name: "Ravi Sato", email: "ravi.sato@harborlane.test", password: "Harbor-Net-2026!a" },
  { name: "Jo Mendes", email: "jo.mendes@harborlane.test", password: "Harbor-Net-2026!b" },
  { name: "Lee Varga", email: "lee.varga@northgate-qsa.test", password: "Northgate-QSA-2026!" },
  { name: "Morgan Fell", email: "morgan.fell@harborlane.test", password: "Harbor-Ops-2026!" },
  { name: "Sam Whitlow", email: "sam.whitlow@kestrelpay.test", password: "Kestrel-Owner-2026!" },
] as const;

const userId = (email: string) => seedId(`user:${email}`);

const HARBOR = "5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e01";
const KESTREL = "9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b702";
const SEED_TIME = "2026-09-01T09:00:00Z";

const shape = (id: string, kind: SystemKind, label: string, x: number, y: number, z: number): Shape =>
  ({ id, kind, label, x, y, width: 144, height: 72, z, groupId: null });
const link = (id: string, label: string, a: string, ap: PortSide, b: string, bp: PortSide, points: Point[]): Connector =>
  ({ id, label, from: { shapeId: a, port: ap }, to: { shapeId: b, port: bp }, points });
const zone = (id: string, kind: Zone["kind"], name: string, note: string, x: number, y: number, width: number, height: number): Zone =>
  ({ id, kind, name, note, x, y, width, height });

const PAGES: { diagramId: string; doc: PageDoc }[] = [
  {
    diagramId: HARBOR,
    doc: {
      id: "5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e11", name: "Network diagram", version: 1,
      zones: [zone("net-cde", "cde", "Cardholder Data Environment", "Segmented by <b>VLAN 20</b>", 480, 96, 576, 432)],
      shapes: [shape("net-firewall", "firewall", "Edge firewall", 168, 264, 1), shape("net-switch", "router", "CDE core switch", 600, 264, 2)],
      connectors: [link("net-trunk", "VLAN 20 trunk", "net-firewall", "e", "net-switch", "w", [[312, 300], [600, 300]])],
    },
  },
  {
    diagramId: HARBOR,
    doc: {
      id: "5c0f3e2a-7d41-4b6e-9a10-2f8c6b1d4e12", name: "Account data flows", version: 1,
      zones: [
        zone("zone-connected", "connected", "Connected-to systems", "", 48, 96, 384, 432),
        zone("zone-cde", "cde", "Cardholder Data Environment", "Reviewed with assessor<br>September 2026", 480, 96, 576, 432),
        zone("zone-out", "out_of_scope", "Out of scope", "", 1104, 96, 384, 432),
      ],
      shapes: [
        shape("shp-checkout", "web_app", "Checkout web app", 168, 168, 1),
        shape("shp-admin", "workstation", "Admin workstation", 168, 360, 2),
        shape("shp-payapi", "api_service", "Payment API", 600, 168, 3),
        shape("shp-vault", "database", "Card vault", 600, 360, 4),
        shape("shp-settle", "server", "Settlement batch", 840, 360, 5),
        shape("shp-analytics", "cloud_service", "Analytics", 1224, 168, 6),
        shape("shp-acquirer", "third_party", "Acquirer gateway", 1224, 600, 7),
        shape("shp-fraud", "api_service", "Fraud screening", 600, 600, 8),
      ],
      connectors: [
        link("con-checkout-pay", "Card data <b>(TLS)</b>", "shp-checkout", "e", "shp-payapi", "w", [[312, 204], [600, 204]]),
        link("con-pay-vault", "Token lookup", "shp-payapi", "s", "shp-vault", "n", [[672, 240], [672, 360]]),
        link("con-vault-settle", "Batch records", "shp-vault", "e", "shp-settle", "w", [[744, 396], [840, 396]]),
        link("con-settle-acq", "Settlement file", "shp-settle", "e", "shp-acquirer", "n", [[984, 396], [1080, 396], [1080, 576], [1296, 576], [1296, 600]]),
        link("con-admin-pay", "Admin console", "shp-admin", "e", "shp-vault", "w", [[312, 396], [600, 396]]),
        link("con-pay-analytics", "Order events (no card data)", "shp-payapi", "n", "shp-analytics", "n", [[672, 168], [672, 144], [1296, 144], [1296, 168]]),
        link("con-fraud-settle", "Risk score", "shp-fraud", "e", "shp-settle", "s", [[744, 636], [912, 636], [912, 432]]),
      ],
    },
  },
  {
    diagramId: KESTREL,
    doc: {
      id: "9b7e1c44-0a3d-4f2e-8c55-61d2a9f0b712", name: "Processing scope", version: 1,
      zones: [zone("ks-cde", "cde", "Cardholder Data Environment", "", 0, 0, 480, 360)],
      shapes: [shape("ks-switch", "server", "Kestrel switch", 96, 96, 1)],
      connectors: [],
    },
  },
];

/** Applies the schema and seed data idempotently. Instances sharing a database take turns under an advisory lock. */
export async function migrateAndSeed(client: pg.PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock(73100417)");
  try {
    await client.query(SCHEMA);
    const existing = new Set((await client.query<{ email: string }>("SELECT email FROM users")).rows.map((r) => r.email));
    for (const person of PEOPLE) {
      if (existing.has(person.email)) continue;
      await client.query(
        "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [userId(person.email), person.email, person.name, await hashPassword(person.password), SEED_TIME],
      );
    }
    await client.query(
      "INSERT INTO diagrams (id, owner_id, title, created_at, updated_at) VALUES ($1, $2, $3, $5, $5), ($4, $6, $7, $5, $5) ON CONFLICT DO NOTHING",
      [HARBOR, userId("dana.okafor@harborlane.test"), "Harbor Lane CDE scope", KESTREL, SEED_TIME, userId("sam.whitlow@kestrelpay.test"), "Kestrel Pay processing scope"],
    );
    for (const [index, { diagramId, doc }] of PAGES.entries()) {
      await client.query(
        "INSERT INTO pages (id, diagram_id, name, version, doc, derived, created_at) VALUES ($1, $2, $3, 1, $4, $5, $6) ON CONFLICT DO NOTHING",
        [doc.id, diagramId, doc.name, JSON.stringify(doc), JSON.stringify(derivePage(doc)), new Date(Date.parse(SEED_TIME) + index * 1000).toISOString()],
      );
    }
    for (const [email, role] of [["ravi.sato@harborlane.test", "editor"], ["jo.mendes@harborlane.test", "editor"], ["lee.varga@northgate-qsa.test", "viewer"]] as const) {
      await client.query(
        "INSERT INTO shares (id, diagram_id, email, role, status, user_id, delivered, created_at) VALUES ($1, $2, $3, $4, 'active', $5, true, $6) ON CONFLICT DO NOTHING",
        [seedId(`share:${HARBOR}:${email}`), HARBOR, email, role, userId(email), SEED_TIME],
      );
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(73100417)");
  }
}
