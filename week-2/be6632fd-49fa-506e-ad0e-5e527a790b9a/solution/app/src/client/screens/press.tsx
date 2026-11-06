// The press lead's screens (brief: Staff screens → `/studio/press`, previews; Journey 5).
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { marketTime } from "../../shared/format";
import { api } from "../api";
import { useDraft } from "../drafts";
import { Link } from "../router";
import type { StaffDrop } from "../types";
import { Button, Dialog, EmptyRow, Field, Loading, PageTitle, StatusMark, StatusRegion, focusLater, refusalMessage, useMessage } from "../ui";

export function PressScreen(): JSX.Element {
  const [drops, setDrops] = useState<StaffDrop[] | null>(null);
  const [message, setMessage] = useMessage();
  useEffect(() => {
    void api<{ items: StaffDrop[] }>("GET", "/api/drops").then((r) => (r.ok ? setDrops(r.data.items) : setMessage(refusalMessage(r))));
  }, [setMessage]);
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">Stories and embargoed previews</p>
        <PageTitle>Press</PageTitle>
        <StatusRegion name="Press status" message={message} />
      </div>
      <section className="panel">
        {!drops ? <Loading /> : null}
        <div className="table-scroll" tabIndex={0}>
          <table aria-label="Drops" className="ruled cards-on-phone">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Opens</th>
                <th scope="col">Press</th>
              </tr>
            </thead>
            <tbody>
              {drops?.length === 0 ? <EmptyRow columns={4} /> : null}
              {drops?.map((d) => (
                <tr key={d.id}>
                  <th scope="row">{d.name}</th>
                  <td data-label="Status">
                    <StatusMark status={d.status} />
                  </td>
                  <td data-label="Opens" className="mono">{d.goLiveAt ? marketTime(Date.parse(d.goLiveAt)) : "—"}</td>
                  <td className="row-links">
                    <Link to={`/studio/drops/${d.id}/story`}>Story</Link>
                    <Link to={`/studio/drops/${d.id}/previews`}>Previews</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface Preview {
  id: string;
  editorName: string;
  editorEmail: string;
  outlet: string;
  status: "active" | "revoked" | "expired";
  issuedAt: string;
  expiresAt: string;
  link: string;
}

const STATUS_TEXT: Record<Preview["status"], string> = { active: "Active", revoked: "Revoked", expired: "Expired" };

export function PreviewsScreen({ id }: { id: string }): JSX.Element {
  const [drop, setDrop] = useState<StaffDrop | null>(null);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [message, setMessage] = useMessage();
  const [dialog, setDialog] = useState<{ kind: "send" } | { kind: "revoke" | "regenerate"; preview: Preview } | null>(null);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const opener = useRef<HTMLElement | null>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const draft = useDraft("send-preview", { editorName: "", editorEmail: "", outlet: "" });
  const load = useCallback(async () => {
    const [d, p] = await Promise.all([api<StaffDrop>("GET", `/api/drops/${id}`), api<{ items: Preview[] }>("GET", `/api/drops/${id}/previews`)]);
    if (d.ok) setDrop(d.data);
    if (p.ok) setPreviews(p.data.items);
    else setMessage(refusalMessage(p));
  }, [id, setMessage]);
  useEffect(() => {
    void load();
  }, [load]);
  const close = (): void => {
    setDialog(null);
    setAlert(null);
    setErrors({});
    focusLater(() => opener.current);
  };
  const refuse = (r: { message: string; fields: Record<string, string> }): void => {
    setErrors(r.fields);
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("Sending…");
    const r = await api<Preview>("POST", `/api/drops/${id}/previews`, draft.value);
    setPending(false);
    if (r.ok) {
      draft.clear();
      setMessage(`Preview link created. The email to ${r.data.editorName} is on its way.`);
      await load();
      close();
      return;
    }
    setMessage(refusalMessage(r));
    refuse(r);
  };
  const act = async (kind: "revoke" | "regenerate", preview: Preview): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage(kind === "revoke" ? "Revoking…" : "Regenerating…");
    const r = await api<Preview>("POST", `/api/previews/${preview.id}/${kind}`);
    setPending(false);
    if (r.ok) {
      setMessage(kind === "revoke" ? "Link revoked." : `New link created. The old link no longer works, and the email to ${r.data.editorName} is on its way.`);
      await load();
      close();
      return;
    }
    setMessage(refusalMessage(r));
    refuse(r);
  };
  if (!drop || !previews) return <Loading />;
  return (
    <div className="screen">
      <div className="screen-head with-action">
        <div>
          <p className="eyebrow">
            <Link to="/studio/press">Press</Link> · Embargoed previews
          </p>
          <PageTitle>{`Press previews · ${drop.name}`}</PageTitle>
        </div>
        <Button
          variant="primary"
          buttonRef={sendButton}
          onClick={() => {
            opener.current = sendButton.current;
            setDialog({ kind: "send" });
          }}
        >
          Send preview
        </Button>
      </div>
      <StatusRegion name="Preview status" message={message} />
      <section className="panel">
        <div className="table-scroll" tabIndex={0}>
          <table aria-label="Preview links" className="ruled">
            <thead>
              <tr>
                <th scope="col">Editor</th>
                <th scope="col">Outlet</th>
                <th scope="col">Status</th>
                <th scope="col">Expires</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {previews.length === 0 ? <EmptyRow columns={5} /> : null}
              {previews.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    {p.editorName}
                    <span className="sub">{p.editorEmail}</span>
                  </th>
                  <td>{p.outlet}</td>
                  <td>{STATUS_TEXT[p.status]}</td>
                  <td className="mono">{marketTime(Date.parse(p.expiresAt))}</td>
                  <td className="row-actions">
                    {(["revoke", "regenerate"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className="btn btn-secondary"
                        onClick={(e) => {
                          opener.current = e.currentTarget;
                          setDialog({ kind, preview: p });
                        }}
                      >
                        {kind === "revoke" ? "Revoke" : "Regenerate"}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {dialog?.kind === "send" ? (
        <Dialog title="Send preview" alert={alert} alertKey={attempt} onClose={() => (draft.clear(), close())}>
          <form onSubmit={(e) => void send(e)} noValidate className="stack">
            <Field id="preview-name" label="Editor name" value={draft.value.editorName} onChange={(editorName) => draft.set((d) => ({ ...d, editorName }))} error={errors.editorName} />
            <Field id="preview-email" label="Editor email" type="email" value={draft.value.editorEmail} onChange={(editorEmail) => draft.set((d) => ({ ...d, editorEmail }))} error={errors.editorEmail} />
            <Field id="preview-outlet" label="Outlet" value={draft.value.outlet} onChange={(outlet) => draft.set((d) => ({ ...d, outlet }))} error={errors.outlet} />
            <p className="muted">The editor gets the story, the market opening times and the look images. Nothing commercial is sent.</p>
            <div className="dialog-actions">
              <Button type="submit" variant="primary" pending={pending} pendingText="Sending…">
                Send preview
              </Button>
              <Button onClick={() => (draft.clear(), close())}>Cancel</Button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {dialog && dialog.kind !== "send" ? (
        <Dialog title={dialog.kind === "revoke" ? "Revoke link" : "Regenerate link"} alert={alert} alertKey={attempt} onClose={close}>
          <p>
            {dialog.kind === "revoke"
              ? `The link sent to ${dialog.preview.editorName} stops working at once.`
              : `${dialog.preview.editorName} gets a new link with a fresh expiry; the old link stops working at once.`}
          </p>
          <div className="dialog-actions">
            <Button variant={dialog.kind === "revoke" ? "danger" : "primary"} pending={pending} pendingText={dialog.kind === "revoke" ? "Revoking…" : "Regenerating…"} onClick={() => void act(dialog.kind, dialog.preview)}>
              {dialog.kind === "revoke" ? "Revoke link" : "Regenerate link"}
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
