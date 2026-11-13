import type { LayerPlacement, Rotation, Shape } from '../../shared/types';
import { SHELF_POSTS, SHELF_SPAN_HALF_UNITS } from '../../shared/placement';

const SPAN_IN = SHELF_SPAN_HALF_UNITS / 2;

export interface LiftedFootprint {
  pieceNumber: string;
  shape: Shape;
  /** Rounded sides in half-inch units, before rotation. */
  width: number;
  depth: number;
  xHalf: number;
  yHalf: number;
  rotation: Rotation;
  refused: boolean;
}

function percent(halfUnits: number): string {
  return `${(halfUnits / SHELF_SPAN_HALF_UNITS) * 100}%`;
}

function GridAndPosts(): JSX.Element {
  const lines: JSX.Element[] = [];
  for (let step = 0; step <= SHELF_SPAN_HALF_UNITS; step += 1) {
    const at = step / 2;
    const strong = at % 5 === 0;
    lines.push(
      <line
        key={`v${step}`}
        x1={at}
        y1={0}
        x2={at}
        y2={SPAN_IN}
        stroke="currentColor"
        strokeWidth={strong ? 0.08 : 0.03}
        opacity={strong ? 0.5 : 0.22}
      />,
      <line
        key={`h${step}`}
        x1={0}
        y1={at}
        x2={SPAN_IN}
        y2={at}
        stroke="currentColor"
        strokeWidth={strong ? 0.08 : 0.03}
        opacity={strong ? 0.5 : 0.22}
      />,
    );
  }
  return (
    <svg viewBox={`0 0 ${SPAN_IN} ${SPAN_IN}`} aria-hidden="true" focusable="false">
      <g>{lines}</g>
      <circle
        cx={SPAN_IN / 2}
        cy={SPAN_IN / 2}
        r={SPAN_IN / 2}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.18}
      />
      {SHELF_POSTS.map((post) => (
        <rect
          key={`${post.x}-${post.y}`}
          x={post.x / 2}
          y={post.y / 2}
          width={post.size / 2}
          height={post.size / 2}
          fill="currentColor"
          opacity={0.75}
        />
      ))}
    </svg>
  );
}

/** The current layer drawn from above, true to the 23 inch shelf. */
export function Shelf({
  layer,
  placements,
  lifted,
  slide,
  settling,
  onOpenPlaced,
  onDragTo,
  onSwipe,
}: {
  layer: number;
  placements: LayerPlacement[];
  lifted: LiftedFootprint | null;
  slide: 'left' | 'right' | null;
  settling: string | null;
  onOpenPlaced: (pieceNumber: string) => void;
  onDragTo: (xHalf: number, yHalf: number) => void;
  onSwipe: (direction: 'previous' | 'next') => void;
}): JSX.Element {
  const liftedSpan =
    lifted === null
      ? null
      : lifted.shape === 'rectangular' && (lifted.rotation === 90 || lifted.rotation === 270)
        ? { width: lifted.depth, depth: lifted.width }
        : { width: lifted.width, depth: lifted.depth };

  const snapFromPointer = (
    event: { clientX: number; clientY: number },
    box: HTMLElement,
  ): void => {
    if (!lifted || !liftedSpan) return;
    const rect = box.getBoundingClientRect();
    const halfPerPixel = SHELF_SPAN_HALF_UNITS / rect.width;
    const x = Math.round((event.clientX - rect.left) * halfPerPixel - liftedSpan.width / 2);
    const y = Math.round((event.clientY - rect.top) * halfPerPixel - liftedSpan.depth / 2);
    onDragTo(
      Math.max(0, Math.min(SHELF_SPAN_HALF_UNITS, x)),
      Math.max(0, Math.min(SHELF_SPAN_HALF_UNITS, y)),
    );
  };

  let touchStartX: number | null = null;
  let touchStartY: number | null = null;

  return (
    <div className="shelf-wrap">
      <div
        className={`shelf${slide ? ` layer-slide-${slide}` : ''}`}
        role="group"
        aria-label={`Shelf layer ${layer}`}
        onPointerMove={(event) => {
          if (event.buttons === 1) snapFromPointer(event, event.currentTarget);
        }}
        onPointerDown={(event) => {
          if (lifted) snapFromPointer(event, event.currentTarget);
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStartX = touch?.clientX ?? null;
          touchStartY = touch?.clientY ?? null;
        }}
        onTouchEnd={(event) => {
          const touch = event.changedTouches[0];
          if (touchStartX === null || touchStartY === null || !touch) return;
          const dx = touch.clientX - touchStartX;
          const dy = touch.clientY - touchStartY;
          if (!lifted && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            onSwipe(dx < 0 ? 'next' : 'previous');
          }
          touchStartX = null;
          touchStartY = null;
        }}
      >
        <GridAndPosts />
        {placements.map((placement) => (
          <button
            type="button"
            key={placement.piece_number}
            className={`footprint${placement.shape === 'rectangular' ? '' : ' round'}${
              placement.piece_number === settling ? ' settling' : ''
            }`}
            aria-label={`Placed Piece ${placement.piece_number}`}
            style={{
              left: percent(Math.round(Number(placement.x) * 2)),
              top: percent(Math.round(Number(placement.y) * 2)),
              width: percent(Math.round(Number(placement.width_in) * 2)),
              height: percent(Math.round(Number(placement.depth_in) * 2)),
            }}
            onClick={() => onOpenPlaced(placement.piece_number)}
          >
            {placement.piece_number}
          </button>
        ))}
        {lifted && liftedSpan && (
          <div
            className={`footprint lifted${lifted.shape === 'rectangular' ? '' : ' round'}${
              lifted.refused ? ' refused' : ''
            }`}
            style={{
              left: percent(lifted.xHalf),
              top: percent(lifted.yHalf),
              width: percent(liftedSpan.width),
              height: percent(liftedSpan.depth),
            }}
          >
            {lifted.pieceNumber}
          </div>
        )}
      </div>
    </div>
  );
}
