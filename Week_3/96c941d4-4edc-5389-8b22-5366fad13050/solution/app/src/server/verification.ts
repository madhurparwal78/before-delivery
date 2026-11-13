import { CAMPAIGN } from '../shared/constants.js';
import { runCommandLog } from '../shared/simulation.js';
import type { Command, Definition, Metrics, SimulationConfig, Transfer } from '../shared/types.js';
import { runSources, proofSources, proofDestination, runDestination } from './transitions.js';
import type { ProofState } from './transitions.js';
import { ApiError } from './errors.js';
import { requireObjects, requireStore } from './app.js';
import type { AppContext } from './app.js';
import {
  canonicalDefinitionText,
  canonicalEvidenceText,
  digestOfText,
  evidenceJson,
} from './digests.js';
import { ObjectStoreError, evidenceObjectKey, levelObjectKey } from './objects.js';
import type { RunRecord, StoredTicket } from './store.js';
import { canonicalize } from '../shared/canonical.js';

const decoder = new TextDecoder();

interface ConfirmedEvidence {
  definition: Definition;
  commands: Command[];
  endTick: number;
}

/**
 * Writes the immutable definition and evidence objects, then reads both exact objects back and
 * validates their digests. Returns null when object access is unavailable.
 */
export async function confirmEvidenceObjects(
  context: AppContext,
  ticket: StoredTicket,
  commands: Command[],
  endTick: number,
  expectedEvidenceDigest: string,
  restoreObjects = true,
): Promise<ConfirmedEvidence | null> {
  const definitionText = canonicalDefinitionText(ticket.definition);
  const evidenceText = canonicalEvidenceText(commands, endTick);
  try {
    const objects = requireObjects(context);
    if (restoreObjects) {
    await objects.putImmutable(levelObjectKey(ticket.levelDigest), Buffer.from(definitionText, 'utf8'));
    await objects.putImmutable(
      evidenceObjectKey(expectedEvidenceDigest),
      Buffer.from(evidenceText, 'utf8'),
    );
    }
    const storedDefinition = await objects.get(levelObjectKey(ticket.levelDigest));
    const storedEvidence = await objects.get(evidenceObjectKey(expectedEvidenceDigest));
    if (storedDefinition === null || storedEvidence === null) return null;
    const definitionBytes = decoder.decode(storedDefinition);
    const evidenceBytes = decoder.decode(storedEvidence);
    if (digestOfText(definitionBytes) !== ticket.levelDigest) return null;
    if (digestOfText(evidenceBytes) !== expectedEvidenceDigest) return null;
    const definition = JSON.parse(definitionBytes) as Definition;
    const evidence = JSON.parse(evidenceBytes) as { commands: Command[]; endTick: number };
    if (canonicalize(evidenceJson(evidence.commands, evidence.endTick)) !== evidenceBytes) return null;
    return { definition, commands: evidence.commands, endTick: evidence.endTick };
  } catch (error) {
    if (error instanceof ObjectStoreError || (error instanceof ApiError && error.code === 'EVIDENCE_UNAVAILABLE')) return null;
    throw error;
  }
}

export function simulationConfigOf(ticket: StoredTicket, definition: Definition): SimulationConfig {
  return {
    definition,
    loadout: ticket.loadout,
    initialReserve: ticket.initialReserve,
    initialHealth: ticket.initialHealth,
  };
}

interface Reproduction {
  metrics: Metrics | null;
  failure: { tick: number; seq: number | null; reason: string } | null;
  ledger: Transfer[];
  lastAvailableTick: number;
}

export function reproduce(ticket: StoredTicket, evidence: ConfirmedEvidence): Reproduction {
  const config = simulationConfigOf(ticket, evidence.definition);
  const outcome = runCommandLog(config, evidence.commands, evidence.endTick);
  if (outcome.terminal === null) {
    return {
      metrics: null,
      failure: outcome.failure,
      ledger: outcome.ledger,
      lastAvailableTick: outcome.lastAvailableTick,
    };
  }
  const terminal = outcome.terminal;
  return {
    metrics: {
      outcome: terminal.outcome as Metrics['outcome'],
      breaches: terminal.breaches,
      completionTick: terminal.tick,
      remainingCharge: terminal.reserve,
      health: terminal.health,
    },
    failure: null,
    ledger: outcome.ledger,
    lastAvailableTick: outcome.lastAvailableTick,
  };
}

/** Commits one terminal result together with its ledger and qualifying effects. */
export async function commitTerminalResult(
  context: AppContext,
  ticket: StoredTicket,
  reproduction: Reproduction,
): Promise<RunRecord> {
  const store = await requireStore(context);
  const accepted = reproduction.metrics !== null;
  const state = runDestination('verifying', 'finish', accepted);
  await store.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('squallglass-result-commit'))");
    if (ticket.mode === 'playtest') await client.query('SELECT id FROM levels WHERE id = $1 FOR UPDATE', [ticket.sourceId]);
    await client.query("UPDATE runs SET state = 'verifying' WHERE id = $1 AND state = ANY($2::text[])", [ticket.id, runSources.begin]);
    await client.query("UPDATE proofs SET state = 'verifying' WHERE run_id = $1 AND state = ANY($2::text[])", [ticket.id, proofSources.begin]);
    const updated = await client.query(
      `UPDATE runs SET state = $2, outcome = $3, breaches = $4, completion_tick = $5, remaining_charge = $6, health = $7, failure = $8, last_available_tick = $9, committed_at = now(), commit_seq = nextval(pg_get_serial_sequence('runs','commit_seq'))
       WHERE id = $1 AND state = ANY($10::text[])`,
      [
        ticket.id,
        state,
        reproduction.metrics?.outcome ?? null,
        reproduction.metrics?.breaches ?? null,
        reproduction.metrics?.completionTick ?? null,
        reproduction.metrics?.remainingCharge ?? null,
        reproduction.metrics?.health ?? null,
        reproduction.failure === null ? null : JSON.stringify(reproduction.failure),
        reproduction.lastAvailableTick,
        runSources.finish,
      ],
    );
    if ((updated.rowCount ?? 0) !== 1) return;

    const entries = reproduction.ledger;
    const chunkSize = 400;
    for (let offset = 0; offset < entries.length; offset += chunkSize) {
      const chunk = entries.slice(offset, offset + chunkSize);
      const values: unknown[] = [];
      const placeholders = chunk.map((entry, index) => {
        const base = index * 8;
        values.push(
          ticket.id,
          offset + index,
          entry.movementId,
          entry.tick,
          entry.account,
          entry.delta,
          entry.reason,
          entry.deviceId,
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
      });
      await client.query(
        `INSERT INTO ledger_entries (run_id, ordinal, movement_id, tick, account, delta, reason, device_id)
         VALUES ${placeholders.join(',')}`,
        values,
      );
    }

    const victory = accepted && (reproduction.metrics as Metrics).outcome === 'victory';

    if (ticket.mode === 'campaign' && victory) {
      await client.query(
        `INSERT INTO completions (account_id, encounter_id, run_id) VALUES ($1,$2,$3)
         ON CONFLICT (account_id, encounter_id) DO NOTHING`,
        [ticket.accountId, ticket.sourceId, ticket.id],
      );
    }

    if (ticket.mode === 'playtest') {
      const proof = await client.query<{ level_id: string; revision: number; state: ProofState }>(
        `SELECT level_id, revision, state FROM proofs WHERE run_id = $1 AND state = ANY($2::text[])`,
        [ticket.id, proofSources.finish],
      );
      const row = proof.rows[0];
      if (row !== undefined) {
        const level = await client.query<{ revision: number; state: string; proof_run_id: string | null }>(
          'SELECT revision, state, proof_run_id FROM levels WHERE id = $1 FOR UPDATE',
          [row.level_id],
        );
        const current = level.rows[0];
        const proofState = proofDestination(row.state, 'finish', victory, current.revision === row.revision);
        await client.query(`UPDATE proofs SET state = $2 WHERE run_id = $1 AND state = ANY($3::text[])`, [
          ticket.id,
          proofState,
          proofSources.finish,
        ]);
        if (proofState === 'qualified' && current.state === 'private' && current.proof_run_id === null) {
          await client.query(
            `UPDATE levels SET proof_run_id = $2 WHERE id = $1 AND state = 'private' AND proof_run_id IS NULL`,
            [row.level_id, ticket.id],
          );
        }
      }
    }

    if (accepted && ticket.mode !== 'playtest') {
      await client.query(
        'INSERT INTO presentations (run_id, version, tick, playing) VALUES ($1,0,0,false) ON CONFLICT (run_id) DO NOTHING',
        [ticket.id],
      );
    }
  });
  return (await store.run(ticket.id)) as RunRecord;
}

export function campaignUnlocks(completed: string[]): { completed: string[]; unlocked: string[] } {
  const completedSet = new Set(completed);
  const unlocked = new Set<string>([CAMPAIGN[0].id]);
  CAMPAIGN.forEach((encounter, index) => {
    if (!completedSet.has(encounter.id)) return;
    unlocked.add(encounter.id);
    const next = CAMPAIGN[index + 1];
    if (next !== undefined) unlocked.add(next.id);
  });
  return {
    completed: CAMPAIGN.filter((encounter) => completedSet.has(encounter.id)).map((e) => e.id),
    unlocked: CAMPAIGN.filter((encounter) => unlocked.has(encounter.id)).map((e) => e.id),
  };
}
