// The train_cars table: reads and writes of car rows, and the system user that owns speculative commits.
import type { Queryable } from "../db.ts";
import { now } from "../clock.ts";
import type { Person } from "../repo/types.ts";

export const TRAIN_USER = "spurline-train";

export interface CarRow {
  readonly id: number;
  readonly project_id: number;
  readonly target: string;
  readonly mr_id: number;
  readonly mr_iid: number;
  readonly source: string;
  readonly author: string;
  readonly added_by: number;
  readonly position: number;
  readonly sha: string;
  readonly base_sha: string;
  readonly source_sha: string;
  readonly pipeline_id: number | null;
  readonly pipeline_at: number | null;
}

interface NewCar {
  readonly projectId: number;
  readonly target: string;
  readonly mrId: number;
  readonly iid: number;
  readonly source: string;
  readonly author: string;
  readonly addedBy: number;
  readonly sha: string;
  readonly baseSha: string;
  readonly sourceSha: string;
  readonly pipelineId: number | null;
}

export async function listCars(q: Queryable, projectId: number, target: string): Promise<CarRow[]> {
  return q.q<CarRow>("SELECT * FROM train_cars WHERE project_id = $1 AND target = $2 ORDER BY position, id", [projectId, target]);
}

export async function carByRequest(q: Queryable, projectId: number, mrId: number): Promise<CarRow | undefined> {
  return q.maybe<CarRow>("SELECT * FROM train_cars WHERE project_id = $1 AND mr_id = $2", [projectId, mrId]);
}

export async function carByIid(q: Queryable, projectId: number, iid: number): Promise<CarRow | undefined> {
  return q.maybe<CarRow>("SELECT * FROM train_cars WHERE project_id = $1 AND mr_iid = $2", [projectId, iid]);
}

export async function carByPipeline(q: Queryable, projectId: number, pipelineId: number): Promise<CarRow | undefined> {
  return q.maybe<CarRow>("SELECT * FROM train_cars WHERE project_id = $1 AND pipeline_id = $2", [projectId, pipelineId]);
}

export async function carsAtSource(q: Queryable, projectId: number, source: string): Promise<CarRow[]> {
  return q.q<CarRow>("SELECT * FROM train_cars WHERE project_id = $1 AND source = $2 ORDER BY target, position", [projectId, source]);
}

export async function targetHasCars(q: Queryable, projectId: number, target: string): Promise<boolean> {
  return (await q.maybe("SELECT 1 FROM train_cars WHERE project_id = $1 AND target = $2 LIMIT 1", [projectId, target])) !== undefined;
}

export async function insertCar(q: Queryable, car: NewCar, position: number): Promise<CarRow> {
  return q.one<CarRow>(
    `INSERT INTO train_cars (project_id, target, mr_id, mr_iid, source, author, added_by, position, sha, base_sha, source_sha, pipeline_id, pipeline_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [car.projectId, car.target, car.mrId, car.iid, car.source, car.author, car.addedBy, position, car.sha, car.baseSha, car.sourceSha,
      car.pipelineId, car.pipelineId === null ? null : now()],
  );
}

export async function rebuildRow(
  q: Queryable,
  carId: number,
  built: { sha: string; baseSha: string; sourceSha: string; pipelineId: number | null },
): Promise<void> {
  await q.q(
    "UPDATE train_cars SET sha = $2, base_sha = $3, source_sha = $4, pipeline_id = $5, pipeline_at = $6 WHERE id = $1",
    [carId, built.sha, built.baseSha, built.sourceSha, built.pipelineId, built.pipelineId === null ? null : now()],
  );
}

export async function deleteCar(q: Queryable, carId: number): Promise<void> {
  await q.q("DELETE FROM train_cars WHERE id = $1", [carId]);
}

export async function renumber(q: Queryable, projectId: number, target: string): Promise<void> {
  await q.q(
    `UPDATE train_cars SET position = ordered.n
       FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS n FROM train_cars WHERE project_id = $1 AND target = $2) ordered
      WHERE train_cars.id = ordered.id`,
    [projectId, target],
  );
}

export async function carsDueBefore(q: Queryable, createdBefore: number): Promise<CarRow[]> {
  return q.q<CarRow>("SELECT * FROM train_cars WHERE pipeline_id IS NOT NULL AND pipeline_at <= $1 ORDER BY pipeline_at, id", [createdBefore]);
}

export async function trainActor(q: Queryable): Promise<Person> {
  await q.q(
    "INSERT INTO users (username, password, time_zone, created_at) VALUES ($1, NULL, 'UTC', $2) ON CONFLICT (username) DO NOTHING",
    [TRAIN_USER, now()],
  );
  const user = await q.one<{ id: number }>("SELECT id FROM users WHERE username = $1", [TRAIN_USER]);
  return { id: user.id, username: TRAIN_USER };
}

export async function personById(q: Queryable, userId: number): Promise<Person> {
  const user = await q.one<{ id: number; username: string }>("SELECT id, username FROM users WHERE id = $1", [userId]);
  return { id: user.id, username: user.username };
}
