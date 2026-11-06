import { svg } from './dom.ts';
import type { Load } from './types.ts';

const PAD = 10;

/** Rounded dimensions, the same half-inch rounding the server quotes with. */
function roundedInches(raw: number): number {
  return Math.ceil(Math.round(raw * 100) / 50) / 2;
}

const GAP = 4;
const SHELF_IN = 0.625;

export interface Drawing {
  readonly root: SVGElement;
  readonly deckGroups: Map<number, SVGElement>;
  /** Pixel y of each deck's standing surface, used to animate shelf lines. */
  readonly deckBaseY: Map<number, number>;
  readonly pieceRects: Map<string, SVGRectElement>;
  readonly bands: Map<number, SVGRectElement>;
}

export function drawElevation(load: Load | null, width: number, height: number): Drawing {
  const innerWidth = Math.max(40, width - 2 * PAD);
  const innerHeight = Math.max(80, height - 2 * PAD);
  const stack = load?.kiln.stack_height_in ?? 27;
  const pxPerInch = innerHeight / stack;
  const floorY = PAD + innerHeight;
  const yFor = (inchesFromFloor: number): number => floorY - inchesFromFloor * pxPerInch;

  const root = svg('svg', {
    role: 'img',
    'aria-label': 'Kiln elevation',
    class: 'elevation',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });

  root.appendChild(
    svg('defs', {}, [
      svg('pattern', {
        id: 'refusal-hatch',
        width: 8,
        height: 8,
        patternUnits: 'userSpaceOnUse',
        patternTransform: 'rotate(45)',
      }, [
        svg('line', { x1: 0, y1: 0, x2: 0, y2: 8, class: 'hatch-line' }),
      ]),
    ]),
  );
  root.appendChild(
    svg('rect', {
      class: 'kiln-outline',
      x: PAD,
      y: PAD,
      width: innerWidth,
      height: innerHeight,
    }),
  );

  const deckGroups = new Map<number, SVGElement>();
  const deckBaseY = new Map<number, number>();
  const pieceRects = new Map<string, SVGRectElement>();
  const bands = new Map<number, SVGRectElement>();

  const decks = load?.decks ?? [];
  let base = 0;
  for (const deck of decks) {
    const group = svg('g', { 'data-deck': deck.number });
    const baseY = yFor(base);
    deckBaseY.set(deck.number, baseY);

    const shelfTop = base + deck.deck_height_in;
    group.appendChild(
      svg('line', {
        class: 'post',
        x1: PAD + 6,
        y1: baseY,
        x2: PAD + 6,
        y2: yFor(base + deck.post_height_in),
      }),
    );
    group.appendChild(
      svg('line', {
        class: 'post',
        x1: PAD + innerWidth - 6,
        y1: baseY,
        x2: PAD + innerWidth - 6,
        y2: yFor(base + deck.post_height_in),
      }),
    );

    const widths = deck.pieces.map((piece) => roundedInches(piece.width_in) * pxPerInch);
    const sum = widths.reduce((total, value) => total + value, 0);
    const spacing = GAP * Math.max(0, deck.pieces.length - 1);
    const available = innerWidth - spacing - 8;
    const factor = sum > available && sum > 0 ? Math.max(0.02, available / sum) : 1;
    let cursor = PAD + 4;
    for (const [index, piece] of deck.pieces.entries()) {
      const pieceWidth = Math.max(2, (widths[index] as number) * factor);
      const pieceHeight = roundedInches(piece.height_in) * pxPerInch;
      const rect = svg('rect', {
        class: 'silhouette',
        'data-piece': piece.id,
        x: cursor,
        y: yFor(base + roundedInches(piece.height_in)),
        width: pieceWidth,
        height: Math.max(1, pieceHeight),
      }) as SVGRectElement;
      group.appendChild(rect);
      pieceRects.set(piece.id, rect);
      cursor += pieceWidth + GAP;
    }

    group.appendChild(
      svg('rect', {
        class: 'shelf',
        x: PAD,
        y: yFor(shelfTop),
        width: innerWidth,
        height: Math.max(1, SHELF_IN * pxPerInch),
      }),
    );
    deckGroups.set(deck.number, group);
    root.appendChild(group);
    base = shelfTop;
  }

  if (load) {
    const headroomY = yFor(base);
    root.appendChild(
      svg('line', {
        class: 'headroom-line',
        x1: PAD,
        y1: headroomY,
        x2: PAD + innerWidth,
        y2: headroomY,
      }),
    );
    root.appendChild(
      svg('text', {
        class: 'headroom-label',
        x: PAD + 6,
        y: Math.max(PAD + 12, headroomY - 6),
      }, [`${load.headroom_in.toFixed(3)} IN`]),
    );
  }

  const bandCount = Math.max(1, decks.length);
  const bandHeight = innerHeight / bandCount;
  for (let index = 0; index < bandCount; index += 1) {
    const deckNumber = (decks[index]?.number ?? index + 1) as number;
    const band = svg('rect', {
      class: 'deck-band',
      'data-deck-band': deckNumber,
      x: PAD,
      y: floorY - (index + 1) * bandHeight,
      width: innerWidth,
      height: bandHeight,
    }) as SVGRectElement;
    root.appendChild(band);
    bands.set(deckNumber, band);
  }

  return { root, deckGroups, deckBaseY, pieceRects, bands };
}

export function showRefusal(drawing: Drawing, deckNumber: number, reason: string): void {
  clearRefusal(drawing);
  const band = drawing.bands.get(deckNumber);
  if (!band) return;
  const x = Number(band.getAttribute('x'));
  const y = Number(band.getAttribute('y'));
  const width = Number(band.getAttribute('width'));
  const height = Number(band.getAttribute('height'));
  const overlay = svg('g', { class: 'refusal' }, [
    svg('rect', { x, y, width, height, fill: 'url(#refusal-hatch)' }),
    svg('text', { class: 'refusal-text', x: x + 8, y: y + height / 2 }, [reason]),
  ]);
  drawing.root.appendChild(overlay);
}

export function clearRefusal(drawing: Drawing): void {
  for (const node of Array.from(drawing.root.querySelectorAll('.refusal'))) node.remove();
}
