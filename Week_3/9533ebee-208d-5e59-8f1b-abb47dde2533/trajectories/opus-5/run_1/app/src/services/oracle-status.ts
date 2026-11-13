/**
 * The oracle status this server process reports. It is the result of the
 * latest poll made by this process, so until its first poll returns it reads
 * `unreachable`.
 */

import { ASSET_CODES, type Asset } from '../domain/assets.ts';
import type { OracleStatus } from '../domain/oracle.ts';

const statuses = new Map<Asset, OracleStatus>(
  ASSET_CODES.map((asset) => [asset, 'unreachable' as OracleStatus]),
);

export function currentOracleStatus(asset: Asset): OracleStatus {
  return statuses.get(asset) ?? 'unreachable';
}

export function recordOracleStatus(asset: Asset, status: OracleStatus): void {
  statuses.set(asset, status);
}
