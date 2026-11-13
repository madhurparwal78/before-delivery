import { el } from '../dom';

export interface StaticGridOptions {
  blocks: string[];
  numbers: { row: number; col: number; number: number }[];
  solution?: string[][];
  owners?: (row: number, col: number) => string | null;
  className?: string;
}

/** A read-only grid: numbering, answers or owner colours, with no interaction. */
export function staticGrid(options: StaticGridOptions): HTMLElement {
  const rows = options.blocks.map((row, r) =>
    el(
      'div',
      { class: 'static-row' },
      row.split('').map((cell, c) => {
        if (cell === '#') return el('div', { class: 'static-cell black' });
        const number = options.numbers.find((n) => n.row === r && n.col === c);
        const owner = options.owners ? options.owners(r, c) : null;
        return el(
          'div',
          {
            class: `static-cell${owner ? ' owned' : ''}`,
            'data-colour': owner,
          },
          [
            number ? el('span', { class: 'static-number', text: String(number.number) }) : null,
            options.solution
              ? el('span', { class: 'static-letter', text: options.solution[r][c] })
              : null,
          ],
        );
      }),
    ),
  );
  return el(
    'div',
    {
      class: `static-grid ${options.className ?? ''}`.trim(),
      style: `--cols:${options.blocks[0]?.length ?? 1}`,
    },
    rows,
  );
}
