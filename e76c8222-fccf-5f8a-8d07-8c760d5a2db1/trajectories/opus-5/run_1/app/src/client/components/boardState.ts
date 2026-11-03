import { GateResult, RequestObject, RequestSeat } from '../types';

export type PipState = 'unchecked' | 'pass' | 'fail';

export interface GateView {
  phase: 'pending' | 'resolved';
  gates: GateResult[];
  revealed: number;
}

export interface DragState {
  interpreterId: string;
  interpreterName: string;
  anchor: { x: number; y: number };
  pointer: { x: number; y: number };
  mode: 'pointer' | 'keyboard';
  targetRequestId: string | null;
}

/** The card's lowest-numbered open seat, or its highest-numbered seat when none is open. */
export function targetSeat(request: RequestObject): RequestSeat | null {
  const open = request.seats.filter((seat) => seat.status === 'open');
  if (open.length > 0) {
    return open.reduce((lowest, seat) => (seat.position < lowest.position ? seat : lowest));
  }
  if (request.seats.length === 0) return null;
  return request.seats.reduce((highest, seat) => (seat.position > highest.position ? seat : highest));
}

export function pipStates(view: GateView | undefined): PipState[] {
  if (!view || view.phase === 'pending') return ['unchecked', 'unchecked', 'unchecked', 'unchecked'];
  return view.gates.map((gate, index) =>
    index < view.revealed ? (gate.pass ? 'pass' : 'fail') : 'unchecked',
  );
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
