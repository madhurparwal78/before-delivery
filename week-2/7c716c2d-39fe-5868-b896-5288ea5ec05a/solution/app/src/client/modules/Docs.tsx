// Docs: the list, the editor saved against its loaded version, the conflict choice, version
// history, and the edit kept across a lost session.
import { FileText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ApiFailure, get, type Doc, type DocVersion } from "../api";
import { Dialog } from "../components/Dialog";
import { Panes } from "../components/Panes";
import { EmptyNote, NotFound, SheetHeader, TitleBlock } from "../components/Sheet";
import { Attachments, Uploader, withAttachment } from "../components/Uploader";
import { dropDraft, draftFor, trackUnsaved } from "../draft";
import { showDate } from "../format";
import { forEditor, withStoredEndings } from "../lines";
import { navigate } from "../router";
import { useApp } from "../store";

export function DocsModule(props: { rest: string[] }): JSX.Element {
  const app = useApp();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const openId = props.rest[0] ?? null;

  const load = useCallback(() => {
    get<{ docs: Doc[] }>("/api/docs")
      .then((r) => setDocs(r.docs))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load, app.projects]);
  useEffect(
    () =>
      app.on((event) => {
        if (event.name === "doc" || event.name === "reset") load();
      }),
    [app, load],
  );

  const list = (
    <div className="doc-list">
      <h2 className="list-heading">Docs</h2>
      {docs?.length === 0 && <p className="list-empty">No docs are shared with you yet.</p>}
      <ul>
        {(docs ?? []).map((d) => (
          <li key={d.id}>
            <a
              href={`/docs/${d.id}`}
              className="doc-link"
              aria-current={d.id === openId ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/docs/${d.id}`);
              }}
            >
              <FileText aria-hidden="true" size={18} strokeWidth={1.5} />
              <span className="doc-title">{d.title}</span>
              <span className="mono muted">{`v${d.version} · ${showDate(d.updated_at)}`}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );

  const detail =
    props.rest.length > 1 ? (
      <NotFound back="/docs" />
    ) : openId ? (
      <DocEditor key={openId} id={openId} onSaved={(doc) => setDocs((list) => list && list.map((d) => (d.id === doc.id ? doc : d)))} />
    ) : (
      <div className="sheet">
        <TitleBlock name="Docs" state={`${docs?.length ?? 0} shared`} changed={app.workspace.today} />
        <h1>Docs</h1>
        <EmptyNote>Open a doc from the list to read or edit it.</EmptyNote>
      </div>
    );
  return <Panes list={list} detail={detail} detailFirst={openId !== null} detailKey={`doc-${openId ?? "none"}`} />;
}

function DocEditor(props: { id: string; onSaved: (doc: Doc) => void }): JSX.Element {
  const app = useApp();
  const [doc, setDoc] = useState<Doc | null | "missing">(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Doc | null>(null);
  const [history, setHistory] = useState<DocVersion[] | null>(null);
  const readOnly = app.person.role === "guest";

  const say = useCallback((text: string): void => {
    flushSync(() => setStatus(""));
    setStatus(text);
  }, []);

  const show = useCallback((next: Doc): void => {
    setDoc(next);
    setTitle(next.title);
    setBody(forEditor(next.body ?? ""));
  }, []);

  const loaded = doc && doc !== "missing" ? doc : null;
  const unsaved = loaded !== null && (title !== loaded.title || body !== forEditor(loaded.body ?? ""));
  const live = useRef({ loaded, unsaved, title, body });
  live.current = { loaded, unsaved, title, body };

  useEffect(() => {
    get<Doc>(`/api/docs/${props.id}`)
      .then((found) => {
        const draft = draftFor(props.id, app.person.id);
        if (!draft) return show(found);
        setDoc({ ...found, version: draft.base_version });
        setTitle(draft.title);
        setBody(forEditor(draft.body));
        say("Your unsaved changes were restored.");
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setDoc("missing");
      });
  }, [props.id, app.person.id, say, show]);

  const personId = app.person.id;
  useEffect(
    () =>
      trackUnsaved(() => {
        const { loaded: open, unsaved: edited, title: heading, body: text } = live.current;
        if (!open || !edited) return null;
        return { doc_id: open.id, person_id: personId, title: heading, body: withStoredEndings(open.body ?? "", text), base_version: open.version };
      }),
    [personId],
  );

  /** A `doc` event loads the new version into an editor with no unsaved changes; edits are left alone. */
  useEffect(
    () =>
      app.on((event) => {
        const open = live.current.loaded;
        if (event.name === "revoked" && event.data.scope === "project" && open?.project_id === event.data.id) setDoc("missing");
        if (event.name !== "doc" || event.data.id !== props.id || !open || event.data.version <= open.version) return;
        if (live.current.unsaved) return;
        void get<Doc>(`/api/docs/${props.id}`)
          .then((next) => {
            if (!live.current.unsaved) show(next);
          })
          .catch(() => undefined);
      }),
    [app, props.id, show],
  );

  if (doc === "missing") return <NotFound back="/docs" />;
  if (doc === null) return <div className="sheet" aria-busy="true" />;

  const saved = (next: Doc): void => {
    dropDraft();
    show(next);
    props.onSaved(next);
  };

  const openConflict = (error: ApiFailure): void => {
    const current = error.payload.current as Doc;
    setConflict(current);
    say(`${app.nameOf(current.updated_by)} saved version ${current.version} while you were editing. Keep mine or load theirs?`);
  };

  const save = async (baseVersion: number): Promise<void> => {
    setErrors({});
    say("Saving");
    try {
      const next = await api<Doc>("PUT", `/api/docs/${doc.id}`, { title, body: withStoredEndings(doc.body ?? "", body), base_version: baseVersion });
      saved(next);
      say(`Saved version ${next.version}.`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) return say("");
      if (error.code === "version_conflict") openConflict(error);
      else if (error.code === "validation") {
        const fields: Record<string, string> = {};
        if (error.fields.title) fields.title = title.trim() === "" ? "Give the doc a title." : "Doc titles can be up to 200 characters.";
        if (error.fields.body) fields.body = "A doc can be up to 200,000 characters.";
        setErrors(fields);
        say(Object.values(fields).join(" "));
      } else say("");
    }
  };

  const openHistory = async (): Promise<void> => {
    const { versions } = await get<{ versions: DocVersion[] }>(`/api/docs/${doc.id}/versions`);
    setHistory(versions.filter((v) => v.version < doc.version));
  };

  const restore = async (version: number): Promise<void> => {
    setHistory(null);
    say("Saving");
    try {
      const next = await api<Doc>("POST", `/api/docs/${doc.id}/restore`, { version, base_version: doc.version });
      saved(next);
      say(`Restored version ${version} as version ${next.version}.`);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "version_conflict") openConflict(error);
      else say("");
    }
  };

  return (
    <article className="sheet doc-sheet">
      <SheetHeader back="/docs" />
      <TitleBlock name={doc.title} state={`Version ${doc.version}`} changed={doc.updated_at} />
      <h1 className="doc-heading">{doc.title}</h1>
      <p className="eyebrow mono">
        {`Version ${doc.version}`} · {`Last edited by ${app.nameOf(doc.updated_by)}`}
      </p>
      <div className="field">
        <label htmlFor="doc-title">Doc title</label>
        <input id="doc-title" className="input doc-title-input" value={title} readOnly={readOnly} aria-invalid={errors.title ? true : undefined} onChange={(e) => setTitle(e.target.value)} />
        {errors.title && <p className="field-error">{errors.title}</p>}
      </div>
      <div className="field">
        <label htmlFor="doc-body">Doc body</label>
        <textarea id="doc-body" className="input doc-body" rows={14} value={body} readOnly={readOnly} aria-invalid={errors.body ? true : undefined} onChange={(e) => setBody(e.target.value)} />
        {errors.body && <p className="field-error">{errors.body}</p>}
      </div>
      <div className="doc-actions">
        {!readOnly && (
          <>
            <button type="button" className="button primary" onClick={() => void save(doc.version)}>
              Save doc
            </button>
            <button type="button" className="button" onClick={() => void openHistory().catch(() => undefined)}>
              Version history
            </button>
          </>
        )}
        <p role="status" aria-label="Doc status" aria-live="polite" className="doc-status">
          {status}
        </p>
      </div>
      <section className="attachments-block" aria-label="Attachments">
        <h2>Attachments</h2>
        <Attachments attachments={doc.attachments} />
        <Uploader path={`/api/docs/${doc.id}/attachments`} onUploaded={(a) => setDoc((d) => (d && d !== "missing" ? { ...d, attachments: withAttachment(d.attachments, a) } : d))} />
      </section>
      {history && (
        <Dialog label="Version history" onClose={() => setHistory(null)}>
          <div className="dialog-body">
            <h2>Version history</h2>
            {history.length === 0 && <p>This is the first version.</p>}
            <ul className="ruled-list versions">
              {history.map((v) => (
                <li key={v.version}>
                  <span className="mono">{`${showDate(v.saved_at)} · ${app.nameOf(v.saved_by)}`}</span>
                  <button type="button" className="button" onClick={() => void restore(v.version)}>
                    {`Restore version ${v.version}`}
                  </button>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button type="button" className="button ghost" onClick={() => setHistory(null)}>
                Close
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {conflict && (
        <Dialog label="Newer version saved" onClose={() => setConflict(null)}>
          <div className="dialog-body">
            <h2>Newer version saved</h2>
            <p>{`${app.nameOf(conflict.updated_by)} saved version ${conflict.version} while you were editing.`}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setConflict(null);
                  void save(conflict.version);
                }}
              >
                Keep mine
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setConflict(null);
                  dropDraft();
                  show(conflict);
                  say(`Loaded version ${conflict.version} from ${app.nameOf(conflict.updated_by)}.`);
                }}
              >
                Load theirs
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </article>
  );
}
