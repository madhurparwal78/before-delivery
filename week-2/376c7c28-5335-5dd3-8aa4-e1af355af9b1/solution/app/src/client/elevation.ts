import { svg } from './dom.ts';
import type { Load } from './types.ts';

const PAD = 10;

/** Rounded dimensions, the same half-inch rounding the server quotes with. */
function roundedInches(raw: number): number {
  return Math.ceil(Math.round(raw * 100) / 50) / 2;
}

const GAP = 4;
const SHELF_IN = 0.625;
const MIN_BAND_PX = 56;
const PLATE_CHAR_PX = 7.8;

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
    // The unused headroom: a dashed frame inset inside it, so it never merges into the top shelf.
    const headroomY = yFor(base);
    const frameTop = PAD + 4;
    const frameBottom = headroomY - 4;
    if (frameBottom - frameTop >= 6) {
      root.appendChild(
        svg('rect', {
          class: 'headroom-line',
          x: PAD + 4,
          y: frameTop,
          width: innerWidth - 8,
          height: frameBottom - frameTop,
        }),
      );
    }
    root.appendChild(
      svg('text', {
        class: 'headroom-label',
        x: PAD + 12,
        y: Math.max(PAD + 16, frameBottom - 8),
      }, [`HEADROOM ${load.headroom_in.toFixed(3)} IN`]),
    );
  }

  // Each deck's own band, from the shelf (or floor) it stands on up to its own shelf top: it is
  // where the drag tint and the refusal hatching are drawn. A thin empty deck still gets 56 px.
  // The pointer areas above it span the same decks, the top one reaching up through the headroom.
  const deckSpans = decks.length > 0 ? decks : [{ number: 1, deck_height_in: SHELF_IN }];
  let spanBase = 0;
  const hitTargets: SVGRectElement[] = [];
  for (const [index, deck] of deckSpans.entries()) {
    const bottomY = yFor(spanBase);
    const topY = yFor(spanBase + deck.deck_height_in);
    const bandTop = Math.max(PAD, Math.min(topY, bottomY - MIN_BAND_PX));
    const band = svg('rect', {
      class: 'deck-band',
      x: PAD,
      y: bandTop,
      width: innerWidth,
      height: bottomY - bandTop,
    }) as SVGRectElement;
    root.insertBefore(band, root.querySelector('[data-deck]'));
    bands.set(deck.number, band);
    const isTop = index === deckSpans.length - 1;
    const hitTop = isTop ? PAD : topY;
    hitTargets.push(
      svg('rect', {
        class: 'deck-hit',
        'data-deck-band': deck.number,
        x: PAD,
        y: hitTop,
        width: innerWidth,
        height: Math.max(1, bottomY - hitTop),
      }) as SVGRectElement,
    );
    spanBase += deck.deck_height_in;
  }
  for (const target of hitTargets) root.appendChild(target);

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
  // The reason sits on a ground plate edged in accent, centred in the hatched deck band.
  const plateWidth = Math.min(width - 8, reason.length * PLATE_CHAR_PX + 16);
  const plateX = x + (width - plateWidth) / 2;
  const plateY = y + height / 2 - 13;
  const overlay = svg('g', { class: 'refusal' }, [
    svg('rect', { x, y, width, height, fill: 'url(#refusal-hatch)' }),
    svg('rect', { class: 'refusal-plate', x: plateX, y: plateY, width: plateWidth, height: 26 }),
    svg('text', { class: 'refusal-text', x: x + width / 2, y: plateY + 17, 'text-anchor': 'middle' }, [reason]),
  ]);
  const firstHit = drawing.root.querySelector('.deck-hit');
  drawing.root.insertBefore(overlay, firstHit);
}

export function clearRefusal(drawing: Drawing): void {
  for (const node of Array.from(drawing.root.querySelectorAll('.refusal'))) node.remove();
}
