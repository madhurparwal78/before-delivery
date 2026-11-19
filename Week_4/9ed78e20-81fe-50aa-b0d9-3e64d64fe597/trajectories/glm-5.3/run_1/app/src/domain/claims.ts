import {
  type ClaimFailure,
  findNumbersInClaimText,
  numbersEqual,
  parseScore,
  recordedDelta,
  type ClaimInput,
  type RowView,
} from './lifecycles.js';

export type ValidationRow = RowView;

export type ClaimCheckInput = {
  routeSlug: string;
  routeTitle: string;
  body: string;
  claims: ClaimInput[];
  comparatorNames: Record<string, string>;
  rows: ValidationRow[];
};

/**
 * The one place that decides claim validation. Each claim is checked against the
 * recorded benchmark rows; failures carry a reason per the business rules.
 */
export function validateClaims(input: ClaimCheckInput): { valid: boolean; results: ClaimFailure[]; bodyIssues: string[] } {
  const results: ClaimFailure[] = [];
  const bodyIssues: string[] = [];
  const definedIds = new Set(input.claims.map((c) => c.id));
  const bodyMarkers = new Set<string>();
  const markerRe = /\[claim:([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(input.body)) !== null) {
    bodyMarkers.add(m[1]);
    if (!definedIds.has(m[1])) {
      bodyIssues.push(`The body marks claim ${m[1]}, which is not defined.`);
    }
  }
  const usedInBody = new Set<string>();
  for (const claim of input.claims) {
    if (bodyMarkers.has(claim.id)) usedInBody.add(claim.id);
  }
  for (const claim of input.claims) {
    const failure = checkClaim(claim, input);
    if (failure) results.push({ claim: claim.id, ok: false, reason: failure });
    else results.push({ claim: claim.id, ok: true, reason: 'ok' });
  }
  const valid = results.every((r) => r.ok) && bodyIssues.length === 0;
  return { valid, results, bodyIssues };
}

function checkClaim(claim: ClaimInput, input: ClaimCheckInput): string | null {
  const modelRow = input.rows.find(
    (r) => r.subject === input.routeSlug && r.benchmark === claim.benchmark && r.eval_date === claim.eval_date,
  );
  if (!modelRow) return `No recorded row for ${input.routeTitle} on ${claim.benchmark} at ${claim.eval_date}.`;
  const comparatorRow = input.rows.find(
    (r) => r.subject === claim.comparator && r.benchmark === claim.benchmark && r.eval_date === claim.eval_date,
  );
  if (!comparatorRow) {
    const comparatorName = input.comparatorNames[claim.comparator] ?? claim.comparator;
    return `No recorded row for ${comparatorName} on ${claim.benchmark} at ${claim.eval_date}.`;
  }
  const delta = recordedDelta(modelRow.score, comparatorRow.score);
  if (!numbersEqual(claim.stated_delta, delta)) {
    return `Stated difference ${claim.stated_delta} does not match the recorded difference ${delta}.`;
  }
  if (!input.body.includes(`[claim:${claim.id}]`)) {
    return `Claim ${claim.id} is not marked in the body.`;
  }
  const names = [
    input.routeTitle,
    ...Object.values(input.comparatorNames),
    claim.benchmark,
  ].filter(Boolean);
  const numbers = findNumbersInClaimText(claim.text, names);
  const allowed = [modelRow.score, comparatorRow.score, String(Math.abs(parseScore(delta)))];
  for (const n of numbers) {
    if (!allowed.some((a) => numbersEqual(n, a))) {
      return `The number ${n} in the claim text does not match the cited rows.`;
    }
  }
  return null;
}

export { recordedDelta };
