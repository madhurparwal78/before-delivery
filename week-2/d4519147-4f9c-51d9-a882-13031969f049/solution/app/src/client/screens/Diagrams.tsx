import { useEffect, useRef, useState } from "react";
import { announce, AnnouncementsRegion } from "../announce.tsx";
import { errorBody, readJson, request, sessionInfo, type SessionUser } from "../api.ts";
import { EmptyPlan } from "../icons.tsx";
import { Modal, useModalDepth } from "../modal.tsx";
import { navigate } from "../router.ts";

interface Row {
  id: string;
  title: string;
  role: "owner" | "editor" | "viewer";
  updatedAt: string;
}

const ROLE = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;
const updated = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export function Diagrams() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dialog, setDialog] = useState<null | "new" | "password">(null);
  const inert = useModalDepth() > 0;

  useEffect(() => {
    void (async () => {
      const res = await request({ method: "GET", path: "/api/diagrams" });
      if (res.ok) setRows((await readJson<{ diagrams: Row[] }>(res)).diagrams);
    })();
  }, []);

  const signOut = async () => {
    const res = await request({ method: "DELETE", path: "/api/session" });
    if (res.status === 204 || res.status === 401) {
      sessionInfo.clear();
      void navigate("/signin", { force: true });
    }
  };

  return (
    <div className="page-screen">
      <main className="list-screen" inert={inert}>
        <header className="list-head">
          <p className="eyebrow">Scopewright{sessionInfo.user ? ` · ${sessionInfo.user.displayName}` : ""}</p>
          <h1>Diagrams</h1>
        </header>
        <ul className="diagram-list" aria-label="Your diagrams">
          {(rows ?? []).map((d) => (
            <li key={d.id} className="diagram-row">
              <a className="diagram-link" href={`/d/${d.id}`} onClick={(e) => {
                e.preventDefault();
                void navigate(`/d/${d.id}`);
              }}>{d.title}</a>
              <span className="chip">{ROLE[d.role]}</span>
              <span className="row-meta mono">Updated {updated.format(new Date(d.updatedAt))} UTC</span>
            </li>
          ))}
        </ul>
        {rows === null && <div className="skeleton-rows skeleton-list" aria-hidden="true"><span /><span /><span /></div>}
        {rows?.length === 0 && (
          <div className="list-empty">
            <EmptyPlan />
            <p>No diagrams yet. Use New diagram to start one, or ask a diagram owner for an invitation.</p>
          </div>
        )}
        <div className="list-actions">
          <button type="button" className="btn btn-primary" onClick={() => setDialog("new")}>New diagram</button>
          <button type="button" className="btn" onClick={() => setDialog("password")}>Change password</button>
          <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
        </div>
      </main>
      <div className="list-status"><AnnouncementsRegion /></div>
      {dialog === "new" && <NewDiagram onClose={() => setDialog(null)} />}
      {dialog === "password" && <ChangePassword onClose={() => setDialog(null)} />}
    </div>
  );
}

function NewDiagram({ onClose }: { onClose(): void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await request({ method: "POST", path: "/api/diagrams", json: { title } });
    setBusy(false);
    if (res.status === 201) {
      const d = (await readJson<{ diagram: { id: string; pages: { id: string }[] } }>(res)).diagram;
      void navigate(`/d/${d.id}/p/${d.pages[0]!.id}`, { hint: "focus-canvas" });
      return;
    }
    setError((await errorBody(res))?.error === "validation" ? "Use 1 to 120 characters, with no line breaks or control characters." : "Something went wrong. Try again.");
  };
  return (
    <Modal kind="dialog" label="New diagram" onClose={onClose} className="dialog-narrow">
      <header className="dialog-head"><h2>New diagram</h2></header>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}>
        <div className="field">
          <label htmlFor="new-title">Title</label>
          <input id="new-title" type="text" value={title} maxLength={120} aria-describedby={error ? "new-title-error" : undefined} onChange={(e) => setTitle(e.target.value)} />
          {error && <p className="field-error" id="new-title-error">{error}</p>}
        </div>
        <footer className="dialog-foot">
          <button type="submit" className="btn btn-primary" disabled={busy}>Create diagram</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </footer>
      </form>
    </Modal>
  );
}

function ChangePassword({ onClose }: { onClose(): void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; alert?: string }>({});
  const [busy, setBusy] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await request({ method: "POST", path: "/api/session/password", json: { currentPassword: current, newPassword: next } });
    setBusy(false);
    if (res.ok) {
      sessionInfo.adopt(await readJson<{ user: SessionUser; csrfToken: string }>(res));
      onClose();
      announce("Password changed. Your other sessions were signed out.");
      return;
    }
    const body = await errorBody(res);
    if (body?.error === "signin_locked") return setErrors({ alert: "Too many sign-in attempts. Try again later." });
    if (body?.error === "validation") {
      const f = body.fields ?? {};
      return setErrors({
        current: f.currentPassword === "incorrect" ? "Current password is incorrect." : undefined,
        next: f.newPassword === "length" ? "Use 12 to 128 characters." : f.newPassword === "unchanged" ? "Choose a password different from your current one." : undefined,
      });
    }
    setErrors({ alert: "Something went wrong. Try again." });
  };
  return (
    <Modal kind="dialog" label="Change password" onClose={onClose} initialFocus={currentRef} className="dialog-narrow">
      <header className="dialog-head"><h2>Change password</h2></header>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}>
        <div className="field">
          <label htmlFor="pw-current">Current password</label>
          <input id="pw-current" ref={currentRef} type="password" autoComplete="current-password" value={current} aria-describedby={errors.current ? "pw-current-error" : undefined} onChange={(e) => setCurrent(e.target.value)} />
          {errors.current && <p className="field-error" id="pw-current-error">{errors.current}</p>}
        </div>
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" autoComplete="new-password" value={next} aria-describedby={errors.next ? "pw-new-error" : "pw-new-hint"} onChange={(e) => setNext(e.target.value)} />
          {errors.next ? <p className="field-error" id="pw-new-error">{errors.next}</p> : <p className="hint" id="pw-new-hint">12 to 128 characters. Your other sessions sign out when it changes.</p>}
        </div>
        <div role="alert" className="form-alert">{errors.alert}</div>
        <footer className="dialog-foot">
          <button type="submit" className="btn btn-primary" disabled={busy}>Save password</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </footer>
      </form>
    </Modal>
  );
}
