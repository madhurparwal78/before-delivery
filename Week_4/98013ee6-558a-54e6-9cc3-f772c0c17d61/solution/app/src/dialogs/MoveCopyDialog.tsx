import { useEffect, useRef, useState } from "react";
import { counted } from "../../shared/relativeTime";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { reportOperation } from "../lib/operations";
import { BoardListbox } from "../components/BoardListbox";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { InlineAlert } from "../ui/InlineAlert";
import type { BoardSummary, OperationView } from "../../shared/types";

interface Props {
  verb: "Move" | "Copy";
  pinIds: number[];
  currentBoardId: number;
  onClose: () => void;
  onDone: () => void;
  returnFocusTo: HTMLElement | null;
}

export function MoveCopyDialog({ verb, pinIds, currentBoardId, onClose, onDone, returnFocusTo }: Props) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.get<{ boards: BoardSummary[] }>("/api/boards/mine").then((found) => {
      const others = found.boards.filter((board) => board.id !== currentBoardId);
      setBoards(others);
      setChosen(others[0]?.id ?? null);
    });
  }, [currentBoardId]);

  const loaded = boards.length > 0;
  useEffect(() => {
    if (loaded) root.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
  }, [loaded]);

  const target = boards.find((board) => board.id === chosen);
  const run = async (): Promise<void> => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const operation = await api.post<OperationView>("/api/operations", { kind: verb.toLowerCase(), pins: pinIds, board: target.id, section: null });
      reportOperation(operation, `${counted(pinIds.length, "pin", "pins")} ${verb === "Move" ? "moved" : "copied"} to ${target.name}`);
      onDone();
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.code === "already_on_board" ? `This pin is already on ${target.name}.` : GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <Dialog title={`${verb} ${counted(pinIds.length, "pin", "pins")}`} onClose={onClose} returnFocusTo={returnFocusTo}>
      <div className="stack" ref={root}>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <BoardListbox boards={boards} value={chosen} onChange={(board) => setChosen(board.id)} autoFocusFirst />
        <div className="actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} busyLabel={verb === "Move" ? "Moving" : "Copying"} disabled={!target} onClick={() => void run()}>
            {`${verb} here`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
