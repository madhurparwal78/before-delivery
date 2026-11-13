/** Shipment and return state machines. Every move is judged here. */

import type { ReturnState, ShipmentState } from '../../shared/types.js';

export type ShipmentActor = 'seller' | 'shopper';

const SHIPMENT_MOVES: { from: ShipmentState; to: ShipmentState; actor: ShipmentActor }[] = [
  { from: 'placed', to: 'packed', actor: 'seller' },
  { from: 'packed', to: 'shipped', actor: 'seller' },
  { from: 'shipped', to: 'delivered', actor: 'seller' },
  { from: 'placed', to: 'cancelled', actor: 'shopper' },
  { from: 'packed', to: 'cancelled', actor: 'shopper' },
];

export function shipmentMoveAllowed(
  from: ShipmentState,
  to: ShipmentState,
  actor: ShipmentActor,
): boolean {
  return SHIPMENT_MOVES.some(
    (move) => move.from === from && move.to === to && move.actor === actor,
  );
}

const RETURN_MOVES: { from: ReturnState; to: ReturnState }[] = [
  { from: 'requested', to: 'picked' },
  { from: 'requested', to: 'declined' },
  { from: 'declined', to: 'requested' },
];

export function returnMoveAllowed(from: ReturnState, to: ReturnState): boolean {
  return RETURN_MOVES.some((move) => move.from === from && move.to === to);
}
