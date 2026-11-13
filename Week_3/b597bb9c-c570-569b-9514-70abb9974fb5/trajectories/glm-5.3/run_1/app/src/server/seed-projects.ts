import type { Db } from './db';
import { clipLength, secondsToFrames } from '../shared/frames';

/**
 * The seeded projects, cuts, comments, review links and markers. Seed only
 * an empty database. Projects 7 and 8 are stored in seconds and upgraded at
 * start by the published rounding rule.
 */
export interface SeedClip {
  id: string;
  rowId: string;
  name: string;
  kind: 'mp4' | 'wav' | 'png' | 'text';
  mediaId: string | null;
  start: number;
  sourceIn: number;
  sourceOut: number;
  speed?: number;
  keyframes?: Record<string, { frame: number; value: number; curve: string }[]>;
  groupId?: string;
  text?: string;
  textColour?: string;
  boxColour?: string;
  fontWeight?: number;
}

export interface SeedProject {
  id: string;
  title: string;
  agency: string;
  description: string;
  frameRate: string;
  aspect: string;
  timeUnit: 'frames' | 'seconds';
  rows: { id: string; name: string; kind: 'video' | 'audio' | 'caption'; locked?: boolean }[];
  clips: SeedClip[];
  captions: { id: string; rowId: string; start: number; end: number; text: string }[];
  markers: { frame: number; label: string }[];
  members: { personId: string; role: string }[];
  cuts: { id: string; name: string; shared?: boolean; clipOverrides?: Record<string, { start?: number; sourceIn?: number; sourceOut?: number }>; totalFrames?: number }[];
  reviewLink?: { id: string; token: string; cutId: string; days: number };
  comments?: {
    id: string; author: string; body: string; visibility: 'team' | 'review';
    cutId?: string; frame: number; rowId?: string; clipId?: string; liveOffset?: number;
    mentions?: string[];
  }[];
}

export const seedProjects: SeedProject[] = [
  {
    id: 'harbour-light',
    title: 'Harbour Light 30s',
    agency: 'Kestrel & Vane',
    description: "Thirty seconds for a harbour lamp-maker's anniversary.",
    frameRate: '23.976',
    aspect: '16:9',
    timeUnit: 'frames',
    rows: [
      { id: 'hl-titles', name: 'Titles', kind: 'video' },
      { id: 'hl-picture', name: 'Picture', kind: 'video' },
      { id: 'hl-music', name: 'Music', kind: 'audio', locked: true },
      { id: 'hl-captions', name: 'Captions', kind: 'caption' },
    ],
    clips: [
      { id: 'hl-c1', rowId: 'hl-picture', name: 'HL_A001_C003', kind: 'mp4', mediaId: 'hl-a001-c003', start: 0, sourceIn: 48, sourceOut: 288, groupId: 'hl-g1' },
      { id: 'hl-c2', rowId: 'hl-picture', name: 'HL_A002_C011', kind: 'mp4', mediaId: 'hl-a002-c011', start: 240, sourceIn: 0, sourceOut: 240,
        keyframes: {
          opacity: [
            { frame: 0, value: 0, curve: 'eased' },
            { frame: 24, value: 100, curve: 'eased' },
          ],
          scale: [
            { frame: 0, value: 100, curve: 'linear' },
            { frame: 240, value: 120, curve: 'linear' },
          ],
        } },
      { id: 'hl-c3', rowId: 'hl-picture', name: 'HL_A004_C002', kind: 'mp4', mediaId: 'hl-a004-c002', start: 480, sourceIn: 120, sourceOut: 359 },
      { id: 'hl-c4', rowId: 'hl-music', name: 'harbour_bed', kind: 'wav', mediaId: 'harbour-bed', start: 0, sourceIn: 0, sourceOut: 719 },
      { id: 'hl-c5', rowId: 'hl-titles', name: 'Harbour Light', kind: 'text', mediaId: null, start: 24, sourceIn: 0, sourceOut: 96, text: 'Harbour Light', textColour: 'ffffff', boxColour: '000000', fontWeight: 600, groupId: 'hl-g1' },
    ],
    captions: [
      { id: 'hl-cap-1', rowId: 'hl-captions', start: 30, end: 96, text: 'Every boat comes home' },
      { id: 'hl-cap-2', rowId: 'hl-captions', start: 264, end: 360, text: 'to the same light.' },
      { id: 'hl-cap-3', rowId: 'hl-captions', start: 600, end: 700, text: 'Harbour Light. Since 1898.' },
    ],
    markers: [
      { frame: 0, label: 'Open' },
      { frame: 240, label: 'Gull' },
      { frame: 480, label: 'Lamp' },
      { frame: 600, label: 'Tagline' },
    ],
    members: [
      { personId: 'noor', role: 'owner' },
      { personId: 'idris', role: 'editor' },
      { personId: 'pia', role: 'editor' },
      { personId: 'maren', role: 'commenter' },
    ],
    cuts: [
      {
        id: 'hl-cut-1', name: 'Cut 1', shared: true,
        clipOverrides: { 'hl-c3': { start: 500, sourceIn: 120, sourceOut: 339 } },
      },
      { id: 'hl-cut-2', name: 'Cut 2' },
    ],
    reviewLink: { id: 'hl-link-1', token: 'rv-harbour-cut1-7f3a2c', cutId: 'hl-cut-1', days: 30 },
    comments: [
      { id: 'hl-n1', author: 'Maren Okafor', body: 'Hold on the gull a beat longer @noor', visibility: 'team', frame: 300, rowId: 'hl-picture', clipId: 'hl-c2', liveOffset: 60, mentions: ['noor'] },
      { id: 'hl-n2', author: 'Ada Brightwater', body: 'Can the lamp shot hold longer?', visibility: 'review', cutId: 'hl-cut-1', frame: 560, clipId: 'hl-c3', liveOffset: 60 },
    ],
  },
  {
    id: 'copperline',
    title: 'Copperline Launch Teaser',
    agency: 'Kestrel & Vane',
    description: 'Launch teaser for a copper cookware line.',
    frameRate: '25',
    aspect: '16:9',
    timeUnit: 'frames',
    rows: [{ id: 'cl-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'cl-c1', rowId: 'cl-picture', name: 'CL_HERO_01', kind: 'mp4', mediaId: 'cl-hero-01', start: 0, sourceIn: 0, sourceOut: 1500 },
      { id: 'cl-c2', rowId: 'cl-picture', name: 'CL_HERO_02', kind: 'mp4', mediaId: 'cl-hero-02', start: 1500, sourceIn: 0, sourceOut: 1450 },
    ],
    captions: [],
    markers: [
      { frame: 0, label: '' },
      { frame: 750, label: '' },
      { frame: 1500, label: '' },
      { frame: 2250, label: '' },
    ],
    members: [
      { personId: 'noor', role: 'owner' },
      { personId: 'maren', role: 'commenter' },
    ],
    cuts: [{ id: 'cl-cut-1', name: "Director's 2m", totalFrames: 2950 }],
  },
  {
    id: 'saltmarsh',
    title: 'Saltmarsh Coffee Reels',
    agency: 'Lowtide Studio',
    description: 'Three vertical reels for a roastery.',
    frameRate: '25',
    aspect: '9:16',
    timeUnit: 'frames',
    rows: [{ id: 'sm-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'sm-c1', rowId: 'sm-picture', name: 'SM_REEL_01', kind: 'mp4', mediaId: 'sm-reel-01', start: 0, sourceIn: 0, sourceOut: 375 },
    ],
    captions: [],
    markers: [
      { frame: 0, label: '' },
      { frame: 125, label: '' },
      { frame: 250, label: '' },
      { frame: 350, label: '' },
    ],
    members: [{ personId: 'noor', role: 'owner' }],
    cuts: [],
  },
  {
    id: 'northgate',
    title: 'Northgate Run Club',
    agency: 'Lowtide Studio',
    description: 'Square spots for a weekly running club.',
    frameRate: '29.97',
    aspect: '1:1',
    timeUnit: 'frames',
    rows: [{ id: 'ng-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'ng-c1', rowId: 'ng-picture', name: 'NG_RUN_01', kind: 'mp4', mediaId: 'ng-run-01', start: 0, sourceIn: 0, sourceOut: 600 },
    ],
    captions: [],
    markers: [
      { frame: 0, label: '' },
      { frame: 150, label: '' },
      { frame: 300, label: '' },
      { frame: 450, label: '' },
    ],
    members: [{ personId: 'noor', role: 'owner' }],
    cuts: [],
  },
  {
    id: 'ferrow-bank',
    title: 'Ferrow Bank Explainer',
    agency: 'Kestrel & Vane',
    description: 'Explainer for a small regional bank.',
    frameRate: '24',
    aspect: '16:9',
    timeUnit: 'frames',
    rows: [{ id: 'fb-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'fb-c1', rowId: 'fb-picture', name: 'FB_EXPL_01', kind: 'mp4', mediaId: 'fb-expl-01', start: 0, sourceIn: 0, sourceOut: 1080 },
    ],
    captions: [],
    markers: [
      { frame: 0, label: '' },
      { frame: 360, label: '' },
      { frame: 720, label: '' },
    ],
    members: [{ personId: 'noor', role: 'owner' }],
    cuts: [],
  },
  {
    id: 'blue-hour',
    title: 'Blue Hour Festival Recap',
    agency: 'Lowtide Studio',
    description: 'One-minute recap of a night market.',
    frameRate: '25',
    aspect: '16:9',
    timeUnit: 'frames',
    rows: [{ id: 'bh-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'bh-c1', rowId: 'bh-picture', name: 'BH_RECAP_01', kind: 'mp4', mediaId: 'bh-recap-01', start: 0, sourceIn: 0, sourceOut: 1500 },
    ],
    captions: [],
    markers: [
      { frame: 0, label: '' },
      { frame: 500, label: '' },
      { frame: 1000, label: '' },
    ],
    members: [{ personId: 'noor', role: 'owner' }],
    cuts: [],
  },
  {
    id: 'quayside',
    title: 'Quayside Teaser',
    agency: 'Kestrel & Vane',
    description: 'An older teaser kept for reference.',
    frameRate: '25',
    aspect: '16:9',
    timeUnit: 'seconds',
    rows: [{ id: 'qs-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'qs-c1', rowId: 'qs-picture', name: 'QS_014', kind: 'mp4', mediaId: 'qs-014', start: 0, sourceIn: 0, sourceOut: 12.34 },
      { id: 'qs-c2', rowId: 'qs-picture', name: 'QS_022', kind: 'mp4', mediaId: 'qs-022', start: 12.34, sourceIn: 2.02, sourceOut: 9.5 },
    ],
    captions: [],
    markers: [
      { frame: 0, label: '' },
      { frame: 6.1, label: '' },
      { frame: 12.34, label: '' },
    ],
    members: [{ personId: 'noor', role: 'owner' }],
    cuts: [],
  },
  {
    id: 'orchard-lane',
    title: 'Orchard Lane Interview',
    agency: 'Lowtide Studio',
    description: 'Sit-down interview with an orchard keeper.',
    frameRate: '23.976',
    aspect: '4:5',
    timeUnit: 'seconds',
    rows: [{ id: 'ol-picture', name: 'Picture', kind: 'video' }],
    clips: [
      { id: 'ol-c1', rowId: 'ol-picture', name: 'OL_INT_01', kind: 'mp4', mediaId: 'ol-int-01', start: 0, sourceIn: 4.2, sourceOut: 64.2 },
    ],
    captions: [],
    markers: [
      { frame: 0, label: '' },
      { frame: 30, label: '' },
      { frame: 60, label: '' },
    ],
    members: [{ personId: 'noor', role: 'owner' }],
    cuts: [],
  },
];

/** Insert the seed projects when the database is empty. */
export async function seedProjectsIfEmpty(db: Db, workspaceId: string): Promise<void> {
  const existing = await db.query('SELECT 1 FROM projects LIMIT 1');
  if ((existing.rowCount ?? 0) > 0) return;
  for (let i = 0; i < seedProjects.length; i++) {
    const p = seedProjects[i]!;
    await db.query(
      `INSERT INTO projects (id, workspace_id, title, agency, description, frame_rate, aspect_ratio, time_unit, version, seed_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
      [p.id, workspaceId, p.title, p.agency, p.description, p.frameRate, p.aspect, p.timeUnit, i + 1],
    );
    for (const m of p.members) {
      await db.query('INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3)', [p.id, m.personId, m.role]);
    }
    let pos = 1;
    for (const row of p.rows) {
      await db.query(
        'INSERT INTO rows (id, project_id, name, kind, position, locked) VALUES ($1,$2,$3,$4,$5,$6)',
        [row.id, p.id, row.name, row.kind, pos, row.locked === true],
      );
      pos++;
    }
    for (const clip of p.clips) {
      // end_frame follows the length rule: start plus (source_out − source_in)
      // scaled by speed, by the rounding rule.
      const sourceIn = clip.sourceIn;
      const sourceOut = clip.sourceOut;
      const length = clipLength(
        p.timeUnit === 'seconds' ? secondsToFrames(sourceIn, p.frameRate) : sourceIn,
        p.timeUnit === 'seconds' ? secondsToFrames(sourceOut, p.frameRate) : sourceOut,
        clip.speed ?? 100,
      );
      // For a seconds project the stored end is decimal seconds; the upgrade
      // recomputes it by the length rule.
      const end = p.timeUnit === 'seconds' ? clip.start + (sourceOut - sourceIn) : clip.start + length;
      await db.query(
        `INSERT INTO clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out, speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes, add_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$13,$14,$15,$16,$17,$18)`,
        [clip.id, p.id, clip.rowId, clip.name, clip.kind, clip.mediaId, clip.start, end, sourceIn, sourceOut,
          clip.speed ?? 100, clip.groupId ?? null, clip.text ?? null, clip.textColour ?? null,
          clip.boxColour ?? null, clip.fontWeight ?? null, JSON.stringify(clip.keyframes ?? {}), 0],
      );
    }
    let capOrder = 0;
    for (const cap of p.captions) {
      await db.query(
        'INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text) VALUES ($1,$2,$3,$4,$5,$6)',
        [cap.id, p.id, cap.rowId, cap.start, cap.end, cap.text],
      );
      capOrder++;
    }
    for (const marker of p.markers) {
      await db.query(
        'INSERT INTO markers (project_id, frame, label) VALUES ($1,$2,$3)',
        [p.id, marker.frame, marker.label],
      );
    }
    for (const cut of p.cuts) {
      const snapshot = projectSnapshot(p, cut.clipOverrides ?? {});
      await db.query(
        `INSERT INTO cuts (id, project_id, name, version, total_frames, shared, snapshot) VALUES ($1,$2,$3,1,$4,$5,$6)`,
        [cut.id, p.id, cut.name, cut.totalFrames ?? snapshot.totalFrames, cut.shared === true, JSON.stringify(snapshot)],
      );
    }
    if (p.reviewLink !== undefined) {
      await db.query(
        `INSERT INTO review_links (id, project_id, token, cut_id, expires_at, state) VALUES ($1,$2,$3,$4,$5,'active')`,
        [p.reviewLink.id, p.id, p.reviewLink.token, p.reviewLink.cutId, new Date(Date.now() + p.reviewLink.days * 86400000)],
      );
    }
    for (const comment of p.comments ?? []) {
      await db.query(
        `INSERT INTO comments (id, project_id, author_name, body, visibility, cut_id, frame, live_offset, row_id, clip_id, live_frame, mentions, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9,$10,$11::numeric,$12,$13)`,
        [comment.id, p.id, comment.author, comment.body, comment.visibility, comment.cutId ?? null,
          comment.frame, comment.liveOffset ?? 0, comment.rowId ?? null, comment.clipId ?? null,
          comment.frame + (comment.liveOffset ?? 0), comment.mentions ?? [], new Date()],
      );
    }
    await db.query(
      `INSERT INTO ops (project_id, version, person_id, person_name, op_type, op, undo_data)
       VALUES ($1,1,'noor','Noor Achterberg','seed','{}','{}')`,
      [p.id],
    );
  }
}

function projectSnapshot(p: SeedProject, overrides: Record<string, { start?: number; sourceIn?: number; sourceOut?: number }>): {
  rows: unknown[];
  clips: unknown[];
  captions: unknown[];
  totalFrames: number;
} {
  const rate = p.frameRate;
  const upgrade = p.timeUnit === 'seconds';
  const clips = p.clips.map((clip) => {
    const o = overrides[clip.id];
    const start = o?.start !== undefined ? o.start : clip.start;
    const sourceIn = o?.sourceIn !== undefined ? o.sourceIn : clip.sourceIn;
    const sourceOut = o?.sourceOut !== undefined ? o.sourceOut : clip.sourceOut;
    const startFrame = upgrade ? secondsToFrames(start, rate) : start;
    const inFrame = upgrade ? secondsToFrames(sourceIn, rate) : sourceIn;
    const outFrame = upgrade ? secondsToFrames(sourceOut, rate) : sourceOut;
    const length = clipLength(inFrame, outFrame, clip.speed ?? 100);
    return {
      id: clip.id, row_id: clip.rowId, name: clip.name, kind: clip.kind, media_id: clip.mediaId,
      start_frame: startFrame, end_frame: startFrame + length, source_in: inFrame, source_out: outFrame,
      speed_percent: clip.speed ?? 100, hidden: false, group_id: clip.groupId ?? null,
      text: clip.text ?? null, text_colour: clip.textColour ?? null, box_colour: clip.boxColour ?? null,
      font_weight: clip.fontWeight ?? null, keyframes: clip.keyframes ?? {},
    };
  });
  const captions = p.captions.map((cap) => ({
    id: cap.id, row_id: cap.rowId, start_frame: cap.start, end_frame: cap.end, text: cap.text,
  }));
  let totalFrames = 0;
  for (const c of [...clips, ...captions]) {
    totalFrames = Math.max(totalFrames, c.end_frame);
  }
  return { rows: p.rows, clips, captions, totalFrames };
}
