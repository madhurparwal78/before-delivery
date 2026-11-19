import { useState, type FormEvent } from "react";
import type { SetJson } from "../../../server/configsets.js";
import { failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useSession } from "../../lib/session.js";
import { Button, Field, loadingScreen, Page, Rest, StatusBlock, useLoad } from "../../lib/ui.js";
import { FilePicker } from "./FilePicker.js";

type Action = "create" | "update" | "unchanged" | "collision" | "delete";
type Choice = "take_set" | "keep_live";
type Step = "export" | "preview" | "commit" | "backout";

interface PreviewItem {
  kind: string;
  name: string;
  action: Action;
}

interface Preview {
  setId: number;
  number: string;
  items: PreviewItem[];
}

interface Note {
  text: string;
  failed: boolean;
}

const STATE_WORDS: Record<SetJson["state"], string> = { open: "Open", exported: "Exported", committed: "Committed", backed_out: "Backed out" };
const ACTION_WORDS: Record<Action, string> = { create: "Create", update: "Update", unchanged: "Unchanged", collision: "Collision", delete: "Delete" };
const PENDING: Record<Step, string> = { export: "Exporting...", preview: "Previewing...", commit: "Committing...", backout: "Backing out..." };

const kindWord = (kind: string): string => {
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const itemKey = (item: PreviewItem): string => `${item.kind}:${item.name}`;

export function ConfigSets(): JSX.Element {
  const announce = useAnnounce();
  const session = useSession();
  const { state, reload, setData } = useLoad(async () => (await get<{ sets: SetJson[] }>("/api/config-sets")).sets, [session.accessVersion]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createProblem, setCreateProblem] = useState("");
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState<{ id: number; step: Step } | null>(null);
  const [notes, setNotes] = useState<Record<number, Note>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  const waiting = loadingScreen(state, "Configuration sets", reload);
  if (waiting || state.status !== "ready") return waiting!;
  const sets = state.data;

  const upsert = (set: SetJson): void => setData(sets.some((entry) => entry.id === set.id) ? sets.map((entry) => (entry.id === set.id ? set : entry)) : [...sets, set]);
  const note = (id: number, text: string, failed: boolean): void => {
    setNotes((now) => ({ ...now, [id]: { text, failed } }));
    announce(text);
  };

  const create = (event: FormEvent): void => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateProblem("");
    post<{ set: SetJson }>("/api/config-sets", { name }).then(
      ({ set }) => {
        upsert(set);
        setName("");
        setCreating(false);
      },
      (error: unknown) => {
        const text = failureText(error);
        setCreateProblem(text);
        announce(text);
        setCreating(false);
      },
    );
  };

  const upload = (file: File): void => {
    const body = new FormData();
    body.set("file", file);
    setUploading(true);
    setCreateProblem("");
    post<{ set: SetJson }>("/api/config-sets/upload", body).then(
      ({ set }) => {
        upsert(set);
        announce(`Set ${set.number} uploaded.`);
        setUploading(false);
      },
      (error: unknown) => {
        const text = failureText(error);
        setCreateProblem(text);
        announce(text);
        setUploading(false);
      },
    );
  };

  const act = (set: SetJson, step: Step): void => {
    if (running) return;
    setRunning({ id: set.id, step });
    setNotes((now) => ({ ...now, [set.id]: { text: PENDING[step], failed: false } }));
    if (step !== "preview") announce(PENDING[step]);
    const done = (): void => setRunning(null);
    const refused = (error: unknown): void => {
      note(set.id, failureText(error), true);
      done();
    };
    const base = `/api/config-sets/${set.id}`;
    if (step === "export") {
      post<{ set: SetJson }>(`${base}/export`).then((result) => {
        upsert(result.set);
        note(set.id, `Set ${set.number} exported.`, false);
        done();
      }, refused);
    } else if (step === "preview") {
      post<{ items: PreviewItem[] }>(`${base}/preview`).then((result) => {
        setPreview({ setId: set.id, number: set.number, items: result.items });
        setChoices({});
        note(set.id, `Preview of ${set.number} ready.`, false);
        done();
      }, refused);
    } else if (step === "commit") {
      post<{ set: SetJson; applied: number }>(`${base}/commit`, { choices: preview?.setId === set.id ? choices : {} }).then((result) => {
        upsert(result.set);
        if (preview?.setId === set.id) setPreview(null);
        note(set.id, `Set ${set.number} committed: ${result.applied} items applied.`, false);
        done();
      }, refused);
    } else {
      post<{ set: SetJson }>(`${base}/backout`).then((result) => {
        upsert(result.set);
        if (preview?.setId === set.id) setPreview(null);
        note(set.id, `Set ${set.number} backed out.`, false);
        done();
      }, refused);
    }
  };

  const stepButton = (set: SetJson, step: Step, label: string): JSX.Element => {
    const mine = running?.id === set.id && running.step === step;
    return (
      <Button variant="outline" busy={mine} aria-disabled={running?.id === set.id || undefined} onClick={() => act(set, step)}>
        {mine ? PENDING[step] : label}
      </Button>
    );
  };

  return (
    <Page subject="Configuration sets">
      <Rest narrow>
        <form className="stack" onSubmit={create} aria-label="Configuration set files">
          <Field label="Set name">
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="row">
            <Button type="submit" busy={creating} aria-disabled={creating || undefined}>
              New set
            </Button>
            <FilePicker label="Upload set file" accept=".json,application/json" busy={uploading} onFile={upload} />
          </div>
          {createProblem ? <p className="form-error">{createProblem}</p> : null}
        </form>
      </Rest>
      <Rest label="Sets">
        {sets.length === 0 ? (
          <p className="muted">No configuration sets yet.</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Sets list">
            <table className="data-table sets-table">
              <thead>
                <tr>
                  <th scope="col">Set</th>
                  <th scope="col">Name</th>
                  <th scope="col">State</th>
                  <th scope="col" className="num">
                    Items
                  </th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sets.map((set) => {
                  const message = notes[set.id];
                  return (
                    <tr key={set.id}>
                      <th scope="row">{set.number}</th>
                      <td>{set.name}</td>
                      <td>
                        <StatusBlock outlined={set.state === "open"}>{STATE_WORDS[set.state]}</StatusBlock>
                      </td>
                      <td className="num">{set.items.length}</td>
                      <td className="actions">
                        <div className="row">
                          {stepButton(set, "export", "Export set")}
                          {stepButton(set, "preview", "Preview against live")}
                          {stepButton(set, "commit", "Commit set")}
                          {stepButton(set, "backout", "Back out set")}
                        </div>
                        {message ? <p className={message.failed ? "form-error" : "job-line"}>{message.text}</p> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Rest>
      {preview ? (
        <Rest label="Preview">
          <div className="stack">
            <h2 className="rest-heading">Preview of {preview.number}</h2>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Preview rows">
              <table className="data-table" aria-label="Set preview">
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Name</th>
                    <th scope="col">Action</th>
                    <th scope="col">Choice</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((item) => (
                    <tr key={itemKey(item)}>
                      <td>{kindWord(item.kind)}</td>
                      <td>{item.name}</td>
                      <td>
                        <StatusBlock outlined={item.action !== "collision"}>{ACTION_WORDS[item.action]}</StatusBlock>
                      </td>
                      <td>
                        {item.action === "collision" ? (
                          <div role="radiogroup" aria-label={item.name} className="choice">
                            {(["take_set", "keep_live"] as const).map((choice) => (
                              <label key={choice} className="check">
                                <input
                                  type="radio"
                                  name={`choice-${itemKey(item)}`}
                                  checked={choices[itemKey(item)] === choice}
                                  onChange={() => setChoices((now) => ({ ...now, [itemKey(item)]: choice }))}
                                />
                                <span>{choice === "take_set" ? "Take set" : "Keep live"}</span>
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Rest>
      ) : null}
    </Page>
  );
}
