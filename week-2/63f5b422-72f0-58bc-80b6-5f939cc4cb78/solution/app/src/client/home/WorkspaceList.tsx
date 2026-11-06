import { useEffect, useState, type FormEvent } from "react";
import type { Role } from "../../shared/types.js";
import { api } from "../api.js";
import { FieldMessage } from "../ui/FieldMessage.js";

interface Me {
  user: { id: string; name: string; email: string };
  workspaces: { id: string; name: string; slug: string; role: Role }[];
}

const ROLE_TEXT: Record<Role, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

/** `/`: the workspaces a person belongs to, and a form to create one. */
export function WorkspaceList() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Me>("GET", "/api/me").then((r) => (r.ok ? setMe(r.data) : location.assign("/signin")));
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Enter a workspace name.");
    setBusy(true);
    const result = await api<{ id: string }>("POST", "/api/workspaces", { name: name.trim() });
    setBusy(false);
    if (result.ok) return location.assign(`/w/${result.data.id}/edit`);
    setError(result.error.fields.name ?? result.error.message);
  };

  const signOut = async () => {
    await api("POST", "/api/auth/signout");
    location.assign("/signin");
  };

  return (
    <main className="pl-ground pl-home">
      <div className="pl-home-inner">
        <header className="pl-home-head">
          <p className="pl-brand">
            <span className="pl-brand-mark" aria-hidden="true" /> Plinth
          </p>
          {me && (
            <p className="pl-home-user">
              {me.user.name} · <button type="button" className="pl-link-button" onClick={() => void signOut()}>Sign out</button>
            </p>
          )}
        </header>
        <h1>Workspaces</h1>
        {me === null ? (
          <p className="pl-muted">Loading your workspaces…</p>
        ) : me.workspaces.length === 0 ? (
          <p className="pl-muted">You are not in a workspace yet. Create one to start building pages.</p>
        ) : (
          <ul className="pl-workspaces">
            {me.workspaces.map((w) => (
              <li key={w.id}>
                <a href={`/w/${w.id}/edit`}>{w.name}</a>
                <span className="pl-role">{ROLE_TEXT[w.role]}</span>
              </li>
            ))}
          </ul>
        )}
        <form className="pl-create" onSubmit={create} noValidate>
          <div className={`pl-field${error ? " pl-field-error" : ""}`}>
            <label htmlFor="workspace-name">Workspace name</label>
            <input
              id="workspace-name"
              value={name}
              maxLength={80}
              aria-describedby={error ? "workspace-name-error" : undefined}
              onChange={(e) => (setName(e.target.value), setError(null))}
            />
            {error && (
              <FieldMessage id="workspace-name-error">{error}</FieldMessage>
            )}
          </div>
          <button type="submit" className="pl-primary" aria-busy={busy || undefined} disabled={busy}>
            Create workspace
          </button>
        </form>
      </div>
    </main>
  );
}
