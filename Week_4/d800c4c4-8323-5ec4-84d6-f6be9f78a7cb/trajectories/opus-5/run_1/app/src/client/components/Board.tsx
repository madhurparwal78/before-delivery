import { useEffect, useRef } from 'react';
import type { Item, Part, PartShape } from '../../shared/types';
import { outlineStateWord } from '../../shared/status-words';

export const HOLE_PITCH = 32;
export const BOARD_PADDING = 16;
export const BOARD_COLUMNS = 10;
export const BOARD_WIDTH = BOARD_PADDING * 2 + BOARD_COLUMNS * HOLE_PITCH;

export interface BoardPart {
  readonly part: Part;
  readonly item: Item;
}

/** Outlines run by their top row, then by their left column. */
export function boardOrder(items: readonly Item[]): BoardPart[] {
  const parts: BoardPart[] = [];
  for (const item of items) for (const part of item.parts) parts.push({ part, item });
  return parts.sort(
    (left, right) => left.part.row - right.part.row || left.part.col - right.part.col,
  );
}

function cell(part: Part): { x: number; y: number; width: number; height: number } {
  return {
    x: BOARD_PADDING + part.col * HOLE_PITCH,
    y: BOARD_PADDING + part.row * HOLE_PITCH,
    width: part.width * HOLE_PITCH,
    height: part.height * HOLE_PITCH,
  };
}

/** Each silhouette is drawn from its part's shape kind and its size in holes. */
function silhouette(shape: PartShape, part: Part): string {
  const { x, y, width: w, height: h } = cell(part);
  const inset = 6;
  const left = x + inset;
  const top = y + inset;
  const right = x + w - inset;
  const bottom = y + h - inset;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  switch (shape) {
    case 'drill':
      return (
        `M${left} ${top} H${right - (right - left) * 0.3} ` +
        `L${right} ${top + (bottom - top) * 0.2} V${top + (bottom - top) * 0.4} ` +
        `L${right - (right - left) * 0.3} ${midY} H${midX} ` +
        `V${bottom} H${left + (right - left) * 0.3} V${midY} H${left} Z`
      );
    case 'saw':
      return (
        `M${left} ${top} H${right} L${right} ${midY} ` +
        `H${left + (right - left) * 0.35} L${left + (right - left) * 0.35} ${bottom} ` +
        `H${left} Z`
      );
    case 'ladder':
      return (
        `M${left} ${top} H${left + 7} V${bottom} H${left} Z ` +
        `M${right - 7} ${top} H${right} V${bottom} H${right - 7} Z ` +
        rungs(left, right, top, bottom)
      );
    case 'hammer':
      return (
        `M${left} ${top} H${right} V${top + (bottom - top) * 0.22} ` +
        `H${midX + 6} V${bottom} H${midX - 6} V${top + (bottom - top) * 0.22} H${left} Z`
      );
    case 'wrench':
      return (
        `M${midX - 6} ${top + (bottom - top) * 0.2} V${bottom} H${midX + 6} ` +
        `V${top + (bottom - top) * 0.2} H${right} V${top} H${left} ` +
        `V${top + (bottom - top) * 0.2} Z`
      );
    case 'case':
      return (
        `M${left} ${top + 8} H${midX - 10} V${top} H${midX + 10} V${top + 8} H${right} ` +
        `V${bottom} H${left} Z`
      );
    case 'battery':
      return (
        `M${midX - 8} ${top} H${midX + 8} V${top + 6} H${right} V${bottom} H${left} ` +
        `V${top + 6} H${midX - 8} Z`
      );
    case 'cable':
      return (
        `M${left} ${midY} Q${left + (right - left) * 0.25} ${top} ${midX} ${midY} ` +
        `Q${left + (right - left) * 0.75} ${bottom} ${right} ${midY} ` +
        `Q${left + (right - left) * 0.75} ${bottom + 6} ${midX} ${midY + 6} ` +
        `Q${left + (right - left) * 0.25} ${top + 6} ${left} ${midY + 6} Z`
      );
    case 'blade':
      return (
        `M${left} ${top} H${right} V${bottom - 8} ` +
        `${teeth(left, right, bottom)} V${top} Z`
      );
    default:
      return `M${left + 6} ${top} H${right - 6} Q${right} ${top} ${right} ${top + 6} V${bottom - 6} Q${right} ${bottom} ${right - 6} ${bottom} H${left + 6} Q${left} ${bottom} ${left} ${bottom - 6} V${top + 6} Q${left} ${top} ${left + 6} ${top} Z`;
  }
}

function rungs(left: number, right: number, top: number, bottom: number): string {
  let path = '';
  const count = Math.max(2, Math.round((bottom - top) / 28));
  for (let index = 1; index < count; index += 1) {
    const y = top + ((bottom - top) / count) * index;
    path += `M${left + 7} ${y - 3} H${right - 7} V${y + 3} H${left + 7} Z `;
  }
  return path;
}

function teeth(left: number, right: number, bottom: number): string {
  let path = '';
  const count = Math.max(3, Math.round((right - left) / 10));
  for (let index = count; index >= 0; index -= 1) {
    const x = right - ((right - left) / count) * index;
    path += `L${x} ${bottom} L${x - (right - left) / count / 2} ${bottom - 8} `;
  }
  return path;
}

interface BoardProps {
  readonly items: readonly Item[];
  readonly rows: number;
  readonly selectedItemId: number | null;
  readonly pickedPartId: number | null;
  readonly hoverPartId: number | null;
  readonly snapPartId: number | null;
  readonly settledPartIds: ReadonlySet<number>;
  readonly reducedMotion: boolean;
  readonly onActivate: (entry: BoardPart) => void;
  readonly registerOutline: (partId: number, element: SVGGElement | null) => void;
}

export function Board({
  items,
  rows,
  selectedItemId,
  pickedPartId,
  hoverPartId,
  snapPartId,
  settledPartIds,
  reducedMotion,
  onActivate,
  registerOutline,
}: BoardProps): JSX.Element {
  const ordered = boardOrder(items);
  const height = BOARD_PADDING * 2 + Math.max(rows, 1) * HOLE_PITCH;
  const hoverRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    if (pickedPartId === null || hoverPartId === null) return;
    hoverRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [pickedPartId, hoverPartId, reducedMotion]);

  const holes: JSX.Element[] = [];
  for (let row = 0; row <= Math.max(rows, 1); row += 1) {
    for (let col = 0; col < BOARD_COLUMNS; col += 1) {
      holes.push(
        <circle
          key={`${row}-${col}`}
          className="peg-hole"
          cx={BOARD_PADDING + col * HOLE_PITCH}
          cy={BOARD_PADDING + row * HOLE_PITCH}
          r={3}
        />,
      );
    }
  }

  return (
    <div className="board-frame">
      <svg
        className="board"
        viewBox={`0 0 ${BOARD_WIDTH} ${height}`}
        width={BOARD_WIDTH}
        height={height}
        role="presentation"
      >
        <g aria-hidden="true">{holes}</g>
        {ordered.map(({ part, item }) => {
          const word = outlineStateWord(part.state, item.status);
          const box = cell(part);
          const classes = [
            'outline',
            `outline-${word.replace(/ /g, '-')}`,
            selectedItemId === item.id ? 'outline-selected' : '',
            snapPartId === part.id ? 'outline-snapped' : '',
            hoverPartId === part.id && pickedPartId !== null ? 'outline-hovered' : '',
            settledPartIds.has(part.id) && !reducedMotion ? 'outline-settling' : '',
            pickedPartId === part.id ? 'outline-source' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g
              key={part.id}
              ref={(element) => {
                registerOutline(part.id, element);
                if (hoverPartId === part.id) hoverRef.current = element;
              }}
              className={classes}
              role="button"
              tabIndex={0}
              aria-label={`${item.name} — ${part.name}, ${word}`}
              data-part-id={part.id}
              onClick={() => onActivate({ part, item })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onActivate({ part, item });
                }
              }}
            >
              <rect className="outline-hit" {...box} />
              <path className="outline-shape" d={silhouette(part.shape, part)} />
              {word === 'held' ? (
                <path className="outline-shape outline-shape-double" d={silhouette(part.shape, part)} />
              ) : null}
              {word === 'reserved' ? (
                <path
                  className="outline-notch"
                  d={`M${box.x + box.width - 14} ${box.y} L${box.x + box.width} ${box.y + 14}`}
                />
              ) : null}
              {word === 'missing' ? (
                <>
                  <path
                    className="outline-cross"
                    d={`M${box.x + 3} ${box.y + 3} l10 10 M${box.x + 13} ${box.y + 3} l-10 10`}
                  />
                  <text className="outline-word" x={box.x + box.width / 2} y={box.y + box.height / 2}>
                    missing
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
