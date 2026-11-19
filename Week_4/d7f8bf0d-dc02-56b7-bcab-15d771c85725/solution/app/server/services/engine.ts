import { db, one, rows, transaction } from '../db'
import { applyTick } from '../domain/session/tick'
import { nextStatus, type SessionCause } from '../../shared/session-states'
import type { Outbox } from './outbox'
import { changeStatus, loadSession, saveSession } from './session-store'
import type { Valkey } from './valkey'

// Advances every Running session under its Valkey tick lease: one tick per 1,000 ms of Running time, each committed
// in one transaction with positions, occupancy, counters and its outbox row.

const STEP_MS = 100
const TICK_MS = 1000
const MIN_GAP_MS = 900
const INTERRUPT_AFTER_MS = 5000

interface RunningSession { id: string; since_ms: number }

export class Engine {
  readonly leases = new Set<string>()
  private stepping = false
  private recovered = false

  constructor(private readonly valkey: Valkey, private readonly outbox: Outbox) {
    valkey.onChange(up => {
      if (up) this.recovered = true
    })
  }

  start(): void {
    setInterval(() => void this.step(), STEP_MS)
  }

  private async step(): Promise<void> {
    if (this.stepping || !this.valkey.settled) return
    this.stepping = true
    try {
      if (!this.valkey.up) {
        this.leases.clear()
        await this.changeAll('Running', null, 'valkey_down')
        return
      }
      if (this.recovered) {
        this.recovered = false
        this.outbox.kick()
        await this.changeAll('Held', 'valkey', 'valkey_up')
      }
      const running = await rows<RunningSession>(db(),
        `select id, coalesce(extract(epoch from (clock_timestamp() - last_tick_at)) * 1000, 0) as since_ms from sessions where status = 'Running'`)
      const ids = new Set(running.map(session => session.id))
      for (const held of [...this.leases]) if (!ids.has(held)) this.leases.delete(held)
      await Promise.all(running.map(session => this.advance(session).catch(() => undefined)))
    } finally {
      this.stepping = false
    }
  }

  private async advance(session: RunningSession): Promise<void> {
    // A held lease is renewed with each tick, so between ticks there is nothing to ask Valkey.
    if (this.leases.has(session.id) && session.since_ms < TICK_MS - STEP_MS) return
    if (session.since_ms > INTERRUPT_AFTER_MS && (await this.valkey.leaseHolder(session.id)) === null) {
      await this.change(session.id, 'lease_lost')
      return
    }
    if (!(await this.valkey.holdLease(session.id))) {
      this.leases.delete(session.id)
      return
    }
    this.leases.add(session.id)
    if (session.since_ms >= TICK_MS) await this.commitTick(session.id)
  }

  private async commitTick(sessionId: string): Promise<void> {
    await transaction(async tx => {
      const row = await loadSession(tx.client, sessionId, true)
      if (row === undefined || row.status !== 'Running' || row.last_tick_at === null) return
      const since = await one<{ ms: number }>(tx.client, 'select extract(epoch from (clock_timestamp() - $1::timestamptz)) * 1000 as ms', [row.last_tick_at])
      if (since === undefined || since.ms < MIN_GAP_MS) return
      row.tick += 1
      const detail = applyTick(row.state, row.ratio, row.tick)
      row.last_tick_at = since.ms < 2 * TICK_MS ? new Date(row.last_tick_at.getTime() + TICK_MS) : new Date()
      await saveSession(tx, row, { type: 'tick.committed', detail })
    })
  }

  // Automatic changes: a Valkey outage holds sessions, its return resumes them, a lost lease interrupts.
  private async change(sessionId: string, cause: SessionCause): Promise<void> {
    await transaction(async tx => {
      const row = await loadSession(tx.client, sessionId, true)
      if (row === undefined) return
      if (cause === 'lease_lost') {
        const gap = await one<{ ms: number }>(tx.client, 'select coalesce(extract(epoch from (clock_timestamp() - $1::timestamptz)) * 1000, 0) as ms', [row.last_tick_at])
        if ((gap?.ms ?? 0) <= INTERRUPT_AFTER_MS) return
      }
      const next = nextStatus(row, cause)
      if (next === null) return
      await changeStatus(tx, row, next, { cause, from: row.status, to: next.status })
    })
  }

  private async changeAll(status: string, reason: string | null, cause: SessionCause): Promise<void> {
    const found = await rows<{ id: string }>(db(),
      `select id from sessions where status = $1 and ($2::text is null or hold_reason = $2)`, [status, reason])
    for (const session of found) await this.change(session.id, cause).catch(() => undefined)
  }
}
