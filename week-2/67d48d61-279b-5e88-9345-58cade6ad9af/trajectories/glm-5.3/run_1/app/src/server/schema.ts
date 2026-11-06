import type { Pool } from "pg";
import type { CycleConfig } from "../domain/cycles.js";
import { CYCLES, type Priority, type Status } from "../domain/model.js";

export const SCHEMA = `
create table if not exists tasks (
  number int primary key,
  title text not null,
  details text not null default '',
  department text not null,
  label text,
  status text not null,
  priority int not null default 0,
  owner text,
  cycle text,
  parent int references tasks(number),
  duplicate_of int,
  request text,
  version int not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists links (
  source int not null references tasks(number),
  target int not null references tasks(number),
  primary key (source, target)
);
create table if not exists activity (
  id bigserial primary key,
  task int not null,
  at timestamptz not null default now(),
  actor_handle text,
  kind text not null,
  changes jsonb not null,
  change int
);
create table if not exists journal (
  seq int primary key,
  kind text not null,
  actor text,
  undoable boolean not null default false,
  undone boolean not null default false
);
create table if not exists undo_journal (
  change int primary key,
  crew text not null,
  kind text not null,
  before jsonb not null,
  after_versions jsonb not null,
  cascade_json jsonb not null default '[]'
);
create table if not exists idempotency (
  key text not null,
  method text not null,
  path text not null,
  body_hash text not null,
  status int not null,
  body text not null,
  created timestamptz not null default now(),
  primary key (key, method, path, body_hash)
);
create table if not exists attachments (
  id uuid primary key,
  task int not null,
  file_name text not null,
  kind text not null,
  size bigint not null,
  content_type text not null,
  created_at timestamptz not null default now()
);
create table if not exists meta (
  key text primary key,
  value text not null
);
`;

interface SeedTask {
  n: number; title: string; dept: string; label: string | null; status: Status;
  pri: Priority; owner: string | null; cycle: string | null; parent: number | null;
}

const S = (n: number, title: string, dept: string, label: string | null, status: Status, pri: Priority, owner: string | null, cycle: string | null, parent: number | null = null): SeedTask =>
  ({ n, title, dept, label, status, pri, owner, cycle, parent });

const SEED_TASKS: SeedTask[] = [
  S(1, "Upstage door sticks on the swing", "carpentry", null, "todo", 2, "devi", "rehearsal-1"),
  S(2, "Stair unit stage right creaks on the third tread", "carpentry", null, "todo", 3, "devi", "rehearsal-1"),
  S(3, "Add a masking flat at the stage left sight line", "carpentry", null, "todo", 3, "devi", "rehearsal-1"),
  S(4, "Trim the bottom rail of the stage right wing flat", "carpentry", null, "todo", 4, "devi", "rehearsal-1"),
  S(5, "Rebuild the trap lid hinge", "carpentry", null, "in_progress", 2, "devi", "rehearsal-1"),
  S(6, "Brace the balcony rail", "carpentry", null, "todo", 1, "devi", "rehearsal-1"),
  S(7, "Add a kick plate to the porch door", "carpentry", null, "backlog", 4, null, "rehearsal-1"),
  S(8, "Fix the wobble in the kitchen table leg", "carpentry", null, "todo", 3, "devi", "rehearsal-1"),
  S(9, "Shim the window unit level", "carpentry", null, "todo", 4, "devi", "rehearsal-1"),
  S(10, "Upstage door unit", "carpentry", null, "in_progress", 2, "devi", "rehearsal-1"),
  S(11, "Re-hang the upstage door on rising butts", "carpentry", null, "done", 2, "devi", "rehearsal-1", 10),
  S(12, "Rebuild the upstage door flat", "carpentry", null, "in_progress", 1, "devi", "rehearsal-1", 10),
  S(13, "Repaint the upstage door flat", "paint", null, "todo", 2, "sasha", "rehearsal-1"),
  S(14, "Touch up the back wall scumble around the door unit", "paint", null, "todo", 3, "sasha", "rehearsal-1"),
  S(15, "Glue down the lifting floor cloth seam", "carpentry", null, "todo", 3, "devi", "rehearsal-2"),
  S(16, "Add a handrail to the offstage escape stair", "carpentry", null, "todo", 2, "devi", "rehearsal-2"),
  S(17, "Replace the cracked bench seat", "carpentry", null, "backlog", 4, null, "rehearsal-2"),
  S(18, "Silence the casters on the bar wagon", "carpentry", null, "todo", 3, "devi", "rehearsal-2"),
  S(19, "Re-cut the window shutter to clear the sill", "carpentry", null, "todo", 4, "devi", "rehearsal-2"),
  S(20, "Fit a stop block to the revolve jack", "carpentry", null, "todo", 2, "devi", "rehearsal-2"),
  S(21, "Focus: area 1 downstage left", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(22, "Focus: area 2 downstage centre", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(23, "Focus: area 3 downstage right", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(24, "Focus: area 4 upstage left", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(25, "Focus: area 5 upstage centre", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(26, "Focus: stage left boom after masking", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(27, "Focus: porch door special", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(28, "Focus: window gobo", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(29, "Focus: kitchen table pool", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(30, "Focus: stair special", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(31, "Focus: trap special", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(32, "Focus: curtain call wash", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(33, "Build the storm sequence cues 40 to 46", "lighting", "programming", "todo", 2, "ines", "rehearsal-1"),
  S(34, "Slow the fade in cue 12", "lighting", "programming", "todo", 3, "ines", "rehearsal-1"),
  S(35, "Add a preset for the preshow", "lighting", "programming", "backlog", 4, "ines", "rehearsal-1"),
  S(36, "Replace the flickering lamp on the second electric", "lighting", "electrics", "in_progress", 2, "ines", "rehearsal-1"),
  S(37, "Focus: upstage door special", "lighting", "focus", "todo", 2, "ines", "rehearsal-1"),
  S(38, "Doorbell cue fires late in scene 4", "sound", "cues", "todo", 2, "kofi", "rehearsal-1"),
  S(39, "Thunder cue too loud in the stalls", "sound", "cues", "todo", 3, "kofi", "rehearsal-1"),
  S(40, "Hum on the stage left foldback speaker", "sound", "system", "in_progress", 1, "kofi", "rehearsal-1"),
  S(41, "Build a platform for the quick-change booth", "carpentry", null, "todo", 2, "devi", "rehearsal-2"),
  S(42, "Source a period telephone", "props", null, "in_progress", 3, "oren", "rehearsal-1"),
  S(43, "Breakaway plate for the dinner scene", "props", null, "todo", 2, "oren", "rehearsal-1"),
  S(44, "Add felt pads to the teacups", "props", null, "todo", 4, "oren", "rehearsal-1"),
  S(45, "Preset the lantern on the porch table", "props", null, "backlog", 4, null, "rehearsal-1"),
  S(46, "Focus: balcony specials", "lighting", "focus", "todo", 3, "ines", "rehearsal-1"),
  S(47, "Re-rig the mic pack in the Act 1 coat lining", "sound", "system", "todo", 3, "kofi", "rehearsal-1"),
  S(48, "Costume: Act 1 coat for Ada", "wardrobe", null, "in_progress", 2, "ruth", "rehearsal-1"),
  S(49, "First fitting for the Act 1 coat", "wardrobe", "fitting", "done", 3, "ruth", "rehearsal-1", 48),
  S(50, "Take in the Act 1 coat at the side seams", "wardrobe", "alteration", "done", 3, "ruth", "rehearsal-1", 48),
  S(51, "Swap the coat hooks for a zip for the quick-change", "wardrobe", "quick-change", "in_progress", 2, "ruth", "rehearsal-1", 48),
  S(52, "Costume: Act 2 waistcoat for Jonah", "wardrobe", null, "todo", 3, "ruth", "rehearsal-1"),
  S(53, "Confirm the quick-change booth size", "wardrobe", "quick-change", "todo", 2, "ruth", "rehearsal-1"),
  S(54, "First fitting for the Act 2 waistcoat", "wardrobe", "fitting", "todo", 3, "ruth", "rehearsal-1", 52),
  S(55, "Let out the Act 2 waistcoat at the back seam", "wardrobe", "alteration", "todo", 4, "ruth", "rehearsal-1", 52),
  S(56, "Refresh the faded spike marks at the kitchen table", "props", null, "backlog", 3, null, "rehearsal-1"),
  S(57, "Re-glue the loose banister cap", "carpentry", null, "backlog", 4, null, "rehearsal-2"),
  S(58, "Fog machine for the storm scene", "lighting", null, "cancelled", 0, null, "rehearsal-1"),
  S(59, "Replace the worn rug edge tape", "props", null, "backlog", 4, null, "rehearsal-1"),
  S(60, "Set a battery change schedule for the radio mics", "sound", "system", "backlog", 4, null, "rehearsal-1"),
];

const SEED_LINKS: [number, number][] = [
  [12, 13], [10, 14], [3, 26], [13, 37], [53, 41], [6, 46], [48, 47],
];

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}

export async function seedIfEmpty(pool: Pool): Promise<boolean> {
  const r = await pool.query("select count(*)::int as n from tasks");
  if (r.rows[0].n > 0) return false;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(781273)");
    for (const t of SEED_TASKS) {
      await client.query(
        `insert into tasks (number, title, details, department, label, status, priority, owner, cycle, parent, version, updated_at)
         values ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,1,now())`,
        [t.n, t.title, t.dept, t.label, t.status, t.pri, t.owner, t.cycle, t.parent],
      );
    }
    for (const [s, t] of SEED_LINKS) {
      await client.query("insert into links (source, target) values ($1,$2)", [s, t]);
    }
    await client.query("insert into journal (seq, kind, actor, undoable, undone) values (1,'seed','promptside',false,false)");
    await client.query("commit");
    return true;
  } catch (e) {
    try { await client.query("rollback") } catch { /* already aborted */ }
    throw e;
  } finally {
    client.release();
  }
}

export const CYCLE_KEYS = CYCLES.map((c) => c.key);
