import { memo } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { Board as BoardData, Item, Part } from "../api";
import { prefersReducedMotion, Status } from "../components/ui";
import { outlineWord } from "./outline";
import { silhouette } from "./silhouettes";

/** The words an outline can read, shown with their shapes in the key under the board. */
const KEY_WORDS = ["on the wall", "out", "missing", "pending photo", "reserved", "held"];

const PITCH = 32;
const FRAME = 8;

interface OutlineState {
  selected: boolean;
  snap: boolean;
  hover: boolean;
  animateHang: boolean;
}

interface OutlineProps extends OutlineState {
  part: Part;
  item: Item;
  onActivate: (part: Part, item: Item, point: { x: number; y: number } | null) => void;
  register: (id: number, el: HTMLButtonElement | null) => void;
}

const Outline = memo(function Outline({ part, item, selected, snap, hover, animateHang, onActivate, register }: OutlineProps) {
  const word = outlineWord(part.state, item.status);
  const width = part.width * PITCH;
  const height = part.height * PITCH;
  const { path, holes } = silhouette(part.shape, width, height);
  const sil = useRef<SVGPathElement>(null);
  const fill = useRef<SVGRectElement>(null);
  useLayoutEffect(() => {
    if (!animateHang || word !== "on the wall" || prefersReducedMotion()) return;
    sil.current?.animate(
      [
        { transform: "translateY(-6px) scale(1.06)" },
        { transform: "translateY(1px) scale(0.985)", offset: 0.7 },
        { transform: "none" },
      ],
      { duration: 380, easing: "cubic-bezier(.34,1.45,.55,1)" },
    );
    fill.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,.8,.3,1)" });
  }, [animateHang, word]);
  return (
    <button
      type="button"
      ref={(el) => register(part.id, el)}
      class={`outline word-${word.replace(/\s+/g, "-")}${selected ? " is-selected" : ""}${snap ? " is-snap" : ""}${hover ? " is-hover" : ""}`}
      style={{ left: `${FRAME + part.col * PITCH}px`, top: `${FRAME + part.row * PITCH}px`, width: `${width}px`, height: `${height}px` }}
      aria-label={`${item.name} — ${part.name}, ${word}`}
      data-part={part.id}
      onClick={(event) => onActivate(part, item, event.detail === 0 ? null : { x: event.clientX, y: event.clientY })}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        <rect class="outline-fill" ref={fill} x="3" y="3" width={width - 6} height={height - 6} />
        <path class="silhouette" ref={sil} d={path} fill-rule={holes} />
        <rect class="outline-frame" x="2.5" y="2.5" width={width - 5} height={height - 5} />
        {word === "reserved" && <rect class="outline-notch" x={width / 2 - 6} y="0" width="12" height="7" />}
        {word === "held" && <rect class="outline-inner" x="8" y="8" width={width - 16} height={height - 16} />}
        {word === "missing" && (
          <>
            <path class="outline-cross" d={`M${width - 16},6 L${width - 6},16 M${width - 6},6 L${width - 16},16`} />
            <text class="outline-missing" x={width / 2} y={height / 2 + 4} text-anchor="middle">
              missing
            </text>
          </>
        )}
      </svg>
    </button>
  );
});

interface BoardViewProps {
  board: BoardData | null;
  states: (part: Part, item: Item) => OutlineState;
  onActivate: (part: Part, item: Item, point: { x: number; y: number } | null) => void;
  register: (id: number, el: HTMLButtonElement | null) => void;
  ghost: { partId: number; label: string } | null;
}

/** The perforated pegboard, ten holes wide on a 32px pitch, with one traced outline per part. */
export function BoardView({ board, states, onActivate, register, ghost }: BoardViewProps) {
  const rows = Math.max(board?.rows ?? 0, 4);
  const width = 10 * PITCH + FRAME * 2;
  const height = rows * PITCH + FRAME * 2;
  const ghostPart = ghost && board ? board.items.flatMap((i) => i.parts).find((p) => p.id === ghost.partId) : undefined;
  return (
    <section class="pane pane-board" aria-label="Pegboard">
      {board === null ? (
        <p class="loading-line">Loading the board…</p>
      ) : (
        <div class="board" style={{ width: `${width}px`, height: `${height}px` }}>
          <svg class="board-holes" width={width} height={height} aria-hidden="true" focusable="false">
            <defs>
              <pattern id="board-holes" width={PITCH} height={PITCH} patternUnits="userSpaceOnUse" x={FRAME} y={FRAME}>
                <circle cx={PITCH / 2} cy={PITCH / 2} r="3.5" class="hole" />
              </pattern>
            </defs>
            <rect x="0" y="0" width={width} height={height} class="board-surface" />
            <rect x={FRAME} y={FRAME} width={width - FRAME * 2} height={height - FRAME * 2} fill="url(#board-holes)" />
          </svg>
          {board.items.flatMap((item) =>
            item.parts.map((part) => (
              <Outline key={part.id} part={part} item={item} {...states(part, item)} onActivate={onActivate} register={register} />
            )),
          )}
          {ghostPart && (
            <div
              class="ghost-card"
              aria-hidden="true"
              style={{ left: `${FRAME + ghostPart.col * PITCH + 6}px`, top: `${FRAME + ghostPart.row * PITCH + 6}px` }}
            >
              {ghost!.label}
            </div>
          )}
        </div>
      )}
      <ul class="board-key" aria-label="Board key">
        {KEY_WORDS.map((word) => (
          <li key={word}>
            <Status word={word} />
          </li>
        ))}
      </ul>
    </section>
  );
}
