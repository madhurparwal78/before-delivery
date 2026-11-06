import { randomUUID } from "node:crypto";
import type pg from "pg";
import { captureCheckpoint } from "./checkpoints.js";
import { sha256Hex } from "./storage.js";

const SAMPLE_TITLE = "Sample: Tip Calculator";
const DEMO_LEARNER = "Robin Vale";
const SESSION_TITLE = "Sample session";
const SESSION_LEAD_MS = 24 * 60 * 60 * 1000;

const FILES: Record<string, string> = {
  "README.md": "# Tip Calculator\n\nSplit a bill and add a tip. Run the tests with `node src/tip.test.js`.\n",
  "index.html": '<!doctype html>\n<title>Tip Calculator</title>\n<script type="module" src="src/tip.js"></script>\n',
  "src/tip.js": "export function tip(bill, percent) {\n  return Math.round(bill * percent) / 100;\n}\n",
  "src/tip.test.js": 'import { tip } from "./tip.js";\n\nconsole.assert(tip(50, 20) === 10, "20% of 50 is 10");\n',
};
const STARTER_TIP = "export function tip(bill, percent) {\n  return 0;\n}\n";

async function writeFile(db: pg.PoolClient, id: string, projectId: string, path: string, text: string): Promise<void> {
  const bytes = Buffer.from(text, "utf8");
  await db.query(
    `INSERT INTO files (id, project_id, path, content, sha256, size) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, sha256 = EXCLUDED.sha256, size = EXCLUDED.size`,
    [id, projectId, path, bytes, sha256Hex(bytes), bytes.length],
  );
}

/** The sample workspace a new mentor receives, created inside their account's transaction. Returns its checkpoint IDs. */
export async function seedSample(db: pg.PoolClient, mentorId: string, now: Date): Promise<string[]> {
  const projectId = randomUUID();
  const robinId = randomUUID();
  await db.query("INSERT INTO projects (id, title, kind, owner_id) VALUES ($1, $2, 'one_to_one', $3)", [projectId, SAMPLE_TITLE, mentorId]);
  await db.query("INSERT INTO users (id, email, name, kind) VALUES ($1, NULL, $2, 'learner')", [robinId, DEMO_LEARNER]);
  await db.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, 'mentor')", [projectId, mentorId]);
  await db.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, 'student')", [projectId, robinId]);
  await db.query(
    "INSERT INTO sessions (id, project_id, title, state, scheduled_for) VALUES ($1, $2, $3, 'scheduled', $4)",
    [randomUUID(), projectId, SESSION_TITLE, new Date(now.getTime() + SESSION_LEAD_MS)],
  );
  const ids = Object.fromEntries(Object.keys(FILES).map((path) => [path, randomUUID()]));
  for (const [path, text] of Object.entries(FILES)) {
    await writeFile(db, ids[path]!, projectId, path, path === "src/tip.js" ? STARTER_TIP : text);
  }
  const starter = await captureCheckpoint(db, projectId, mentorId, "Starter", now);
  await writeFile(db, ids["src/tip.js"]!, projectId, "src/tip.js", FILES["src/tip.js"]!);
  const minute40 = await captureCheckpoint(db, projectId, mentorId, "Minute 40", new Date(now.getTime() + 1));
  return [starter, minute40];
}
