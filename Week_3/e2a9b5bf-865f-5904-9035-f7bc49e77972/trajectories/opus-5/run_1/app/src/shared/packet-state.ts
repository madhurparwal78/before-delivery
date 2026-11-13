import { PACKET_LABELS } from './messages.js';
import type { PacketState } from './types.js';

export type PacketAction = 'rows' | 'check' | 'render' | 'send';

/** The states each action may legally start from. */
const LEGAL_FROM: Record<PacketAction, readonly PacketState[]> = {
  rows: ['draft', 'checked'],
  check: ['draft'],
  render: ['checked', 'render_failed'],
  send: ['rendered', 'send_failed'],
};

export function actionIsLegal(state: PacketState, action: PacketAction): boolean {
  return LEGAL_FROM[action].includes(state);
}

export function packetLabel(state: PacketState): string {
  return PACKET_LABELS[state];
}

/** A deleted citation returns a packet to draft from every state but these. */
export function survivesCitationDelete(state: PacketState): boolean {
  return state === 'sending' || state === 'sent';
}

export const PACKET_BUTTON_STATES = {
  check: ['draft'],
  render: ['checked'],
  try_again: ['render_failed'],
  send: ['rendered', 'send_failed'],
} as const satisfies Record<string, readonly PacketState[]>;
