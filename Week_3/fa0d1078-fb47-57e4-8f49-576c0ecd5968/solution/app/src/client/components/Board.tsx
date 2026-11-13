import type { JSX } from "preact";
import { cellName, DIGITS, notesDigits } from "../../shared/board";
import { highlights, type BoardView, type CellView } from "../game/view";

function labelOf(index: number, cell: CellView, mode: BoardView["mode"]): string {
  const where = `Row ${Math.floor(index / 9) + 1}, column ${(index % 9) + 1}, `;
  if (mode === "paused") return `${where}hidden`;
  switch (cell.kind) {
    case "given":
      return `${where}given ${cell.value}`;
    case "hinted":
      return `${where}${cell.value}, hint`;
    case "wrong":
      return `${where}${cell.value}, wrong`;
    case "correct":
      return `${where}${cell.value}`;
    case "empty":
      return cell.notes === 0 ? `${where}empty` : `${where}empty, notes ${notesDigits(cell.notes).join(" ")}`;
  }
}

interface BoardProps {
  view: BoardView;
  onSelect: (index: number) => void;
}

export function Board({ view, onSelect }: BoardProps): JSX.Element {
  const marks = highlights(view);
  const paused = view.mode === "paused";
  return (
    <div
      id="board"
      class="board"
      role="grid"
      aria-label="Puzzle board"
      aria-hidden={paused ? "true" : undefined}
      data-state={view.mode}
      onClick={(event) => {
        const cell = (event.target as Element).closest("[data-cell]");
        const index = cell ? Number(cell.getAttribute("data-index")) : -1;
        if (index >= 0) onSelect(index);
      }}
    >
      {Array.from({ length: 9 }, (_, row) => (
        <div class="board-row" role="row" key={row}>
          {view.cells.slice(row * 9, row * 9 + 9).map((cell, column) => {
            const index = row * 9 + column;
            const visible = !paused;
            return (
              <div
                key={index}
                class="cell"
                role="gridcell"
                data-cell={cellName(index)}
                data-index={index}
                data-given={cell.kind === "given" ? "true" : "false"}
                data-value={visible && cell.value !== 0 ? String(cell.value) : ""}
                data-notes={visible ? notesDigits(cell.notes).join(" ") : ""}
                data-wrong={cell.kind === "wrong" ? "true" : "false"}
                data-hinted={cell.kind === "hinted" ? "true" : "false"}
                data-highlight={marks[index]}
                aria-selected={index === view.selected ? "true" : "false"}
                aria-label={labelOf(index, cell, view.mode)}
                tabIndex={index === view.selected ? 0 : -1}
              >
                {visible && cell.value !== 0 && <span class="digit">{cell.value}</span>}
                {visible && cell.value === 0 && cell.notes !== 0 && (
                  <span class="notes" aria-hidden="true">
                    {DIGITS.map((digit) => (
                      <i key={digit} data-note={cell.notes & (1 << digit) ? digit : ""} />
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
