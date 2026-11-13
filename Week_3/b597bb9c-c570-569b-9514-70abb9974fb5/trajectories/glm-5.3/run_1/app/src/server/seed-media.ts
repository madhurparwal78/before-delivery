import type { Db } from './db';
import { Storage } from './storage';
import { hashPassword, newHex, sha256Hex } from './util';
import { judgeMedia } from './media-judge';

/** The seeded MP4/WAV/PNG stand-ins written to MinIO at seeding. */
export function mp4StandIn(width: number, height: number, timescale: number, duration: number, tag = 0): Uint8Array {
  const ftyp = box('ftyp', [
    0x69, 0x73, 0x6f, 0x6d, // major brand 'isom'
    0x00, 0x00, 0x02, 0x00, // minor version
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31, // compatible brands
    (tag >>> 24) & 0xff, (tag >>> 16) & 0xff, (tag >>> 8) & 0xff, tag & 0xff,
  ]);
  const mvhd = mvhdBox(timescale, duration);
  const trak = box('trak', tkhdBox(width, height));
  const moov = box('moov', [...mvhd, ...trak]);
  const out = new Uint8Array(ftyp.length + moov.length);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  return out;
}

function box(type: string, body: number[] | Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body instanceof Uint8Array ? body : new Uint8Array(body), 8);
  return out;
}

function fullBox(type: string, version: number, body: number[]): Uint8Array {
  return box(type, [version, 0, 0, 0, ...body]);
}

function mvhdBox(timescale: number, duration: number): Uint8Array {
  return fullBox('mvhd', 0, [
    0, 0, 0, 0, 0, 0, 0, 0, // creation, modification
    (timescale >>> 24) & 0xff, (timescale >>> 16) & 0xff, (timescale >>> 8) & 0xff, timescale & 0xff,
    (duration >>> 24) & 0xff, (duration >>> 16) & 0xff, (duration >>> 8) & 0xff, duration & 0xff,
    0, 0, 0, 0x01, // rate
    0x01, 0, 0, 0, // volume
    0, 0, 0, 0, 0, 0, 0, 0, // reserved
    0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // matrix
    0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0x40, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, // predefined
    0, 0, 0, 0,
    0x00, 0x02, // next track id
  ]);
}

function tkhdBox(width: number, height: number): Uint8Array {
  // version(1)+flags(3) ctime(4) mtime(4) track_id(4) reserved(4) duration(4)
  // reserved(8) layer(2) alt_group(2) volume(2) reserved(2) matrix(36) width(4) height(4)
  const body: number[] = [
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 1,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0,
    0, 0,
    0x01, 0x00,
    0, 0,
  ];
  const matrix: number[] = [];
  const unity = [
    [0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0x00, 0x01, 0x00, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0],
  ];
  for (const row of unity) matrix.push(...row);
  body.push(...matrix);
  const fixed16 = (value: number): number[] => {
    const v = Math.round(value * 0x10000);
    return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  };
  body.push(...fixed16(width), ...fixed16(height));
  return fullBox('tkhd', 0, body);
}

export function wavStandIn(samples: number): Uint8Array {
  const dataBytes = samples * 2;
  const fmt = chunk('fmt ', [
    1, 0, // PCM
    1, 0, // mono
    0x40, 0x1f, 0, 0, // 8000 Hz
    0x80, 0x3e, 0, 0, // byte rate
    2, 0, // block align
    16, 0, // bits
  ]);
  const data = chunk('data', sineSamples(samples));
  const out = new Uint8Array(12 + fmt.length + data.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set(fmt, 12);
  out.set(data, 12 + fmt.length);
  return out;
}

function chunk(id: string, body: Uint8Array | number[]): Uint8Array {
  const bodyBytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const out = new Uint8Array(8 + bodyBytes.length);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  view.setUint32(4, bodyBytes.length, true);
  out.set(bodyBytes, 8);
  return out;
}

/** 16-bit mono PCM at 8 kHz holding a 110 Hz sine rising 0 to half scale. */
function sineSamples(count: number): Uint8Array {
  const out = new Uint8Array(count * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < count; i++) {
    const amplitude = (i / count) * 16384;
    const value = Math.round(Math.sin((2 * Math.PI * 110 * i) / 8000) * amplitude);
    view.setInt16(i * 2, value, true);
  }
  return out;
}

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: number[]): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(new Uint8Array(data), 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A solid 1200×400 image. */
export function pngStandIn(width: number, height: number): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', [
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    8, 2, 0, 0, 0,
  ]);
  const out = new Uint8Array(sig.length + ihdr.length);
  out.set(sig, 0);
  out.set(ihdr, sig.length);
  return out;
}

export interface SeedMediaSpec {
  id: string;
  name: string;
  folder: string;
  kind: 'mp4' | 'wav' | 'png';
  bytes: Uint8Array;
}

export function seedMediaSpecs(): SeedMediaSpec[] {
  return [
    media('hl-a001-c003', 'HL_A001_C003.mp4', 'Harbour Light / Rushes', 'mp4', mp4StandIn(1920, 1080, 24000, 480480)),
    media('hl-a002-c011', 'HL_A002_C011.mp4', 'Harbour Light / Rushes', 'mp4', mp4StandIn(1920, 1080, 24000, 288288)),
    media('hl-a004-c002', 'HL_A004_C002.mp4', 'Harbour Light / Rushes', 'mp4', mp4StandIn(1920, 1080, 24000, 600600)),
    media('harbour-bed', 'harbour_bed.wav', 'Harbour Light / Audio', 'wav', wavStandIn(240240)),
    media('cl-hero-01', 'CL_HERO_01.mp4', 'Copperline / Rushes', 'mp4', mp4StandIn(1920, 1080, 25000, 1600000)),
    media('cl-hero-02', 'CL_HERO_02.mp4', 'Copperline / Rushes', 'mp4', mp4StandIn(1920, 1080, 25000, 1500000)),
    media('sm-reel-01', 'SM_REEL_01.mp4', 'Saltmarsh / Rushes', 'mp4', mp4StandIn(1080, 1920, 25000, 375000)),
    media('ng-run-01', 'NG_RUN_01.mp4', 'Northgate / Rushes', 'mp4', mp4StandIn(1080, 1080, 30000, 600600)),
    media('fb-expl-01', 'FB_EXPL_01.mp4', 'Ferrow Bank / Rushes', 'mp4', mp4StandIn(1920, 1080, 24, 1080)),
    media('bh-recap-01', 'BH_RECAP_01.mp4', 'Blue Hour / Rushes', 'mp4', mp4StandIn(1920, 1080, 25000, 1500000, 1)),
    media('qs-014', 'QS_014.mp4', 'Quayside / Rushes', 'mp4', mp4StandIn(1920, 1080, 25000, 600000)),
    media('qs-022', 'QS_022.mp4', 'Quayside / Rushes', 'mp4', mp4StandIn(1920, 1080, 25000, 300000)),
    media('ol-int-01', 'OL_INT_01.mp4', 'Orchard Lane / Rushes', 'mp4', mp4StandIn(1080, 1350, 24000, 1801800)),
    media('kv-logo', 'kv_logo.png', 'Kestrel & Vane / Brand', 'png', pngStandIn(1200, 400)),
  ];
}

function media(id: string, name: string, folder: string, kind: 'mp4' | 'wav' | 'png', bytes: Uint8Array): SeedMediaSpec {
  return { id, name, folder, kind, bytes };
}

/** Store the seed media objects and create their library rows. */
export async function seedMedia(db: Db, storage: Storage, workspaceId: string): Promise<void> {
  for (const spec of seedMediaSpecs()) {
    const sha = sha256Hex(spec.bytes);
    await storage.put(`media/${sha}`, spec.bytes);
    let width: number | null = null;
    let height: number | null = null;
    let timescale: number | null = null;
    let duration: number | null = null;
    let sampleRate: number | null = null;
    let sampleFrames: number | null = null;
    let channels: number | null = null;
    let bits: number | null = null;
    const existing = await db.query('SELECT id FROM media WHERE sha256 = $1', [sha]);
  if ((existing.rowCount ?? 0) > 0) continue;
  if (spec.kind === 'mp4') {
      const parsed = judgeMedia(spec.bytes, 'seed');
      if (!parsed.ok) throw new Error('seed MP4 stand-in failed its own header judge');
      const info = parsed.media.mp4!;
      width = info.width;
      height = info.height;
      timescale = info.timescale;
      duration = info.duration;
    } else if (spec.kind === 'wav') {
      const parsed = judgeMedia(spec.bytes, 'seed');
      if (!parsed.ok) throw new Error('seed WAV stand-in failed its own header judge');
      const info = parsed.media.wav!;
      sampleRate = info.sampleRate;
      sampleFrames = info.sampleFrames;
      channels = info.channels;
      bits = info.bits;
    } else {
      width = 1200;
      height = 400;
    }
    await db.query(
      `INSERT INTO media (id, workspace_id, name, kind, folder, bytes, sha256, width, height, duration_timescale, duration, sample_rate, sample_frames, channels, bits)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [spec.id, workspaceId, spec.name, spec.kind, spec.folder, spec.bytes.length, sha,
        width, height, timescale, duration, sampleRate, sampleFrames, channels, bits],
    );
  }
}

export const people = [
  { id: 'noor', name: 'Noor Achterberg', email: 'noor@gatecut.example', handle: 'noor', password: 'reel-owner-4417' },
  { id: 'idris', name: 'Idris Fallowfield', email: 'idris@kestrelvane.example', handle: 'idris', password: 'reel-editor-2290' },
  { id: 'pia', name: 'Pia Marchetti', email: 'pia@kestrelvane.example', handle: 'pia', password: 'reel-editor-5531' },
  { id: 'maren', name: 'Maren Okafor', email: 'maren@kestrelvane.example', handle: 'maren', password: 'reel-producer-8812' },
  { id: 'theo', name: 'Theo Brandt', email: 'theo@lowtide.example', handle: 'theo', password: 'reel-editor-6604' },
];

export async function seedWorkspace(db: Db): Promise<{ workspaceId: string; ownerId: string } | null> {
  const existing = await db.query<{ id: number; workspace_id: string; owner_person_id: string }>('SELECT id, workspace_id, owner_person_id FROM workspace LIMIT 1');
  if ((existing.rowCount ?? 0) > 0) {
    return { workspaceId: existing.rows[0]!.workspace_id, ownerId: existing.rows[0]!.owner_person_id };
  }
  const workspaceId = `ws-${newHex(8)}`;
  for (const p of people) {
    await db.query(
      `INSERT INTO people (id, name, email, handle, password_hash) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.name, p.email, p.handle, hashPassword(p.password)],
    );
  }
  await db.query(
    `INSERT INTO workspace (workspace_id, owner_person_id, availability, carried_storage_bytes, opening_minutes, opening_month)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [workspaceId, 'noor', 'Booked through 14 November; taking new cuts from 17 November.',
      41200000000, 212, `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`],
  );
  return { workspaceId, ownerId: 'noor' };
}
