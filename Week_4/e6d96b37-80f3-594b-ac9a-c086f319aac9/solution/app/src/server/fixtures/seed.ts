// The invented fixture desk (every namespace), the default `hollowmint` desk created on serve,
// and the grading seed's workflow overlays, identities and genuine sign-ins.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { draftKey, WORKSPACES, type WorkflowKey } from "../../shared/drafts.js";
import { CELLS } from "../../shared/limits.js";
import type { Attribution, Holder, PhotoLabel, Role } from "../../shared/types.js";
import { config, DEFAULT_NAMESPACE } from "../config.js";
import { exclusively, query, transaction } from "../db.js";
import type { ManifestRecord, OfferRecord, SpecimenRecord, StoredPhoto } from "../desk.js";
import { albumFrom, registerImageKey } from "../commands/stock.js";
import { serviceUnavailable } from "../errors.js";
import { type BrowserCookie, exchangeCode, passwordSignIn, pkcePair, reachable } from "../keycloak.js";
import { configureRealm, password, provisionIdentity, username } from "../keycloakSetup.js";
import { copyObject, ensureBucket, putObject } from "../minio.js";
import { type AlbumDefinition, lookupAlbum, lookupVariety, type VarietyRecord } from "../register.js";
import { createSession, SESSION_COOKIE } from "../sessions.js";
import { type CoinFace, drawCoin } from "./draw.js";

export const VARIANTS = ["base", "conflict", "outage", "offline", "session"] as const;
type Variant = (typeof VARIANTS)[number];
export const WORKFLOWS: readonly WorkflowKey[] = [...(Object.keys(WORKSPACES) as WorkflowKey[]), "cross-cutting"];

interface FixtureSpecimen {
  key: string;
  owner: Role;
  reference: string;
  mintmark: string;
  holder: Holder;
  face: Omit<CoinFace, "side" | "seed">;
  quarantined?: boolean;
}

const FLIP: Holder = { kind: "flip", width_mm: 50, height_mm: 50 };
const SILVER: [number, number, number] = [1, 1, 1];

const FIXTURES: FixtureSpecimen[] = [
  { key: "A", owner: "dealer", reference: "ALD-A", mintmark: "A", holder: FLIP, face: { mintmark: "A", wear: 1, tone: SILVER, repunched: true } },
  { key: "B", owner: "dealer", reference: "ALD-A", mintmark: "A", holder: FLIP, face: { mintmark: "A", wear: 9, tone: [0.93, 0.9, 0.84] } },
  { key: "C", owner: "dealer", reference: "ALD-A", mintmark: "A", holder: { kind: "slab", width_mm: 70, height_mm: 90 }, face: { mintmark: "A", wear: 2, tone: [1.02, 0.98, 0.9] } },
  { key: "U", owner: "dealer", reference: "ALD-K", mintmark: "K", holder: FLIP, face: { mintmark: "K", wear: 3, tone: [0.97, 0.97, 0.99] }, quarantined: true },
  { key: "O", owner: "dealer", reference: "ALD-O", mintmark: "O", holder: { kind: "capsule", width_mm: 46, height_mm: 46 }, face: { mintmark: "O", wear: 2, tone: [1, 0.99, 0.96] } },
  { key: "X", owner: "counterpart", reference: "ALD-K", mintmark: "K", holder: FLIP, face: { mintmark: "K", wear: 2, tone: [0.98, 0.96, 0.92] } },
  { key: "Y", owner: "outsider", reference: "ALD-A", mintmark: "A", holder: FLIP, face: { mintmark: "A", wear: 3, tone: SILVER } },
];

const pictures = new Map<string, Buffer>();

/** Fixture pictures are drawn once per process; the drawing is deterministic. */
function picture(name: string, face: CoinFace): Buffer {
  if (!pictures.has(name)) pictures.set(name, drawCoin(face));
  return pictures.get(name)!;
}

function seedOf(name: string): number {
  return createHash("sha256").update(name).digest().readUInt32BE(0);
}

function facePicture(spec: FixtureSpecimen, label: PhotoLabel, extra: Partial<CoinFace> = {}): Buffer {
  const name = `${spec.key}-${label}-${extra.mark ?? ""}`;
  return picture(name, { ...spec.face, side: label === "reverse" ? "reverse" : "obverse", seed: seedOf(name), ...extra });
}

/** The two staged intake photographs (`media`), a fresh invented crown. */
function stagedMedia(): { obverse: Buffer; reverse: Buffer } {
  const face = { mintmark: "A", wear: 1, tone: SILVER } as const;
  return {
    obverse: picture("staged-obverse", { ...face, side: "obverse", seed: 11 }),
    reverse: picture("staged-reverse", { ...face, side: "reverse", seed: 12 }),
  };
}

/** Draws every fixture picture ahead of the first seed. */
export function warmPictures(): void {
  for (const spec of FIXTURES) {
    facePicture(spec, "obverse");
    facePicture(spec, "reverse");
  }
  facePicture(FIXTURES[0]!, "arrival", { mark: "scratch", lightShift: 0.08 });
  facePicture(FIXTURES[0]!, "arrival", { mark: "gouge", lightShift: 0.08 });
  facePicture(FIXTURES[5]!, "arrival", { lightShift: 0.08 });
  stagedMedia();
}

// --- providers ------------------------------------------------------------------------------

interface Providers {
  minio: boolean;
  keycloak: boolean;
  register: Map<string, VarietyRecord>;
  album: AlbumDefinition | null;
}

async function probe(ns: string): Promise<Providers> {
  const minio = await ensureBucket().then(() => true, () => false);
  const keycloak = await reachable();
  const register = new Map<string, VarietyRecord>();
  for (const reference of ["ALD-A", "ALD-K", "ALD-O"]) {
    const record = await lookupVariety(reference).catch(() => null);
    if (!record || !minio) continue;
    const stored = await putObject(registerImageKey(ns, record), record.image, "image/svg+xml").then(() => true, () => false);
    if (stored) register.set(reference, record);
  }
  const album = await lookupAlbum("ALD-CROWN").catch(() => null);
  return { minio, keycloak, register, album };
}

// --- desk content -----------------------------------------------------------------------------

interface DeskContent {
  specimens: Map<string, SpecimenRecord>;
  cells: Map<string, string | null>;
  offers: OfferRecord[];
  manifests: ManifestRecord[];
  receipts: { offer: string; party: "dealer" | "counterpart"; matches: boolean }[];
  /** Objects to write: key, bytes, content type. */
  objects: { key: string; bytes: Buffer; type: string }[];
  /** Object copies to make once the sources exist. */
  copies: { source: string; target: string }[];
}

function photoRecord(ns: string, key: string, label: PhotoLabel, bytes: Buffer, offer?: string): StoredPhoto & { bytes: Buffer } {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const objectKey = label === "arrival"
    ? `arrivals/${ns}/${offer}/${key}-${sha256}.png`
    : `specimens/${ns}/${key}/${label}-${sha256}.png`;
  return { id: randomUUID(), label, object_key: objectKey, sha256, width: 1000, height: 1000, bytes, ...(offer ? { offer } : {}) };
}

function attributionFor(spec: FixtureSpecimen, providers: Providers): Attribution {
  const record = providers.register.get(spec.reference);
  return {
    reference: spec.reference,
    mintmark: spec.mintmark,
    revision: record ? record.revision : null,
    certainty: spec.quarantined ? "uncertain" : "certain",
    note: spec.quarantined ? "Mintmark K looks doubled under the loupe; holding for a second look." : null,
    correction: null,
    register: record ? "stored" : "pending",
  };
}

function offer(key: string, fields: Partial<OfferRecord> = {}): OfferRecord {
  return {
    key,
    version: 1,
    status: "draft",
    dealer_items: [],
    counterpart_items: [],
    acceptances: { dealer: null, counterpart: null },
    holds: [],
    expires_at: null,
    status_before_dispute: null,
    changed: 0,
    ...fields,
  };
}

const acceptedBoth = (version: number) => ({
  dealer: { version, subject: "seed" },
  counterpart: { version, subject: "seed" },
});

function manifest(offerKey: string, party: "dealer" | "counterpart", order: string[]): ManifestRecord {
  return { offer: offerKey, party, version: 1, order, frozen: false, evidence: [] };
}

function addPhoto(content: DeskContent, ns: string, key: string, label: PhotoLabel, bytes: Buffer, offerKey?: string): StoredPhoto {
  const { bytes: data, ...photo } = photoRecord(ns, key, label, bytes, offerKey);
  content.specimens.get(key)!.photos.push(photo);
  content.objects.push({ key: photo.object_key, bytes: data, type: "image/png" });
  return photo;
}

/** Freezes a seeded manifest the way the product does: evidence copies of each latest obverse. */
function freezeSeeded(content: DeskContent, ns: string, m: ManifestRecord): void {
  m.frozen = true;
  m.version = 2;
  for (const item of m.order) {
    const s = content.specimens.get(item)!;
    const obverse = s.photos.find((p) => p.label === "obverse")!;
    const target = `manifests/${ns}/${m.offer}/${m.party}/${item}-dispatch-${obverse.sha256}.png`;
    m.evidence.push({ specimen: item, label: "dispatch", object_key: target, sha256: obverse.sha256 });
    s.photos.push({ ...obverse, id: randomUUID(), label: "dispatch", object_key: target });
    content.copies.push({ source: obverse.object_key, target });
  }
  content.objects.push({
    key: `manifests/${ns}/${m.offer}/${m.party}/manifest.json`,
    bytes: Buffer.from(JSON.stringify({ offer: m.offer, party: m.party, order: m.order, evidence: m.evidence })),
    type: "application/json",
  });
}

function buildContent(ns: string, workflow: WorkflowKey | "default", providers: Providers, clock: Date): DeskContent {
  const content: DeskContent = { specimens: new Map(), cells: new Map(), offers: [], manifests: [], receipts: [], objects: [], copies: [] };
  FIXTURES.forEach((spec, index) => {
    content.specimens.set(spec.key, {
      key: spec.key,
      creation: index + 1,
      display_label: `Specimen ${spec.key}`,
      owner: spec.owner,
      transferred: false,
      holder: spec.holder,
      attribution: attributionFor(spec, providers),
      quarantined: spec.quarantined ?? false,
      missing: false,
      version: 1,
      photos: [],
      annotations: [],
    });
    addPhoto(content, ns, spec.key, "obverse", facePicture(spec, "obverse"));
    addPhoto(content, ns, spec.key, "reverse", facePicture(spec, "reverse"));
  });
  for (const cell of CELLS) content.cells.set(cell, cell === "A2" ? "B" : null);
  content.offers.push(offer("offer-0", { status: "accepted", dealer_items: ["O"], acceptances: acceptedBoth(1) }));
  content.manifests.push(manifest("offer-0", "dealer", ["O"]), manifest("offer-0", "counterpart", []));
  const window = (seconds: number) => new Date(clock.getTime() + seconds * 1000).toISOString();
  const a = content.specimens.get("A")!;
  const fixtureA = FIXTURES[0]!;
  const fixtureX = FIXTURES[5]!;
  const shipped = (status: OfferRecord["status"]) => {
    content.offers.push(offer("offer-1", { status, version: 2, dealer_items: ["A"], counterpart_items: ["X"], acceptances: acceptedBoth(1) }));
    const dealer = manifest("offer-1", "dealer", ["A"]);
    const counterpart = manifest("offer-1", "counterpart", ["X"]);
    content.manifests.push(dealer, counterpart);
    freezeSeeded(content, ns, dealer);
    freezeSeeded(content, ns, counterpart);
  };
  switch (workflow) {
    case "default":
      content.offers.push(offer("offer-1", { status: "sent", dealer_items: ["C"], counterpart_items: ["X"], expires_at: window(config.limits.FLAN_OFFER_WINDOW_S) }));
      break;
    case "attribution":
    case "catalog_reconciliation":
      a.attribution = { ...a.attribution, revision: null, register: "pending" };
      break;
    case "condition_comparison":
      addPhoto(content, ns, "A", "arrival", facePicture(fixtureA, "arrival", { mark: "scratch", lightShift: 0.08 }), "offer-past");
      break;
    case "offer_assembly":
      content.offers.push(offer("offer-1"), offer("offer-2"));
      break;
    case "counteroffers":
      content.offers.push(offer("offer-1", { status: "accepted", dealer_items: ["A"], counterpart_items: ["X"], acceptances: acceptedBoth(1) }));
      content.manifests.push(manifest("offer-1", "dealer", ["A"]), manifest("offer-1", "counterpart", ["X"]));
      break;
    case "dispatch":
      content.offers.push(offer("offer-1", { status: "accepted", dealer_items: ["A", "B", "C"], counterpart_items: ["X"], acceptances: acceptedBoth(1) }));
      content.manifests.push(manifest("offer-1", "dealer", ["A", "B", "C"]), manifest("offer-1", "counterpart", ["X"]));
      break;
    case "receipt":
      shipped("dispatched");
      addPhoto(content, ns, "A", "arrival", facePicture(fixtureA, "arrival", { lightShift: 0.08 }), "offer-1");
      addPhoto(content, ns, "X", "arrival", facePicture(fixtureX, "arrival", { lightShift: 0.08 }), "offer-1");
      break;
    case "disputes":
      shipped("received");
      addPhoto(content, ns, "A", "arrival", facePicture(fixtureA, "arrival", { mark: "gouge", lightShift: 0.08 }), "offer-1");
      addPhoto(content, ns, "X", "arrival", facePicture(fixtureX, "arrival", { lightShift: 0.08 }), "offer-1");
      content.receipts.push({ offer: "offer-1", party: "dealer", matches: true });
      break;
    case "stock_audit":
      content.cells.set("A1", "A");
      content.cells.set("B1", "U");
      break;
    case "cross-cutting":
      content.offers.push(offer("offer-1", { status: "sent", dealer_items: ["A"], counterpart_items: ["X"], expires_at: window(config.limits.FLAN_OFFER_WINDOW_S) }));
      break;
    default:
      break;
  }
  return content;
}

async function writeContent(
  client: pg.PoolClient,
  ns: string,
  grading: boolean,
  clock: Date | null,
  content: DeskContent,
  providers: Providers,
): Promise<void> {
  await client.query("DELETE FROM desks WHERE ns = $1", [ns]);
  await client.query("DELETE FROM app_sessions WHERE ns = $1", [ns]);
  const album = providers.album ? albumFrom(providers.album, {}) : null;
  await client.query(
    `INSERT INTO desks (ns, grading, clock_at, keeper_order, album, next_creation) VALUES ($1,$2,$3,$4,$5,$6)`,
    [ns, grading, clock, JSON.stringify(["A", "B", "C"]), album, content.specimens.size + 1],
  );
  for (const s of content.specimens.values()) {
    await client.query("INSERT INTO specimens (ns, key, creation, data) VALUES ($1,$2,$3,$4)", [ns, s.key, s.creation, s]);
  }
  for (const [cell, specimen] of content.cells) {
    await client.query("INSERT INTO tray_cells (ns, cell, specimen) VALUES ($1,$2,$3)", [ns, cell, specimen]);
  }
  for (const record of providers.register.values()) {
    await client.query(
      `INSERT INTO register_records (ns, reference, revision, issue, mintmark, image_path, image_object_key) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ns, record.reference, record.revision, record.issue, record.mintmark, record.image_path, registerImageKey(ns, record)],
    );
  }
  for (const o of content.offers) await client.query("INSERT INTO offers (ns, key, data) VALUES ($1,$2,$3)", [ns, o.key, o]);
  for (const m of content.manifests) {
    await client.query("INSERT INTO manifests (ns, offer, party, data) VALUES ($1,$2,$3,$4)", [ns, m.offer, m.party, m]);
  }
  for (const r of content.receipts) {
    await client.query("INSERT INTO receipts (ns, offer, party, matches) VALUES ($1,$2,$3,$4)", [ns, r.offer, r.party, r.matches]);
  }
}

async function storeObjects(content: DeskContent, providers: Providers): Promise<void> {
  if (!providers.minio) {
    for (const s of content.specimens.values()) s.photos = [];
    return;
  }
  await Promise.all(content.objects.map((o) => putObject(o.key, o.bytes, o.type)));
  await Promise.all(content.copies.map((c) => copyObject(c.source, c.target)));
}

async function storeIdentities(ns: string): Promise<void> {
  await configureRealm();
  for (const role of ["dealer", "counterpart", "outsider"] as const) {
    const secret = await provisionIdentity(ns, role);
    await query(
      `INSERT INTO identities (ns, role, username, totp_secret) VALUES ($1,$2,$3,$4)
       ON CONFLICT (ns, role) DO UPDATE SET totp_secret = EXCLUDED.totp_secret`,
      [ns, role, username(ns, role), secret],
    );
  }
}

// --- the default desk ---------------------------------------------------------------------------

let defaultReady: Promise<void> | null = null;

/** Creates `hollowmint` once, only when every provider can take its part; retried until it can. */
export function ensureDefaultDesk(): Promise<void> {
  defaultReady ??= exclusively("flan-default-desk", async () => {
    const existing = await query("SELECT 1 FROM desks WHERE ns = $1", [DEFAULT_NAMESPACE]);
    if (existing.length > 0) return;
    const providers = await probe(DEFAULT_NAMESPACE);
    if (!providers.minio || !providers.keycloak || providers.register.size < 3 || !providers.album) throw serviceUnavailable();
    await storeIdentities(DEFAULT_NAMESPACE);
    const content = buildContent(DEFAULT_NAMESPACE, "default", providers, new Date());
    await storeObjects(content, providers);
    await transaction((client) => writeContent(client, DEFAULT_NAMESPACE, false, null, content, providers));
  }).catch((error: unknown) => {
    defaultReady = null;
    throw error;
  });
  return defaultReady;
}

// --- grading seed -------------------------------------------------------------------------------

type StorageState = { cookies: BrowserCookie[]; origins: { origin: string; localStorage: { name: string; value: string }[] }[] };

function appCookie(value: string): BrowserCookie {
  return {
    name: SESSION_COOKIE,
    value,
    domain: new URL(config.publicUrl).hostname,
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  };
}

/** One genuine sign-in: Keycloak's login form, then the app's own code exchange and session. */
async function signIn(ns: string, role: Role, keycloak: boolean): Promise<BrowserCookie[]> {
  if (!keycloak) {
    const id = await createSession({ ns, subject: `${ns}:${role}`, username: username(ns, role), role, keycloak_session: null });
    return [appCookie(id)];
  }
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString("base64url");
  const signed = await passwordSignIn(username(ns, role), password(ns, role), state, challenge);
  const tokens = await exchangeCode(signed.code, verifier);
  const id = await createSession({ ns, subject: tokens.subject, username: tokens.username, role, keycloak_session: tokens.keycloakSession });
  return [...signed.cookies, appCookie(id)];
}

function drafts(ns: string, workflow: WorkflowKey, variant: Variant, role: "dealer" | "dealer_peer" | "counterpart" | "outsider") {
  const items: { name: string; value: string }[] = [];
  const dealerSide = role === "dealer" || role === "dealer_peer";
  if (workflow === "intake" && variant === "conflict" && role === "dealer_peer") {
    items.push({ name: draftKey(ns, "intake", "form"), value: JSON.stringify({ reference: `${ns}-I` }) });
  }
  if (workflow === "catalog_reconciliation" && dealerSide) {
    items.push({ name: draftKey(ns, "reconciliation", "A"), value: JSON.stringify({ correction: "ALD-A" }) });
  }
  if ((workflow === "condition_comparison" || workflow === "cross-cutting") && dealerSide) {
    items.push({ name: draftKey(ns, "condition", "A"), value: JSON.stringify({ note: "Check the field left of the mintmark.", x: 560, y: 470 }) });
  }
  return items;
}

function entry(ns: string, workflow: WorkflowKey, role: Role): string {
  const home = `${config.publicUrl}/desk/${ns}`;
  if (role === "outsider") return home;
  if (workflow === "cross-cutting") return role === "dealer" ? `${home}/condition?specimen=A` : `${home}/counteroffers?offer=offer-1`;
  const slug = WORKSPACES[workflow];
  const exchange = ["offers", "counteroffers", "dispatch", "receipt", "disputes"].includes(slug);
  if (role === "counterpart" && !exchange) return home;
  return `${home}/${slug}${exchange ? "?offer=offer-1" : "?specimen=A"}`;
}

interface SeedRequest {
  ns: string;
  workflow: WorkflowKey;
  variant: Variant;
}

export async function seedNamespace({ ns, workflow, variant }: SeedRequest) {
  await query("SELECT 1");
  const providers = await probe(ns);
  const clock = new Date(config.gradeClockIso);
  if (providers.keycloak) await storeIdentities(ns);
  const content = buildContent(ns, workflow, providers, clock);
  await storeObjects(content, providers);
  await transaction((client) => writeContent(client, ns, true, clock, content, providers));
  const roles = ["dealer", "dealer_peer", "counterpart", "outsider"] as const;
  const origin = new URL(config.publicUrl).origin;
  const sessions = Object.fromEntries(
    await Promise.all(
      roles.map(async (seat) => {
        const role: Role = seat === "dealer_peer" ? "dealer" : seat;
        const state: StorageState = {
          cookies: await signIn(ns, role, providers.keycloak),
          origins: [{ origin, localStorage: drafts(ns, workflow, variant, seat) }],
        };
        return [seat, state] as const;
      }),
    ),
  );
  const media = stagedMedia();
  return {
    namespace: ns,
    entries: {
      dealer: entry(ns, workflow, "dealer"),
      dealer_peer: entry(ns, workflow, "dealer"),
      counterpart: entry(ns, workflow, "counterpart"),
      outsider: entry(ns, workflow, "outsider"),
    },
    sessions,
    state_url: `${config.publicUrl}/api/desks/${ns}/state`,
    media: {
      obverse: `data:image/png;base64,${media.obverse.toString("base64")}`,
      reverse: `data:image/png;base64,${media.reverse.toString("base64")}`,
    },
    clock: clock.toISOString(),
  };
}
