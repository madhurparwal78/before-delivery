import type {
  Decision, PromotionKind, PromotionState, RailPhase, StageStatus,
} from './domain.js';
import { ACTIVE_PROMOTION_STATES } from './domain.js';

// ---------------------------------------------------------------- transitions

// The promotion transition table. The single place that decides which
// from-state may move to which to-state.
const LEGAL_TRANSITIONS: Record<string, readonly PromotionState[]> = {
  requested: ['awaiting_approval', 'queued'],
  awaiting_approval: ['approved', 'rejected', 'expired'],
  approved: ['queued', 'expired'],
  queued: ['applying', 'window_blocked'],
  window_blocked: ['queued', 'expired'],
  applying: ['health_wait', 'healthy', 'degraded'],
  health_wait: ['healthy', 'degraded'],
  rejected: [],
  expired: [],
  healthy: ['rolled_back'],
  degraded: ['rolled_back'],
  rolled_back: [],
};

export function isLegalTransition(from: PromotionState, to: PromotionState): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

export function isActiveState(state: PromotionState): boolean {
  return (ACTIVE_PROMOTION_STATES as readonly string[]).includes(state);
}

// ------------------------------------------------------- rail phase/progress

// The rail phase and progress mapping. The single place that derives the edge
// phase and progress from promotion state and counter.
export function railPhaseAndProgress(
  state: PromotionState,
  inSync: number | null,
  total: number | null,
  failedProgress: number | null,
): { phase: RailPhase; progress: number } {
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  switch (state) {
    case 'awaiting_approval':
    case 'approved':
    case 'requested':
    case 'queued':
      return { phase: 'queued', progress: 0.1 };
    case 'window_blocked':
      return { phase: 'window_check', progress: 0.2 };
    case 'applying': {
      const synced = inSync ?? 0;
      const all = total ?? 0;
      const p = all > 0 ? 0.2 + 0.4 * (synced / all) : 0.2;
      return { phase: 'applying', progress: round3(p) };
    }
    case 'health_wait': {
      const synced = inSync ?? 0;
      const all = total ?? 0;
      const p = all > 0 ? 0.6 + 0.35 * (synced / all) : 0.6;
      return { phase: 'health_wait', progress: round3(p) };
    }
    case 'healthy':
      return { phase: 'healthy', progress: 1 };
    case 'degraded':
      return { phase: 'degraded', progress: failedProgress ?? 0.6 };
    case 'rejected':
    case 'expired':
      return { phase: 'stopped', progress: 0 };
    default:
      return { phase: 'idle', progress: 0 };
  }
}

// -------------------------------------------------------------- stage status

// The stage status rule. The single place that derives a stage's status.
export function stageStatus(
  activePromotion: { state: PromotionState } | null,
  currentRevision: { state: PromotionState } | null,
): StageStatus {
  if (activePromotion) {
    if (activePromotion.state === 'applying' || activePromotion.state === 'health_wait') return 'progressing';
    return 'out_of_sync';
  }
  if (currentRevision) {
    if (currentRevision.state === 'healthy') return 'healthy';
    if (currentRevision.state === 'degraded' || currentRevision.state === 'rolled_back') return 'degraded';
  }
  return 'not_deployed';
}

// --------------------------------------------------------------- redaction

const REDACTED = '[redacted]';

// The redaction rule. The single place that decides which fields are secrets.
export function isSecretKind(kind: string): boolean {
  return kind === 'Secret' || kind === 'SealedSecret';
}

// Returns the leaf paths of a manifest whose values must be redacted.
export function secretLeafPaths(manifest: Record<string, unknown>): string[] {
  const kind = String(manifest.kind ?? '');
  const paths: string[] = [];
  if (kind === 'Secret') {
    for (const base of ['data', 'stringData']) {
      const v = manifest[base];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const k of Object.keys(v as object)) paths.push(`${base}.${k}`);
      }
    }
  } else if (kind === 'SealedSecret') {
    const spec = manifest.spec as Record<string, unknown> | undefined;
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      const enc = spec.encryptedData as Record<string, unknown> | undefined;
      if (enc && typeof enc === 'object' && !Array.isArray(enc)) {
        for (const k of Object.keys(enc)) paths.push(`spec.encryptedData.${k}`);
      }
      const tpl = spec.template as Record<string, unknown> | undefined;
      if (tpl && typeof tpl === 'object' && !Array.isArray(tpl)) {
        const tdata = tpl.data as Record<string, unknown> | undefined;
        if (tdata && typeof tdata === 'object' && !Array.isArray(tdata)) {
          for (const k of Object.keys(tdata)) paths.push(`spec.template.data.${k}`);
        }
      }
    }
  }
  return paths;
}

export function redactedValue(): string {
  return REDACTED;
}

// -------------------------------------------------------------- helpers

export function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, '').slice(0, 7);
}

export function nowInstant(): Date {
  return new Date();
}

export function instantString(d: Date): string {
  return d.toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z');
}

// The freeze-policy-version-in-force rule. The single place that decides which
// version applies at an instant.
export function policyVersionInForce(
  versions: { version: number; effective_from: Date }[],
  at: Date,
): number {
  let best = 0;
  for (const v of versions) {
    if (v.effective_from.getTime() <= at.getTime() && v.version > best) best = v.version;
  }
  return best;
}

export type { Decision, PromotionKind, PromotionState, RailPhase, StageStatus };
