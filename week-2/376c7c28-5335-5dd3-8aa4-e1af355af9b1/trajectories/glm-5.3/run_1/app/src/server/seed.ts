import { deflateSync } from "node:zlib";
import { newId } from "./config";
import { pool, q, one, tx } from "./db";
import { hashPassword } from "./auth";
import { roundDims, cubicEighths } from "./quote";
import { putObject } from "./services/s3";
import type { PieceRow } from "./types";

// Seed data: created when the database is empty, idempotent across simultaneous
// instances through the same advisory lock as the schema.

const SEED_PASSWORD = "kilnroom-2026";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// A small PNG the app draws itself, at least 64 by 64 pixels.
export function drawSeedPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const rawRows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const shade = ((x / 8) | 0) % 2 === ((y / 8) | 0) % 2 ? 1.0 : 0.72;
      row[1 + x * 3] = Math.min(255, Math.round(r * shade));
      row[2 + x * 3] = Math.min(255, Math.round(g * shade));
      row[3 + x * 3] = Math.min(255, Math.round(b * shade));
    }
    rawRows.push(row);
  }
  const raw = Buffer.concat(rawRows);
  const idat = deflateSync(raw);
  const out: Buffer[] = [];
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  out.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  out.push(chunk("IHDR", ihdr));
  out.push(chunk("IDAT", idat));
  out.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(out);
}

type SeedStudio = {
  name: string;
  slug: string;
  tz: string;
  window: number;
  rates: [number, number, number, number];
  kilns: { name: string; area: number }[];
  clay: string[];
  people: { name: string; email: string; handle: string; role: string; membership: string | null; card: string; balance: number }[];
  pieces: { title: string; owner: string; clay: string; dims: [number, number, number]; status: string; deadline: string | null; checkedInAt: string }[];
};

const SEED: SeedStudio[] = [
  {
    name: "Ember Lane Clay",
    slug: "ember-lane",
    tz: "Pacific/Auckland",
    window: 14,
    rates: [3, 6, 5, 7],
    kilns: [
      { name: "North Kiln", area: 380 },
      { name: "South Kiln", area: 264 },
    ],
    clay: ["Buff Stoneware", "Speckled Stoneware", "Porcelain"],
    people: [
      { name: "Rowan Vale", email: "rowan@ember-lane.example", handle: "rowan", role: "owner", membership: null, card: "none", balance: 0 },
      { name: "Ines Calder", email: "ines@ember-lane.example", handle: "ines", role: "kiln_tech", membership: null, card: "none", balance: 0 },
      { name: "Theo Marsh", email: "theo@ember-lane.example", handle: "theo", role: "kiln_tech", membership: null, card: "none", balance: 0 },
      { name: "Priya Nandakumar", email: "priya@ember-lane.example", handle: "priya", role: "member", membership: "member", card: "on_file", balance: 2000 },
      { name: "Jonah Reyes", email: "jonah@ember-lane.example", handle: "jonah", role: "member", membership: "member", card: "none", balance: 0 },
      { name: "Wen Liu", email: "wen@ember-lane.example", handle: "wen", role: "member", membership: "drop_off", card: "on_file", balance: 0 },
    ],
    pieces: [
      { title: "Tall Vase", owner: "priya", clay: "Buff Stoneware", dims: [5.2, 5.0, 11.3], status: "waiting_bisque", deadline: null, checkedInAt: "2026-10-01" },
      { title: "Breakfast Bowl", owner: "priya", clay: "Speckled Stoneware", dims: [6.1, 6.1, 3.2], status: "waiting_bisque", deadline: null, checkedInAt: "2026-10-01" },
      { title: "Mug", owner: "jonah", clay: "Porcelain", dims: [3.6, 4.4, 4.0], status: "waiting_bisque", deadline: null, checkedInAt: "2026-10-01" },
      { title: "Serving Platter", owner: "wen", clay: "Buff Stoneware", dims: [14.0, 10.2, 1.4], status: "waiting_bisque", deadline: null, checkedInAt: "2026-10-01" },
    ],
  },
  {
    name: "Saltmarsh Pottery Co-op",
    slug: "saltmarsh",
    tz: "Pacific/Honolulu",
    window: 14,
    rates: [2, 4, 4, 6],
    kilns: [{ name: "Tide Kiln", area: 380 }],
    clay: ["Dark Stoneware"],
    people: [
      { name: "Dana Whitfield", email: "dana@saltmarsh.example", handle: "dana", role: "owner", membership: null, card: "none", balance: 0 },
      { name: "Kofi Mensah", email: "kofi@saltmarsh.example", handle: "kofi", role: "kiln_tech", membership: null, card: "none", balance: 0 },
      { name: "Ana Ruiz", email: "ana@saltmarsh.example", handle: "ana", role: "member", membership: "member", card: "on_file", balance: 1000 },
    ],
    pieces: [
      { title: "Salt Jar", owner: "ana", clay: "Dark Stoneware", dims: [4.0, 4.0, 6.0], status: "waiting_bisque", deadline: null, checkedInAt: "2026-10-01" },
    ],
  },
  {
    name: "Andes Kiln Works",
    slug: "andes",
    tz: "America/Santiago",
    window: 14,
    rates: [3, 5, 4, 6],
    kilns: [{ name: "Cordillera Kiln", area: 380 }],
    clay: ["Red Earthenware"],
    people: [
      { name: "Valentina Rojas", email: "valentina@andes.example", handle: "valentina", role: "owner", membership: null, card: "none", balance: 0 },
      { name: "Matías Fuentes", email: "matias@andes.example", handle: "matias", role: "kiln_tech", membership: null, card: "none", balance: 0 },
      { name: "Camila Soto", email: "camila@andes.example", handle: "camila", role: "member", membership: "member", card: "on_file", balance: 1500 },
      { name: "Diego Herrera", email: "diego@andes.example", handle: "diego", role: "member", membership: "member", card: "none", balance: 0 },
    ],
    pieces: [
      { title: "Andes Cup", owner: "camila", clay: "Red Earthenware", dims: [3.5, 3.5, 4.2], status: "waiting_bisque", deadline: null, checkedInAt: "2026-10-01" },
      { title: "Terrace Planter", owner: "diego", clay: "Red Earthenware", dims: [8.0, 8.0, 6.3], status: "ready_for_pickup", deadline: "2026-11-13", checkedInAt: "2026-10-01" },
    ],
  },
];

export async function seedIfEmpty(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(918273645)");
    const existing = await one<{ n: string }>(client, "SELECT COUNT(*) AS n FROM studios");
    if (Number(existing?.n ?? 0) > 0) return;
    for (const studio of SEED) {
      const studioId = newId();
      await client.query(
        "INSERT INTO studios (id, name, slug, time_zone, pickup_window_days, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [studioId, studio.name, studio.slug, studio.tz, studio.window, new Date()],
      );
      await client.query("INSERT INTO storage_fee_history (studio_id, effective_from, cents) VALUES ($1,'2026-01-01',50)", [studioId]);
      await client.query(
        "INSERT INTO rate_schedules (id, studio_id, effective_from, member_bisque_cents, member_glaze_cents, dropoff_bisque_cents, dropoff_glaze_cents, created_at) VALUES ($1,$2,'2026-01-01',$3,$4,$5,$6,$7)",
        [newId(), studioId, studio.rates[0], studio.rates[1], studio.rates[2], studio.rates[3], new Date()],
      );
      const clayIds = new Map<string, string>();
      for (const name of studio.clay) {
        const id = newId();
        clayIds.set(name, id);
        await client.query("INSERT INTO clay_bodies (id, studio_id, name) VALUES ($1,$2,$3)", [id, studioId, name]);
      }
      const kilnIds = new Map<string, string>();
      for (const kiln of studio.kilns) {
        const id = newId();
        kilnIds.set(kiln.name, id);
        await client.query("INSERT INTO kilns (id, studio_id, name, stack_height_in, shelf_area_sq_in) VALUES ($1,$2,$3,27,$4)", [id, studioId, kiln.name, kiln.area]);
      }
      const personIds = new Map<string, string>();
      for (const person of studio.people) {
        const id = newId();
        personIds.set(person.handle, id);
        await client.query(
          `INSERT INTO people (id, studio_id, email, name, handle, role, membership, card_status, password_hash, active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
          [id, studioId, person.email, person.name, person.handle, person.role, person.membership, person.card, hashPassword(SEED_PASSWORD), new Date()],
        );
        if (person.balance > 0) {
          // Each opening balance is one `opening` movement: member_credit +amount and
          // adjustments -amount.
          const movementId = newId();
          await client.query(
            "INSERT INTO movements (id, studio_id, member_id, kind, amount_cents, charge_id, purchase_id, created_at) VALUES ($1,$2,$3,'opening',$4,NULL,NULL,$5)",
            [movementId, studioId, id, person.balance, new Date()],
          );
          await client.query("INSERT INTO ledger_entries (id, movement_id, account, amount_cents, created_at) VALUES ($1,$2,'member_credit',$3,$4)", [newId(), movementId, person.balance, new Date()]);
          await client.query("INSERT INTO ledger_entries (id, movement_id, account, amount_cents, created_at) VALUES ($1,$2,'adjustments',$3,$4)", [newId(), movementId, -person.balance, new Date()]);
        }
      }
      for (const pack of [["Credit 20", 2000], ["Credit 50", 5000], ["Credit 100", 10000]] as [string, number][]) {
        await client.query("INSERT INTO credit_packs (id, studio_id, name, amount_cents) VALUES ($1,$2,$3,$4)", [newId(), studioId, pack[0], pack[1]]);
      }
      for (const piece of studio.pieces) {
        const id = newId();
        const ownerId = personIds.get(piece.owner) as string;
        const clayId = clayIds.get(piece.clay) as string;
        const rounded = roundDims(piece.dims[0], piece.dims[1], piece.dims[2]);
        const cubic = cubicEighths(rounded);
        const owner = studio.people.find((p) => p.handle === piece.owner);
        const membership = owner?.membership === "drop_off" ? "drop_off" : "member";
        const [mb, mg, db, dg] = studio.rates;
        const bisqueRate = membership === "member" ? mb : db;
        const glazeRate = membership === "member" ? mg : dg;
        const quotedAt = new Date(`${piece.checkedInAt}T09:00:00Z`);
        await client.query(
          `INSERT INTO pieces (id, studio_id, owner_id, title, clay_body_id, status, length_in, width_in, height_in,
                               rounded_l_half, rounded_w_half, rounded_h_half, cubic_eighths, membership,
                               bisque_rate_cents, glaze_rate_cents, rates_effective_from, quoted_at, waiting_since, pickup_deadline,
                               bisque_outcome, glaze_outcome, photo_key, photo_content_type, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'2026-01-01',$17,$18,$19,$20,$21,$22,'image/png',$23)`,
          [
            id, studioId, ownerId, piece.title, clayId, piece.status,
            piece.dims[0], piece.dims[1], piece.dims[2],
            rounded.lengthHalf, rounded.widthHalf, rounded.heightHalf, cubic, membership,
            bisqueRate, glazeRate, quotedAt,
            piece.status.startsWith("waiting") ? quotedAt : null,
            piece.deadline,
            piece.status === "ready_for_pickup" ? "intact" : null,
            piece.status === "ready_for_pickup" ? "intact" : null,
            `studios/${studioId}/pieces/${id}/seed.png`,
            new Date(`${piece.checkedInAt}T08:00:00Z`),
          ],
        );
        // Seed pieces are quoted and checked in on 2026-10-01 with history to match.
        await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'logged',$3)", [newId(), id, quotedAt]);
        if (piece.status === "waiting_bisque") {
          await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'waiting_bisque',$3)", [newId(), id, quotedAt]);
        } else if (piece.status === "ready_for_pickup") {
          await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'bisqued',$3)", [newId(), id, quotedAt]);
          await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'waiting_glaze',$3)", [newId(), id, quotedAt]);
          await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'glazed',$3)", [newId(), id, quotedAt]);
          await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'ready_for_pickup',$3)", [newId(), id, quotedAt]);
        }
      }
    }
  });
}

// Seeded intake photos: written to the bucket, retried until the storage answers.
export async function ensureSeedPhotos(): Promise<void> {
  const pieces = await q<PieceRow & { studio_slug: string }>(
    pool,
    `SELECT p.*, s.slug AS studio_slug FROM pieces p JOIN studios s ON s.id = p.studio_id WHERE p.photo_key LIKE '%/seed.png'`,
  );
  for (const piece of pieces) {
    if (!piece.photo_key) continue;
    const png = drawSeedPng(96, 96, 168, 116, 88);
    try {
      await putObject(piece.photo_key, png, "image/png");
    } catch {
      // Storage was unreachable; the retry loop will try again.
    }
  }
}
