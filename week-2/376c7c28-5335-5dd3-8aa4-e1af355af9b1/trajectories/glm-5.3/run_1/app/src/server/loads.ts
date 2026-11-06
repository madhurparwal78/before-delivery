// Load deck maths: post heights, deck heights, headroom, footprint and value.
// All derived from piece dimensions and stored quotes — never set by a request.

export type PlacedPiece = { id: string; title: string; length_in: number; width_in: number; height_in: number };
import { cubicEighths, footprintPct, footprintQuarters, roundDims } from "./quote";

export const STACK_HEIGHT_IN = 27;
export const SHELF_THICKNESS_IN = 0.625;
export const POST_CLEARANCE_IN = 0.5;
export const FOOTPRINT_LIMIT_PCT = 85;

// The footprint limit is judged on the exact percent, not the reported one decimal:
// exactly 85 is allowed.
export function footprintExceedsLimit(footprintSqIn: number, areaSqIn: number): boolean {
  return (footprintSqIn / areaSqIn) * 100 > FOOTPRINT_LIMIT_PCT + 1e-9;
}

export type DeckFigure = {
  number: number;
  post_height_in: number;
  deck_height_in: number;
  footprint_sq_in: number;
  footprint_pct: number;
  pieces: PlacedPiece[];
};

export type LoadFigure = {
  headroom_in: number;
  value_cents: number;
  decks: DeckFigure[];
};

// Half-inch rounded height of a piece.
export function pieceHeightHalf(p: { length_in: number; width_in: number; height_in: number }): number {
  return Math.ceil(p.height_in * 2 - 1e-9);
}

export function pieceDimsHalf(p: { length_in: number; width_in: number; height_in: number }) {
  return roundDims(p.length_in, p.width_in, p.height_in);
}

// Load figures from current pieces. `pieces` are the load's pieces with deck number
// and placement position; `deckCount` the load's deck count; `firingFeeOf` returns
// the stored fee for the load's firing.
export function computeLoadFigures(
  kilnAreaSqIn: number,
  deckCount: number,
  placed: { ticket: PlacedPiece; deck: number; position: number }[],
  firingFeeOf: (ticket: PlacedPiece) => number,
): LoadFigure {
  const decks: DeckFigure[] = [];
  for (let n = 1; n <= deckCount; n++) {
    const pieces = placed.filter((x) => x.deck === n).sort((a, b) => a.position - b.position).map((x) => x.ticket);
    const tallestHalf = pieces.reduce((m, p) => Math.max(m, pieceHeightHalf(p)), 0);
    const postHalf = pieces.length === 0 ? 0 : tallestHalf + 1; // + 0.5in clearance
    const postHeightIn = postHalf / 2;
    const quarters = pieces.reduce((s, p) => {
      const d = pieceDimsHalf(p);
      return s + footprintQuarters(d);
    }, 0);
    decks.push({
      number: n,
      post_height_in: postHeightIn,
      deck_height_in: postHeightIn + SHELF_THICKNESS_IN,
      footprint_sq_in: quarters / 4,
      footprint_pct: footprintPct(quarters, kilnAreaSqIn),
      pieces,
    });
  }
  const sumDeckHeights = decks.reduce((s, d) => s + d.deck_height_in, 0);
  const headroom = STACK_HEIGHT_IN - sumDeckHeights;
  const value = placed.reduce((s, x) => s + firingFeeOf(x.ticket), 0);
  return { headroom_in: Math.round(headroom * 1000) / 1000, value_cents: value, decks };
}

// Would-be figures for a hypothetical placement (piece added to a deck).
export function figuresWithPlacement(
  kilnAreaSqIn: number,
  deckCount: number,
  placed: { ticket: PlacedPiece; deck: number; position: number }[],
  firingFeeOf: (t: PlacedPiece) => number,
  piece: PlacedPiece,
  deck: number,
): LoadFigure {
  const next = placed.concat([{ ticket: piece, deck, position: Number.MAX_SAFE_INTEGER }]);
  return computeLoadFigures(kilnAreaSqIn, deckCount, next, firingFeeOf);
}

// Would-be figures for a move (piece removed from its deck, appended to another).
export function figuresWithMove(
  kilnAreaSqIn: number,
  deckCount: number,
  placed: { ticket: PlacedPiece; deck: number; position: number }[],
  firingFeeOf: (t: PlacedPiece) => number,
  piece: PlacedPiece,
  toDeck: number,
): LoadFigure {
  const remaining = placed.filter((x) => x.ticket.id !== piece.id);
  return figuresWithPlacement(kilnAreaSqIn, deckCount, remaining, firingFeeOf, piece, toDeck);
}
