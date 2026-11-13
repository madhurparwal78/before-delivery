import { DEPOSIT_CENTS } from '../../shared/constants';
import { PiecePlacement, PieceStatus, SaleKind, fitGeometry, verdictSentence } from '../../shared/geometry';
import { boardFeet, priceCents, volumeMm3 } from '../../shared/money';
import { ApiError } from '../errors';
import { BoardRow } from './boards';

export interface FitPieceShape extends PiecePlacement {
  status: PieceStatus;
}

export interface FitShape {
  board: string;
  pieces: FitPieceShape[];
  clear_count: number;
  cuts_mm: number[];
  take_mm: number | null;
  sale: SaleKind | null;
  offcut_mm: number | null;
  clear_offcut_mm: number | null;
  board_feet: string | null;
  price_cents: number | null;
  verdict: string;
}

/** The one place a layout is turned into cuts, a take, an offcut and a price. */
export function computeFit(board: BoardRow, pieces: PiecePlacement[], rateCents: number | null): FitShape {
  const geometry = fitGeometry(pieces, board);
  const takeVolume = geometry.take_mm === null ? null : volumeMm3(board.thickness_mm, board.width_mm, geometry.take_mm);
  return {
    board: board.tag,
    pieces: pieces.map((piece, index) => ({ ...piece, status: geometry.statuses[index] ?? 'clear' })),
    clear_count: geometry.clear_count,
    cuts_mm: geometry.cuts_mm,
    take_mm: geometry.take_mm,
    sale: geometry.sale,
    offcut_mm: geometry.offcut_mm,
    clear_offcut_mm: geometry.clear_offcut_mm,
    board_feet: takeVolume === null ? null : boardFeet(takeVolume),
    price_cents:
      geometry.take_mm === null || rateCents === null
        ? null
        : priceCents(board.thickness_mm, board.width_mm, geometry.take_mm, rateCents),
    verdict: verdictSentence(geometry.clear_count, pieces.length, geometry.sale, geometry.offcut_mm)
  };
}

/** A hold needs every piece clear and a price above the deposit. */
export function requireHoldableFit(fit: FitShape): { take_mm: number; sale: SaleKind; price_cents: number } {
  const everyPieceClear = fit.pieces.length > 0 && fit.pieces.every((piece) => piece.status === 'clear');
  if (!everyPieceClear || fit.take_mm === null || fit.sale === null || fit.price_cents === null) {
    throw new ApiError('validation', { pieces: 'Every piece must sit clear of the defects.' });
  }
  if (fit.price_cents <= DEPOSIT_CENTS) {
    throw new ApiError('validation', { pieces: 'This layout costs no more than the deposit.' });
  }
  return { take_mm: fit.take_mm, sale: fit.sale, price_cents: fit.price_cents };
}
