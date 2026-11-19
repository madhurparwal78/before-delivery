/** Postgres access: pool, transactions and idempotent schema+seed. */
import { Pool, type PoolClient } from 'pg';
import { SCHEMA_SQL } from './schema.js';
import { hashPassword } from './password.js';
import { TEMPLATES, type TemplateCode } from '../domain.js';
import type { Config } from './config.js';

export interface Facilitator {
  id: string; email: string; name: string; password_hash: string; time_zone: string;
}

export interface Workshop {
  id: string; facilitator_id: string; title: string; template: string; status: string;
  scheduled_start: string; scheduled_end: string; sponsor_email: string; fee_cents: number;
  round_number: number; round_ends_at: Date | null; voting_ends_at: Date | null;
  dot_budget: number | null; version: number;
}

export interface Frame {
  id: string; workshop_id: string; title: string; x: number; y: number; width: number; height: number;
  position: number; trashed_at: Date | null; purge_at: Date | null; purged: boolean;
}

export interface Cluster {
  id: string; workshop_id: string; frame_id: string; title: string; x: number; y: number; created_at: Date;
}

export interface Note {
  id: string; workshop_id: string; frame_id: string; cluster_id: string | null; kind: string;
  text: string | null; image_id: string | null; x: number; y: number; revealed: boolean;
  facilitator_only: boolean; author_participant_id: string | null; author_facilitator: boolean;
  author_name: string; round_number: number; created_at: Date; placement_index: number;
}

export interface Connector {
  id: string; workshop_id: string; from_note_id: string; to_note_id: string; created_at: Date;
}

export interface Dot {
  id: string; workshop_id: string; participant_id: string; cluster_id: string;
  kind: 'spend' | 'return'; cancels_id: string | null; created_at: Date;
}

export interface Participant {
  id: string; workshop_id: string; display_name: string; join_link_id: string; session_id: string;
  hue: number; active: boolean; session_ended: boolean; ended_at: Date | null; created_at: Date;
}

export interface JoinLink {
  id: string; workshop_id: string; token: string; revoked: boolean; expires_at: Date; created_at: Date;
}

export interface Invite {
  id: string; workshop_id: string; email: string; status: string; created_at: Date; sent_at: Date | null;
}

export interface ActivityEntry {
  id: string; seq: string; at: Date; actor: string; action: string; workshop_id: string | null;
}

export class Db {
  pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 24, idleTimeoutMillis: 30000 });
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      try { await client.query('rollback'); } catch { /* connection already gone */ }
      throw e;
    } finally {
      client.release();
    }
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params as never[]);
    return res.rows as T[];
  }

  async row<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.rows<T>(sql, params);
    return rows.length === 0 ? null : rows[0];
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(sql, params as never[]);
  }

  async createFacilitatorSession(facilitatorId: string, sessionId: string, expiresAt: Date): Promise<void> {
    await this.exec('insert into facilitator_sessions (id, facilitator_id, expires_at) values ($1,$2,$3)', [sessionId, facilitatorId, expiresAt]);
  }

  async deleteFacilitatorSession(sessionId: string): Promise<void> {
    await this.exec('delete from facilitator_sessions where id = $1', [sessionId]);
  }

  async waitForDb(maxMs = 180000): Promise<void> {
    const started = Date.now();
    for (;;) {
      try {
        await this.exec('select 1');
        return;
      } catch {
        if (Date.now() - started > maxMs) throw new Error('postgres unreachable');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  /** Apply the schema and make sure the seed data is present (idempotent, every start). */
  async applySchemaAndSeed(): Promise<void> {
    await this.exec(SCHEMA_SQL);
    const junoHash = hashPassword('fold-the-lantern-26');
    const odileHash = hashPassword('brack-the-room-27');
    await this.tx(async (c) => {
      await c.query(
        `insert into facilitators (id, email, name, password_hash, time_zone) values
         ('fac_juno','juno@lanternfold.test','Juno Marlowe',$1,'Europe/Lisbon'),
         ('fac_odile','odile@lanternfold.test','Odile Brack',$2,'America/Toronto')
         on conflict (id) do nothing`,
        [junoHash, odileHash]);
      for (const [facId, plan, term] of [['fac_juno', 'studio', 'monthly'], ['fac_odile', 'free', 'monthly']] as const) {
        await c.query(
          `insert into billing_mirror (facilitator_id, plan, term, renews_on, entitlements)
           values ($1,$2,$3,$4,$5) on conflict (facilitator_id) do nothing`,
          [facId, plan, term, dateInDays(30), JSON.stringify(entitlementsFor(plan))]);
      }
      await seedJunoWorkshops(c);
    });
  }
}

function dateInDays(n: number): string {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
}

function entitlementsFor(plan: string): Record<string, number | null> {
  if (plan === 'free') return { activeWorkshops: 3, participantsPerWorkshop: 8, silentRoundsPerWorkshop: 1, invitesPerDay: 20, recapScale: 1 };
  if (plan === 'studio') return { activeWorkshops: 20, participantsPerWorkshop: 30, silentRoundsPerWorkshop: null, invitesPerDay: 200, recapScale: 2 };
  return { activeWorkshops: null, participantsPerWorkshop: 50, silentRoundsPerWorkshop: null, invitesPerDay: 1000, recapScale: 2 };
}

async function seedJunoWorkshops(c: PoolClient): Promise<void> {
  const juno = 'fac_juno';
  // Workshop 1: Harbourline (draft, discovery)
  await c.query(
    `insert into workshops (id, facilitator_id, title, template, status, scheduled_start, scheduled_end, sponsor_email, fee_cents, version)
     values ('ws_harbourline', $1, 'Harbourline Studio — discovery sprint', 'discovery', 'draft',
             '2027-03-04T14:00', '2027-03-04T17:00', 'sponsor@harbourline.test', 0, 1)
     on conflict (id) do nothing`, [juno]);
  // Workshop 2: Fernmoor (revealed, retrospective) — richly seeded
  const exists = await c.query('select 1 from workshops where id = $1', ['ws_fernmoor']);
  if (exists.rowCount === 0) {
    await c.query(
      `insert into workshops (id, facilitator_id, title, template, status, scheduled_start, scheduled_end, sponsor_email, fee_cents, round_number, version)
       values ('ws_fernmoor', $1, 'Fernmoor Clinic — Q3 retrospective', 'retrospective', 'revealed',
               '2027-02-11T09:00', '2027-02-11T11:00', 'lead@fernmoor.test', 125010, 1, 1)`, [juno]);
    const frameIds = new Map<string, string>();
    let pos = 0;
    for (const title of TEMPLATES.retrospective) {
      const id = `fr_${slug(title)}`;
      frameIds.set(title, id);
      await c.query(
        `insert into frames (id, workshop_id, title, x, y, width, height, position) values ($1,'ws_fernmoor',$2,$3,0,800,600,$4)`,
        [id, title, pos * 900, pos]);
      pos += 1;
    }
    // Join link (seed link used only by seed participants)
    await c.query(
      `insert into join_links (id, workshop_id, token, revoked, expires_at) values ('jl_seed','ws_fernmoor',$1,false, now() + interval '365 days')`,
      ['seed-token-not-for-joining-0000000000000001']);
    // Participants
    const partIds = new Map<string, string>();
    for (const [pid, name, hue] of [['pt_priya', 'Priya N.', 210], ['pt_tomas', 'Tomás R.', 32], ['pt_ade', 'Ade K.', 130]] as const) {
      partIds.set(name, pid);
      await c.query(
        `insert into participants (id, workshop_id, display_name, join_link_id, session_id, hue, active, session_ended)
         values ($1,'ws_fernmoor',$2,$3,$4,$5,true,false)`,
        [pid, name, 'jl_seed', `sess_${pid}`, hue]);
    }
    // Clusters: Handoffs, Tooling in "To improve"
    const handoffs = 'cl_handoffs';
    const tooling = 'cl_tooling';
    await c.query(
      `insert into clusters (id, workshop_id, frame_id, title, x, y) values
       ($1,'ws_fernmoor','fr_to-improve','Handoffs',120,140),
       ($2,'ws_fernmoor','fr_to-improve','Tooling',420,140)`,
      [handoffs, tooling]);
    interface SeedNote {
      id: string; frame: string; text: string; author: string; authorIsFac: boolean;
      cluster: string | null; facOnly: boolean; x: number; y: number; idx: number;
    }
    const notes: SeedNote[] = [
      { id: 'nt_went1', frame: 'fr_went-well', text: 'Weekly demo kept the clinic leads close', author: 'Priya N.', authorIsFac: false, cluster: null, facOnly: false, x: 100, y: 90, idx: 0 },
      { id: 'nt_went2', frame: 'fr_went-well', text: 'Release notes are finally readable', author: 'Ade K.', authorIsFac: false, cluster: null, facOnly: false, x: 100, y: 220, idx: 1 },
      { id: 'nt_h1', frame: 'fr_to-improve', text: 'Intake forms change hands three times', author: 'Tomás R.', authorIsFac: false, cluster: handoffs, facOnly: false, x: 140, y: 180, idx: 0 },
      { id: 'nt_h2', frame: 'fr_to-improve', text: 'Nobody owns the Friday triage', author: 'Priya N.', authorIsFac: false, cluster: handoffs, facOnly: false, x: 140, y: 300, idx: 1 },
      { id: 'nt_h3', frame: 'fr_to-improve', text: 'Night shift hears about changes last', author: 'Ade K.', authorIsFac: false, cluster: handoffs, facOnly: false, x: 140, y: 420, idx: 2 },
      { id: 'nt_t1', frame: 'fr_to-improve', text: 'Two scheduling tools disagree', author: 'Tomás R.', authorIsFac: false, cluster: tooling, facOnly: false, x: 440, y: 180, idx: 0 },
      { id: 'nt_t2', frame: 'fr_to-improve', text: 'Search in the records app times out', author: 'Priya N.', authorIsFac: false, cluster: tooling, facOnly: false, x: 440, y: 300, idx: 1 },
      { id: 'nt_unc1', frame: 'fr_to-improve', text: 'Too many status meetings', author: 'Ade K.', authorIsFac: false, cluster: null, facOnly: false, x: 660, y: 520, idx: 0 },
      { id: 'nt_fac1', frame: 'fr_to-improve', text: 'Sponsor bristles at any mention of the scheduling vendor', author: 'Juno Marlowe', authorIsFac: true, cluster: null, facOnly: true, x: 660, y: 80, idx: 0 },
      { id: 'nt_act1', frame: 'fr_actions', text: 'Pilot a single triage owner for April', author: 'Juno Marlowe', authorIsFac: true, cluster: null, facOnly: false, x: 120, y: 90, idx: 0 },
    ];
    for (const n of notes) {
      await c.query(
        `insert into notes (id, workshop_id, frame_id, cluster_id, kind, text, image_id, x, y, revealed,
           facilitator_only, author_participant_id, author_facilitator, author_name, round_number, placement_index)
         values ($1,'ws_fernmoor',$2,$3,'text',$4,null,$5,$6,true,$7,$8,$9,$10,1,$11)`,
        [n.id, n.frame, n.cluster, n.text, n.x, n.y, n.facOnly,
          n.authorIsFac ? null : participantIdFor(n.author), n.authorIsFac, n.author, n.idx]);
    }
    await c.query(
      `insert into connectors (id, workshop_id, from_note_id, to_note_id) values ('cn_seed','ws_fernmoor','nt_h2','nt_act1')`);
  }
  // Workshop 3: Odile's Kestrel Foods (draft, strategy)
  await c.query(
    `insert into workshops (id, facilitator_id, title, template, status, scheduled_start, scheduled_end, sponsor_email, fee_cents, version)
     values ('ws_kestrel','fac_odile','Kestrel Foods — strategy offsite','strategy','draft',
             '2027-04-08T10:00','2027-04-08T16:00','ops@kestrelfoods.test',0,1)
     on conflict (id) do nothing`);
  // Template frames for seeded workshops when missing
  for (const [wsId, template] of [['ws_harbourline', 'discovery'], ['ws_kestrel', 'strategy']] as const) {
    await ensureTemplateFrames(c, wsId, template as TemplateCode);
  }
  await ensureTemplateFrames(c, 'ws_fernmoor', 'retrospective');
}

function participantIdFor(name: string): string {
  if (name === 'Priya N.') return 'pt_priya';
  if (name === 'Tomás R.') return 'pt_tomas';
  return 'pt_ade';
}

export async function ensureTemplateFrames(c: PoolClient, workshopId: string, template: TemplateCode): Promise<void> {
  const existing = await c.query('select count(*)::int as n from frames where workshop_id = $1', [workshopId]);
  if (existing.rows[0].n > 0) return;
  const titles = TEMPLATES[template];
  let i = 0;
  for (const title of titles) {
    await c.query(
      `insert into frames (id, workshop_id, title, x, y, width, height, position)
       values ($1,$2,$3,$4,0,800,600,$5)`,
      [`fr_${workshopId}_${slug(title)}`, workshopId, title, i * 900, i]);
    i += 1;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
