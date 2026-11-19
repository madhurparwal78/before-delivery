import { config } from '../config.js';
import type { ShipDayBounds } from './ship-time.js';

export type DayState = 'open' | 'closed' | 'signed' | 'countersigned';

export type DaySignature = {
  signedAtMs: number | null;
  countersignedAtMs: number | null;
};

export type ShipDayStatus = {
  state: DayState;
  closesAtMs: number;
  canEdit: boolean;
};

/** The single place a ship's day state is decided, from the server's clock alone. */
export function shipDayStatus(
  bounds: ShipDayBounds,
  signature: DaySignature | null,
  nowMs: number,
): ShipDayStatus {
  const closesAtMs = bounds.endMs + config.dayCloseSeconds * 1000;
  const open = nowMs < closesAtMs;
  if (open) return { state: 'open', closesAtMs, canEdit: true };
  if (signature?.countersignedAtMs != null) {
    return { state: 'countersigned', closesAtMs, canEdit: false };
  }
  if (signature?.signedAtMs != null) return { state: 'signed', closesAtMs, canEdit: false };
  return { state: 'closed', closesAtMs, canEdit: false };
}
