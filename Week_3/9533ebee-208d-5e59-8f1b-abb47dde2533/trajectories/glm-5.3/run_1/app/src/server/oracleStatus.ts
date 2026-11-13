import type { AssetCode, OracleStatus } from '../shared/types.js';

/**
 * Each server process reports the status of its own latest poll. Until a poll
 * returns on this process, the status reads unreachable.
 */
const statuses = new Map<AssetCode, OracleStatus>();

export function processOracleStatus(asset: AssetCode): OracleStatus {
  return statuses.get(asset) ?? 'unreachable';
}

export function setProcessOracleStatus(asset: AssetCode, status: OracleStatus): void {
  statuses.set(asset, status);
}
