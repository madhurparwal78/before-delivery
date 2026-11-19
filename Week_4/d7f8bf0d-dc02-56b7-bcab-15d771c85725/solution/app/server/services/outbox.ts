import type { Tx } from '../db'
import { db, rows } from '../db'
import type { Valkey } from './valkey'

// Every committed change is written to event_outbox in its own transaction, then published to its Valkey Stream
// in commit order with the entry ID <seq>-0. One instance drains at a time (advisory lock), oldest first.

const DRAIN_LOCK = 7_190_002

let wake: () => void = () => undefined

export async function writeOutbox(tx: Tx, stream: string, seq: number, type: string, payload: unknown): Promise<void> {
  await tx.client.query('insert into event_outbox (stream, seq, type, payload) values ($1, $2, $3, $4)', [stream, seq, type, JSON.stringify(payload)])
  tx.afterCommit.push(() => wake())
}

interface Pending { stream: string; seq: number; type: string; payload: unknown }

export class Outbox {
  private draining = false
  private again = false

  constructor(private readonly valkey: Valkey) {
    wake = () => this.kick()
  }

  start(): void {
    setInterval(() => this.kick(), 200)
  }

  kick(): void {
    if (this.draining) {
      this.again = true
      return
    }
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (!this.valkey.up) return
    this.draining = true
    const client = await db().connect()
    try {
      const got = await client.query('select pg_try_advisory_lock($1) as locked', [DRAIN_LOCK])
      if (!got.rows[0].locked) return
      try {
        do {
          this.again = false
          for (;;) {
            const batch = await rows<Pending>(client, 'select stream, seq, type, payload from event_outbox where published_at is null order by stream, seq limit 100')
            if (batch.length === 0) break
            for (const event of batch) {
              await this.valkey.publish(event.stream, event.seq, event.type, JSON.stringify(event.payload))
              await client.query('update event_outbox set published_at = now() where stream = $1 and seq = $2', [event.stream, event.seq])
            }
          }
        } while (this.again)
      } finally {
        await client.query('select pg_advisory_unlock($1)', [DRAIN_LOCK])
      }
    } catch {
      return
    } finally {
      client.release()
      this.draining = false
    }
  }
}
