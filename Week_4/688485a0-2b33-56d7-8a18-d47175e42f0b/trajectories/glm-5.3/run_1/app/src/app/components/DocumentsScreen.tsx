import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api, QueryAnswer, ApiError } from "../lib/api";
import { copy, apiErrorMessage } from "../lib/copy";
import { QueryBar, QueryBarState, ResultsView, ViewSwitch, Pager, usePages, statusFor, EditorPane } from "./Workspace";
import { ResizeSeparator } from "./ResizeSeparator";
import { JsonObj, prettyJson } from "shared/values";
import { Dialog } from "./Dialog";
import { useNavigate } from "../lib/router";

/**
 * The Documents screen (DP-06 to DP-08, DP-11, DP-16 to DP-18, DP-49 to DP-58):
 * query bar, results, document editor, live updates over the event stream, and
 * the Insert / Load file / Download / Save query controls.
 */

export interface DocumentsScreenProps {
  pid: string;
  cid: string;
  role: "owner" | "editor" | "reader";
  phone: boolean;
  initialDocId: string | null;
  outage: boolean;
  onOutageChange: (v: boolean) => void;
  initialQuery?: QueryBarState;
  collectionName: string;
  queryPanePercent: number;
  onQueryPanePercent: (v: number) => void;
  onRoleChange: (role: string) => void;
}

const DEFAULT_QUERY: QueryBarState = { filter: "", projection: "", sort: "", limit: "" };

interface EditorState {
  docId: string | null;
  version: number;
  text: string;
  fresh: boolean;
}

export function DocumentsScreen(props: DocumentsScreenProps): ReactNode {
  const navigate = useNavigate();
  const canWrite = props.role === "owner" || props.role === "editor";
  const [query, setQuery] = useState<QueryBarState>(props.initialQuery ?? DEFAULT_QUERY);
  const [answer, setAnswer] = useState<QueryAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "table" | "json">("list");
  const [editor, setEditor] = useState<EditorState>({ docId: null, version: 0, text: "", fresh: false });
  const [saveStatus, setSaveStatus] = useState("");
  const [clash, setClash] = useState(false);
  const [clashVersion, setClashVersion] = useState(0);
  const [clashDoc, setClashDoc] = useState<JsonObj | null>(null);
  const [validationChip, setValidationChip] = useState<{ path: string; message: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveQueryOpen, setSaveQueryOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const draftRef = useRef<string>("");
  const lastSeqRef = useRef<number>(0);
  const [, setCollectionCount] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const pageRef = useRef(page);
  pageRef.current = page;

  const runQuery = useCallback(async (p: number, q: QueryBarState): Promise<void> => {
    setPending(true);
    setRefused(false);
    setError("");
    try {
      const filter = q.filter.trim() === "" ? {} : JSON.parse(q.filter);
      const projection = q.projection.trim() === "" ? null : JSON.parse(q.projection);
      const sort = q.sort.trim() === "" ? null : JSON.parse(q.sort);
      const limit = q.limit.trim() === "" ? 0 : Number(q.limit);
      const ans = await api.post<QueryAnswer>(`/api/projects/${props.pid}/collections/${props.cid}/query`, {
        filter, projection, sort, limit, page: p,
      });
      setAnswer(ans);
      setPending(false);
      if (q.filter.trim() === "" && (q.limit.trim() === "" || q.limit.trim() === "0")) {
        setCollectionCount(ans.matched);
      }
    } catch (err) {
      setPending(false);
      setRefused(true);
      const e = err as ApiError;
      if (e.code === "invalid_query" && (e.extras.field === "filter" || e.extras.field === "projection" || e.extras.field === "sort")) {
        const names: Record<string, string> = { filter: "Filter", projection: "Projection", sort: "Sort" };
        setError(`${names[String(e.extras.field)]} is not valid JSON`);
      } else {
        setError(apiErrorMessage(e));
      }
    }
  }, [props.pid, props.cid]);

  // opening the screen runs the empty query at once
  useEffect(() => {
    void runQuery(1, queryRef.current);
  }, [runQuery]);

  // the live feed (DP-56): re-run the current query when a change arrives
  useEffect(() => {
    const source = new EventSource(`/api/projects/${props.pid}/collections/${props.cid}/events`);
    source.addEventListener("change", ev => {
      const data = JSON.parse((ev as MessageEvent).data) as { seq: number };
      if (data.seq > lastSeqRef.current) lastSeqRef.current = data.seq;
      // re-run in place; focus, scroll and the editor draft are untouched
      void runQuery(pageRef.current, queryRef.current);
    });
    source.addEventListener("role", ev => {
      // a role change applies to the open screen at once (DP-65)
      const data = JSON.parse((ev as MessageEvent).data) as { role: string };
      props.onRoleChange(data.role === "owner" || data.role === "editor" ? data.role : "reader");
      if (data.role !== "owner" && data.role !== "editor") {
        setSaveStatus(copy.readOnlyNote);
      }
    });
    source.onerror = () => {
      // the browser's EventSource reconnects on its own with Last-Event-ID
    };
    return () => source.close();
  }, [props.pid, props.cid, runQuery, props.onRoleChange]);

  // open a document
  const openDoc = async (id: string, opener: HTMLElement | null): Promise<void> => {
    openerRef.current = opener;
    try {
      const res = await api.get<{ document: JsonObj; version: number }>(
        `/api/projects/${props.pid}/collections/${props.cid}/documents/${id}`,
      );
      const text = prettyJson(res.document);
      draftRef.current = text;
      setEditor({ docId: id, version: res.version, text, fresh: false });
      setSaveStatus("");
      setClash(false);
      setValidationChip(null);
      navigate(`/p/${props.pid}/c/${props.cid}/d/${id}`, true);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "not_found") {
        setSaveStatus(copy.docGone);
      }
    }
  };

  useEffect(() => {
    if (props.initialDocId !== null && editor.docId === null) {
      void openDoc(props.initialDocId, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialDocId]);

  const onEditorText = (text: string): void => {
    draftRef.current = text;
    setEditor(cur => cur.docId === null ? cur : { ...cur, text });
  };

  const save = async (versionOverride?: number): Promise<void> => {
    if (editor.docId === null && !editor.fresh) return;
    let doc: JsonObj;
    try {
      doc = JSON.parse(draftRef.current) as JsonObj;
    } catch {
      setValidationChip({ path: "", message: "not valid JSON" });
      setSaveStatus("not valid JSON");
      return;
    }
    setSaveStatus(copy.savePending);
    setValidationChip(null);
    try {
      if (editor.fresh) {
        const res = await api.post<{ document: JsonObj; version: number }>(
          `/api/projects/${props.pid}/collections/${props.cid}/documents`,
          { document: doc },
        );
        const id = res.document["_id"] as string;
        setEditor({ docId: id, version: res.version, text: draftRef.current, fresh: false });
        setSaveStatus(copy.saveSaved);
        navigate(`/p/${props.pid}/c/${props.cid}/d/${id}`, true);
        void runQuery(pageRef.current, queryRef.current);
        return;
      }
      const version = versionOverride ?? editor.version;
      if (!Object.prototype.hasOwnProperty.call(doc, "_id")) {
        doc["_id"] = editor.docId; // the editor knows its document's id
      }
      const res = await api.put<{ document: JsonObj; version: number }>(
        `/api/projects/${props.pid}/collections/${props.cid}/documents/${editor.docId}`,
        { document: doc, version },
      );
      setEditor(cur => ({ ...cur, version: res.version }));
      setClash(false);
      setSaveStatus(copy.saveSaved);
      void runQuery(pageRef.current, queryRef.current);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "version_conflict") {
        setClash(true);
        setClashVersion(Number(e.extras.current_version));
        setClashDoc(e.extras.current as JsonObj);
        setSaveStatus("");
      } else if (e.code === "validation_failed") {
        const path = String(e.extras.path ?? "");
        const rule = String(e.extras.rule ?? "");
        const validator = await api.get<{ validator: unknown }>(`/api/projects/${props.pid}/collections/${props.cid}/validator`)
          .then(r => r.validator)
          .catch(() => null);
        const msg = validationMessage(path, rule, validator);
        setValidationChip({ path, message: msg });
        setSaveStatus(msg);
      } else if (e.code === "duplicate_key") {
        const value = JSON.stringify(e.extras.value);
        const msg = `Duplicate value ${value} for unique index ${String(e.extras.index ?? "")}`;
        setValidationChip({ path: String(e.extras.index ?? ""), message: msg });
        setSaveStatus(msg);
      } else if (e.code === "not_found") {
        setSaveStatus(copy.docGone);
      } else if (e.code === "read_only") {
        setSaveStatus(copy.readOnlyNote);
      } else {
        const msg = apiErrorMessage(e);
        setValidationChip({ path: "", message: msg });
        setSaveStatus(msg);
      }
    }
  };

  const closeEditor = (): void => {
    setEditor({ docId: null, version: 0, text: "", fresh: false });
    setClash(false);
    setSaveStatus("");
    setValidationChip(null);
    navigate(`/p/${props.pid}/c/${props.cid}`, true);
    if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    else {
      const first = document.querySelector<HTMLElement>("[data-doc-id] button, [data-doc-id]");
      first?.focus();
    }
  };

  const pages = usePages(answer?.matched ?? 0, answer?.page_size ?? 10);

  const goPage = (p: number): void => {
    setPage(p);
    void runQuery(p, queryRef.current);
  };

  const insertDoc = (): void => {
    openerRef.current = null;
    draftRef.current = "{}";
    setEditor({ docId: null, version: 0, text: "{}", fresh: true });
    setSaveStatus("");
    setValidationChip(null);
  };

  const insertNow = async (): Promise<void> => {
    let doc: JsonObj;
    try {
      doc = JSON.parse(draftRef.current) as JsonObj;
    } catch {
      setValidationChip({ path: "", message: "not valid JSON" });
      setSaveStatus("not valid JSON");
      return;
    }
    setSaveStatus(copy.savePending);
    try {
      const res = await api.post<{ document: JsonObj; version: number }>(
        `/api/projects/${props.pid}/collections/${props.cid}/documents`,
        { document: doc },
      );
      const id = res.document["_id"] as string;
      setEditor({ docId: id, version: res.version, text: draftRef.current, fresh: false });
      setSaveStatus(copy.saveSaved);
      navigate(`/p/${props.pid}/c/${props.cid}/d/${id}`, true);
      void runQuery(pageRef.current, queryRef.current);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "validation_failed") {
        const path = String(e.extras.path ?? "");
        const rule = String(e.extras.rule ?? "");
        const validator = await api.get<{ validator: unknown }>(`/api/projects/${props.pid}/collections/${props.cid}/validator`)
          .then(r => r.validator)
          .catch(() => null);
        const msg = validationMessage(path, rule, validator);
        setValidationChip({ path, message: msg });
        setSaveStatus(msg);
      } else {
        const msg = apiErrorMessage(e);
        setSaveStatus(msg);
        setValidationChip({ path: "", message: msg });
      }
    }
  };

  const onRun = (): void => {
    setPage(1);
    void runQuery(1, query);
    if (props.phone) {
      const resultsTab = document.querySelector<HTMLElement>("[role='tab'][data-tab='results']");
      resultsTab?.focus();
    }
  };

  return (
    <div className="documents-screen" data-phone={props.phone ? "true" : "false"}>
      <div className="query-pane" style={{ flexBasis: `${props.queryPanePercent}%` }}>
        <QueryBar state={query} onChange={setQuery} onRun={onRun} phone={props.phone} />
      </div>
      <ResizeSeparator label="Resize query pane" value={props.queryPanePercent} onChange={props.onQueryPanePercent} />
      <div className="results-pane">
        <div className="results-head">
          <ViewSwitch view={view} onChange={setView} />
          <div className="doc-actions">
            {canWrite && <button className="btn" onClick={insertDoc}>Insert document</button>}
            {canWrite && <button className="btn" onClick={() => setLoadOpen(true)}>Load file</button>}
            <button className="btn" onClick={() => setDownloadOpen(true)}>Download</button>
            {canWrite && <button className="btn" onClick={() => setSaveQueryOpen(true)}>Save query</button>}
          </div>
        </div>
        <div role="status" aria-label="Query status" className="query-status">
          {statusFor(answer, pending, refused)}
        </div>
        <div
          role="status"
          aria-label="Query plan"
          className="query-plan"
          data-plan-kind={answer?.plan.kind ?? "full_scan"}
          data-plan-index={answer?.plan.index ?? ""}
        >
          {answer !== null && !refused ? (
            <>
              <div>{answer.plan.kind === "index" && answer.plan.index !== null ? `Used index ${answer.plan.index}` : "Full scan"}</div>
              <div>Examined {answer.plan.docs_examined} documents, returned {answer.plan.returned}</div>
            </>
          ) : null}
        </div>
        {error !== "" && (
          <div role="alert" className="query-error">{error}</div>
        )}
        {answer !== null && answer.matched === 0 && query.filter.trim() === "" && (
          <div className="empty-collection">
            <h2 className="empty-headline">{copy.emptyCollection}</h2>
          </div>
        )}
        <ResultsView
          answer={answer}
          view={view}
          busy={pending}
          onOpenDoc={(id, opener) => void openDoc(id, opener)}
        />
        <Pager page={page} pages={pages} onPrev={() => goPage(page - 1)} onNext={() => goPage(page + 1)} />
        <div role="status" className="reader-note-status" />
      </div>
      {props.phone ? null : (
        <EditorPane
          docId={editor.docId}
          open={editor.docId !== null || editor.fresh}
          text={editor.text}
          onText={onEditorText}
          onSave={editor.fresh ? () => void insertNow() : () => void save()}
          onClose={closeEditor}
          onDelete={() => setDeleteOpen(true)}
          onReload={() => {
            if (clashDoc !== null) {
              const text = prettyJson(clashDoc);
              draftRef.current = text;
              setEditor(cur => ({ ...cur, text, version: clashVersion }));
              setClash(false);
            }
          }}
          onOverwrite={() => void save(clashVersion)}
          saveStatus={saveStatus}
          clash={clash}
          readOnly={!canWrite}
          phone={false}
          validationChip={validationChip}
        />
      )}
      {props.phone && (editor.docId !== null || editor.fresh) && (
        <EditorPane
          docId={editor.docId}
          open={editor.docId !== null || editor.fresh}
          text={editor.text}
          onText={onEditorText}
          onSave={editor.fresh ? () => void insertNow() : () => void save()}
          onClose={closeEditor}
          onDelete={() => setDeleteOpen(true)}
          onReload={() => {
            if (clashDoc !== null) {
              const text = prettyJson(clashDoc);
              draftRef.current = text;
              setEditor(cur => ({ ...cur, text, version: clashVersion }));
              setClash(false);
            }
          }}
          onOverwrite={() => void save(clashVersion)}
          saveStatus={saveStatus}
          clash={clash}
          readOnly={!canWrite}
          phone
          validationChip={validationChip}
        />
      )}
      <DeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          if (editor.docId !== null) {
            try {
              await api.del(`/api/projects/${props.pid}/collections/${props.cid}/documents/${editor.docId}`);
            } catch {
              /* already gone */
            }
            setDeleteOpen(false);
            closeEditor();
            void runQuery(1, queryRef.current);
          }
        }}
      />
      <SaveQueryDialog
        open={saveQueryOpen}
        onClose={() => setSaveQueryOpen(false)}
        onKeep={async name => {
          const filter = query.filter.trim() === "" ? {} : JSON.parse(query.filter);
          const projection = query.projection.trim() === "" ? null : JSON.parse(query.projection);
          const sort = query.sort.trim() === "" ? null : JSON.parse(query.sort);
          const limit = query.limit.trim() === "" ? 0 : Number(query.limit);
          await api.post(`/api/projects/${props.pid}/collections/${props.cid}/saved-queries`, {
            name, filter, projection, sort, limit,
          });
          setSaveQueryOpen(false);
        }}
      />
      <LoadFileDialog
        open={loadOpen}
        pid={props.pid}
        cid={props.cid}
        onClose={() => setLoadOpen(false)}
        onDone={() => void runQuery(1, queryRef.current)}
        onOutage={() => props.onOutageChange(true)}
      />
      <DownloadDialog
        open={downloadOpen}
        pid={props.pid}
        cid={props.cid}
        query={query}
        collectionName={props.collectionName}
        onClose={() => setDownloadOpen(false)}
        onOutage={() => props.onOutageChange(true)}
      />
    </div>
  );
}

function validationMessage(path: string, rule: string, validator: unknown): string {
  // the published text names the rule's expectation, read from the validator
  let expected = "";
  if (validator !== null && typeof validator === "object") {
    const props = (validator as { properties?: Record<string, Record<string, unknown>> }).properties;
    const ruleOf = props?.[path];
    if (ruleOf !== undefined) {
      if (rule === "bsonType") expected = String(ruleOf["bsonType"] ?? "");
      else if (rule === "minimum") expected = String(ruleOf["minimum"] ?? "");
      else if (rule === "maximum") expected = String(ruleOf["maximum"] ?? "");
      else if (rule === "enum") expected = JSON.stringify(ruleOf["enum"] ?? []);
    }
  }
  switch (rule) {
    case "required": return `Document failed validation at ${path}: required field is missing`;
    case "bsonType": return `Document failed validation at ${path}: expected ${expected}`;
    case "minimum": return `Document failed validation at ${path}: must be at least ${expected}`;
    case "maximum": return `Document failed validation at ${path}: must be at most ${expected}`;
    default: return `Document failed validation at ${path}: must be one of ${expected}`;
  }
}

function DeleteDialog(props: { open: boolean; onClose: () => void; onConfirm: () => void | Promise<void> }): ReactNode {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (props.open) confirmRef.current?.focus();
  }, [props.open]);
  return (
    <Dialog label="Delete this document?" open={props.open} onClose={props.onClose}>
      <h2 className="dialog-title">Delete this document?</h2>
      <div className="dialog-actions">
        <button ref={confirmRef} className="btn danger" onClick={() => void props.onConfirm()}>Delete</button>
        <button className="btn" onClick={props.onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function SaveQueryDialog(props: { open: boolean; onClose: () => void; onKeep: (name: string) => void | Promise<void> }): ReactNode {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog label="Save query" open={props.open} onClose={props.onClose}>
      <h2 className="dialog-title">Save query</h2>
      <label className="field">
        <span className="field-label">Query name</span>
        <input
          aria-label="Query name"
          className="text-input"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </label>
      {error !== "" && <div role="alert" className="dialog-error">{error}</div>}
      <div className="dialog-actions">
        <button
          className="btn primary"
          onClick={() => {
            void (async () => {
              try {
                await props.onKeep(name);
                setName("");
                setError("");
              } catch (err) {
                const e = err as ApiError;
                setError(e.code === "name_taken" ? copy.nameTaken : apiErrorMessage(e));
              }
            })();
          }}
        >
          Keep query
        </button>
        <button className="btn" onClick={props.onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function LoadFileDialog(props: {
  open: boolean; pid: string; cid: string; onClose: () => void;
  onDone: () => void; onOutage: () => void;
}): ReactNode {
  const [format, setFormat] = useState<"jsonl" | "csv">("jsonl");
  const [file, setFile] = useState<File | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const closeAll = (): void => {
    setFile(null);
    setImportId(null);
    setStatus("");
    setErrors([]);
    props.onClose();
  };
  return (
    <Dialog label="Load file" open={props.open} onClose={closeAll}>
      <h2 className="dialog-title">Load file</h2>
      <label className="field">
        <span className="field-label">File</span>
        <input
          aria-label="Choose file"
          className="text-input"
          type="file"
          accept=".jsonl,.csv,.json"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <div role="radiogroup" aria-label="Format" className="view-switch">
        <label className="radio-pill">
          <input type="radio" name="format" checked={format === "jsonl"} onChange={() => setFormat("jsonl")} />
          <span>JSON lines</span>
        </label>
        <label className="radio-pill">
          <input type="radio" name="format" checked={format === "csv"} onChange={() => setFormat("csv")} />
          <span>CSV</span>
        </label>
      </div>
      <div className="dialog-actions">
        <button
          className="btn primary"
          disabled={file === null}
          onClick={() => {
            if (file === null) return;
            void (async () => {
              setStatus(copy.importPending);
              setErrors([]);
              try {
                const res = await api.post<{ import_id: string; inserted: number }>(
                  `/api/projects/${props.pid}/collections/${props.cid}/imports?format=${format}`,
                );
                void res;
              } catch (err) {
                const e = err as ApiError;
                if (e.code === "import_failed") {
                  const errs = (e.extras.errors as { line: number; message: string }[]) ?? [];
                  setStatus(copy.importFailed);
                  setErrors(errs);
                  return;
                }
                if (e.code === "storage_unavailable") {
                  setStatus("File storage is unavailable. Try again later.");
                  props.onOutage();
                  return;
                }
                setStatus(apiErrorMessage(e));
                return;
              }
              setStatus("Imported");
              props.onDone();
            })();
          }}
        >
          Load
        </button>
      </div>
      <div role="status" aria-label="Import status" className="import-status">{status}</div>
      {errors.length > 0 && (
        <ul aria-label="Line errors" className="line-errors">
          {errors.map(e => (
            <li key={e.line}>Line {e.line}: {e.message}</li>
          ))}
        </ul>
      )}
      {importId !== null && (
        <a href={`/api/projects/${props.pid}/collections/${props.cid}/imports/${importId}/original`} className="link">
          Download original file
        </a>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={closeAll}>Close</button>
      </div>
    </Dialog>
  );
}

function DownloadDialog(props: {
  open: boolean; pid: string; cid: string; query: QueryBarState; collectionName: string;
  onClose: () => void; onOutage: () => void;
}): ReactNode {
  const [format, setFormat] = useState<"jsonl" | "csv">("jsonl");
  const [error, setError] = useState("");
  const urlRef = useRef<string | null>(null);
  return (
    <Dialog label="Download" open={props.open} onClose={() => { setError(""); urlRef.current = null; props.onClose(); }}>
      <h2 className="dialog-title">Download</h2>
      <div role="radiogroup" aria-label="Format" className="view-switch">
        <label className="radio-pill">
          <input type="radio" name="dl-format" checked={format === "jsonl"} onChange={() => setFormat("jsonl")} />
          <span>JSON lines</span>
        </label>
        <label className="radio-pill">
          <input type="radio" name="dl-format" checked={format === "csv"} onChange={() => setFormat("csv")} />
          <span>CSV</span>
        </label>
      </div>
      {error !== "" && <div role="alert" className="dialog-error">{error}</div>}
      <div className="dialog-actions">
        <button
          className="btn primary"
          onClick={() => {
            void (async () => {
              const filter = props.query.filter.trim() === "" ? {} : JSON.parse(props.query.filter);
              const sort = props.query.sort.trim() === "" ? null : JSON.parse(props.query.sort);
              try {
                const res = await api.post<{ download_url: string }>(
                  `/api/projects/${props.pid}/collections/${props.cid}/exports`,
                  { format, filter, sort },
                );
                urlRef.current = res.download_url;
                const a = document.createElement("a");
                a.href = res.download_url;
                a.download = `${props.collectionName}.${format}`;
                a.click();
                props.onClose();
              } catch (err) {
                const e = err as ApiError;
                if (e.code === "storage_unavailable") props.onOutage();
                setError(apiErrorMessage(e));
              }
            })();
          }}
        >
          Download file
        </button>
        <button className="btn" onClick={props.onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
