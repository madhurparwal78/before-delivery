import { PROVIDER_TIMEOUT_MS, config } from '../config';

export class ScoreUnavailable extends Error {}

export class ScoreBusy extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('the score service is busy');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ScoreBody {
  gtin: string;
  garment: string;
  massGrams: string;
  washes: number;
  materials: { id: string; sharePercent: string; tier1: string; tier2: string; tier3: string }[];
  repairService: boolean;
  rangeSize: number;
}

export interface ScoreAnswer {
  score: number;
  per100g: number;
  runId: string;
}

/** The national textile score, asked of the score service alone. */
export async function askForScore(body: ScoreBody): Promise<ScoreAnswer> {
  let answer: Response;
  try {
    answer = await fetch(`${config.wiremockUrl}/v1/textile/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new ScoreUnavailable('the score service did not answer in time');
  }
  if (answer.status === 429) {
    const header = answer.headers.get('retry-after');
    const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : 60;
    throw new ScoreBusy(seconds);
  }
  if (!answer.ok) throw new ScoreUnavailable(`the score service answered ${answer.status}`);
  let parsed: { score?: unknown; per100g?: unknown; runId?: unknown };
  try {
    parsed = (await answer.json()) as typeof parsed;
  } catch {
    throw new ScoreUnavailable('the score service answered something other than JSON');
  }
  if (
    typeof parsed.score !== 'number' ||
    typeof parsed.per100g !== 'number' ||
    typeof parsed.runId !== 'string'
  ) {
    throw new ScoreUnavailable('the score service answered something other than a score');
  }
  return { score: parsed.score, per100g: parsed.per100g, runId: parsed.runId };
}
