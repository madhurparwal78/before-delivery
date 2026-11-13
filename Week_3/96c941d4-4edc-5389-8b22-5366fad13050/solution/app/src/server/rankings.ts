import { DEVICE_IDS, USAGE_SCALE } from '../shared/constants.js';
import type { Command, Metrics } from '../shared/types.js';

interface QualifyingResult {
  runId: string;
  accountId: string;
  playerName: string;
  metrics: Metrics;
  commitSeq: number;
  commands: Command[];
}

interface BoardRow {
  rank: number;
  accountId: string;
  playerName: string;
  runId: string;
  breaches: number;
  completionTick: number;
  remainingCharge: number;
}

interface Usage {
  device: string;
  deployments: number;
  tenthsPercent: number;
}

interface Board {
  digest: string;
  ruleset: string;
  rows: BoardRow[];
  personalBest: BoardRow | null;
  completions: number;
  crewUsage: Usage[];
}

function compareMetrics(a: Metrics, b: Metrics): number {
  return (
    a.breaches - b.breaches ||
    a.completionTick - b.completionTick ||
    b.remainingCharge - a.remainingCharge
  );
}

function selectBestPerAccount(results: QualifyingResult[]): QualifyingResult[] {
  const best = new Map<string, QualifyingResult>();
  for (const result of results) {
    const current = best.get(result.accountId);
    if (current === undefined) {
      best.set(result.accountId, result);
      continue;
    }
    const comparison = compareMetrics(result.metrics, current.metrics);
    if (comparison < 0 || (comparison === 0 && result.commitSeq < current.commitSeq)) {
      best.set(result.accountId, result);
    }
  }
  return [...best.values()];
}

/** Distributes deploy counts into tenths of a percent using largest remainders. */
function crewUsageOf(selected: QualifyingResult[]): Usage[] {
  const counts = new Map<string, number>(DEVICE_IDS.map((id) => [id, 0]));
  for (const result of selected) {
    for (const command of result.commands) {
      if (command.type !== 'deploy' || command.device === null) continue;
      counts.set(command.device, (counts.get(command.device) as number) + 1);
    }
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return DEVICE_IDS.map((device) => ({ device, deployments: 0, tenthsPercent: 0 }));
  }
  const base = DEVICE_IDS.map((device, order) => {
    const deployments = counts.get(device) as number;
    const scaled = deployments * USAGE_SCALE;
    return {
      device,
      order,
      deployments,
      tenthsPercent: Math.floor(scaled / total),
      remainder: scaled % total,
    };
  });
  let distributed = base.reduce((sum, row) => sum + row.tenthsPercent, 0);
  const ordered = [...base].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (const row of ordered) {
    if (distributed >= USAGE_SCALE) break;
    row.tenthsPercent += 1;
    distributed += 1;
  }
  return base.map((row) => ({
    device: row.device,
    deployments: row.deployments,
    tenthsPercent: row.tenthsPercent,
  }));
}

/** Derives ranks, personal best, completions and crew usage from the same qualifying results. */
export function computeBoard(
  digest: string,
  ruleset: string,
  results: QualifyingResult[],
  viewerAccountId: string | null,
): Board {
  const selected = selectBestPerAccount(results);
  const ordered = [...selected].sort(
    (a, b) => compareMetrics(a.metrics, b.metrics) || (a.accountId < b.accountId ? -1 : 1),
  );
  const rows: BoardRow[] = [];
  let rank = 0;
  ordered.forEach((result, index) => {
    const previous = index === 0 ? null : ordered[index - 1];
    if (previous === null || compareMetrics(result.metrics, previous.metrics) !== 0) rank = index + 1;
    rows.push({
      rank,
      accountId: result.accountId,
      playerName: result.playerName,
      runId: result.runId,
      breaches: result.metrics.breaches,
      completionTick: result.metrics.completionTick,
      remainingCharge: result.metrics.remainingCharge,
    });
  });
  return {
    digest,
    ruleset,
    rows,
    personalBest:
      viewerAccountId === null ? null : (rows.find((row) => row.accountId === viewerAccountId) ?? null),
    completions: selected.length,
    crewUsage: crewUsageOf(selected),
  };
}
