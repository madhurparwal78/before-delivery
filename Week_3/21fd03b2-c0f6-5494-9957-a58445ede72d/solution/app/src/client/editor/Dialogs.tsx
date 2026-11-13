import { useEffect, useMemo, useRef, useState } from "react";
import { COPY, NOTICE } from "../../shared/copy";
import type { SceneDocument } from "../../shared/doc";
import { RIG_PARAMS } from "../../shared/params";
import { ApiFailure, request } from "../api";
import { notify } from "../notices";
import { Dialog, formatLocal } from "../ui";
import { useStore } from "./StageHost";
import type { EditorStore, LabInfo } from "./store";

const SHORTCUTS: Array<[string, string]> = [
  ["R", "Run, or Stop while running"],
  ["P", "Pause or Resume"],
  ["N", "Step"],
  ["Escape", "Stop while running; clear the selection when editing"],
  ["W, E, T", "Move, Rotate, Scale"],
  ["S", "Snap"],
  ["G", "Grid"],
  ["F", "Frame the selected object"],
  ["Delete or Backspace", "Remove the selected object"],
  ["F2", "Rename the selected object"],
  ["Ctrl+Z or Cmd+Z", "Undo"],
  ["Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y", "Redo"],
  ["Ctrl+K or Cmd+K", "Open the command palette"],
  ["?", "Open Keyboard shortcuts"],
];

export function ShortcutsDialog({ store }: { store: EditorStore }): JSX.Element {
  return (
    <Dialog title="Keyboard shortcuts" onEscape={() => store.closeDialog()}>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <div className="dialog-actions">
        <button type="button" className="chip primary" onClick={() => store.closeDialog()}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

interface Command {
  label: string;
  run: () => void;
}

export function CommandsDialog({ store }: { store: EditorStore }): JSX.Element {
  const state = useStore(store);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const commands = useMemo<Command[]>(() => {
    const later = (work: () => void) => () => {
      store.closeDialog();
      work();
    };
    const base: Command[] = [
      { label: "Run", run: later(() => store.startRun()) },
      { label: "Stop", run: later(() => store.stopRun()) },
      { label: "Pause", run: later(() => !store.state.paused && store.togglePause()) },
      { label: "Step", run: later(() => store.stepOnce()) },
      { label: "Add ramp", run: later(() => store.place({ kind: "ramp" })) },
      { label: "Add pendulum", run: later(() => store.place({ kind: "pendulum" })) },
      { label: "Add launcher", run: later(() => store.place({ kind: "launcher" })) },
      { label: "Add crate", run: later(() => store.place({ kind: "crate" })) },
      { label: "Toggle snap", run: later(() => store.toggleSnap()) },
      { label: "Toggle grid", run: later(() => store.toggleGrid()) },
      { label: "Undo", run: later(() => void store.undo()) },
      { label: "Redo", run: later(() => void store.redo()) },
      { label: "New checkpoint", run: later(() => store.setPanel("assets", { open: true })) },
      { label: "Open publish", run: () => store.openDialog("publish") },
      { label: "Open share", run: () => store.openDialog("share") },
      { label: "Reset layout", run: later(() => store.resetLayout()) },
    ];
    return [...base, ...state.doc.objects.map((o) => ({ label: `Select ${o.name}`, run: later(() => store.select(o.id)) }))];
  }, [store, state.doc.objects]);
  const matches = commands.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));
  const index = Math.min(active, Math.max(matches.length - 1, 0));
  return (
    <Dialog title="Commands" onEscape={() => store.closeDialog()} initialFocus="input">
      <input
        role="combobox"
        aria-label="Command"
        aria-expanded="true"
        aria-controls="command-options"
        aria-activedescendant={matches[index] ? `command-option-${index}` : undefined}
        aria-autocomplete="list"
        className="command-input"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(Math.min(index + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(Math.max(index - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            matches[index]?.run();
          }
        }}
      />
      <ul role="listbox" id="command-options" aria-label="Matching commands" className="command-list">
        {matches.map((c, i) => (
          <li key={c.label} role="option" id={`command-option-${i}`} aria-selected={i === index} className={i === index ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => c.run()}>
            {c.label}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function RestoreDialog({ store }: { store: EditorStore }): JSX.Element | null {
  const state = useStore(store);
  if (!state.restoreTarget) return null;
  return (
    <Dialog title="Restore checkpoint" role="alertdialog" onEscape={() => store.closeDialog()} initialFocus="[data-cancel]">
      <p>
        Restore <b>{state.restoreTarget.label}</b>? The scene returns to that checkpoint as a new revision.
      </p>
      <div className="dialog-actions">
        <button type="button" data-cancel className="chip" onClick={() => store.closeDialog()}>
          Cancel
        </button>
        <button type="button" className="chip primary" onClick={() => void store.confirmRestore()}>
          Restore
        </button>
      </div>
    </Dialog>
  );
}

export function ConflictDialog({ store }: { store: EditorStore }): JSX.Element {
  return (
    <Dialog title="Scene changed elsewhere" role="alertdialog">
      <p>Someone saved a newer version of this scene. Keep your unsaved changes on top of it, or use theirs.</p>
      <div className="dialog-actions">
        <button type="button" className="chip" onClick={() => void store.keepMine()}>
          Keep my changes
        </button>
        <button type="button" className="chip primary" onClick={() => void store.useTheirs()}>
          Use their version
        </button>
      </div>
    </Dialog>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  notify(NOTICE.copied);
}

function paramRows(doc: SceneDocument): Array<{ key: string; label: string }> {
  return doc.objects.flatMap((o) => (o.kind === "model" ? [] : RIG_PARAMS[o.kind].map((d) => ({ key: `${o.id}.${d.key}`, label: `${o.name}: ${d.label}` }))));
}

export function PublishDialog({ store }: { store: EditorStore }): JSX.Element {
  const state = useStore(store);
  const [checkpointId, setCheckpointId] = useState(state.scene.lab?.checkpointId ?? state.checkpoints[0]?.id ?? "");
  const [rows, setRows] = useState<Array<{ key: string; label: string }>>([]);
  const [chosen, setChosen] = useState<string[]>(state.scene.lab?.exposed ?? []);
  const [error, setError] = useState<string | null>(null);
  const lab = state.scene.lab;
  useEffect(() => {
    if (!checkpointId) return;
    let live = true;
    fetch(`/api/scenes/${state.scene.id}/checkpoints/${checkpointId}/document`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<SceneDocument>) : null))
      .then((doc) => live && doc && setRows(paramRows(doc)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [checkpointId, state.scene.id]);
  const publish = async (): Promise<void> => {
    setError(null);
    if (!checkpointId) {
      notify(NOTICE.needCheckpoint);
      return;
    }
    notify(NOTICE.publishing);
    try {
      const { data } = await request<{ lab: LabInfo; delivery: "sent" | "queued" }>(`/api/scenes/${state.scene.id}/publish`, { method: "POST", body: { checkpointId, exposed: chosen } });
      store.setSceneMeta({ status: "published", lab: data.lab });
      notify(data.delivery === "sent" ? NOTICE.published(data.lab.url) : NOTICE.publishedQueued(data.lab.url));
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "no_checkpoint") notify(NOTICE.needCheckpoint);
      else if (e instanceof ApiFailure && e.code === "storage_unavailable") notify("File storage is unreachable. Uploads, checkpoints and publishing are paused.");
      else {
        notify("");
        setError(e instanceof ApiFailure ? (e.fields.exposed ?? e.message) : COPY.exposed);
      }
    }
  };
  const act = async (path: string, done: (data: { lab?: LabInfo }) => void): Promise<void> => {
    try {
      const { data } = await request<{ lab?: LabInfo }>(`/api/scenes/${state.scene.id}/${path}`, { method: "POST", body: {} });
      done(data);
    } catch (e) {
      notify(e instanceof ApiFailure ? e.message : "Something went wrong.");
    }
  };
  return (
    <Dialog title="Publish lab" onEscape={() => store.closeDialog()}>
      <div className="stack">
        <div className="field">
          <label htmlFor="publish-checkpoint">Checkpoint</label>
          <select id="publish-checkpoint" value={checkpointId} onChange={(e) => setCheckpointId(e.target.value)}>
            {state.checkpoints.length === 0 ? <option value="">No checkpoints yet</option> : null}
            {state.checkpoints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="checks">
          <legend>Student controls</legend>
          {rows.map((r) => (
            <label key={r.key} className="check">
              <input type="checkbox" checked={chosen.includes(r.key)} onChange={(e) => setChosen(e.target.checked ? [...chosen, r.key] : chosen.filter((k) => k !== r.key))} />
              {r.label}
            </label>
          ))}
          {rows.length === 0 ? <p className="empty-line">Save a checkpoint to choose student controls.</p> : null}
        </fieldset>
        {error ? <p className="field-error">{error}</p> : null}
        {lab ? (
          <div className="lab-address">
            <span className="muted">Lab address</span>
            <code>{lab.url}</code>
            <div className="dialog-actions left">
              <button type="button" className="chip" onClick={() => void copyText(lab.url)}>
                Copy lab link
              </button>
              <button type="button" className="chip" onClick={() => void act("lab-link/regenerate", (d) => (store.setSceneMeta({ lab: d.lab ?? null }), notify(NOTICE.labRegenerated)))}>
                Regenerate lab link
              </button>
              <button type="button" className="chip" onClick={() => void act("unpublish", () => (store.setSceneMeta({ status: "unpublished", lab: null }), notify(NOTICE.unpublished)))}>
                Unpublish
              </button>
            </div>
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="chip" onClick={() => store.closeDialog()}>
            Close
          </button>
          <button type="button" className="chip primary" onClick={() => void publish()}>
            Publish lab
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface ShareLink {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
}

export function ShareDialog({ store }: { store: EditorStore }): JSX.Element {
  const state = useStore(store);
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const path = `/api/projects/${state.projectId}/share-links`;
  const load = async (): Promise<void> => {
    const { data } = await request<{ links: ShareLink[] }>(path);
    setLinks(data.links);
  };
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.fields.email ?? e.message) : "Something went wrong.");
    }
  };
  return (
    <Dialog title="Share project" onEscape={() => store.closeDialog()}>
      <div className="stack">
        <button
          type="button"
          className="chip"
          onClick={() =>
            void run(async () => {
              await request(path, { method: "POST", body: {} });
              notify(NOTICE.linkCreated);
            })
          }
        >
          Create read-only link
        </button>
        <div className="field">
          <label htmlFor="share-email">Email the link to</label>
          <input id="share-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "share-error" : undefined} />
          {error ? (
            <p id="share-error" className="field-error">
              {error}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="chip"
          onClick={() =>
            void run(async () => {
              const { data } = await request<{ delivery: "sent" | "queued" | null }>(path, { method: "POST", body: { email } });
              notify(data.delivery === "sent" ? NOTICE.linkEmailed(email) : NOTICE.linkQueued(email));
              setEmail("");
            })
          }
        >
          Create and email link
        </button>
        <h3 className="sub-title">Active links</h3>
        {links && links.length === 0 ? <p className="empty-line">No active links.</p> : null}
        <ul aria-label="Active links" className="rows link-rows">
          {(links ?? []).map((l) => (
            <li key={l.id}>
              <span className="muted">Expires {formatLocal(l.expiresAt)}</span>
              <code className="link-url">{l.url}</code>
              <div className="dialog-actions left">
                <button type="button" className="chip" onClick={() => void copyText(l.url)}>
                  Copy link
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    void run(async () => {
                      await request(`/api/share-links/${l.id}/regenerate`, { method: "POST", body: {} });
                      notify(NOTICE.linkRegenerated);
                    })
                  }
                >
                  Regenerate link
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    void run(async () => {
                      await request(`/api/share-links/${l.id}`, { method: "DELETE" });
                      notify(NOTICE.linkRevoked);
                    })
                  }
                >
                  Revoke link
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="chip" onClick={() => store.closeDialog()}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
