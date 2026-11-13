/**
 * The transactional outbox. Each event is written in the same transaction as
 * the change it reports, so a rolled-back change emits nothing, and the
 * event id is the ledger event id Svix delivers under.
 */

import { randomUUID } from 'node:crypto';
import { writeInstant, type Queryable } from '../db/pool.ts';
import { apiAmount, apiHealthFactor } from '../domain/apiformat.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import type { PositionState } from '../domain/position.ts';
import type { Asset } from '../domain/assets.ts';

export type EventType = 'settlement.committed' | 'position.state_changed';

interface EventEnvelope {
  readonly event_id: string;
  readonly type: EventType;
  readonly position_id: string | null;
  readonly sequence: number | null;
  readonly occurred_at: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Takes the next sequence number for a position, counting from 1 with no
 * gaps across both event types. The caller holds the position's row lock.
 */
async function nextSequence(client: Queryable, positionId: string): Promise<number> {
  const result = await client.query<{ event_sequence: number }>(
    'UPDATE positions SET event_sequence = event_sequence + 1 WHERE position_id = $1 RETURNING event_sequence',
    [positionId],
  );
  const sequence = result.rows[0]?.event_sequence;
  if (sequence === undefined) throw new Error(`Unknown position ${positionId}`);
  return sequence;
}

async function insertEvent(
  client: Queryable,
  envelope: EventEnvelope,
  occurredAtMs: number,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (event_id, type, position_id, sequence, occurred_at,
                                payload, status, attempts, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', 0, $5, $5)`,
    [
      envelope.event_id,
      envelope.type,
      envelope.position_id,
      envelope.sequence,
      writeInstant(occurredAtMs),
      JSON.stringify(envelope),
    ],
  );
}

export interface SettlementEventInput {
  readonly eventId: string;
  readonly settlementId: string;
  readonly kind: 'draw' | 'withdrawal' | 'liquidation';
  readonly asset: Asset;
  readonly amount: bigint;
  readonly statementKey: string;
  /** Null for a liquidity withdrawal, which carries no position. */
  readonly positionId: string | null;
  readonly occurredAtMs: number;
}

/** One `settlement.committed` event. It is written before any state change. */
export async function emitSettlementCommitted(
  client: Queryable,
  input: SettlementEventInput,
): Promise<void> {
  const sequence =
    input.positionId === null ? null : await nextSequence(client, input.positionId);
  await insertEvent(
    client,
    {
      event_id: input.eventId,
      type: 'settlement.committed',
      position_id: input.positionId,
      sequence,
      occurred_at: formatCanonicalUtc(input.occurredAtMs),
      data: {
        settlement_id: input.settlementId,
        kind: input.kind,
        asset: input.asset,
        amount: apiAmount(input.amount),
        statement_key: input.statementKey,
      },
    },
    input.occurredAtMs,
  );
}

export interface StateChangeEventInput {
  readonly positionId: string;
  readonly from: PositionState | null;
  readonly to: PositionState;
  readonly healthFactorScaled: bigint | null;
  readonly graceEndsAtMs: number | null;
  /**
   * The instant of the change. For a grace expiry this is the grace end
   * itself, not the moment the server noticed.
   */
  readonly occurredAtMs: number;
}

/** One `position.state_changed` event. */
export async function emitPositionStateChanged(
  client: Queryable,
  input: StateChangeEventInput,
): Promise<string> {
  const eventId = randomUUID();
  const sequence = await nextSequence(client, input.positionId);
  await insertEvent(
    client,
    {
      event_id: eventId,
      type: 'position.state_changed',
      position_id: input.positionId,
      sequence,
      occurred_at: formatCanonicalUtc(input.occurredAtMs),
      data: {
        from: input.from,
        to: input.to,
        health_factor: apiHealthFactor(input.healthFactorScaled),
        grace_ends_at:
          input.graceEndsAtMs === null ? null : formatCanonicalUtc(input.graceEndsAtMs),
      },
    },
    input.occurredAtMs,
  );
  return eventId;
}
