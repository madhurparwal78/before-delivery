import {
  indexInWord,
  wordAt,
  wordSquares,
  type Direction,
  type GridLayout,
  type Word,
} from './grid';

export interface Selection {
  row: number;
  col: number;
  direction: Direction;
}

export interface AdvanceContext {
  layout: GridLayout;
  filled: (row: number, col: number) => boolean;
  skipFilled: boolean;
  jumpNextClue: boolean;
}

/** The selected square's word in the active direction, or its only word. */
export function activeWord(layout: GridLayout, selection: Selection): Word {
  const word = wordAt(layout, selection.row, selection.col, selection.direction);
  if (word) return word;
  const other = wordAt(
    layout,
    selection.row,
    selection.col,
    selection.direction === 'across' ? 'down' : 'across',
  );
  if (!other) throw new Error('every white square belongs to a word');
  return other;
}

function wordHasEmpty(context: AdvanceContext, word: Word): boolean {
  return wordSquares(word).some((square) => !context.filled(square.row, square.col));
}

function landOn(context: AdvanceContext, word: Word): Selection {
  const squares = wordSquares(word);
  const empty = squares.find((square) => !context.filled(square.row, square.col));
  const target = empty ?? squares[0];
  return { row: target.row, col: target.col, direction: word.direction };
}

/** The one auto-advance rule, in all three of its published variants. */
export function advanceAfterLetter(context: AdvanceContext, selection: Selection): Selection {
  const word = activeWord(context.layout, selection);
  const squares = wordSquares(word);
  const index = indexInWord(word, selection.row, selection.col);
  const stepOn = (): Selection =>
    index < squares.length - 1
      ? { ...squares[index + 1], direction: word.direction }
      : { row: selection.row, col: selection.col, direction: word.direction };

  const emptyLater = squares.slice(index + 1).find((square) => !context.filled(square.row, square.col));
  const emptyEarlier = squares.slice(0, index).find((square) => !context.filled(square.row, square.col));
  const wordFull = !emptyLater && !emptyEarlier && context.filled(selection.row, selection.col);

  if (wordFull && context.jumpNextClue) {
    const order = context.layout.words;
    const start = order.findIndex(
      (candidate) => candidate.number === word.number && candidate.direction === word.direction,
    );
    for (let step = 1; step <= order.length; step += 1) {
      const next = order[(start + step) % order.length];
      if (wordHasEmpty(context, next)) return landOn(context, next);
    }
    return stepOn();
  }
  if (!context.skipFilled) return stepOn();
  if (emptyLater) return { ...emptyLater, direction: word.direction };
  if (emptyEarlier) return { ...emptyEarlier, direction: word.direction };
  return stepOn();
}

/** The starting clue: the first clue in clue order whose word has an empty square. */
export function startingSelection(context: AdvanceContext): Selection {
  const order = context.layout.words;
  const first = order.find((word) => wordHasEmpty(context, word)) ?? order[0];
  return landOn(context, first);
}
