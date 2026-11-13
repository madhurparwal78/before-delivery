import { randomBytes } from "node:crypto";
import type pg from "pg";
import { roundExact } from "../shared/rational";
import type { Clip } from "../shared/types";
import { currentMonth } from "./allowance";
import { hashPassword } from "./auth";
import { mediaWords } from "./media/library";
import { mp4StandIn, pngStandIn, sha256Of, wavStandIn } from "./standins";
import { headObject, putObject } from "./s3";
import type { CaptionRec, RowRec } from "./timeline/model";
import type { CutSnapshot } from "./timeline/engine";

const PEOPLE = [
  { id: "noor", name: "Noor Achterberg", email: "noor@gatecut.example", password: "reel-owner-4417", handle: "noor", owner: true },
  { id: "idris", name: "Idris Fallowfield", email: "idris@kestrelvane.example", password: "reel-editor-2290", handle: "idris", owner: false },
  { id: "pia", name: "Pia Marchetti", email: "pia@kestrelvane.example", password: "reel-editor-5531", handle: "pia", owner: false },
  { id: "maren", name: "Maren Okafor", email: "maren@kestrelvane.example", password: "reel-producer-8812", handle: "maren", owner: false },
  { id: "theo", name: "Theo Brandt", email: "theo@lowtide.example", password: "reel-editor-6604", handle: "theo", owner: false },
] as const;

type Header =
  | { kind: "mp4"; width: number; height: number; timescale: number; duration: number }
  | { kind: "wav"; samples: number }
  | { kind: "png"; width: number; height: number };

interface SeedMedia {
  id: string;
  file: string;
  folder: string;
  header: Header;
}

const MEDIA: SeedMedia[] = [
  { id: "hl-a001-c003", file: "HL_A001_C003.mp4", folder: "Harbour Light / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 24000, duration: 480480 } },
  { id: "hl-a002-c011", file: "HL_A002_C011.mp4", folder: "Harbour Light / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 24000, duration: 288288 } },
  { id: "hl-a004-c002", file: "HL_A004_C002.mp4", folder: "Harbour Light / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 24000, duration: 600600 } },
  { id: "harbour-bed", file: "harbour_bed.wav", folder: "Harbour Light / Audio", header: { kind: "wav", samples: 240240 } },
  { id: "cl-hero-01", file: "CL_HERO_01.mp4", folder: "Copperline / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25000, duration: 1600000 } },
  { id: "cl-hero-02", file: "CL_HERO_02.mp4", folder: "Copperline / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25000, duration: 1500000 } },
  { id: "sm-reel-01", file: "SM_REEL_01.mp4", folder: "Saltmarsh / Rushes", header: { kind: "mp4", width: 1080, height: 1920, timescale: 25000, duration: 375000 } },
  { id: "ng-run-01", file: "NG_RUN_01.mp4", folder: "Northgate / Rushes", header: { kind: "mp4", width: 1080, height: 1080, timescale: 30000, duration: 600600 } },
  { id: "fb-expl-01", file: "FB_EXPL_01.mp4", folder: "Ferrow Bank / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 24, duration: 1080 } },
  { id: "bh-recap-01", file: "BH_RECAP_01.mp4", folder: "Blue Hour / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25000, duration: 1500000 } },
  { id: "qs-014", file: "QS_014.mp4", folder: "Quayside / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25000, duration: 600000 } },
  { id: "qs-022", file: "QS_022.mp4", folder: "Quayside / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25000, duration: 300000 } },
  { id: "ol-int-01", file: "OL_INT_01.mp4", folder: "Orchard Lane / Rushes", header: { kind: "mp4", width: 1080, height: 1350, timescale: 24000, duration: 1801800 } },
  { id: "kv-logo", file: "kv_logo.png", folder: "Kestrel & Vane / Brand", header: { kind: "png", width: 1200, height: 400 } },
];

function standIn(media: SeedMedia): Buffer {
  const h = media.header;
  if (h.kind === "mp4") return mp4StandIn(media.file, h.width, h.height, h.timescale, h.duration);
  if (h.kind === "wav") return wavStandIn(h.samples);
  return pngStandIn(h.width, h.height, [0x3a, 0x2e, 0x24]);
}

/** Writes any missing stand-in object to storage; safe to run at every start and a no-op when storage is down. */
export async function ensureSeedObjects(sha: ReadonlyMap<string, string>): Promise<void> {
  for (const media of MEDIA) {
    const key = `media/${sha.get(media.id)}`;
    try {
      if (!(await headObject(key))) await putObject(key, standIn(media));
    } catch {
      return;
    }
  }
}

export function seedMediaSha(): Map<string, string> {
  return new Map(MEDIA.map((media) => [media.id, sha256Of(standIn(media))]));
}

interface SeedClip {
  id: string;
  row: string;
  media?: string;
  name?: string;
  kind: Clip["kind"];
  start: number;
  end: number;
  sourceIn: number;
  sourceOut: number;
  group?: string;
  text?: string;
  keyframes?: Clip["keyframes"];
  legacy?: { start: string; source_in: string; source_out: string };
}

interface SeedProject {
  id: string;
  title: string;
  agency: string;
  description: string;
  rate: string;
  aspect: string;
  legacy?: boolean;
  members: [string, string][];
  rows: { id: string; name: string; kind: string; locked?: boolean }[];
  clips: SeedClip[];
  markers: { frame: number; label: string; legacy?: string }[];
}

const KESTREL = "Kestrel & Vane";
const LOWTIDE = "Lowtide Studio";
const OWNER: [string, string][] = [["noor", "owner"]];
const picture = (id: string): SeedProject["rows"] => [{ id, name: "Picture", kind: "video" }];
const markers = (...frames: number[]): SeedProject["markers"] => frames.map((frame) => ({ frame, label: "" }));
const solo = (id: string, row: string, media: string, name: string, frames: number): SeedClip => ({
  id, row, media, name, kind: "mp4", start: 0, end: frames, sourceIn: 0, sourceOut: frames,
});

const PROJECTS: SeedProject[] = [
  {
    id: "harbour-light", title: "Harbour Light 30s", agency: KESTREL, description: "Thirty seconds for a harbour lamp-maker's anniversary.",
    rate: "23.976", aspect: "16:9",
    members: [["noor", "owner"], ["idris", "editor"], ["pia", "editor"], ["maren", "commenter"]],
    rows: [
      { id: "hl-titles", name: "Titles", kind: "video" }, { id: "hl-picture", name: "Picture", kind: "video" },
      { id: "hl-music", name: "Music", kind: "audio", locked: true }, { id: "hl-captions", name: "Captions", kind: "caption" },
    ],
    clips: [
      { id: "hl-c1", row: "hl-picture", media: "hl-a001-c003", name: "HL_A001_C003", kind: "mp4", start: 0, end: 240, sourceIn: 48, sourceOut: 288, group: "hl-g1" },
      {
        id: "hl-c2", row: "hl-picture", media: "hl-a002-c011", name: "HL_A002_C011", kind: "mp4", start: 240, end: 480, sourceIn: 0, sourceOut: 240,
        keyframes: {
          opacity: [{ frame: 0, value: 0, curve: "eased" }, { frame: 24, value: 100, curve: "linear" }],
          scale: [{ frame: 0, value: 100, curve: "linear" }, { frame: 240, value: 120, curve: "linear" }],
        },
      },
      { id: "hl-c3", row: "hl-picture", media: "hl-a004-c002", name: "HL_A004_C002", kind: "mp4", start: 480, end: 719, sourceIn: 120, sourceOut: 359 },
      { id: "hl-c4", row: "hl-music", media: "harbour-bed", name: "harbour_bed", kind: "wav", start: 0, end: 719, sourceIn: 0, sourceOut: 719 },
      { id: "hl-c5", row: "hl-titles", name: "Harbour Light", kind: "text", start: 24, end: 120, sourceIn: 0, sourceOut: 96, group: "hl-g1", text: "Harbour Light" },
    ],
    markers: [{ frame: 0, label: "Open" }, { frame: 240, label: "Gull" }, { frame: 480, label: "Lamp" }, { frame: 600, label: "Tagline" }],
  },
  {
    id: "copperline", title: "Copperline Launch Teaser", agency: KESTREL, description: "Launch teaser for a copper cookware line.",
    rate: "25", aspect: "16:9", members: [["noor", "owner"], ["maren", "commenter"]], rows: picture("cl-picture"),
    clips: [solo("cl-c1", "cl-picture", "cl-hero-01", "CL_HERO_01", 1500), { ...solo("cl-c2", "cl-picture", "cl-hero-02", "CL_HERO_02", 1450), start: 1500, end: 2950 }],
    markers: markers(0, 750, 1500, 2250),
  },
  {
    id: "saltmarsh", title: "Saltmarsh Coffee Reels", agency: LOWTIDE, description: "Three vertical reels for a roastery.",
    rate: "25", aspect: "9:16", members: OWNER, rows: picture("sm-picture"), clips: [solo("sm-c1", "sm-picture", "sm-reel-01", "SM_REEL_01", 375)], markers: markers(0, 125, 250, 350),
  },
  {
    id: "northgate", title: "Northgate Run Club", agency: LOWTIDE, description: "Square spots for a weekly running club.",
    rate: "29.97", aspect: "1:1", members: OWNER, rows: picture("ng-picture"), clips: [solo("ng-c1", "ng-picture", "ng-run-01", "NG_RUN_01", 600)], markers: markers(0, 150, 300, 450),
  },
  {
    id: "ferrow-bank", title: "Ferrow Bank Explainer", agency: KESTREL, description: "Explainer for a small regional bank.",
    rate: "24", aspect: "16:9", members: OWNER, rows: picture("fb-picture"), clips: [solo("fb-c1", "fb-picture", "fb-expl-01", "FB_EXPL_01", 1080)], markers: markers(0, 360, 720),
  },
  {
    id: "blue-hour", title: "Blue Hour Festival Recap", agency: LOWTIDE, description: "One-minute recap of a night market.",
    rate: "25", aspect: "16:9", members: OWNER, rows: picture("bh-picture"), clips: [solo("bh-c1", "bh-picture", "bh-recap-01", "BH_RECAP_01", 1500)], markers: markers(0, 500, 1000),
  },
  {
    id: "quayside", title: "Quayside Teaser", agency: KESTREL, description: "An older teaser kept for reference.",
    rate: "25", aspect: "16:9", legacy: true, members: OWNER, rows: picture("qs-picture"),
    clips: [
      { id: "qs-c1", row: "qs-picture", media: "qs-014", name: "QS_014", kind: "mp4", start: 0, end: 0, sourceIn: 0, sourceOut: 0, legacy: { start: "0", source_in: "0", source_out: "12.34" } },
      { id: "qs-c2", row: "qs-picture", media: "qs-022", name: "QS_022", kind: "mp4", start: 0, end: 0, sourceIn: 0, sourceOut: 0, legacy: { start: "12.34", source_in: "2.02", source_out: "9.5" } },
    ],
    markers: [{ frame: 0, label: "", legacy: "0" }, { frame: 0, label: "", legacy: "6.1" }, { frame: 0, label: "", legacy: "12.34" }],
  },
  {
    id: "orchard-lane", title: "Orchard Lane Interview", agency: LOWTIDE, description: "Sit-down interview with an orchard keeper.",
    rate: "23.976", aspect: "4:5", legacy: true, members: OWNER, rows: picture("ol-picture"),
    clips: [{ id: "ol-c1", row: "ol-picture", media: "ol-int-01", name: "OL_INT_01", kind: "mp4", start: 0, end: 0, sourceIn: 0, sourceOut: 0, legacy: { start: "0", source_in: "4.2", source_out: "64.2" } }],
    markers: [{ frame: 0, label: "", legacy: "0" }, { frame: 0, label: "", legacy: "30" }, { frame: 0, label: "", legacy: "60" }],
  },
];

function clipRecord(seed: SeedClip, rowId: string): Clip {
  return {
    id: seed.id, row_id: rowId, name: seed.name ?? seed.text ?? seed.id, kind: seed.kind, media_id: seed.media ?? null,
    start_frame: seed.start, end_frame: seed.end, source_in: seed.sourceIn, source_out: seed.sourceOut, speed_percent: 100,
    hidden: false, group_id: seed.group ?? null, text: seed.text ?? null,
    text_colour: seed.kind === "text" ? "ffffff" : null, box_colour: seed.kind === "text" ? "000000" : null,
    font_weight: seed.kind === "text" ? 600 : null, keyframes: seed.keyframes ?? {}, base: {},
  };
}

/** Seeds an empty database in one transaction. */
export async function seed(client: pg.PoolClient): Promise<void> {
  const existing = await client.query("SELECT 1 FROM people LIMIT 1");
  if (existing.rowCount) return;
  const sha = seedMediaSha();
  for (const person of PEOPLE) {
    await client.query("INSERT INTO people (id, name, email, handle, password_hash, is_owner) VALUES ($1,$2,$3,$4,$5,$6)", [
      person.id, person.name, person.email, person.handle, hashPassword(person.password), person.owner,
    ]);
  }
  await client.query("INSERT INTO workspace (id, owner_id, availability, carried_storage_bytes, opening_minutes, opening_month) VALUES ($1,'noor',$2,$3,$4,$5)", [
    `ws-${randomBytes(8).toString("hex")}`, "Booked through 14 November; taking new cuts from 17 November.", 41_200_000_000, 212, currentMonth(),
  ]);
  for (const media of MEDIA) {
    const h = media.header;
    const bytes = standIn(media).length;
    const [num, den] = h.kind === "mp4" ? [BigInt(h.duration), BigInt(h.timescale)] : h.kind === "wav" ? [BigInt(h.samples), 8000n] : [3600n, 1n];
    await client.query(
      `INSERT INTO media (id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, src_num, src_den, words)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        media.id, media.file, h.kind, media.folder, bytes, sha.get(media.id), h.kind === "wav" ? null : h.width, h.kind === "wav" ? null : h.height,
        h.kind === "png" ? null : roundExact(num * 1000n, den) / 1000, h.kind === "wav" ? 8000 : null, num, den, mediaWords(media.file, media.folder),
      ],
    );
  }
  for (const project of PROJECTS) {
    await client.query(
      "INSERT INTO projects (id, title, agency, description, frame_rate, aspect_ratio, time_unit) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [project.id, project.title, project.agency, project.description, project.rate, project.aspect, project.legacy ? "seconds" : "frames"],
    );
    for (const [person, role] of project.members) await client.query("INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3)", [project.id, person, role]);
    for (const [index, row] of project.rows.entries()) {
      await client.query("INSERT INTO rows (id, project_id, name, kind, position, locked) VALUES ($1,$2,$3,$4,$5,$6)", [row.id, project.id, row.name, row.kind, index + 1, row.locked ?? false]);
    }
    for (const clip of project.clips) {
      const record = clipRecord(clip, clip.row);
      await client.query(
        `INSERT INTO clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out, speed_percent, hidden,
           group_id, text, text_colour, box_colour, font_weight, keyframes, base, legacy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,100,false,$11,$12,$13,$14,$15,$16,'{}',$17)`,
        [
          record.id, project.id, record.row_id, record.name, record.kind, record.media_id, record.start_frame, record.end_frame, record.source_in,
          record.source_out, record.group_id, record.text, record.text_colour, record.box_colour, record.font_weight, JSON.stringify(record.keyframes),
          clip.legacy ? JSON.stringify(clip.legacy) : null,
        ],
      );
    }
    for (const marker of project.markers) {
      await client.query("INSERT INTO markers (project_id, frame, label, legacy) VALUES ($1,$2,$3,$4)", [project.id, marker.frame, marker.label, marker.legacy ?? null]);
    }
  }
  await seedHarbourLight(client);
  await seedCopperlineCut(client);
}

async function seedHarbourLight(client: pg.PoolClient): Promise<void> {
  const project = PROJECTS[0];
  if (!project) return;
  const captions: [string, number, number, string][] = [
    ["hl-cap-1", 30, 96, "Every boat comes home"], ["hl-cap-2", 264, 360, "to the same light."], ["hl-cap-3", 600, 700, "Harbour Light. Since 1898."],
  ];
  for (const [id, start, end, text] of captions) {
    await client.query("INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text) VALUES ($1,'harbour-light','hl-captions',$2,$3,$4)", [id, start, end, text]);
  }
  const rows: RowRec[] = project.rows.map((row, index) => ({ id: row.id, name: row.name, kind: row.kind as RowRec["kind"], position: index + 1, locked: row.locked ?? false, srt_eol: "\n", srt_bom: false }));
  const clips = project.clips.map((clip) => clipRecord(clip, clip.row));
  const capRecords: CaptionRec[] = captions.map(([id, start, end, text]) => ({ id, row_id: "hl-captions", start_frame: start, end_frame: end, text, orig_start_ms: null, orig_end_ms: null }));
  const cutOne: CutSnapshot = {
    rows, captions: capRecords,
    clips: clips.map((clip) => (clip.id === "hl-c3" ? { ...clip, start_frame: 500, source_out: 339 } : clip)),
  };
  const cutTwo: CutSnapshot = { rows, clips, captions: capRecords };
  for (const [id, name, snapshot, shared] of [["hl-cut-1", "Cut 1", cutOne, true], ["hl-cut-2", "Cut 2", cutTwo, false]] as const) {
    await client.query("INSERT INTO cuts (id, project_id, name, version, total_frames, shared, snapshot) VALUES ($1,'harbour-light',$2,1,719,$3,$4)", [id, name, shared, JSON.stringify(snapshot)]);
  }
  await client.query("INSERT INTO review_links (id, project_id, cut_id, token, expires_at) VALUES ('hl-link-1','harbour-light','hl-cut-1','rv-harbour-cut1-7f3a2c', now() + interval '30 days')");
  await client.query(
    `INSERT INTO comments (id, project_id, author_id, author_name, body, visibility, cut_id, pin_frame, pin_row_id, pin_clip_id, pin_offset, mentions)
     VALUES ('hl-n1','harbour-light','maren','Maren Okafor','Hold on the gull a beat longer @noor','team',NULL,300,'hl-picture','hl-c2',60,'["noor"]'),
            ('hl-n2','harbour-light',NULL,'Ada Brightwater','Can the lamp shot hold longer?','review','hl-cut-1',560,'hl-picture','hl-c3',60,'[]')`,
  );
}

async function seedCopperlineCut(client: pg.PoolClient): Promise<void> {
  const project = PROJECTS[1];
  if (!project) return;
  const rows: RowRec[] = project.rows.map((row, index) => ({ id: row.id, name: row.name, kind: row.kind as RowRec["kind"], position: index + 1, locked: false, srt_eol: "\n", srt_bom: false }));
  const snapshot: CutSnapshot = { rows, clips: project.clips.map((clip) => clipRecord(clip, clip.row)), captions: [] };
  await client.query("INSERT INTO cuts (id, project_id, name, version, total_frames, snapshot) VALUES ('cl-cut-1','copperline',$1,1,2950,$2)", ["Director's 2m", JSON.stringify(snapshot)]);
}
