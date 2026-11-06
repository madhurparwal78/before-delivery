import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { store } from "./store.ts";
import type { Doc, DocSummary } from "./types.ts";
import { NotFoundDetail, TitleBlock } from "./ui.tsx";

export function DocsList(props: { onNavigate: (path: string) => void; currentDocId: string | null }): React.ReactNode {
  useEffect(() => {
    void store.refreshDocs();
    const off = store.onStreamEvent((name) => {
      if (name === "doc" || name === "reset" || name === "revoked") void store.refreshDocs();
    });
    return off;
  }, []);
  return (
    <div>
      {store.docs.map((d: DocSummary) => (
        <a
          key={d.id}
          className="link-plain"
          href={`/docs/${d.id}`}
          aria-current={props.currentDocId === d.id ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            props.onNavigate(`/docs/${d.id}`);
          }}
        >
          {d.title} <span className="meta num">v{d.version}</span>
        </a>
      ))}
      {store.docs.length === 0 && <div className="not-found">No docs yet.</div>}
    </div>
  );
}

export function DocEditor(props: { docId: string; isPhone: boolean; onBack: () => void }): React.ReactNode {
  const { docId } = props;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseVersion, setBaseVersion] = useState(0);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<{ current: Doc; mine: { title: string; body: string; base: number } } | null>(null);
  const [history, setHistory] = useState<{ version: number; saved_at: string; saved_by: string; title: string; body: string }[] | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const titleRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    setConflict(null);
    setStatus("");
    const load = async (): Promise<void> => {
      try {
        const { data } = await api.doc(docId);
        if (cancelled) return;
        setDoc(data);
        setTitle(data.title);
        setBody(data.body);
        setBaseVersion(data.version);
        dirtyRef.current = false;
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "not_found") setMissing(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  useEffect(() => {
    const off = store.onStreamEvent((name, data) => {
      if (name === "doc") {
        const d = data as { id: string; version: number };
        if (d.id !== docId) return;
        if (dirtyRef.current) {
          // An editor with unsaved changes is left alone.
          return;
        }
        void api.doc(docId).then(({ data: fresh }) => {
          setDoc(fresh);
          setTitle(fresh.title);
          setBody(fresh.body);
          setBaseVersion(fresh.version);
        }).catch(() => undefined);
      }
      if (name === "revoked") {
        const r = data as { scope: string; id: string };
        if (r.scope === "project") {
          void api.doc(docId).then(() => undefined).catch((e) => {
            if (e instanceof ApiError && e.code === "not_found") setMissing(true);
          });
        }
      }
    });
    return off;
  }, [docId]);

  if (missing) return <NotFoundDetail />;
  if (!doc) return <div className="not-found">Loading…</div>;

  const readOnly = store.me?.role === "guest";

  const save = async (overrideBase?: number): Promise<void> => {
    try {
      const { data } = await api.saveDoc(docId, {
        title,
        body,
        base_version: overrideBase ?? baseVersion,
      });
      setDoc(data);
      setBaseVersion(data.version);
      dirtyRef.current = false;
      setStatus(`Saved version ${data.version}.`);
      setConflict(null);
      clearDraft();
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        const current = e.current as Doc;
        setConflict({ current, mine: { title, body, base: baseVersion } });
        const editor = store.personById(current.updated_by);
        setStatus(
          `${editor?.name ?? "Someone"} saved version ${current.version} while you were editing. Keep mine or load theirs?`
        );
        return;
      }
      if (e instanceof ApiError && e.fields) {
        const first = Object.values(e.fields)[0];
        setStatus(first ?? "");
        return;
      }
      if (e instanceof ApiError && e.code === "database_unavailable") {
        setStatus("Tallyroom can't reach its database. Changes are not being saved.");
        return;
      }
      setStatus("The doc wasn't saved.");
    }
  };

  const clearDraft = (): void => {
    if (store.docDraft?.docId === docId) {
      store.docDraft = null;
      sessionStorage.removeItem("tr_doc_draft");
    }
  };

  const keepMine = async (): Promise<void> => {
    if (!conflict) return;
    try {
      const { data } = await api.saveDoc(docId, { title, body, base_version: conflict.current.version });
      setDoc(data);
      setBaseVersion(data.version);
      dirtyRef.current = false;
      setStatus(`Saved version ${data.version}.`);
      setConflict(null);
      clearDraft();
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        const current = e.current as Doc;
        setConflict({ current, mine: { title, body, base: conflict.current.version } });
        return;
      }
      setStatus("The doc wasn't saved.");
    }
  };

  const loadTheirs = (): void => {
    if (!conflict) return;
    setDoc(conflict.current);
    setTitle(conflict.current.title);
    setBody(conflict.current.body);
    setBaseVersion(conflict.current.version);
    const editor = store.personById(conflict.current.updated_by);
    setStatus(`Loaded version ${conflict.current.version} from ${editor?.name ?? "someone else"}.`);
    setConflict(null);
    clearDraft();
  };

  const openHistory = async (): Promise<void> => {
    try {
      const { data } = await api.docVersions(docId);
      setHistory(data.versions);
    } catch {
      setHistory([]);
    }
  };

  const restore = async (version: number): Promise<void> => {
    setHistory(null);
    setStatus("Saving");
    try {
      const { data } = await api.restoreDoc(docId, { version, base_version: baseVersion });
      setDoc(data);
      setTitle(data.title);
      setBody(data.body);
      setBaseVersion(data.version);
      dirtyRef.current = false;
      setStatus(`Restored version ${version} as version ${data.version}.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        const current = e.current as Doc;
        setConflict({ current, mine: { title, body, base: baseVersion } });
        return;
      }
      setStatus("The doc wasn't restored.");
    }
  };

  const onEdit = (nextTitle: string, nextBody: string): void => {
    setTitle(nextTitle);
    setBody(nextBody);
    dirtyRef.current = true;
    // An unsaved edit survives a lost session in this tab's session storage.
    store.docDraft = {
      docId,
      title: nextTitle,
      body: nextBody,
      baseVersion,
      personId: store.me?.id ?? "",
    };
    sessionStorage.setItem(
      "tr_doc_draft",
      JSON.stringify(store.docDraft)
    );
  };

  return (
    <div>
      {props.isPhone && <button className="btn" onClick={props.onBack}>Back</button>}
      <TitleBlock keyText={doc.title} state={`v${doc.version}`} changed={doc.updated_at.slice(0, 10)} />
      <h1>Doc</h1>
      <div className="form-grid">
        <label htmlFor="doc-title">Title</label>
        <input
          id="doc-title"
          aria-label="Doc title"
          value={title}
          readOnly={readOnly}
          onChange={(e) => onEdit(e.currentTarget.value, body)}
        />
        <label htmlFor="doc-body">Body</label>
        <textarea
          id="doc-body"
          aria-label="Doc body"
          rows={14}
          value={body}
          readOnly={readOnly}
          onChange={(e) => onEdit(title, e.currentTarget.value)}
        />
      </div>
      <div role="status" aria-live="polite" aria-label="Doc status">
        {status}
      </div>
      {!readOnly && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button className="btn primary" aria-label="Save doc" onClick={() => void save()}>
            Save doc
          </button>
          <button className="btn" aria-label="Version history" onClick={() => void openHistory()}>
            Version history
          </button>
          <button
            className="btn"
            aria-label="Attach file"
            aria-disabled={store.status?.storage === "unavailable"}
            onClick={() => {
              if (store.status?.storage === "unavailable") {
                setUploadStatus("Upload failed: storage is unavailable. Nothing was attached.");
                store.announce("Upload failed: storage is unavailable. Nothing was attached.");
                return;
              }
              fileRef.current?.click();
            }}
          >
            Attach file
          </button>
          <input
            ref={fileRef}
            type="file"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploadStatus(`Uploading ${file.name}`);
              void api
                .attachFile(`/api/docs/${docId}/attachments`, file)
                .then(() => {
                  setUploadStatus(`Attached ${file.name}.`);
                  store.announce(`Attached ${file.name}.`);
                })
                .catch((err) => {
                  setUploadStatus(
                    err instanceof ApiError && err.fields?.file
                      ? err.fields.file
                      : "Upload failed: storage is unavailable. Nothing was attached."
                  );
                });
              e.target.value = "";
            }}
          />
        </div>
      )}
      <div role="status" aria-label="Upload status">
        {uploadStatus}
      </div>
      <div className="section-label">Attachments</div>
      {doc.attachments.map((a) => (
        <a key={a.id} className="attachment-link" href={`/api/attachments/${a.id}`}>
          {a.filename}
        </a>
      ))}
      {conflict && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-label="Newer version saved">
            <h2>Newer version saved</h2>
            <p>
              {`${store.personById(conflict.current.updated_by)?.name ?? "Someone"} saved version ${conflict.current.version} while you were editing. Keep mine or load theirs?`}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" aria-label="Keep mine" onClick={() => void keepMine()}>
                Keep mine
              </button>
              <button className="btn" aria-label="Load theirs" onClick={loadTheirs}>
                Load theirs
              </button>
            </div>
          </div>
        </div>
      )}
      {history && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-label="Version history">
            <h2>Version history</h2>
            {history
              .filter((v) => v.version < doc.version)
              .map((v) => (
                <div key={v.version} className="row">
                  <span className="meta num">v{v.version}</span>
                  <span className="title">{v.title}</span>
                  <button className="row-btn" aria-label={`Restore version ${v.version}`} onClick={() => void restore(v.version)}>
                    Restore
                  </button>
                </div>
              ))}
            <button className="btn" aria-label="Close" onClick={() => setHistory(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
