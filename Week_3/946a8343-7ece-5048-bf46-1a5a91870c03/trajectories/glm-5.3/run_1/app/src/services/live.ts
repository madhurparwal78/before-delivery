import { PoolClient } from 'pg';
import type { DbClient } from '../db/db.js';

export type LiveType =
  | 'merge_request' | 'thread' | 'review' | 'approvals' | 'checks' | 'version'
  | 'pipeline' | 'job' | 'job_log' | 'train' | 'board' | 'issue' | 'epic'
  | 'milestone' | 'wiki' | 'environment' | 'deployment' | 'role' | 'presence'
  | 'export' | 'import' | 'instance';

export interface LiveMessage {
  seq: number;
  type: LiveType;
  data: Record<string, unknown>;
}

export type LiveListener = (m: LiveMessage) => void;

class Bus {
  private nextSub = 1;
  private subs = new Map<number, { project: number; listener: LiveListener }>();

  subscribe(project: number, listener: LiveListener): () => void {
    const id = this.nextSub++;
    this.subs.set(id, { project, listener });
    return () => this.subs.delete(id);
  }

  publish(project: number, m: LiveMessage): void {
    for (const s of this.subs.values()) {
      if (s.project === project) {
        try {
          s.listener(m);
        } catch {
          // listener errors don't affect the sender
        }
      }
    }
  }
}

export const bus = new Bus();

export class LiveLog {
  private perProject = new Map<number, { last: LiveMessage[] }>();

  async record(c: DbClient, projectId: number, type: LiveType, data: Record<string, unknown>, nowMs: number): Promise<number> {
    const r = await c.query<{ seq: bigint }>(
      `INSERT INTO live_messages (project_id, seq, type, data, created_at)
       VALUES ($1, COALESCE((SELECT max(seq) FROM live_messages WHERE project_id = $1), 0) + 1, $2, $3, $4)
       RETURNING seq`,
      [projectId, type, JSON.stringify(data), nowMs],
    );
    const seq = Number(r.rows[0].seq);
    const msg: LiveMessage = { seq, type, data };
    bus.publish(projectId, msg);
    const log = this.perProject.get(projectId);
    if (log) {
      log.last.push(msg);
      if (log.last.length > 1000) log.last.splice(0, log.last.length - 1000);
    }
    return seq;
  }

  attachMemory(projectId: number): void {
    if (!this.perProject.has(projectId)) this.perProject.set(projectId, { last: [] });
  }

  memory(projectId: number): LiveMessage[] | null {
    return this.perProject.get(projectId)?.last ?? null;
  }

  async catchUp(c: PoolClient | DbClient, projectId: number, since: number): Promise<{ messages: LiveMessage[]; resync: boolean }> {
    const r = await c.query<{ seq: string; type: string; data: Record<string, unknown> }>(
      `SELECT seq, type, data FROM live_messages WHERE project_id = $1 AND seq > $2 ORDER BY seq`,
      [projectId, since],
    );
    const all = r.rows.map((row) => ({ seq: Number(row.seq), type: row.type as LiveType, data: row.data }));
    if (all.length > 1000) return { messages: [], resync: true };
    return { messages: all, resync: false };
  }
}

export const liveLog = new LiveLog();
