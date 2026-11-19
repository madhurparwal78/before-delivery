// Seed data: the main world with its ranger, and grading worlds with their invented contents.

import { App } from "./main";
import { newId, makeSafariCode } from "../shared/ids";
import { hashPassword } from "./passwords";
import { writeFilm } from "./players";
import { withTransaction } from "./db";
import { objectKeyFor } from "./storage";

const MAIN_WORLD = "world_main";

export async function seedMainWorld(app: App): Promise<void> {
  const existing = await app.db.query<{ n: string }>("SELECT COUNT(*) AS n FROM worlds WHERE kind = 'main'");
  if (Number(existing.rows[0].n) > 0) return;

  await app.db.query(
    "INSERT INTO worlds (id, kind, tick, frozen, start_ms) VALUES ($1,'main',6000,FALSE,$2)",
    [MAIN_WORLD, Date.now()]);

  const rangerId = newId("player");
  const hash = await hashPassword("Harbour-Ranger-1");
  await withTransaction(app.db, async client => {
    await client.query(
      "INSERT INTO players (id, world_id, name, handle, email, password_hash, confirmed, ranger) VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE)",
      [rangerId, MAIN_WORLD, "Sal Marram", "sal-marram", "ranger@hushfoot.example", hash]);
    await client.query("INSERT INTO positions (player_id) VALUES ($1)", [rangerId]);
    await writeFilm(client, rangerId, 36, "start");
    await client.query("INSERT INTO hall_frames (player_id, public) VALUES ($1, FALSE)", [rangerId]);
    await client.query("INSERT INTO settings (player_id) VALUES ($1)", [rangerId]);
  });
}

export interface GradingWorldResult {
  world: { id: string; tick: number };
  explorer: SeedPlayer;
  friend: SeedPlayer;
  rival: SeedPlayer;
  ranger: SeedPlayer;
  ranger2: SeedPlayer;
  newcomer: SeedPlayer;
  photos: Record<string, string>;
  safari: { code: string };
  notes: Record<string, string>;
}

export interface SeedPlayer { id: string; name: string; handle: string; email: string; password: string }

export async function createGradingWorld(app: App, tick: number): Promise<GradingWorldResult> {
  const worldId = newId("gworld");
  const suffix = Math.random().toString(36).slice(2, 8);
  await app.db.query(
    "INSERT INTO worlds (id, kind, tick, frozen, start_ms) VALUES ($1,'grading',$2,TRUE,$3)",
    [worldId, tick, Date.now()]);

  const names: Record<string, string> = {
    explorer: "Explorer Wick", friend: "Fern Friend", rival: "Rival Gull",
    ranger: "Ranger Marram", ranger2: "Ranger Two", newcomer: "Newcome Plover"
  };

  const players: Record<string, SeedPlayer> = {};
  const roles: Record<string, { confirmed: boolean; ranger: boolean }> = {
    explorer: { confirmed: true, ranger: false },
    friend: { confirmed: true, ranger: false },
    rival: { confirmed: true, ranger: false },
    ranger: { confirmed: true, ranger: true },
    ranger2: { confirmed: true, ranger: true },
    newcomer: { confirmed: false, ranger: false }
  };

  const password = "Harbour-Explorer-1";
  const hashes = await Promise.all(Object.keys(names).map(() => hashPassword(password)));

  let i = 0;
  for (const key of Object.keys(names)) {
    const id = newId("player");
    const email = `${key}-${suffix}@example.test`;
    const handle = `${key}-${suffix}`;
    await withTransaction(app.db, async client => {
      await client.query(
        "INSERT INTO players (id, world_id, name, handle, email, password_hash, confirmed, ranger) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, worldId, names[key], handle, email, hashes[i], roles[key].confirmed, roles[key].ranger]);
      await client.query("INSERT INTO positions (player_id) VALUES ($1)", [id]);
      await client.query("INSERT INTO hall_frames (player_id, public) VALUES ($1, FALSE)", [id]);
      await client.query("INSERT INTO settings (player_id, music, effects, graphics) VALUES ($1, 60, 80, 'full')", [id]);
    });
    players[key] = { id, name: names[key], handle, email, password };
    i++;
  }

  const photos: Record<string, string> = {};
  const photoSpecs: { key: string; owner: string; creature: string; total: number; tick: number }[] = [
    { key: "heron", owner: "explorer", creature: "reedpipe-heron", total: 74, tick: 5200 },
    { key: "moth", owner: "explorer", creature: "gloamfin-moth", total: 81, tick: 5300 },
    { key: "lark", owner: "explorer", creature: "puddle-lark", total: 66, tick: 5400 },
    { key: "friend_heron", owner: "friend", creature: "reedpipe-heron", total: 74, tick: 5100 },
    { key: "rival_lark", owner: "rival", creature: "puddle-lark", total: 66, tick: 5300 },
    { key: "rival_private", owner: "rival", creature: "mossback-newt", total: 55, tick: 5000 }
  ];

  for (const spec of photoSpecs) {
    const id = newId("photo");
    photos[spec.key] = id;
    const png = tinyPng();
    await app.storage.put(objectKeyFor(id, "image/png"), png, "image/png");
    await withTransaction(app.db, async client => {
      await client.query(
        `INSERT INTO photos (id, player_id, creature_id, island, tick, tile_x, tile_y, heading, zoom, focus,
          size, centring, facing, sharpness, total, stored, content_type, bytes)
         VALUES ($1,$2,$3,1,$4,12,10,'N',2,4,30,25,25,20,$5,TRUE,'image/png',$6)`,
        [id, players[spec.owner].id, spec.creature, spec.tick, spec.total, png.length]);
    });
  }

  const notes: Record<string, string> = {};
  const approvedNote = newId("note");
  notes.approved = approvedNote;
  const pendingNote = newId("note");
  notes.pending = pendingNote;
  await app.db.query(
    "INSERT INTO notes (id, world_id, author_id, text, status, decided_by_name) VALUES ($1,$2,$3,$4,'approved','Ranger Marram')",
    [approvedNote, worldId, players.explorer.id, "Fresh water at the harbour tap."]);
  await app.db.query(
    "INSERT INTO notes (id, world_id, author_id, text, status) VALUES ($1,$2,$3,$4,'pending')",
    [pendingNote, worldId, players.friend.id, "Seal pups on the dock at low tide."]);

  const code = makeSafariCode();
  await withTransaction(app.db, async client => {
    await client.query(
      "INSERT INTO safaris (code, world_id, status, host_id) VALUES ($1,$2,'open',$3)",
      [code, worldId, players.explorer.id]);
    await client.query(
      "INSERT INTO sightings (safari_code, world_id, island, x, y, by_name) VALUES ($1,$2,1,12,6,$3)",
      [code, worldId, players.explorer.name]);
    await writeFilm(client, players.explorer.id, 36, "start");
    await writeFilm(client, players.friend.id, 36, "start");
    await writeFilm(client, players.rival.id, 36, "start");
    await writeFilm(client, players.ranger.id, 36, "start");
    await writeFilm(client, players.ranger2.id, 36, "start");
    await writeFilm(client, players.newcomer.id, 36, "start");
  });

  // explorer: film 30 (36 start, -6 photo spend, +2 nothing... use ledger pairs to reach 30)
  await withTransaction(app.db, async client => {
    // Spend to 30: -6 from 36.
    await writeFilm(client, players.explorer.id, -6, "photo");
  });

  // explorer albums: heron, moth, lark filled; fernhollow and driftglass stamps.
  await withTransaction(app.db, async client => {
    await client.query("UPDATE album_pages SET player_id = player_id WHERE FALSE");
    const inserts: [string, number][] = [["reedpipe-heron", 74], ["gloamfin-moth", 81], ["puddle-lark", 66]];
    for (const [creature, total] of inserts) {
      await client.query(
        "INSERT INTO album_pages (player_id, creature_id, photo_id, total, filled, tick) VALUES ($1,$2,$3,$4,TRUE,$5)",
        [players.explorer.id, creature, creature === "reedpipe-heron" ? photos.heron : creature === "gloamfin-moth" ? photos.moth : photos.lark, total, 5200]);
    }
    await client.query("INSERT INTO stamps (player_id, island, earned) VALUES ($1,2,TRUE), ($1,3,TRUE)", [players.explorer.id]);
    await client.query("UPDATE positions SET island = 1, x = 3, y = 12, heading = 'E' WHERE player_id = $1", [players.explorer.id]);
    // Public hall with frames 1-3.
    await client.query("UPDATE hall_frames SET public = TRUE WHERE player_id = $1", [players.explorer.id]);
    await client.query("INSERT INTO hall_photos (player_id, frame, photo_id, caption) VALUES ($1,1,$2,''), ($1,2,$3,''), ($1,3,$4,'')",
      [players.explorer.id, photos.heron, photos.moth, photos.lark]);
  });

  // rival: board entry + private hall.
  await withTransaction(app.db, async client => {
    await client.query("INSERT INTO board_entries (world_id, island, player_id, photo_id) VALUES ($1,1,$2,$3)",
      [worldId, players.rival.id, photos.rival_lark]);
    await client.query("INSERT INTO hall_photos (player_id, frame, photo_id, caption) VALUES ($1,1,$2,'')",
      [players.rival.id, photos.rival_private]);
  });

  return {
    world: { id: worldId, tick },
    explorer: players.explorer,
    friend: players.friend,
    rival: players.rival,
    ranger: players.ranger,
    ranger2: players.ranger2,
    newcomer: players.newcomer,
    photos,
    safari: { code },
    notes
  };
}

/** A small valid PNG, generated by the app's own code. */
export function tinyPng(): Buffer {
  const width = 8;
  const height = 8;
  const rawData = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const base = y * (width * 3 + 1) + 1 + x * 3;
      rawData[base] = (x * 31 + y * 17) % 256;
      rawData[base + 1] = (x * 17 + y * 31) % 256;
      rawData[base + 2] = 128;
    }
  }
  const raw = deflateSync(rawData);
  const out: number[] = [];
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  out.push(...sig);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  pushChunk(out, "IHDR", ihdr);
  pushChunk(out, "IDAT", raw);
  pushChunk(out, "IEND", Buffer.alloc(0));
  return Buffer.from(out);
}

import { deflateSync } from "node:zlib";
function pushChunk(out: number[], type: string, data: Buffer): void {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  out.push(...len);
  const typeBuf = Buffer.from(type, "ascii");
  out.push(...typeBuf);
  out.push(...data);
  const crcInput = Buffer.concat([typeBuf, data]);
  out.push(...crc32(crcInput));
}

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number[] {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = Buffer.alloc(4);
  out.writeUInt32BE(crc, 0);
  return [...out];
}
