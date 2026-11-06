import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { seedFiles, starterTip } from "../seed.js";

export class SeedService {
  async createSampleWorkspace(client: PoolClient, mentorId: string): Promise<{ projectId: string; checkpointIds: string[] }> {
    const projectId = crypto.randomUUID();
    const demoLearnerId = crypto.randomUUID();
    const starterId = crypto.randomUUID();
    const minute40Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO projects (id, title, kind, owner_id) VALUES ($1,$2,'one_to_one',$3)`,
      [projectId, "Sample: Tip Calculator", mentorId],
    );
    await client.query(
      `INSERT INTO memberships (project_id, user_id, role) VALUES ($1,$2,'mentor')`,
      [projectId, mentorId],
    );
    await client.query(
      `INSERT INTO users (id, email, name, kind, is_demo) VALUES ($1,NULL,'Robin Vale','learner',true)`,
      [demoLearnerId],
    );
    await client.query(
      `INSERT INTO memberships (project_id, user_id, role) VALUES ($1,$2,'student')`,
      [projectId, demoLearnerId],
    );
    const sessionId = crypto.randomUUID();
    await client.query(
      `INSERT INTO sessions (id, project_id, title, state, scheduled_for, driver_id, version)
       VALUES ($1,$2,'Sample session','scheduled',$3,NULL,0)`,
      [sessionId, projectId, new Date(Date.now() + 24 * 3600 * 1000)],
    );
    const seed = seedFiles();
    const fileIds: { path: string; id: string }[] = [];
    for (const f of seed) {
      const id = crypto.randomUUID();
      fileIds.push({ path: f.path, id });
      await client.query(
        `INSERT INTO files (id, project_id, path, revision, sha256, size, content)
         VALUES ($1,$2,$3,1,$4,$5,$6)`,
        [id, projectId, f.path, f.sha256, f.size, f.content],
      );
    }
    const idByPath = new Map(fileIds.map((f) => [f.path, f.id]));
    // checkpoints
    await client.query(
      `INSERT INTO checkpoints (id, project_id, name, state, created_by, file_count, created_at)
       VALUES ($1,$2,'Starter','pending_upload',$3,4, now() - interval '10 minutes')`,
      [starterId, projectId, mentorId],
    );
    await client.query(
      `INSERT INTO checkpoints (id, project_id, name, state, created_by, file_count, created_at)
       VALUES ($1,$2,'Minute 40','pending_upload',$3,4, now())`,
      [minute40Id, projectId, mentorId],
    );
    // Both checkpoints capture the same files by ID, as a real save does.
    for (const f of seed) {
      const isStarterTip = f.path === "src/tip.js";
      const content = isStarterTip ? starterTip() : f.content;
      const bytes = Buffer.from(content, "utf8");
      await client.query(
        `INSERT INTO checkpoint_files (checkpoint_id, file_id, path, sha256, size, content)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [starterId, idByPath.get(f.path) as string, f.path, sha(bytes), bytes.length, content],
      );
    }
    for (const f of seed) {
      const bytes = Buffer.from(f.content, "utf8");
      await client.query(
        `INSERT INTO checkpoint_files (checkpoint_id, file_id, path, sha256, size, content)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [minute40Id, idByPath.get(f.path) as string, f.path, sha(bytes), bytes.length, f.content],
      );
    }
    return { projectId, checkpointIds: [starterId, minute40Id] };
  }
}

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
