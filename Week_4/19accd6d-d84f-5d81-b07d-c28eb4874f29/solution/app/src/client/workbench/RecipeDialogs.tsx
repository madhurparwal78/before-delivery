import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import type { RecipeSummary, Snapshot, Version } from "../../shared/api";
import { ttlLabel } from "../../shared/ttl";
import { api, ApiFailure, config } from "../api";
import { session } from "../session";
import { useStore } from "../store";
import { Modal } from "../ui/Modal";
import { loadLatest, recordSave, whileSaving } from "./actions";
import { toBase64 } from "./link";
import { activeTab, compactSteps, inputBytes, stepsKey, workbench } from "./state";
import { announce } from "../announce";
import { BADGES, snapshotLine } from "../snapshotLine";

/** The first save of a recipe asks where it lives; later saves keep its owner. */
export function SaveDialog({ onClose, onStale, returnFocus }: {
  onClose: () => void; onStale: (message: string) => void; returnFocus: RefObject<HTMLElement | null>;
}) {
  const binding = useStore(workbench, (state) => state.binding);
  const teams = useStore(session, (state) => state.teams);
  const [name, setName] = useState(binding?.name ?? "");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState(binding?.tags.join(", ") ?? "");
  const [saveTo, setSaveTo] = useState("personal");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFields({});
    setProblem(null);
    const { steps } = workbench.get();
    const content = {
      name, note, steps: compactSteps(steps), tags: tags.split(",").map((tag) => tag.trim()).filter((tag) => tag !== ""),
    };
    try {
      const saved = await whileSaving(
        () =>
          binding
            ? api<{ recipe: RecipeSummary; version: Version }>("POST", `/api/recipes/${binding.recipeId}/versions`, { ...content, baseVersion: binding.baseVersion })
            : api<{ recipe: RecipeSummary; version: Version }>("POST", "/api/recipes", {
                ...content,
                owner: saveTo === "personal" ? { type: "user", id: session.get().user?.id } : { type: "team", id: saveTo },
              }),
        (result) => result.version.n,
      );
      recordSave(saved.recipe, saved.version);
      onClose();
    } catch (error) {
      setBusy(false);
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 409 && error.code === "version_conflict") onStale(error.message);
      else if (error.details?.fields) setFields(error.details.fields);
      else setProblem(error.message);
    }
  };

  const fieldProblem = (key: string): string | undefined => fields[key];
  const stepProblems = Object.entries(fields).filter(([key]) => key === "steps" || key.startsWith("steps."));
  return (
    <Modal title="Save recipe" onClose={onClose} initialFocus={nameField} returnFocus={returnFocus}>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="form-field">
          <label htmlFor="save-name">Recipe name</label>
          <input id="save-name" ref={nameField} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={fieldProblem("name") !== undefined} autoComplete="off" />
          {fieldProblem("name") && <p className="field-error">{fieldProblem("name")}</p>}
        </div>
        <div className="form-field">
          <label htmlFor="save-note">Version note</label>
          <input id="save-note" value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={fieldProblem("note") !== undefined} autoComplete="off" />
          {fieldProblem("note") && <p className="field-error">{fieldProblem("note")}</p>}
        </div>
        <div className="form-field">
          <label htmlFor="save-tags">Tags</label>
          <input id="save-tags" value={tags} onChange={(event) => setTags(event.target.value)} aria-invalid={fieldProblem("tags") !== undefined} autoComplete="off" placeholder="webhook, json" />
          {fieldProblem("tags") && <p className="field-error">{fieldProblem("tags")}</p>}
        </div>
        {!binding && (
          <div className="form-field">
            <label htmlFor="save-to">Save to</label>
            <select id="save-to" value={saveTo} onChange={(event) => setSaveTo(event.target.value)}>
              <option value="personal">Personal</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {stepProblems.map(([key, message]) => (
          <p key={key} className="field-error">{message}</p>
        ))}
        {problem && <p className="field-error">{problem}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" aria-busy={busy}>Save version</button>
        </div>
      </form>
    </Modal>
  );
}

/** Shown when a save met a newer version: take the newest, save mine as a copy, or keep editing. */
export function ChangedDialog({ message, onClose, returnFocus }: { message: string; onClose: () => void; returnFocus: RefObject<HTMLElement | null> }) {
  const loadButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const binding = useStore(workbench, (state) => state.binding);

  const saveCopy = async (): Promise<void> => {
    if (busy || !binding) return;
    setBusy(true);
    const { steps } = workbench.get();
    const saved = await api<{ recipe: RecipeSummary; version: Version }>("POST", "/api/recipes", {
      name: `${binding.name.slice(0, 80 - " (copy)".length)} (copy)`,
      owner: { type: binding.owner.type, id: binding.owner.id },
      tags: binding.tags,
      note: "",
      steps: compactSteps(steps),
    });
    recordSave(saved.recipe, saved.version);
    onClose();
  };

  return (
    <Modal title="This recipe changed" onClose={onClose} initialFocus={loadButton} returnFocus={returnFocus}>
      <p className="modal-note">{message}</p>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" aria-busy={busy} onClick={() => void saveCopy()}>Save as copy</button>
        <button
          ref={loadButton}
          type="button"
          className="primary"
          onClick={() => void loadLatest().then(onClose)}
        >
          Load latest
        </button>
      </div>
    </Modal>
  );
}

/** Creates a share snapshot and follows it, once a second, until it settles. */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const choices = config().shareTtlChoices;
  const [ttl, setTtl] = useState(choices[0] as string);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const token = snapshot?.token;
  const settled = snapshot !== null && snapshot.status !== "pending";

  useEffect(() => {
    if (!token || settled) return;
    const poll = setInterval(() => {
      void api<{ snapshot: Snapshot }>("GET", `/api/snapshots/${token}`).then((answer) => setSnapshot(answer.snapshot), () => undefined);
    }, 1000);
    return () => clearInterval(poll);
  }, [token, settled]);

  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const state = workbench.get();
    const tab = activeTab(state);
    const input = inputBytes(tab);
    if (!input) {
      setBusy(false);
      setProblem("The input cannot be encoded, so it cannot be shared.");
      return;
    }
    const { binding } = state;
    const edited = binding !== null && stepsKey(state.steps) !== binding.savedKey;
    try {
      const made = await api<{ snapshot: Snapshot }>("POST", "/api/snapshots", {
        steps: compactSteps(state.steps),
        recipe: binding && !edited ? { id: binding.recipeId, version: binding.baseVersion } : null,
        ...(tab.file?.id ? { fileId: tab.file.id } : { inputBase64: toBase64(input) }),
        outputBase64: toBase64(state.bake.output),
        ttl,
      });
      setSnapshot(made.snapshot);
    } catch (error) {
      setProblem(error instanceof ApiFailure ? error.message : "The snapshot could not be created.");
    }
    setBusy(false);
  };

  const link = snapshot ? `${window.location.origin}${snapshot.url}` : "";
  return (
    <Modal title="Share snapshot" onClose={onClose} initialFocus={first}>
      <fieldset className="radio-group" role="radiogroup" aria-label="Expires after" disabled={snapshot !== null}>
        <legend>Expires after</legend>
        {choices.map((choice, index) => (
          <label key={choice} className="radio">
            <input ref={index === 0 ? first : undefined} type="radio" name="ttl" value={choice} checked={ttl === choice} onChange={() => setTtl(choice)} />
            <span>{ttlLabel(choice)}</span>
          </label>
        ))}
      </fieldset>
      {snapshot && (
        <div role="status" aria-label="Snapshot status" aria-live="polite" className="snapshot-status">
          <span className="badge" data-status={snapshot.status}>{BADGES[snapshot.status]}</span>{" "}
          <span>{snapshotLine(snapshot)}</span>
        </div>
      )}
      {snapshot?.status === "active" && (
        <div className="snapshot-link">
          <input readOnly aria-label="Snapshot link" value={link} onFocus={(event) => event.currentTarget.select()} />
          <button
            type="button"
            aria-label="Copy snapshot link"
            onClick={() => void navigator.clipboard.writeText(link).then(() => announce("Link copied"), () => undefined)}
          >
            Copy
          </button>
        </div>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>Close</button>
        {!snapshot && (
          <button type="button" className="primary" aria-busy={busy} onClick={() => void create()}>Create snapshot</button>
        )}
      </div>
    </Modal>
  );
}
