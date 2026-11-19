import { CircleAlert, Trash2, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { JsonObject } from "../../shared/json.js";
import { type ErrorBody, documentMessage } from "../../shared/messages.js";
import { asFailure, del, get, post, put } from "../api.js";
import { ConfirmDialog, useOverlay } from "../components/Dialog.js";
import { useToast } from "../components/Toast.js";
import { useShell } from "../shell/ProjectShell.js";

/** The document editor: shows the stored document exactly, saves with its version, handles clashes. */

type Status = { kind: "none" } | { kind: "saving" } | { kind: "saved" } | { kind: "message"; text: string };

interface Props {
  did: string | null;
  asDialog: boolean;
  preload: { id: string; document: JsonObject; version: number } | null;
  onClose: () => void;
  onSaved: (document: JsonObject, version: number) => void;
  onDeleted: () => void;
}

const pretty = (document: JsonObject): string => JSON.stringify(document, null, 2);

export function Editor({ did, asDialog, preload, onClose, onSaved, onDeleted }: Props): ReactNode {
  const { project, collection, role, markMissing } = useShell();
  const toast = useToast();
  const base = `/api/projects/${project.id}/collections/${collection?.id ?? ""}`;
  const readOnly = role === "reader";
  const loaded = preload && preload.id === did ? preload : null;
  const [text, setText] = useState(loaded ? pretty(loaded.document) : did ? "" : "{}");
  const [version, setVersion] = useState<number | null>(loaded ? loaded.version : null);
  const [status, setStatus] = useState<Status>(loaded ? { kind: "saved" } : { kind: "none" });
  const [clash, setClash] = useState<{ version: number; current: JsonObject } | null>(null);
  const confirm = useOverlay();
  const [ready, setReady] = useState(did === null || loaded !== null);
  const leaveNext = useRef(false);

  useEffect(() => {
    if (did === null || loaded) return;
    let current = true;
    get<{ document: JsonObject; version: number }>(`${base}/documents/${did}`).then(
      (answer) => {
        if (!current) return;
        setText(pretty(answer.document));
        setVersion(answer.version);
        setReady(true);
      },
      () => current && markMissing(),
    );
    return () => {
      current = false;
    };
  }, [did, base, loaded, markMissing]);

  const refuse = async (body: ErrorBody): Promise<void> => {
    if (body.error === "validation_failed") {
      const rules = await get<{ validator: JsonObject | null }>(`${base}/validator`).catch(() => ({ validator: null }));
      setStatus({ kind: "message", text: documentMessage(body, rules.validator) ?? "Document failed validation" });
    } else if (body.error === "read_only") {
      setStatus({ kind: "message", text: "You have read access" });
    } else {
      setStatus({ kind: "message", text: documentMessage(body, null) ?? "The document was not saved" });
    }
  };

  const save = async (override?: { version: number }): Promise<void> => {
    if (readOnly) return;
    let document: JsonObject;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setStatus({ kind: "message", text: "not an object" });
        return;
      }
      document = parsed as JsonObject;
    } catch {
      setStatus({ kind: "message", text: "not valid JSON" });
      return;
    }
    setStatus({ kind: "saving" });
    setClash(null);
    try {
      const sent = override?.version ?? version;
      const answer =
        did === null
          ? await post<{ document: JsonObject; version: number }>(`${base}/documents`, { document })
          : await put<{ document: JsonObject; version: number }>(`${base}/documents/${did}`, { document, version: sent ?? 0 });
      setText(pretty(answer.document));
      setVersion(answer.version);
      setStatus({ kind: "saved" });
      onSaved(answer.document, answer.version);
    } catch (error) {
      const failure = asFailure(error);
      if (failure.body.error === "version_conflict") {
        setClash({ version: Number(failure.body["current_version"]), current: failure.body["current"] as JsonObject });
        setStatus({ kind: "none" });
      } else if (failure.status === 404) {
        setStatus({ kind: "message", text: "This document no longer exists" });
      } else {
        await refuse(failure.body);
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  };

  const onTextKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape" && !asDialog) {
      leaveNext.current = true;
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && !leaveNext.current && !readOnly) {
      event.preventDefault();
      const box = event.currentTarget;
      box.setRangeText("  ", box.selectionStart, box.selectionEnd, "end");
      setText(box.value);
    }
    if (event.key !== "Escape") leaveNext.current = false;
  };

  const remove = (): void => {
    if (did === null) return;
    del(`${base}/documents/${did}`).then(
      () => {
        toast("Document deleted");
        onDeleted();
      },
      () => setStatus({ kind: "message", text: "The document was not deleted" }),
    );
  };

  const statusText = status.kind === "saving" ? "Saving" : status.kind === "saved" ? "Saved" : null;
  return (
    <div className="editor" onKeyDown={onKeyDown} aria-busy={!ready || undefined}>
      <div className="editor-head">
        <h2 className="editor-title">{did ?? "New document"}</h2>
        <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
        <div className="editor-actions">
          {readOnly ? null : (
            <button type="button" className="btn btn-ink" onClick={() => void save()} aria-disabled={status.kind === "saving" || undefined}>
              Save
            </button>
          )}
          {readOnly || did === null ? null : (
            <button type="button" className="btn" onClick={() => confirm.open(true)}>
              <Trash2 size={18} aria-hidden="true" />
              Delete document
            </button>
          )}
        </div>
      </div>
      <div className="status-slot" role="status" aria-label="Save status">
        {statusText}
        {status.kind === "message" ? (
          <span className="error-chip">
            <CircleAlert size={18} aria-hidden="true" />
            {status.text}
          </span>
        ) : null}
      </div>
      {clash ? (
        <div className="clash" role="alert">
          <p>This document was changed by someone else.</p>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText(pretty(clash.current));
                setVersion(clash.version);
                setClash(null);
              }}
            >
              Reload
            </button>
            <button type="button" className="btn btn-ink" onClick={() => void save({ version: clash.version })}>
              Overwrite
            </button>
          </div>
        </div>
      ) : null}
      <textarea
        className="code-box editor-box"
        aria-label="Document JSON"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        readOnly={readOnly}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onTextKey}
      />
      {confirm.slot ? <ConfirmDialog key={confirm.slot.id} name="Delete this document?" text="This document will be removed from the collection." onClose={confirm.closeFor(confirm.slot.id)} onConfirm={remove} /> : null}
    </div>
  );
}

