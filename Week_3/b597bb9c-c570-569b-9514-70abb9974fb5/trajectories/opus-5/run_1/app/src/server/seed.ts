/**
 * Seeding. Only an empty database is seeded; every person, agency and project is invented.
 */
import { randomBytes } from 'node:crypto';
import { pool, query } from './db.js';
import { hashPassword, sha256Hex } from './ids.js';
import { standInMp4, standInPng, standInWav } from './seed-files.js';
import { putObject, StorageKeys } from './services/storage.js';
import type { PoolClient } from 'pg';
import type { Keyframe, KeyframeMap } from '../shared/types.js';

interface SeedPerson {
  id: string;
  name: string;
  email: string;
  password: string;
  handle: string;
  owner?: boolean;
  availability?: string;
}

const PEOPLE: SeedPerson[] = [
  {
    id: 'noor',
    name: 'Noor Achterberg',
    email: 'noor@gatecut.example',
    password: 'reel-owner-4417',
    handle: 'noor',
    owner: true,
    availability: 'Booked through 14 November; taking new cuts from 17 November.',
  },
  { id: 'idris', name: 'Idris Fallowfield', email: 'idris@kestrelvane.example', password: 'reel-editor-2290', handle: 'idris' },
  { id: 'pia', name: 'Pia Marchetti', email: 'pia@kestrelvane.example', password: 'reel-editor-5531', handle: 'pia' },
  { id: 'maren', name: 'Maren Okafor', email: 'maren@kestrelvane.example', password: 'reel-producer-8812', handle: 'maren' },
  { id: 'theo', name: 'Theo Brandt', email: 'theo@lowtide.example', password: 'reel-editor-6604', handle: 'theo' },
];

interface SeedMedia {
  id: string;
  name: string;
  folder: string;
  body: (id: string) => Buffer;
}

const MEDIA: SeedMedia[] = [
  { id: 'hl-a001-c003', name: 'HL_A001_C003.mp4', folder: 'Harbour Light / Rushes', body: (id) => standInMp4(1920, 1080, 24000, 480480, id) },
  { id: 'hl-a002-c011', name: 'HL_A002_C011.mp4', folder: 'Harbour Light / Rushes', body: (id) => standInMp4(1920, 1080, 24000, 288288, id) },
  { id: 'hl-a004-c002', name: 'HL_A004_C002.mp4', folder: 'Harbour Light / Rushes', body: (id) => standInMp4(1920, 1080, 24000, 600600, id) },
  { id: 'harbour-bed', name: 'harbour_bed.wav', folder: 'Harbour Light / Audio', body: () => standInWav(240240) },
  { id: 'cl-hero-01', name: 'CL_HERO_01.mp4', folder: 'Copperline / Rushes', body: (id) => standInMp4(1920, 1080, 25000, 1600000, id) },
  { id: 'cl-hero-02', name: 'CL_HERO_02.mp4', folder: 'Copperline / Rushes', body: (id) => standInMp4(1920, 1080, 25000, 1500000, id) },
  { id: 'sm-reel-01', name: 'SM_REEL_01.mp4', folder: 'Saltmarsh / Rushes', body: (id) => standInMp4(1080, 1920, 25000, 375000, id) },
  { id: 'ng-run-01', name: 'NG_RUN_01.mp4', folder: 'Northgate / Rushes', body: (id) => standInMp4(1080, 1080, 30000, 600600, id) },
  { id: 'fb-expl-01', name: 'FB_EXPL_01.mp4', folder: 'Ferrow Bank / Rushes', body: (id) => standInMp4(1920, 1080, 24, 1080, id) },
  { id: 'bh-recap-01', name: 'BH_RECAP_01.mp4', folder: 'Blue Hour / Rushes', body: (id) => standInMp4(1920, 1080, 25000, 1500000, id) },
  { id: 'qs-014', name: 'QS_014.mp4', folder: 'Quayside / Rushes', body: (id) => standInMp4(1920, 1080, 25000, 600000, id) },
  { id: 'qs-022', name: 'QS_022.mp4', folder: 'Quayside / Rushes', body: (id) => standInMp4(1920, 1080, 25000, 300000, id) },
  { id: 'ol-int-01', name: 'OL_INT_01.mp4', folder: 'Orchard Lane / Rushes', body: (id) => standInMp4(1080, 1350, 24000, 1801800, id) },
  { id: 'kv-logo', name: 'kv_logo.png', folder: 'Kestrel & Vane / Brand', body: () => standInPng(1200, 400, [184, 138, 74]) },
];

interface SeedRow {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'caption';
  locked?: boolean;
}

interface SeedClip {
  id: string;
  row_id: string;
  name: string;
  kind: 'mp4' | 'wav' | 'png' | 'text';
  media_id: string | null;
  start_frame?: number;
  end_frame?: number;
  source_in?: number;
  source_out?: number;
  start_seconds?: string;
  source_in_seconds?: string;
  source_out_seconds?: string;
  group_id?: string | null;
  text?: string | null;
  text_colour?: string | null;
  box_colour?: string | null;
  font_weight?: number | null;
  keyframes?: KeyframeMap;
}

interface SeedCaption {
  id: string;
  row_id: string;
  start_frame: number;
  end_frame: number;
  text: string;
}

interface SeedProject {
  id: string;
  title: string;
  agency: string;
  description: string;
  frame_rate: string;
  aspect_ratio: string;
  time_unit?: 'frames' | 'seconds';
  rows: SeedRow[];
  clips: SeedClip[];
  captions?: SeedCaption[];
  markers: { frame?: number; seconds?: string; label: string }[];
  members: { person_id: string; role: 'owner' | 'editor' | 'commenter' }[];
}

const eased = (frame: number, value: number): Keyframe => ({ frame, value, curve: 'eased' });
const linear = (frame: number, value: number): Keyframe => ({ frame, value, curve: 'linear' });

const PROJECTS: SeedProject[] = [
  {
    id: 'harbour-light',
    title: 'Harbour Light 30s',
    agency: 'Kestrel & Vane',
    description: "Thirty seconds for a harbour lamp-maker's anniversary.",
    frame_rate: '23.976',
    aspect_ratio: '16:9',
    rows: [
      { id: 'hl-titles', name: 'Titles', kind: 'video' },
      { id: 'hl-picture', name: 'Picture', kind: 'video' },
      { id: 'hl-music', name: 'Music', kind: 'audio', locked: true },
      { id: 'hl-captions', name: 'Captions', kind: 'caption' },
    ],
    clips: [
      {
        id: 'hl-c1',
        row_id: 'hl-picture',
        name: 'HL_A001_C003',
        kind: 'mp4',
        media_id: 'hl-a001-c003',
        start_frame: 0,
        end_frame: 240,
        source_in: 48,
        source_out: 288,
        group_id: 'hl-g1',
      },
      {
        id: 'hl-c2',
        row_id: 'hl-picture',
        name: 'HL_A002_C011',
        kind: 'mp4',
        media_id: 'hl-a002-c011',
        start_frame: 240,
        end_frame: 480,
        source_in: 0,
        source_out: 240,
        keyframes: { opacity: [eased(0, 0), linear(24, 100)], scale: [linear(0, 100), linear(240, 120)] },
      },
      {
        id: 'hl-c3',
        row_id: 'hl-picture',
        name: 'HL_A004_C002',
        kind: 'mp4',
        media_id: 'hl-a004-c002',
        start_frame: 480,
        end_frame: 719,
        source_in: 120,
        source_out: 359,
      },
      {
        id: 'hl-c4',
        row_id: 'hl-music',
        name: 'harbour_bed',
        kind: 'wav',
        media_id: 'harbour-bed',
        start_frame: 0,
        end_frame: 719,
        source_in: 0,
        source_out: 719,
      },
      {
        id: 'hl-c5',
        row_id: 'hl-titles',
        name: 'Harbour Light',
        kind: 'text',
        media_id: null,
        start_frame: 24,
        end_frame: 120,
        source_in: 0,
        source_out: 96,
        group_id: 'hl-g1',
        text: 'Harbour Light',
        text_colour: 'ffffff',
        box_colour: '000000',
        font_weight: 600,
      },
    ],
    captions: [
      { id: 'hl-cap-1', row_id: 'hl-captions', start_frame: 30, end_frame: 96, text: 'Every boat comes home' },
      { id: 'hl-cap-2', row_id: 'hl-captions', start_frame: 264, end_frame: 360, text: 'to the same light.' },
      { id: 'hl-cap-3', row_id: 'hl-captions', start_frame: 600, end_frame: 700, text: 'Harbour Light. Since 1898.' },
    ],
    markers: [
      { frame: 0, label: 'Open' },
      { frame: 240, label: 'Gull' },
      { frame: 480, label: 'Lamp' },
      { frame: 600, label: 'Tagline' },
    ],
    members: [
      { person_id: 'noor', role: 'owner' },
      { person_id: 'idris', role: 'editor' },
      { person_id: 'pia', role: 'editor' },
      { person_id: 'maren', role: 'commenter' },
    ],
  },
  {
    id: 'copperline',
    title: 'Copperline Launch Teaser',
    agency: 'Kestrel & Vane',
    description: 'Launch teaser for a copper cookware line.',
    frame_rate: '25',
    aspect_ratio: '16:9',
    rows: [{ id: 'cl-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'cl-c1', row_id: 'cl-picture', name: 'CL_HERO_01', kind: 'mp4', media_id: 'cl-hero-01', start_frame: 0, end_frame: 1500, source_in: 0, source_out: 1500 },
      { id: 'cl-c2', row_id: 'cl-picture', name: 'CL_HERO_02', kind: 'mp4', media_id: 'cl-hero-02', start_frame: 1500, end_frame: 2950, source_in: 0, source_out: 1450 },
    ],
    markers: [
      { frame: 0, label: '' },
      { frame: 750, label: '' },
      { frame: 1500, label: '' },
      { frame: 2250, label: '' },
    ],
    members: [
      { person_id: 'noor', role: 'owner' },
      { person_id: 'maren', role: 'commenter' },
    ],
  },
  {
    id: 'saltmarsh',
    title: 'Saltmarsh Coffee Reels',
    agency: 'Lowtide Studio',
    description: 'Three vertical reels for a roastery.',
    frame_rate: '25',
    aspect_ratio: '9:16',
    rows: [{ id: 'sm-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'sm-c1', row_id: 'sm-picture', name: 'SM_REEL_01', kind: 'mp4', media_id: 'sm-reel-01', start_frame: 0, end_frame: 375, source_in: 0, source_out: 375 },
    ],
    markers: [
      { frame: 0, label: '' },
      { frame: 125, label: '' },
      { frame: 250, label: '' },
      { frame: 350, label: '' },
    ],
    members: [{ person_id: 'noor', role: 'owner' }],
  },
  {
    id: 'northgate',
    title: 'Northgate Run Club',
    agency: 'Lowtide Studio',
    description: 'Square spots for a weekly running club.',
    frame_rate: '29.97',
    aspect_ratio: '1:1',
    rows: [{ id: 'ng-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'ng-c1', row_id: 'ng-picture', name: 'NG_RUN_01', kind: 'mp4', media_id: 'ng-run-01', start_frame: 0, end_frame: 600, source_in: 0, source_out: 600 },
    ],
    markers: [
      { frame: 0, label: '' },
      { frame: 150, label: '' },
      { frame: 300, label: '' },
      { frame: 450, label: '' },
    ],
    members: [{ person_id: 'noor', role: 'owner' }],
  },
  {
    id: 'ferrow-bank',
    title: 'Ferrow Bank Explainer',
    agency: 'Kestrel & Vane',
    description: 'Explainer for a small regional bank.',
    frame_rate: '24',
    aspect_ratio: '16:9',
    rows: [{ id: 'fb-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'fb-c1', row_id: 'fb-picture', name: 'FB_EXPL_01', kind: 'mp4', media_id: 'fb-expl-01', start_frame: 0, end_frame: 1080, source_in: 0, source_out: 1080 },
    ],
    markers: [
      { frame: 0, label: '' },
      { frame: 360, label: '' },
      { frame: 720, label: '' },
    ],
    members: [{ person_id: 'noor', role: 'owner' }],
  },
  {
    id: 'blue-hour',
    title: 'Blue Hour Festival Recap',
    agency: 'Lowtide Studio',
    description: 'One-minute recap of a night market.',
    frame_rate: '25',
    aspect_ratio: '16:9',
    rows: [{ id: 'bh-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'bh-c1', row_id: 'bh-picture', name: 'BH_RECAP_01', kind: 'mp4', media_id: 'bh-recap-01', start_frame: 0, end_frame: 1500, source_in: 0, source_out: 1500 },
    ],
    markers: [
      { frame: 0, label: '' },
      { frame: 500, label: '' },
      { frame: 1000, label: '' },
    ],
    members: [{ person_id: 'noor', role: 'owner' }],
  },
  {
    id: 'quayside',
    title: 'Quayside Teaser',
    agency: 'Kestrel & Vane',
    description: 'An older teaser kept for reference.',
    frame_rate: '25',
    aspect_ratio: '16:9',
    time_unit: 'seconds',
    rows: [{ id: 'qs-picture', name: 'Picture', kind: 'video' }],
    clips: [
      {
        id: 'qs-c1',
        row_id: 'qs-picture',
        name: 'QS_014',
        kind: 'mp4',
        media_id: 'qs-014',
        start_seconds: '0',
        source_in_seconds: '0',
        source_out_seconds: '12.34',
      },
      {
        id: 'qs-c2',
        row_id: 'qs-picture',
        name: 'QS_022',
        kind: 'mp4',
        media_id: 'qs-022',
        start_seconds: '12.34',
        source_in_seconds: '2.02',
        source_out_seconds: '9.5',
      },
    ],
    markers: [
      { seconds: '0', label: '' },
      { seconds: '6.1', label: '' },
      { seconds: '12.34', label: '' },
    ],
    members: [{ person_id: 'noor', role: 'owner' }],
  },
  {
    id: 'orchard-lane',
    title: 'Orchard Lane Interview',
    agency: 'Lowtide Studio',
    description: 'Sit-down interview with an orchard keeper.',
    frame_rate: '23.976',
    aspect_ratio: '4:5',
    time_unit: 'seconds',
    rows: [{ id: 'ol-picture', name: 'Picture', kind: 'video' }],
    clips: [
      {
        id: 'ol-c1',
        row_id: 'ol-picture',
        name: 'OL_INT_01',
        kind: 'mp4',
        media_id: 'ol-int-01',
        start_seconds: '0',
        source_in_seconds: '4.2',
        source_out_seconds: '64.2',
      },
    ],
    markers: [
      { seconds: '0', label: '' },
      { seconds: '30', label: '' },
      { seconds: '60', label: '' },
    ],
    members: [{ person_id: 'noor', role: 'owner' }],
  },
];

export const OPENING_MINUTES = 212;
export const CARRIED_STORAGE_BYTES = 41200000000;

export async function databaseIsEmpty(): Promise<boolean> {
  const rows = await query<{ count: number }>('select count(*)::int as count from people');
  return (rows[0]?.count ?? 0) === 0;
}

async function seedMediaObjects(): Promise<{ id: string; bytes: number; sha256: string; body: Buffer }[]> {
  return MEDIA.map((media) => {
    const body = media.body(media.id);
    return { id: media.id, bytes: body.length, sha256: sha256Hex(body), body };
  });
}

export async function writeSeededObjects(): Promise<void> {
  const files = await seedMediaObjects();
  for (const file of files) {
    await putObject(StorageKeys.media(file.sha256), file.body);
  }
}

function wavHeaderFor(body: Buffer): Record<string, number> {
  return { samples: (body.length - 44) / 2, sample_rate: 8000, channels: 1, bits: 16, data_offset: 44, block_align: 2 };
}

interface MediaShape {
  id: string;
  name: string;
  kind: 'mp4' | 'wav' | 'png';
  folder: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_seconds: string | null;
  sample_rate: number | null;
  header: Record<string, number>;
}

function mediaShapes(): MediaShape[] {
  const shapes: MediaShape[] = [];
  for (const media of MEDIA) {
    const body = media.body(media.id);
    const sha256 = sha256Hex(body);
    if (media.name.endsWith('.wav')) {
      const header = wavHeaderFor(body);
      shapes.push({
        id: media.id,
        name: media.name,
        kind: 'wav',
        folder: media.folder,
        bytes: body.length,
        sha256,
        width: null,
        height: null,
        duration_seconds: (header.samples / header.sample_rate).toFixed(3),
        sample_rate: header.sample_rate,
        header,
      });
      continue;
    }
    if (media.name.endsWith('.png')) {
      shapes.push({
        id: media.id,
        name: media.name,
        kind: 'png',
        folder: media.folder,
        bytes: body.length,
        sha256,
        width: 1200,
        height: 400,
        duration_seconds: null,
        sample_rate: null,
        header: { width: 1200, height: 400 },
      });
      continue;
    }
    const spec = MP4_SPECS[media.id];
    shapes.push({
      id: media.id,
      name: media.name,
      kind: 'mp4',
      folder: media.folder,
      bytes: body.length,
      sha256,
      width: spec.width,
      height: spec.height,
      duration_seconds: (spec.duration / spec.timescale).toFixed(3),
      sample_rate: null,
      header: { width: spec.width, height: spec.height, timescale: spec.timescale, duration: spec.duration },
    });
  }
  return shapes;
}

const MP4_SPECS: Record<string, { width: number; height: number; timescale: number; duration: number }> = {
  'hl-a001-c003': { width: 1920, height: 1080, timescale: 24000, duration: 480480 },
  'hl-a002-c011': { width: 1920, height: 1080, timescale: 24000, duration: 288288 },
  'hl-a004-c002': { width: 1920, height: 1080, timescale: 24000, duration: 600600 },
  'cl-hero-01': { width: 1920, height: 1080, timescale: 25000, duration: 1600000 },
  'cl-hero-02': { width: 1920, height: 1080, timescale: 25000, duration: 1500000 },
  'sm-reel-01': { width: 1080, height: 1920, timescale: 25000, duration: 375000 },
  'ng-run-01': { width: 1080, height: 1080, timescale: 30000, duration: 600600 },
  'fb-expl-01': { width: 1920, height: 1080, timescale: 24, duration: 1080 },
  'bh-recap-01': { width: 1920, height: 1080, timescale: 25000, duration: 1500000 },
  'qs-014': { width: 1920, height: 1080, timescale: 25000, duration: 600000 },
  'qs-022': { width: 1920, height: 1080, timescale: 25000, duration: 300000 },
  'ol-int-01': { width: 1080, height: 1350, timescale: 24000, duration: 1801800 },
};

const EMPTY_BASE = { x: null, y: null, scale: null, rotation: null, opacity: null };

function clipRow(project: SeedProject, clip: SeedClip, seq: number): unknown[] {
  return [
    clip.id,
    project.id,
    clip.row_id,
    clip.name,
    clip.kind,
    clip.media_id,
    clip.start_frame ?? 0,
    clip.end_frame ?? 0,
    clip.source_in ?? 0,
    clip.source_out ?? 0,
    100,
    false,
    clip.group_id ?? null,
    clip.text ?? null,
    clip.text_colour ?? null,
    clip.box_colour ?? null,
    clip.font_weight ?? null,
    JSON.stringify(clip.keyframes ?? {}),
    JSON.stringify(EMPTY_BASE),
    seq,
    clip.start_seconds ?? null,
    clip.source_in_seconds ?? null,
    clip.source_out_seconds ?? null,
  ];
}

export async function seedDatabase(): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('begin');
    for (const person of PEOPLE) {
      await client.query(
        `insert into people (id, name, email, handle, password_hash, availability, is_owner) values ($1,$2,$3,$4,$5,$6,$7)`,
        [person.id, person.name, person.email, person.handle, hashPassword(person.password), person.availability ?? '', person.owner === true],
      );
    }
    const month = new Date().toISOString().slice(0, 7);
    await client.query(
      `insert into workspace (id, owner_id, opening_minutes, opening_month, carried_storage_bytes) values ($1,$2,$3,$4,$5)`,
      [`ws-${randomBytes(8).toString('hex')}`, 'noor', OPENING_MINUTES, month, CARRIED_STORAGE_BYTES],
    );
    for (const media of mediaShapes()) {
      await client.query(
        `insert into media (id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, header)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          media.id,
          media.name,
          media.kind,
          media.folder,
          media.bytes,
          media.sha256,
          media.width,
          media.height,
          media.duration_seconds,
          media.sample_rate,
          JSON.stringify(media.header),
        ],
      );
    }
    let seq = 1;
    for (const [order, project] of PROJECTS.entries()) {
      await client.query(
        `insert into projects (id, title, agency, description, frame_rate, aspect_ratio, time_unit, version, seed_order)
         values ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
        [project.id, project.title, project.agency, project.description, project.frame_rate, project.aspect_ratio, project.time_unit ?? 'frames', order + 1],
      );
      for (const [index, row] of project.rows.entries()) {
        await client.query(`insert into project_rows (id, project_id, name, kind, position, locked) values ($1,$2,$3,$4,$5,$6)`, [
          row.id,
          project.id,
          row.name,
          row.kind,
          index + 1,
          row.locked === true,
        ]);
      }
      for (const clip of project.clips) {
        await client.query(
          `insert into clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out,
            speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes, base, added_seq,
            start_seconds, source_in_seconds, source_out_seconds)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          clipRow(project, clip, seq),
        );
        seq += 1;
      }
      for (const caption of project.captions ?? []) {
        await client.query(
          `insert into captions (id, project_id, row_id, start_frame, end_frame, text) values ($1,$2,$3,$4,$5,$6)`,
          [caption.id, project.id, caption.row_id, caption.start_frame, caption.end_frame, caption.text],
        );
      }
      for (const marker of project.markers) {
        await client.query(`insert into markers (project_id, frame, label, seconds) values ($1,$2,$3,$4)`, [
          project.id,
          marker.frame ?? 0,
          marker.label,
          marker.seconds ?? null,
        ]);
      }
      for (const member of project.members) {
        await client.query(`insert into members (project_id, person_id, role) values ($1,$2,$3)`, [
          project.id,
          member.person_id,
          member.role,
        ]);
      }
    }
    await seedCutsAndNotes(client);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function snapshotClip(project: SeedProject, clip: SeedClip, seq: number): Record<string, unknown> {
  return {
    id: clip.id,
    row_id: clip.row_id,
    name: clip.name,
    kind: clip.kind,
    media_id: clip.media_id,
    start_frame: clip.start_frame ?? 0,
    end_frame: clip.end_frame ?? 0,
    source_in: clip.source_in ?? 0,
    source_out: clip.source_out ?? 0,
    speed_percent: 100,
    hidden: false,
    group_id: clip.group_id ?? null,
    text: clip.text ?? null,
    text_colour: clip.text_colour ?? null,
    box_colour: clip.box_colour ?? null,
    font_weight: clip.font_weight ?? null,
    keyframes: clip.keyframes ?? {},
    base: EMPTY_BASE,
    added_seq: seq,
    project_id: project.id,
  };
}

function snapshotOfProject(
  project: SeedProject,
  override: (clip: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  return {
    rows: project.rows.map((row, index) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      position: index + 1,
      locked: row.locked === true,
    })),
    clips: project.clips.map((clip, index) => override(snapshotClip(project, clip, index + 1))),
    captions: (project.captions ?? []).map((caption) => ({
      id: caption.id,
      row_id: caption.row_id,
      start_frame: caption.start_frame,
      end_frame: caption.end_frame,
      text: caption.text,
      import_start_ms: null,
      import_end_ms: null,
      import_start_frame: null,
      import_end_frame: null,
    })),
  };
}

/** Harbour Light's two cuts, its review link and its two notes. */
async function seedCutsAndNotes(client: PoolClient): Promise<void> {
  const harbour = PROJECTS[0];
  const cutOne = snapshotOfProject(harbour, (clip) =>
    clip.id === 'hl-c3' ? { ...clip, start_frame: 500, end_frame: 719, source_in: 120, source_out: 339 } : clip,
  );
  const cutTwo = snapshotOfProject(harbour, (clip) => clip);
  await client.query(
    `insert into cuts (id, project_id, name, version, total_frames, shared, snapshot) values
      ('hl-cut-1','harbour-light','Cut 1',1,719,true,$1),
      ('hl-cut-2','harbour-light','Cut 2',1,719,false,$2)`,
    [JSON.stringify(cutOne), JSON.stringify(cutTwo)],
  );
  const copperline = snapshotOfProject(PROJECTS[1], (clip) => clip);
  await client.query(
    `insert into cuts (id, project_id, name, version, total_frames, shared, snapshot) values
      ('cl-cut-1','copperline','Director''s 2m',1,2950,false,$1)`,
    [JSON.stringify(copperline)],
  );
  await client.query(
    `insert into review_links (id, project_id, token, cut_id, expires_at) values
      ('hl-link-1','harbour-light','rv-harbour-cut1-7f3a2c','hl-cut-1', now() + interval '30 days')`,
  );
  await client.query(
    `insert into comments (id, project_id, author_person_id, author_name, body, visibility, parent_id, cut_id,
        pin_frame, pin_row_id, pin_clip_id, mentions)
     values
      ('hl-n1','harbour-light','maren','Maren Okafor','Hold on the gull a beat longer @noor','team',null,null,
        300,'hl-picture','hl-c2','["noor"]'::jsonb),
      ('hl-n2','harbour-light',null,'Ada Brightwater','Can the lamp shot hold longer?','review',null,'hl-cut-1',
        560,'hl-picture','hl-c3','[]'::jsonb)`,
  );
}
