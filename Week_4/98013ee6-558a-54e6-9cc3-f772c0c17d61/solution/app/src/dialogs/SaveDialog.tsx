import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { notify } from "../lib/feedback";
import { BoardListbox } from "../components/BoardListbox";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { InlineAlert } from "../ui/InlineAlert";
import { CreateBoardDialog } from "./CreateBoardDialog";
import type { BoardSummary, Pin } from "../../shared/types";

/** Saving opens a dialog with a filterable board list that works fully by keyboard. */
export function SaveDialog({ pin, onClose }: { pin: Pin; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [focusBoard, setFocusBoard] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    const found = await api.get<{ boards: BoardSummary[] }>(`/api/boards/mine?q=${encodeURIComponent(typed)}`);
    setBoards(found.boards);
  }, [typed]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (focusBoard === null) return;
    const option = root.current?.querySelector<HTMLElement>(`[data-board-id="${focusBoard}"]`);
    if (option) {
      option.focus();
      setChosen(focusBoard);
      setFocusBoard(null);
    }
  }, [boards, focusBoard]);

  const save = async (board: BoardSummary): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/pins/${pin.id}/saves`, { board: board.id, section: null });
      notify(`Saved to ${board.name}`);
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.code === "already_on_board" ? `This pin is already on ${board.name}.` : GENERIC_ERROR);
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog title="Save to board" onClose={onClose}>
        <div className="stack" ref={root}>
          <input
            ref={search}
            type="search"
            aria-label="Find a board"
            placeholder="Find a board"
            value={typed}
            data-autofocus
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                const first = root.current?.querySelector<HTMLElement>('[role="option"]');
                first?.focus();
                const board = boards[0];
                if (board) setChosen(board.id);
              }
            }}
          />
          {error ? <InlineAlert>{error}</InlineAlert> : null}
          <BoardListbox
            boards={boards}
            value={chosen}
            onChange={(board) => setChosen(board.id)}
            onActivate={(board) => void save(board)}
            onLeaveTop={() => search.current?.focus()}
            busy={saving}
          />
          <div className="actions">
            <Button onClick={() => setCreating(true)}>Create board</Button>
          </div>
        </div>
      </Dialog>
      {creating ? (
        <CreateBoardDialog
          onClose={() => setCreating(false)}
          onCreated={(board) => {
            setTyped("");
            setFocusBoard(board.id);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
