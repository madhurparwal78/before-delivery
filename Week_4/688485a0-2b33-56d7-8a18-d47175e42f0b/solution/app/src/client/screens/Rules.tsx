import { type ReactNode, useEffect, useState } from "react";
import type { JsonValue } from "../../shared/json.js";
import { asFailure, get, put } from "../api.js";
import { useShell } from "../shell/ProjectShell.js";

export function Rules(): ReactNode {
  const { project, collection, role } = useShell();
  const cid = collection?.id ?? "";
  const base = `/api/projects/${project.id}/collections/${cid}/validator`;
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const owner = role === "owner";
  useEffect(() => {
    get<{ validator: JsonValue }>(base).then((answer) => setText(answer.validator === null ? "" : JSON.stringify(answer.validator, null, 2)));
  }, [base]);
  const save = async (): Promise<void> => {
    let validator: JsonValue = null;
    try {
      if ((text ?? "").trim() !== "") validator = JSON.parse(text ?? "") as JsonValue;
    } catch {
      setStatus("Rules are not valid");
      return;
    }
    try {
      await put(base, { validator });
      setStatus("Rules saved");
    } catch (error) {
      setStatus(asFailure(error).body.error === "invalid_validator" ? "Rules are not valid" : "Rules could not be saved");
    }
  };
  return (
    <>
      <h1 className="screen-title">Rules</h1>
      <p className="muted">Required fields and per-path type, minimum, maximum and enum. Rules check inserts, edits and loads, never documents already stored.</p>
      <div className="field">
        <span className="field-label" aria-hidden="true">
          Validator JSON
        </span>
        <textarea
          className="code-box rules-box"
          aria-label="Validator JSON"
          spellCheck={false}
          rows={14}
          readOnly={!owner}
          placeholder='{ "required": ["name"] }'
          value={text ?? ""}
          aria-busy={text === null || undefined}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {owner ? (
        <>
          <p className="status-line" role="status" aria-label="Rules status">
            {status}
          </p>
          <div className="actions">
            <button type="button" className="btn btn-lime" onClick={() => void save()}>
              Save rules
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
