// Postgres: the schema, the seed, and loading the graph.

import pg from "pg";
import type { StatusKey } from "../shared/catalog.js";
import { config } from "./config.js";
import { cycleWindows, localDate, mondayOf, type CycleAnchor, type CycleWindow } from "./cycles.js";
import { TaskGraph, type TaskRow } from "./domain.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

type Queryable = pg.Pool | pg.PoolClient;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS sequence (id int PRIMARY KEY CHECK (id = 1), seq bigint NOT NULL);
INSERT INTO sequence (id, seq) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS cycles (
  key text PRIMARY KEY,
  name text NOT NULL,
  position int NOT NULL UNIQUE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz
);
CREATE TABLE IF NOT EXISTS tasks (
  number int PRIMARY KEY,
  title text NOT NULL,
  details text NOT NULL DEFAULT '',
  department text,
  label text,
  status text NOT NULL,
  priority int NOT NULL DEFAULT 0,
  owner text,
  cycle text REFERENCES cycles(key),
  parent int REFERENCES tasks(number),
  duplicate_of int REFERENCES tasks(number),
  request text UNIQUE,
  version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS links (
  blocker int NOT NULL REFERENCES tasks(number),
  blocked int NOT NULL REFERENCES tasks(number),
  PRIMARY KEY (blocker, blocked)
);
CREATE TABLE IF NOT EXISTS changes (
  seq bigint PRIMARY KEY,
  kind text NOT NULL,
  actor text,
  at timestamptz NOT NULL DEFAULT now(),
  undoable boolean NOT NULL,
  undone boolean NOT NULL DEFAULT false,
  journal jsonb,
  event jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_undo ON changes (actor, seq DESC) WHERE undoable AND NOT undone;
CREATE TABLE IF NOT EXISTS activity (
  id bigserial PRIMARY KEY,
  task int NOT NULL REFERENCES tasks(number),
  at timestamptz NOT NULL DEFAULT now(),
  actor text,
  kind text NOT NULL,
  changes jsonb NOT NULL,
  change bigint
);
CREATE INDEX IF NOT EXISTS activity_task ON activity (task, id);
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  ordinal bigserial,
  task int NOT NULL REFERENCES tasks(number),
  file_name text NOT NULL,
  kind text NOT NULL,
  size bigint NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_task ON attachments (task, ordinal);
CREATE TABLE IF NOT EXISTS idempotency (
  key text PRIMARY KEY,
  method text NOT NULL,
  path text NOT NULL,
  fingerprint text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

type SeedRow = [number, string, string, string | null, StatusKey, number, string | null, "R1" | "R2", number | null, number[]];

// Id, title, department, label, status, priority, owner, cycle, parent, blocked by.
const SEED: SeedRow[] = [
  [1, "Upstage door sticks on the swing", "carpentry", null, "todo", 2, "devi", "R1", null, []],
  [2, "Stair unit stage right creaks on the third tread", "carpentry", null, "todo", 3, "devi", "R1", null, []],
  [3, "Add a masking flat at the stage left sight line", "carpentry", null, "todo", 3, "devi", "R1", null, []],
  [4, "Trim the bottom rail of the stage right wing flat", "carpentry", null, "todo", 4, "devi", "R1", null, []],
  [5, "Rebuild the trap lid hinge", "carpentry", null, "in_progress", 2, "devi", "R1", null, []],
  [6, "Brace the balcony rail", "carpentry", null, "todo", 1, "devi", "R1", null, []],
  [7, "Add a kick plate to the porch door", "carpentry", null, "backlog", 4, null, "R1", null, []],
  [8, "Fix the wobble in the kitchen table leg", "carpentry", null, "todo", 3, "devi", "R1", null, []],
  [9, "Shim the window unit level", "carpentry", null, "todo", 4, "devi", "R1", null, []],
  [10, "Upstage door unit", "carpentry", null, "in_progress", 2, "devi", "R1", null, []],
  [11, "Re-hang the upstage door on rising butts", "carpentry", null, "done", 2, "devi", "R1", 10, []],
  [12, "Rebuild the upstage door flat", "carpentry", null, "in_progress", 1, "devi", "R1", 10, []],
  [13, "Repaint the upstage door flat", "paint", null, "todo", 2, "sasha", "R1", null, [12]],
  [14, "Touch up the back wall scumble around the door unit", "paint", null, "todo", 3, "sasha", "R1", null, [10]],
  [15, "Glue down the lifting floor cloth seam", "carpentry", null, "todo", 3, "devi", "R2", null, []],
  [16, "Add a handrail to the offstage escape stair", "carpentry", null, "todo", 2, "devi", "R2", null, []],
  [17, "Replace the cracked bench seat", "carpentry", null, "backlog", 4, null, "R2", null, []],
  [18, "Silence the casters on the bar wagon", "carpentry", null, "todo", 3, "devi", "R2", null, []],
  [19, "Re-cut the window shutter to clear the sill", "carpentry", null, "todo", 4, "devi", "R2", null, []],
  [20, "Fit a stop block to the revolve jack", "carpentry", null, "todo", 2, "devi", "R2", null, []],
  [21, "Focus: area 1 downstage left", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [22, "Focus: area 2 downstage centre", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [23, "Focus: area 3 downstage right", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [24, "Focus: area 4 upstage left", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [25, "Focus: area 5 upstage centre", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [26, "Focus: stage left boom after masking", "lighting", "focus", "todo", 3, "ines", "R1", null, [3]],
  [27, "Focus: porch door special", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [28, "Focus: window gobo", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [29, "Focus: kitchen table pool", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [30, "Focus: stair special", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [31, "Focus: trap special", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [32, "Focus: curtain call wash", "lighting", "focus", "todo", 3, "ines", "R1", null, []],
  [33, "Build the storm sequence cues 40 to 46", "lighting", "programming", "todo", 2, "ines", "R1", null, []],
  [34, "Slow the fade in cue 12", "lighting", "programming", "todo", 3, "ines", "R1", null, []],
  [35, "Add a preset for the preshow", "lighting", "programming", "backlog", 4, "ines", "R1", null, []],
  [36, "Replace the flickering lamp on the second electric", "lighting", "electrics", "in_progress", 2, "ines", "R1", null, []],
  [37, "Focus: upstage door special", "lighting", "focus", "todo", 2, "ines", "R1", null, [13]],
  [38, "Doorbell cue fires late in scene 4", "sound", "cues", "todo", 2, "kofi", "R1", null, []],
  [39, "Thunder cue too loud in the stalls", "sound", "cues", "todo", 3, "kofi", "R1", null, []],
  [40, "Hum on the stage left foldback speaker", "sound", "system", "in_progress", 1, "kofi", "R1", null, []],
  [41, "Build a platform for the quick-change booth", "carpentry", null, "todo", 2, "devi", "R2", null, [53]],
  [42, "Source a period telephone", "props", null, "in_progress", 3, "oren", "R1", null, []],
  [43, "Breakaway plate for the dinner scene", "props", null, "todo", 2, "oren", "R1", null, []],
  [44, "Add felt pads to the teacups", "props", null, "todo", 4, "oren", "R1", null, []],
  [45, "Preset the lantern on the porch table", "props", null, "backlog", 4, null, "R1", null, []],
  [46, "Focus: balcony specials", "lighting", "focus", "todo", 3, "ines", "R1", null, [6]],
  [47, "Re-rig the mic pack in the Act 1 coat lining", "sound", "system", "todo", 3, "kofi", "R1", null, [48]],
  [48, "Costume: Act 1 coat for Ada", "wardrobe", null, "in_progress", 2, "ruth", "R1", null, []],
  [49, "First fitting for the Act 1 coat", "wardrobe", "fitting", "done", 3, "ruth", "R1", 48, []],
  [50, "Take in the Act 1 coat at the side seams", "wardrobe", "alteration", "done", 3, "ruth", "R1", 48, []],
  [51, "Swap the coat hooks for a zip for the quick-change", "wardrobe", "quick-change", "in_progress", 2, "ruth", "R1", 48, []],
  [52, "Costume: Act 2 waistcoat for Jonah", "wardrobe", null, "todo", 3, "ruth", "R1", null, []],
  [53, "Confirm the quick-change booth size", "wardrobe", "quick-change", "todo", 2, "ruth", "R1", null, []],
  [54, "First fitting for the Act 2 waistcoat", "wardrobe", "fitting", "todo", 3, "ruth", "R1", 52, []],
  [55, "Let out the Act 2 waistcoat at the back seam", "wardrobe", "alteration", "todo", 4, "ruth", "R1", 52, []],
  [56, "Refresh the faded spike marks at the kitchen table", "props", null, "backlog", 3, null, "R1", null, []],
  [57, "Re-glue the loose banister cap", "carpentry", null, "backlog", 4, null, "R2", null, []],
  [58, "Fog machine for the storm scene", "lighting", null, "cancelled", 0, null, "R1", null, []],
  [59, "Replace the worn rug edge tape", "props", null, "backlog", 4, null, "R1", null, []],
  [60, "Set a battery change schedule for the radio mics", "sound", "system", "backlog", 4, null, "R1", null, []],
];

// Applies the schema, records the cycle anchor and seeds an empty database, then writes the five
// cycles the anchor spans, all in one transaction under a lock shared by every process on this database.
export const migrate = async (): Promise<{ anchor: CycleAnchor; windows: CycleWindow[] }> => {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7310041)");
    await client.query("BEGIN");
    await client.query(SCHEMA);
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM tasks");
    const empty = Number(rows[0].n) === 0;
    if (empty) {
      const now = new Date();
      await client.query(
        "INSERT INTO meta (key, value) VALUES ('first_start', $1), ('first_monday', $2) ON CONFLICT (key) DO NOTHING",
        [now.toISOString(), mondayOf(localDate(now))],
      );
    }
    const meta = await client.query<{ key: string; value: string }>("SELECT key, value FROM meta");
    const values = Object.fromEntries(meta.rows.map((r) => [r.key, r.value]));
    const anchor = { firstStart: new Date(values.first_start), firstMonday: values.first_monday };
    for (const [position, w] of cycleWindows(anchor).entries()) {
      await client.query(
        `INSERT INTO cycles (key, name, position, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET name = $2, position = $3, starts_at = $4, ends_at = $5`,
        [w.key, w.name, position, w.start, w.end],
      );
    }
    if (empty) await seed(client, anchor.firstStart);
    const cycles = await client.query<{ key: CycleWindow["key"]; name: string; starts_at: Date; ends_at: Date | null }>(
      "SELECT key, name, starts_at, ends_at FROM cycles ORDER BY position",
    );
    await client.query("COMMIT");
    return { anchor, windows: cycles.rows.map((c) => ({ key: c.key, name: c.name, start: c.starts_at, end: c.ends_at })) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(7310041)").catch(() => undefined);
    client.release();
  }
};

const seed = async (client: pg.PoolClient, now: Date): Promise<void> => {
  for (const [number, title, department, label, status, priority, owner, cycle, parent] of SEED) {
    await client.query(
      `INSERT INTO tasks (number, title, department, label, status, priority, owner, cycle, parent, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [number, title, department, label, status, priority, owner, cycle === "R1" ? "rehearsal-1" : "rehearsal-2", parent, now],
    );
  }
  for (const [number, , , , , , , , , blockers] of SEED) {
    for (const blocker of blockers) await client.query("INSERT INTO links (blocker, blocked) VALUES ($1, $2)", [blocker, number]);
  }
};

export const loadGraph = async (db: Queryable): Promise<TaskGraph> => {
  const tasks = await db.query<TaskRow>("SELECT * FROM tasks");
  const links = await db.query<{ blocker: number; blocked: number }>("SELECT blocker, blocked FROM links");
  return new TaskGraph(tasks.rows, links.rows.map((l) => [l.blocker, l.blocked] as const));
};

export const saveTask = async (db: Queryable, row: TaskRow, insert: boolean): Promise<void> => {
  const values = [
    row.number, row.title, row.details, row.department, row.label, row.status, row.priority, row.owner,
    row.cycle, row.parent, row.duplicate_of, row.request, row.version, row.updated_at,
  ];
  await db.query(
    insert
      ? `INSERT INTO tasks (number, title, details, department, label, status, priority, owner, cycle, parent,
           duplicate_of, request, version, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`
      : `UPDATE tasks SET title=$2, details=$3, department=$4, label=$5, status=$6, priority=$7, owner=$8, cycle=$9,
           parent=$10, duplicate_of=$11, request=$12, version=$13, updated_at=$14 WHERE number=$1`,
    values,
  );
};

export const currentSeq = async (db: Queryable): Promise<number> => {
  const { rows } = await db.query<{ seq: string }>("SELECT seq FROM sequence WHERE id = 1");
  return Number(rows[0].seq);
};
