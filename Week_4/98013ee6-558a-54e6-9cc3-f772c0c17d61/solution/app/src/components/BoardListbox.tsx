import { type KeyboardEvent } from "react";
import type { BoardSummary } from "../../shared/types";

interface Props {
  boards: readonly BoardSummary[];
  value: number | null;
  onChange: (board: BoardSummary) => void;
  /** Enter or a click on an option; when absent, choosing only selects. */
  onActivate?: (board: BoardSummary) => void;
  onLeaveTop?: () => void;
  autoFocusFirst?: boolean;
  busy?: boolean;
}

/** `listbox "Boards"` whose options are named by board name; Up and Down move (and select) with the keyboard. */
export function BoardListbox({ boards, value, onChange, onActivate, onLeaveTop, autoFocusFirst = false, busy = false }: Props) {
  const rovingId = boards.some((board) => board.id === value) ? value : boards[0]?.id;
  const optionAt = (list: HTMLElement, index: number): HTMLElement | null => list.querySelectorAll<HTMLElement>('[role="option"]')[index] ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
    const index = options.findIndex((option) => option === document.activeElement);
    if (index < 0) return;
    const move = (to: number): void => {
      event.preventDefault();
      const target = optionAt(event.currentTarget, to);
      const board = boards[to];
      if (target && board) {
        target.focus();
        onChange(board);
      }
    };
    switch (event.key) {
      case "ArrowDown":
        return move(Math.min(options.length - 1, index + 1));
      case "ArrowUp":
        if (index === 0 && onLeaveTop) {
          event.preventDefault();
          return onLeaveTop();
        }
        return move(Math.max(0, index - 1));
      case "Home":
        return move(0);
      case "End":
        return move(options.length - 1);
      case "Enter":
      case " ": {
        event.preventDefault();
        const board = boards[index];
        if (board) {
          onChange(board);
          onActivate?.(board);
        }
      }
    }
  };

  return (
    <ul role="listbox" aria-label="Boards" className="listbox" onKeyDown={onKeyDown} aria-busy={busy || undefined}>
      {boards.map((board, index) => (
        <li
          key={board.id}
          role="option"
          data-board-id={board.id}
          data-autofocus={autoFocusFirst && index === 0 ? "" : undefined}
          aria-selected={board.id === value}
          aria-label={board.name}
          tabIndex={board.id === rovingId ? 0 : -1}
          className="option"
          onClick={() => {
            onChange(board);
            onActivate?.(board);
          }}
        >
          <span>{board.name}</span>
          <span className="option-meta">{board.visibility === "secret" ? "Secret" : "Public"}</span>
        </li>
      ))}
    </ul>
  );
}
