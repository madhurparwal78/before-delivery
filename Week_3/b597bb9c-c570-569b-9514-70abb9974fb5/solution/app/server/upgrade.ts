import { rateOf } from "../shared/rational";
import { pool, query, tx, type Db } from "./db";
import { captionFromRow, clipFromRow, framesOfSeconds, loadProjectRow, markerFromRow } from "./timeline/store";
import type pg from "pg";

/** Converts one project from seconds to frames in a single transaction; a project already in frames is left alone. */
export async function upgradeProject(client: pg.PoolClient, projectId: string): Promise<void> {
  const project = await loadProjectRow(client, projectId, true);
  if (!project || project.time_unit !== "seconds") return;
  const rate = rateOf(project.frame_rate);
  const clips = await query<Parameters<typeof clipFromRow>[0]>("SELECT * FROM clips WHERE project_id = $1 AND legacy IS NOT NULL", [projectId], client);
  for (const row of clips) {
    const clip = clipFromRow(row, rate);
    await client.query(
      "UPDATE clips SET start_frame=$2, end_frame=$3, source_in=$4, source_out=$5, legacy=NULL WHERE id=$1",
      [clip.id, clip.start_frame, clip.end_frame, clip.source_in, clip.source_out],
    );
  }
  const captions = await query<Parameters<typeof captionFromRow>[0]>("SELECT * FROM captions WHERE project_id = $1 AND legacy IS NOT NULL", [projectId], client);
  for (const row of captions) {
    const caption = captionFromRow(row, rate);
    await client.query("UPDATE captions SET start_frame=$2, end_frame=$3, legacy=NULL WHERE id=$1", [caption.id, caption.start_frame, caption.end_frame]);
  }
  const markers = await query<Parameters<typeof markerFromRow>[0] & { id: number }>("SELECT id, frame, label, legacy FROM markers WHERE project_id = $1 AND legacy IS NOT NULL", [projectId], client);
  for (const row of markers) {
    await client.query("UPDATE markers SET frame=$2, legacy=NULL WHERE id=$1", [row.id, markerFromRow(row, rate).frame]);
  }
  const pins = await query<{ id: string; legacy: number }>("SELECT id, legacy FROM comments WHERE project_id = $1 AND legacy IS NOT NULL", [projectId], client);
  for (const pin of pins) {
    await client.query("UPDATE comments SET pin_frame = $2, legacy = NULL WHERE id = $1", [pin.id, framesOfSeconds(rate, pin.legacy)]);
  }
  await client.query("UPDATE projects SET time_unit = 'frames' WHERE id = $1", [projectId]);
}

/** Runs at every start: each project still stored in seconds is upgraded once. */
export async function upgradeOlderProjects(): Promise<void> {
  const older = await query<{ id: string }>("SELECT id FROM projects WHERE time_unit = 'seconds'", [], pool as Db);
  for (const { id } of older) await tx((client) => upgradeProject(client, id));
}
