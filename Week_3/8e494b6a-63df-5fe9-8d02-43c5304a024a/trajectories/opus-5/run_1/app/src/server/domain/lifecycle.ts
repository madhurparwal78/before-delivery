import type { PoolClient } from 'pg';
import { nowMs } from '../clock.js';
import { query, transaction } from '../db.js';
import {
  explicitMappingsOf,
  generationsOf,
  serializeSegmentEvent,
  eventFromRow,
  type GenerationRow,
  type LifecyclePolicy,
  type Phase,
  type StreamRow,
} from '../store.js';
import { deleteObject, isStorageDown, putObject, segmentKey } from '../storage.js';
import { displayTime } from './tz.js';

const PHASE_ORDER: Phase[] = ['hot', 'warm', 'archive', 'deleted'];

export function phaseRank(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

/** The furthest phase a rolled-over generation's age allows. */
export function targetPhase(policy: LifecyclePolicy, ageMs: number): Phase {
  if (policy.delete_after_ms !== null && ageMs >= policy.delete_after_ms) return 'deleted';
  if (policy.archive_after_ms !== null && ageMs >= policy.archive_after_ms) return 'archive';
  if (policy.warm_after_ms !== null && ageMs >= policy.warm_after_ms) return 'warm';
  return 'hot';
}

export type NextStep = { step: string; at: number | null; events: number | null };

export function nextStepOf(
  stream: StreamRow,
  generation: GenerationRow,
): NextStep | null {
  const policy = stream.policy;
  if (generation.phase === 'deleted') return null;
  if (generation.number === stream.writeGeneration) {
    if (policy.rollover_max_age_ms !== null) {
      return { step: 'rollover', at: generation.becameWriteMs + policy.rollover_max_age_ms, events: null };
    }
    if (policy.rollover_max_events !== null) {
      return { step: 'rollover', at: null, events: policy.rollover_max_events };
    }
    return null;
  }
  const rolledOver = generation.rolledOverMs ?? generation.createdMs;
  const steps: { phase: Phase; after: number | null }[] = [
    { phase: 'warm', after: policy.warm_after_ms },
    { phase: 'archive', after: policy.archive_after_ms },
    { phase: 'deleted', after: policy.delete_after_ms },
  ];
  for (const step of steps) {
    if (step.after === null) continue;
    if (phaseRank(step.phase) <= phaseRank(generation.phase)) continue;
    return {
      step: step.phase === 'deleted' ? 'delete' : step.phase,
      at: rolledOver + step.after,
      events: null,
    };
  }
  return null;
}

export function timelineText(stream: StreamRow, generation: GenerationRow, zone: string): string {
  if (generation.phase === 'deleted') {
    return `Generation ${generation.number}, deleted, next: none`;
  }
  const next = nextStepOf(stream, generation);
  if (!next) return `Generation ${generation.number}, ${generation.phase}, next: none`;
  if (next.at === null) {
    return `Generation ${generation.number}, ${generation.phase}, next: ${next.step} at ${next.events} events`;
  }
  return `Generation ${generation.number}, ${generation.phase}, next: ${next.step} at ${displayTime(zone, next.at)}`;
}

export function serializeGeneration(
  stream: StreamRow,
  generation: GenerationRow,
  zone: string,
): Record<string, unknown> {
  const next = nextStepOf(stream, generation);
  return {
    number: generation.number,
    phase: generation.phase === 'deleted' ? 'deleted' : generation.phase,
    created_at: new Date(generation.createdMs).toISOString(),
    rolled_over_at: generation.rolledOverMs === null ? null : new Date(generation.rolledOverMs).toISOString(),
    events: generation.eventCount,
    next: next
      ? {
          step: next.step,
          at: next.at === null ? null : new Date(next.at).toISOString(),
        }
      : null,
    segment: generation.segmentKey
      ? { key: generation.segmentKey, bytes: generation.segmentBytes ?? 0 }
      : null,
    timeline: timelineText(stream, generation, zone),
    archive_failed: generation.archiveFailed,
    delete_failed: generation.deleteFailed,
  };
}

export type LifecycleOutcome = { notices: string[] };

async function archiveGeneration(
  spaceSlug: string,
  stream: StreamRow,
  generation: GenerationRow,
): Promise<'archived' | 'failed'> {
  const rows = await query(
    `select e.id, e.event_id, e.ts_ms, e.stored_ms, e.fields, e.raw, e.pipeline, g.number as generation, g.phase
     from events e join generations g on g.id = e.generation_id
     where e.generation_id = $1`,
    [generation.id],
  );
  const events = rows.map(eventFromRow).sort((left, right) => {
    if (left.tsMs !== right.tsMs) return left.tsMs - right.tsMs;
    return left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
  });
  const body = Buffer.from(events.map((event) => `${serializeSegmentEvent(event)}\n`).join(''), 'utf8');
  const key = segmentKey(spaceSlug, stream.name, generation.number);
  try {
    const bytes = await putObject(key, body);
    await transaction(async (client: PoolClient) => {
      await client.query(`delete from postings where generation_id = $1`, [generation.id]);
      await client.query(
        `delete from doc_lengths where event_row in (select id from events where generation_id = $1)`,
        [generation.id],
      );
      await client.query(`delete from events where generation_id = $1`, [generation.id]);
      await client.query(
        `update generations set phase = 'archive', segment_key = $2, segment_bytes = $3, archive_failed = false where id = $1`,
        [generation.id, key, bytes],
      );
    });
    return 'archived';
  } catch (cause) {
    if (!isStorageDown(cause)) throw cause;
    await query(
      `update generations set phase = case when phase = 'hot' then 'warm' else phase end, archive_failed = true where id = $1`,
      [generation.id],
    );
    return 'failed';
  }
}

async function deleteGeneration(generation: GenerationRow): Promise<'deleted' | 'failed'> {
  if (generation.phase === 'archive' && generation.segmentKey) {
    try {
      await deleteObject(generation.segmentKey);
    } catch (cause) {
      if (!isStorageDown(cause)) throw cause;
      await query(`update generations set delete_failed = true where id = $1`, [generation.id]);
      return 'failed';
    }
  }
  await transaction(async (client: PoolClient) => {
    await client.query(`delete from postings where generation_id = $1`, [generation.id]);
    await client.query(
      `delete from doc_lengths where event_row in (select id from events where generation_id = $1)`,
      [generation.id],
    );
    await client.query(`delete from events where generation_id = $1`, [generation.id]);
    await client.query(
      `update generations set phase = 'deleted', segment_key = null, segment_bytes = null, event_count = 0, delete_failed = false where id = $1`,
      [generation.id],
    );
  });
  return 'deleted';
}

/** One lifecycle step: roll over once, then move each rolled-over generation forward. */
export async function lifecycleStep(
  spaceSlug: string,
  stream: StreamRow,
): Promise<LifecycleOutcome> {
  const notices: string[] = [];
  const at = nowMs();
  const rolled = await transaction(async (client: PoolClient) => {
    const locked = await client.query<{ write_generation: number }>(
      `select write_generation from streams where id = $1 for update`,
      [stream.id],
    );
    const writeNumber = Number(locked.rows[0].write_generation);
    const current = await client.query(
      `select * from generations where stream_id = $1 and number = $2`,
      [stream.id, writeNumber],
    );
    const row = current.rows[0];
    if (!row) return false;
    const eventCount = Number(row.event_count);
    const becameWriteMs = Number(row.became_write_ms);
    const policy = stream.policy;
    const byAge =
      policy.rollover_max_age_ms !== null && at - becameWriteMs >= policy.rollover_max_age_ms;
    const byCount =
      policy.rollover_max_events !== null && eventCount >= policy.rollover_max_events;
    if (eventCount === 0 || (!byAge && !byCount)) return false;
    await client.query(`update generations set rolled_over_ms = $2 where id = $1`, [row.id, at]);
    const next = await client.query<{ id: number }>(
      `insert into generations (stream_id, number, phase, created_ms, became_write_ms)
       values ($1, $2, 'hot', $3, $3) returning id`,
      [stream.id, writeNumber + 1, at],
    );
    await client.query(`update streams set write_generation = $2 where id = $1`, [
      stream.id,
      writeNumber + 1,
    ]);
    const explicit = await explicitMappingsOf(Number(row.id));
    for (const [field, type] of explicit) {
      await client.query(
        `insert into mappings (generation_id, field, type, explicit) values ($1, $2, $3, true)
         on conflict (generation_id, field) do nothing`,
        [next.rows[0].id, field, type],
      );
    }
    return true;
  });
  if (rolled) stream.writeGeneration += 1;

  const generations = await generationsOf(stream.id);
  for (const generation of generations.sort((left, right) => left.number - right.number)) {
    if (generation.phase === 'deleted') continue;
    if (generation.rolledOverMs === null) continue;
    const age = at - generation.rolledOverMs;
    const target = targetPhase(stream.policy, age);
    if (phaseRank(target) <= phaseRank(generation.phase)) continue;
    let moved: GenerationRow = generation;
    if (phaseRank(target) >= phaseRank('warm') && generation.phase === 'hot' && target === 'warm') {
      await query(`update generations set phase = 'warm' where id = $1`, [generation.id]);
      continue;
    }
    if (target === 'archive') {
      const outcome = await archiveGeneration(spaceSlug, stream, moved);
      if (outcome === 'failed') notices.push('Archive failed. It will retry on the next step.');
      continue;
    }
    if (target === 'deleted') {
      if (phaseRank(moved.phase) < phaseRank('archive') && stream.policy.archive_after_ms !== null) {
        const archived = await archiveGeneration(spaceSlug, stream, moved);
        if (archived === 'failed') {
          notices.push('Archive failed. It will retry on the next step.');
          continue;
        }
        const reloaded = (await generationsOf(stream.id)).find((item) => item.id === generation.id);
        if (reloaded) moved = reloaded;
      }
      const outcome = await deleteGeneration(moved);
      if (outcome === 'failed') notices.push('Delete failed. It will retry on the next step.');
    }
  }
  return { notices };
}
