import { pool } from '../db/pool.js';

export interface InstanceRow {
  id: string;
  port: number;
  up: boolean;
}

export async function registerInstance(id: string, port: number): Promise<void> {
  await pool.query(
    `insert into instances (id, pid, port, up, last_seen_at) values ($1, $2, $3, true, now())
     on conflict (id) do update set pid = $2, port = $3, up = true, last_seen_at = now()`,
    [id, process.pid, port],
  );
}

export async function heartbeat(id: string): Promise<void> {
  await pool.query(`update instances set last_seen_at = now(), up = true where id = $1`, [id]);
}

export async function liveInstances(): Promise<InstanceRow[]> {
  const { rows } = await pool.query<InstanceRow>(
    `select id, port, (last_seen_at > now() - interval '5 seconds') as up
     from instances order by id`,
  );
  return rows;
}
