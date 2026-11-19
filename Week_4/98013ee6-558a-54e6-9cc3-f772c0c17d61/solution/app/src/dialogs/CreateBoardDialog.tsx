import { useState, type FormEvent } from "react";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { InlineAlert } from "../ui/InlineAlert";
import type { Board, Visibility } from "../../shared/types";

export function VisibilityChoice({ value, onChange }: { value: Visibility; onChange: (value: Visibility) => void }) {
  return (
    <div role="radiogroup" aria-label="Visibility" className="choice">
      {(["public", "secret"] as const).map((option) => (
        <label key={option} className="choice-option">
          <input type="radio" name="visibility" checked={value === option} onChange={() => onChange(option)} />
          <span>{option === "public" ? "Public" : "Secret"}</span>
        </label>
      ))}
    </div>
  );
}

export function CreateBoardDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (board: Board) => void }) {
  const { config } = useSession();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const board = await api.post<Board>("/api/boards", { name, visibility });
      onCreated(board);
      onClose();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "board_name_taken") setError(`You already have a board called ${name.trim()}.`);
      else if (failure instanceof ApiFailure && failure.field === "name") setError(`Board names are 1 to ${config.limits.board_name_max} characters.`);
      else setError(GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Create board" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} data-autofocus onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </label>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <VisibilityChoice value={visibility} onChange={setVisibility} />
        <div className="actions">
          <Button variant="primary" type="submit" busy={busy} busyLabel="Creating">Create</Button>
        </div>
      </form>
    </Dialog>
  );
}
