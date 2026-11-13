import { useState } from "react";
import { ApiFailure, call } from "./api";
import { Dialog, useDialogClose } from "./Dialog";
import { navigate } from "./router";
import { LINK_ACCESSES, PRIVACIES, type Board, type FieldErrors, type LinkAccess, type Privacy } from "../shared/types";

interface Props {
  board: Board;
  reload: () => Promise<unknown>;
  onClose: () => void;
}

const PRIVACY_LABELS: Record<Privacy, string> = { private: "Private", password: "Password", public: "Public" };
const LINK_LABELS: Record<LinkAccess, string> = { off: "Off", view: "Can view", contribute: "Can contribute" };

export function SettingsDialog(props: Props) {
  return (
    <Dialog label="Board settings" onClose={props.onClose}>
      <SettingsForm {...props} />
    </Dialog>
  );
}

function SettingsForm({ board, reload }: Props) {
  const close = useDialogClose();
  const [privacy, setPrivacy] = useState(board.privacy);
  const [linkAccess, setLinkAccess] = useState(board.link_access);
  const [approval, setApproval] = useState(board.approval);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setErrors({});
    try {
      await call("PATCH", `/api/boards/${board.id}`, { privacy, link_access: linkAccess, approval, ...(password ? { password } : {}) });
      await reload();
      close();
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 422) throw error;
      setErrors(error.body.errors ?? {});
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (): Promise<void> => {
    await call("POST", `/api/boards/${board.id}/rotate-link`);
    await reload();
  };

  const destroy = async (): Promise<void> => {
    await call("DELETE", `/api/boards/${board.id}`);
    navigate("/");
  };

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 className="form-heading">Board settings</h2>
      <fieldset role="radiogroup" aria-label="Privacy" className="choices">
        <legend aria-hidden="true">Privacy</legend>
        {PRIVACIES.map((value) => (
          <label key={value} className="segment">
            <input type="radio" name="privacy" aria-label={PRIVACY_LABELS[value]} checked={privacy === value} onChange={() => setPrivacy(value)} />
            <span>{PRIVACY_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="board-password">Board password</label>
        <input id="board-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        {errors["password"] && <p className="field-error">{errors["password"]}</p>}
      </div>
      <fieldset role="radiogroup" aria-label="Link access" className="choices">
        <legend aria-hidden="true">Link access</legend>
        {LINK_ACCESSES.map((value) => (
          <label key={value} className="segment">
            <input type="radio" name="link-access" aria-label={LINK_LABELS[value]} checked={linkAccess === value} onChange={() => setLinkAccess(value)} />
            <span>{LINK_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>
      {board.share_path && <p className="small muted share-link">{`${location.origin}${board.share_path}`}</p>}
      <button type="button" className="quiet" onClick={() => void rotate()}>
        Rotate link
      </button>
      <label className="check">
        <input type="checkbox" aria-label="Require approval" checked={approval} onChange={(event) => setApproval(event.target.checked)} />
        <span>Require approval</span>
      </label>
      <div className="form-actions">
        <button type="button" className="quiet" onClick={() => setConfirming(true)}>
          Delete board
        </button>
        <button type="button" className="quiet" onClick={close}>
          Cancel
        </button>
        <button type="submit" aria-busy={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
      {confirming && (
        <Dialog label="Delete this board?" alert onClose={() => setConfirming(false)}>
          <ConfirmDelete title={board.title} onDelete={destroy} />
        </Dialog>
      )}
    </form>
  );
}

function ConfirmDelete({ title, onDelete }: { title: string; onDelete: () => Promise<void> }) {
  const close = useDialogClose();
  return (
    <div className="form">
      <h2 className="form-heading">Delete this board?</h2>
      <p>{`Every post, comment and file on ${title} will be removed.`}</p>
      <div className="form-actions">
        <button type="button" className="quiet" data-autofocus onClick={close}>
          Keep board
        </button>
        <button type="button" onClick={() => void onDelete()}>
          Delete for good
        </button>
      </div>
    </div>
  );
}
