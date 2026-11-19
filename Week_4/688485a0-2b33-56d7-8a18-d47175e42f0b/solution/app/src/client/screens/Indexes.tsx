import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { documentMessage } from "../../shared/messages.js";
import { asFailure, del, get, post } from "../api.js";
import { useToast } from "../components/Toast.js";
import { useShell } from "../shell/ProjectShell.js";

interface IndexRow {
  name: string;
  keys: Record<string, number>;
  unique: boolean;
}

const keyText = (keys: Record<string, number>): string =>
  Object.entries(keys)
    .map(([path, direction]) => `${path} ${direction === 1 ? "ascending" : "descending"}`)
    .join(", ");

export function Indexes(): ReactNode {
  const { project, collection, role } = useShell();
  const toast = useToast();
  const base = `/api/projects/${project.id}/collections/${collection?.id ?? ""}/indexes`;
  const [indexes, setIndexes] = useState<IndexRow[] | null>(null);
  const [keys, setKeys] = useState("");
  const [unique, setUnique] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const owner = role === "owner";

  const load = useCallback(async () => {
    setIndexes((await get<{ indexes: IndexRow[] }>(base)).indexes);
  }, [base]);
  useEffect(() => void load(), [load]);

  const create = async (): Promise<void> => {
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(keys) as JsonValue;
    } catch {
      setStatus("Index keys are not valid");
      return;
    }
    setStatus("Creating index");
    try {
      const body: JsonObject = { keys: parsed, unique };
      if (name.trim() !== "") body["name"] = name.trim();
      const made = await post<{ index: IndexRow }>(base, body);
      setStatus(`Index ${made.index.name} created`);
      setKeys("");
      setName("");
      await load();
    } catch (error) {
      const failure = asFailure(error);
      setStatus(
        failure.body.error === "duplicate_key" ? (documentMessage(failure.body, null) ?? "Duplicate value")
        : failure.body.error === "name_taken" ? "An index with this name already exists"
        : "Index keys are not valid",
      );
    }
  };

  return (
    <>
      <h1 className="screen-title">Indexes</h1>
      <ul className="rows panel" role="list" aria-label="Indexes" aria-busy={indexes === null || undefined}>
        {indexes === null ? (
          <li className="skeleton-row" />
        ) : (
          indexes.map((index) => (
            <li key={index.name} className="row">
              <span className="row-main">
                <strong>{index.name}</strong> <span className="muted">{keyText(index.keys)}</span>
                {index.unique ? <span className="chip">unique</span> : null}
              </span>
              {owner && index.name !== "_id_" ? (
                <button
                  type="button"
                  className="btn"
                  aria-label={`Drop ${index.name}`}
                  onClick={() =>
                    void del(`${base}/${encodeURIComponent(index.name)}`).then(() => {
                      toast(`Index ${index.name} dropped`);
                      return load();
                    })
                  }
                >
                  Drop
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
      {/* Below the list only once it is known, so the list filling in never pushes the form down. */}
      {owner && indexes !== null ? (
        <form
          className="stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <h2>Add an index</h2>
          <label className="field">
            <span className="field-label">Index keys</span>
            <input className="input" spellCheck={false} placeholder='{ "sku": 1 }' value={keys} onChange={(event) => setKeys(event.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" className="checkbox" aria-label="Unique" checked={unique} onChange={(event) => setUnique(event.target.checked)} />
            <span aria-hidden="true">Unique</span>
          </label>
          <label className="field">
            <span className="field-label">Index name</span>
            <input className="input" spellCheck={false} placeholder="optional" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <p className="status-line" role="status" aria-label="Index status">
            {status}
          </p>
          <div className="actions">
            <button type="submit" className="btn btn-lime">
              Create index
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
