import type { FreezePolicyVersion } from '../../shared/types.js';

/**
 * The one rule for which freeze policy version governs an instant: the highest-numbered
 * version whose effective_from is at or before it.
 */
export function versionInForce(versions: readonly FreezePolicyVersion[], instant: Date): FreezePolicyVersion {
  const eligible = versions
    .filter((version) => Date.parse(version.effective_from) <= instant.getTime())
    .sort((left, right) => right.version - left.version);
  const chosen = eligible[0];
  if (!chosen) {
    throw new Error('A project always has a freeze policy version effective in the past');
  }
  return chosen;
}

export function latestVersion(versions: readonly FreezePolicyVersion[]): FreezePolicyVersion {
  const sorted = [...versions].sort((left, right) => right.version - left.version);
  const chosen = sorted[0];
  if (!chosen) throw new Error('A project always has at least one freeze policy version');
  return chosen;
}
