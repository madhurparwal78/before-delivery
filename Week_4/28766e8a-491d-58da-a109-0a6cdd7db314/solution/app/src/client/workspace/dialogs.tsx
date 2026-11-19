// Share, Export, Save version, Delete page and Sign in to continue (brief: Public screens and
// controls, Feedback states, Export dialog, Sessions).
import { useEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../shared/copy";
import { exportFrame } from "../../shared/svg";
import { LIMITS } from "../../shared/text";
import type { ExportView, InviteView, MemberView, VersionView } from "../../shared/types";
import { announce } from "../announce";
import { Dialog } from "../dialog";
import { Icon } from "../icons";
import { deletePage } from "./commands";
import type { WorkspaceStore } from "./store";

const SHARE_POLL_MS = 1000;

export function ShareDialog({ store, opener, onClose }: { store: WorkspaceStore; opener: HTMLElement | null; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  useEffect(() => {
    void store.refreshMembers();
    const timer = setInterval(() => void store.refreshMembers(), SHARE_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  const data = store.members;
  const outage = !!data?.invites.some((i) => i.status === "email_not_sent");
  const reported = (invite: InviteView) => {
    if (invite.status === "emailed") announce(copy.inviteEmailed(invite.email));
    else announce(copy.mailOutage);
  };
  const send = async (e: Event) => {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const res = await store.call<{ invite: InviteView }>("POST", `/api/diagrams/${store.diagramId}/invites`, { email, role });
    setPending(false);
    if (res.ok) {
      reported(res.data.invite);
      setEmail("");
      void store.refreshMembers();
    } else setError(res.error.fields?.email ?? res.error.message);
  };
  const resend = async (invite: InviteView) => {
    setPending(true);
    const res = await store.call<{ invite: InviteView }>("POST", `/api/diagrams/${store.diagramId}/invites/${invite.id}/resend`);
    setPending(false);
    if (res.ok) reported(res.data.invite);
    void store.refreshMembers();
  };
  const removeInvite = async (invite: InviteView) => {
    await store.call("DELETE", `/api/diagrams/${store.diagramId}/invites/${invite.id}`);
    void store.refreshMembers();
  };
  const removeMember = async (member: MemberView) => {
    await store.call("DELETE", `/api/diagrams/${store.diagramId}/members/${member.userId}`);
    void store.refreshMembers();
  };
  const changeRole = async (member: MemberView, next: string) => {
    setRoles({ ...roles, [member.userId]: next });
    await store.call("PATCH", `/api/diagrams/${store.diagramId}/members/${member.userId}`, { role: next });
    await store.refreshMembers();
    setRoles((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== member.userId)));
  };
  return (
    <Dialog label="Share" onClose={onClose} returnTo={opener} className="share-dialog">
      <div class="dialog-body">
        {outage && <p class="banner inline-banner"><Icon name="alert" size={16} /> {copy.mailOutage}</p>}
        <form class="invite-form" onSubmit={send} noValidate>
          <div class="field">
            <label for="invite-email">Email</label>
            <input id="invite-email" type="email" value={email} aria-invalid={error ? "true" : undefined} aria-describedby={error ? "invite-error" : undefined}
              onInput={(e) => setEmail(e.currentTarget.value)} />
            {error && <p class="field-error" id="invite-error">{error}</p>}
          </div>
          <div class="field">
            <label for="invite-role">Role</label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.currentTarget.value as "editor" | "viewer")}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button type="submit" class="primary" aria-disabled={pending ? "true" : undefined}>Send invite</button>
        </form>
        {pending && <p class="muted">{copy.invitePending}</p>}
        <ul class="members" aria-label="Members">
          {data?.members.map((m) => (
            <li key={m.userId}>
              <span class="who"><strong>{m.name}</strong><span class="muted">{m.email}</span></span>
              {m.role === "owner" ? <span class="role-text">Owner</span> : (
                <select aria-label={`Role for ${m.email}`} value={roles[m.userId] ?? m.role} onChange={(e) => void changeRole(m, e.currentTarget.value)}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              )}
              <span class="status">{copy.activeStatus}</span>
              {m.role !== "owner" ? <button type="button" class="ghost row-action" aria-label={`Remove ${m.email}`} onClick={() => void removeMember(m)}>Remove</button> : <span />}
            </li>
          ))}
          {data?.invites.map((i) => (
            <li key={i.id}>
              <span class="who"><strong>{i.email}</strong></span>
              <span class="role-text">{i.role === "editor" ? "Editor" : "Viewer"}</span>
              <span class="status">{copy.inviteStatus[i.status]}</span>
              <span class="row-action">
                {i.status !== "emailed" && (
                  <button type="button" class="ghost" aria-label={`Resend invite to ${i.email}`} onClick={() => void resend(i)}>Resend</button>
                )}
                <button type="button" class="ghost" aria-label={`Remove ${i.email}`} onClick={() => void removeInvite(i)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

/** The newest export this person requested for a page. */
function mine(store: WorkspaceStore, page: string): ExportView | undefined {
  return store.exports.find((x) => x.requestedBy === store.me?.id && x.page === page);
}

export function ExportDialog({ store, opener, onClose }: { store: WorkspaceStore; opener: HTMLElement | null; onClose: () => void }) {
  const doc = store.doc;
  const [page, setPage] = useState(store.page?.id ?? "");
  const [format, setFormat] = useState<"png" | "svg">("png");
  const [scale, setScale] = useState<1 | 2>(1);
  const [background, setBackground] = useState<"white" | "transparent">("white");
  const [error, setError] = useState<string | null>(null);
  // One request per press: further presses while a request is unanswered send nothing.
  const sending = useRef(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const current = mine(store, page);
  const status = current && retrying === current.id && current.status === "storage_unavailable" ? "rendering" : current?.status;
  const pageName = doc?.pages.find((p) => p.id === page)?.name ?? "";
  const start = async () => {
    if (sending.current) return;
    setError(null);
    const target = doc?.pages.find((p) => p.id === page);
    if (!target || !exportFrame(target)) {
      setError(copy.fields.exportPage);
      return;
    }
    sending.current = true;
    announce(copy.exporting(pageName));
    const res = await store.call<{ id: string }>("POST", `/api/diagrams/${store.diagramId}/exports`, { page, format, scale: format === "svg" ? 1 : scale, background })
      .finally(() => {
        sending.current = false;
      });
    if (res.ok) {
      store.rememberExport(res.data.id);
      void store.refreshExports();
    } else if (res.status !== 401) setError(res.error.message);
  };
  const retry = async (x: ExportView) => {
    if (sending.current) return;
    sending.current = true;
    setRetrying(x.id);
    announce(copy.exporting(pageName));
    // A 409 export_not_retryable means another retry already started: the dialog keeps showing the current state.
    try {
      await store.call("POST", `/api/exports/${x.id}/retry`);
      await store.refreshExports();
    } finally {
      sending.current = false;
      setRetrying(null);
    }
  };
  return (
    <Dialog label="Export" onClose={onClose} returnTo={opener} className="export-dialog">
      <div class="dialog-body">
        <fieldset role="radiogroup" aria-label="Format">
          <legend>Format</legend>
          {(["png", "svg"] as const).map((f) => (
            <label key={f} class="choice"><input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} /> {f.toUpperCase()}</label>
          ))}
        </fieldset>
        <fieldset role="radiogroup" aria-label="Scale" disabled={format === "svg"}>
          <legend>Scale</legend>
          {([1, 2] as const).map((s) => (
            <label key={s} class="choice"><input type="radio" name="scale" checked={scale === s} onChange={() => setScale(s)} /> {s}x</label>
          ))}
        </fieldset>
        <div class="field">
          <label for="export-page">Page</label>
          <select id="export-page" value={page} onChange={(e) => setPage(e.currentTarget.value)}>
            {[...(doc?.pages ?? [])].sort((a, b) => a.order - b.order).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <fieldset role="radiogroup" aria-label="Background">
          <legend>Background</legend>
          {(["white", "transparent"] as const).map((b) => (
            <label key={b} class="choice"><input type="radio" name="background" checked={background === b} onChange={() => setBackground(b)} /> {b === "white" ? "White" : "Transparent"}</label>
          ))}
        </fieldset>
        {error && <p class="field-error">{error}</p>}
        <button type="button" class="primary" onClick={() => void start()}>Export</button>
        {current && (
          <div class="export-state">
            {status === "rendering" && <p>{copy.exporting(pageName)}</p>}
            {status === "ready" && (
              <p>{copy.exportReady} <a class="text-link" href={`/api/exports/${current.id}/file`} download>{current.format === "png" ? "Download PNG" : "Download SVG"}</a></p>
            )}
            {status === "storage_unavailable" && (
              <div class="banner inline-banner">
                <p><Icon name="alert" size={16} /> {copy.exportPaused}</p>
                <button type="button" class="ghost" onClick={() => void retry(current)}>Try again</button>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function SaveVersionDialog({ store, opener, onClose }: { store: WorkspaceStore; opener: HTMLElement | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const save = async (e: Event) => {
    e.preventDefault();
    const res = await store.call<{ version: VersionView }>("POST", `/api/diagrams/${store.diagramId}/versions`, { name });
    if (!res.ok) return;
    announce(copy.versionSaved(res.data.version.displayName));
    void store.refreshVersions();
    onClose();
  };
  return (
    <Dialog label="Save version" onClose={onClose} returnTo={opener}>
      <form class="dialog-body" onSubmit={save}>
        <div class="field">
          <label for="version-name">Version name</label>
          <input id="version-name" value={name} maxLength={LIMITS.versionName} onInput={(e) => setName(e.currentTarget.value)} />
        </div>
        <button type="submit" class="primary">Save</button>
      </form>
    </Dialog>
  );
}

export function DeletePageDialog({ store, pageId, opener, onClose }: { store: WorkspaceStore; pageId: string; opener: HTMLElement | null; onClose: () => void }) {
  const name = store.doc?.pages.find((p) => p.id === pageId)?.name ?? "";
  return (
    <Dialog label="Delete page" role="alertdialog" onClose={onClose} returnTo={opener} initial=".dialog-actions .ghost">
      <div class="dialog-body">
        <p>Delete {name} and everything on it? Others see the change at once.</p>
        <div class="dialog-actions">
          <button type="button" class="danger" onClick={() => {
            onClose();
            deletePage(store, pageId);
          }}>Delete page</button>
          <button type="button" class="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

export function SignInDialog({ store }: { store: WorkspaceStore }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (await store.signIn(password)) return;
    setError(copy.signInError);
    announce(copy.signInError);
  };
  return (
    <Dialog label="Sign in to continue" onClose={() => store.closeSignIn()} returnTo={store.signInReturn} initial="#continue-password">
      <form class="dialog-body" onSubmit={submit} noValidate>
        {error && <p class="field-error">{error}</p>}
        <div class="field">
          <label for="continue-email">Email</label>
          <input id="continue-email" type="email" value={store.me?.email ?? ""} readOnly />
        </div>
        <div class="field">
          <label for="continue-password">Password</label>
          <input id="continue-password" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
        </div>
        <button type="submit" class="primary">Sign in</button>
      </form>
    </Dialog>
  );
}
