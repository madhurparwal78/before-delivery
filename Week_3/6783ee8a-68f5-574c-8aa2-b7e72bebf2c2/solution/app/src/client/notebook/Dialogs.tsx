import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import type { Share, ShareRole } from "../../shared/api";
import { ApiFailure, del, get, post } from "../api";
import { Dialog } from "../components/Dialog";
import { shownType } from "./model";
import type { NotebookState } from "./model";
import { Contents } from "./Chrome";
import type { NotebookStore } from "./store";

interface Props {
  store: NotebookStore;
  state: NotebookState;
}

export function RestartDialog({ store }: Props): ReactNode {
  return (
    <Dialog label="Restart kernel?" onClose={() => store.close()}>
      <h2>Restart kernel?</h2>
      <p>All variables will be cleared. Outputs stay.</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => store.close()}>Cancel</button>
        <button type="button" className="btn btn-accent" onClick={() => store.command(() => store.restart())}>Restart</button>
      </div>
    </Dialog>
  );
}

export function ConflictDialog({ store, state }: Props): ReactNode {
  const dialog = state.dialog;
  if (dialog?.kind !== "conflict") return null;
  return (
    <Dialog label="Notebook changed elsewhere" returnFocus={() => document.getElementById(`cell-${dialog.cellId}`)}>
      <h2>Notebook changed elsewhere</h2>
      <p>Someone saved this notebook after you started editing. Choose which version to keep.</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => store.reloadLatest()}>Reload latest</button>
        <button type="button" className="btn btn-accent" onClick={() => store.keepMine()}>Keep my version</button>
      </div>
    </Dialog>
  );
}

export function RevertDialog({ store, state }: Props): ReactNode {
  const dialog = state.dialog;
  if (dialog?.kind !== "revert") return null;
  const { checkpoint, cellId } = dialog;
  return (
    <Dialog label={`Revert to ${checkpoint.label}?`} onClose={() => store.close()}>
      <h2>{`Revert to ${checkpoint.label}?`}</h2>
      <p>A checkpoint named Before revert is saved first.</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => store.close()}>Cancel</button>
        <button type="button" className="btn btn-accent" onClick={() => store.command(() => store.revert(checkpoint, cellId))}>Revert</button>
      </div>
    </Dialog>
  );
}

export function DrawerDialog({ store, state }: Props): ReactNode {
  return (
    <Dialog label="Contents" variant="drawer" onClose={() => store.close()}>
      <h2>Contents</h2>
      <Contents store={store} state={state} />
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => store.close()}>Close</button>
      </div>
    </Dialog>
  );
}

export function SheetDialog({ store, state }: Props): ReactNode {
  const dialog = state.dialog;
  if (dialog?.kind !== "sheet") return null;
  const id = dialog.cellId;
  const viewer = !store.canEdit;
  const act = (work: () => Promise<void>) => () => {
    store.close();
    store.select(id);
    store.command(work);
  };
  const model = state.cells.find((m) => m.server.id === id);
  return (
    <Dialog label="Cell actions" variant="sheet" onClose={() => store.close()}>
      <div className="sheet-actions">
        {!viewer && (
          <>
            <button type="button" className="btn" onClick={act(() => store.run("stay"))}>Run</button>
            <button type="button" className="btn" onClick={act(async () => void (await store.insert("below")))}>Insert below</button>
            <button type="button" className="btn" onClick={act(async () => store.retype(model && shownType(model) === "code" ? "markdown" : "code"))}>Change type</button>
            <button type="button" className="btn" onClick={act(() => store.shift(-1, id))}>Move up</button>
            <button type="button" className="btn" onClick={act(() => store.shift(1, id))}>Move down</button>
            <button type="button" className="btn" onClick={act(() => store.remove())}>Delete</button>
          </>
        )}
        <button type="button" className="btn" onClick={() => store.close()}>Close</button>
      </div>
    </Dialog>
  );
}

interface Command {
  label: string;
  run: () => void;
}

export function PaletteDialog({ store }: Pick<Props, "store">): ReactNode {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  const editor = store.canEdit;
  const cmd = (work: () => Promise<void>) => () => store.command(work);
  const all: Command[] = [
    ...(editor
      ? [
          { label: "Run all cells", run: cmd(() => store.runAll()) },
          { label: "Run selected cell", run: cmd(() => store.run("stay")) },
          { label: "Interrupt kernel", run: () => store.interrupt() },
          { label: "Restart kernel", run: () => store.open({ kind: "restart" }) },
          { label: "Save checkpoint", run: cmd(() => store.saveCheckpoint()) },
          { label: "Insert code cell below", run: cmd(async () => void (await store.insert("below", "code"))) },
          { label: "Insert markdown cell below", run: cmd(async () => void (await store.insert("below", "markdown"))) },
        ]
      : []),
    { label: "Export notebook", run: cmd(() => store.exportFile()) },
    { label: "Show table of contents", run: () => store.open({ kind: "drawer" }) },
  ];
  const shown = all.filter((command) => command.label.toLowerCase().includes(text.toLowerCase()));
  const chosen = Math.min(active, Math.max(shown.length - 1, 0));

  useEffect(() => setActive(0), [text]);

  const choose = (command: Command | undefined): void => {
    if (!command) return;
    store.close();
    command.run();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown") setActive((chosen + 1) % Math.max(shown.length, 1));
    else if (event.key === "ArrowUp") setActive((chosen - 1 + shown.length) % Math.max(shown.length, 1));
    else if (event.key === "Enter") choose(shown[chosen]);
    else return;
    event.preventDefault();
  };

  return (
    <Dialog label="Command palette" onClose={() => store.close()} initialFocus={() => input.current}>
      <h2>Command palette</h2>
      <input
        ref={input}
        role="combobox"
        aria-label="Search commands"
        aria-expanded="true"
        aria-controls={list}
        aria-activedescendant={shown[chosen] ? `${list}-${chosen}` : undefined}
        aria-autocomplete="list"
        className="palette-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKey}
      />
      <ul id={list} role="listbox" aria-label="Commands" className="palette-list">
        {shown.map((command, index) => (
          <li
            key={command.label}
            id={`${list}-${index}`}
            role="option"
            aria-selected={index === chosen}
            className={index === chosen ? "active" : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(command)}
          >
            {command.label}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function ShareDialog({ store }: Props): ReactNode {
  const [shares, setShares] = useState<Share[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const base = `/api/notebooks/${store.state.meta?.id}`;

  const load = (): void => void get<{ shares: Share[] }>(`${base}/shares`).then((found) => setShares(found.shares), () => undefined);
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setProblem("");
    setMessage("Sending invitation…");
    try {
      await post(`${base}/shares`, { email, role });
      setMessage(`Invitation sent to ${email}`);
      setEmail("");
      load();
    } catch (error) {
      setMessage("");
      if (!(error instanceof ApiFailure)) throw error;
      if (error.body.error === "already_shared") setProblem(`${email} already has access`);
      else if (error.body.error === "mail_unavailable") setProblem("Invitation not sent: email is unavailable");
      else setProblem(error.body.errors?.map((e) => `${e.path} ${e.message}`).join(". ") ?? error.message);
    }
  };

  return (
    <Dialog label="Share notebook" onClose={() => store.close()}>
      <h2>Share notebook</h2>
      <form onSubmit={(event) => void send(event)} noValidate>
        <label className="field">
          <span className="label">Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
        </label>
        <div role="radiogroup" aria-label="Role" className="radio-row">
          {(["editor", "viewer"] as const).map((value) => (
            <label key={value} className="radio">
              <input type="radio" name="role" checked={role === value} onChange={() => setRole(value)} />
              <span>{value === "editor" ? "Editor" : "Viewer"}</span>
            </label>
          ))}
        </div>
        <p className="share-message" role="status" aria-live="polite">{message || problem}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => store.close()}>Close</button>
          <button type="submit" className="btn btn-accent">Send invitation</button>
        </div>
      </form>
      <h3>People with access</h3>
      <ul aria-label="People with access" className="access-list">
        {shares.map((share) => {
          const who = share.display_name ?? share.email;
          return (
            <li key={share.id}>
              <span>{who}</span> <span className="muted">{`${share.role === "editor" ? "Editor" : "Viewer"}, ${share.status}`}</span>
              <button type="button" className="btn small" onClick={() => void del(`${base}/shares/${share.id}`).then(load)}>{`Remove ${who}`}</button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
