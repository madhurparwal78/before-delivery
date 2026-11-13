// Keys and spaces: scoped API keys shown once, spaces and members, and saved search copies.
import { useState, type FormEvent } from "react";
import { api, ApiFailure } from "../lib/api";
import { Modal } from "../lib/dialog";
import { useShown } from "../lib/format";
import { Link } from "../lib/router";
import { announce, update, useAppState, type Me } from "../lib/store";
import { Button, EmptyBand, ErrorSummary, Field, LoadFailed, Skeleton, useBusy } from "../lib/ui";
import { useResource } from "../lib/useResource";

interface KeyRow {
  id: number;
  name: string;
  stream_pattern: string;
  actions: string[];
  expires_at: string | null;
  revoked: boolean;
  last4: string;
}

const ACTIONS = ["read", "upload", "manage"];

function NewKeyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [days, setDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        const made = await api.post<{ key: string }>("/api/keys", {
          name, stream_pattern: pattern, actions, expires_in_days: days.trim() === "" ? null : Number(days),
        });
        setCreated(made.key);
        onDone();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="New key" onClose={onClose}>
      {created ? (
        <div className="stack">
          <Field label="New key value">
            {(props) => <input {...props} type="text" readOnly className="mono" value={created} onFocus={(event) => event.target.select()} />}
          </Field>
          <p className="notice">This key is shown once. Copy it now.</p>
          <div className="dialog-actions"><Button primary onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <ErrorSummary failure={failure} labels={{ name: "Key name", stream_pattern: "Stream pattern", actions: "Actions", expires_in_days: "Expires in (days)" }} />
          <Field label="Key name" error={failure?.fields.name}>
            {(props) => <input {...props} type="text" data-field="name" value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label="Stream pattern" hint="Whole stream names; * stands for any run of characters." error={failure?.fields.stream_pattern}>
            {(props) => <input {...props} type="text" data-field="stream_pattern" className="mono" autoCapitalize="none" spellCheck={false} value={pattern} onChange={(event) => setPattern(event.target.value)} />}
          </Field>
          <fieldset role="group" aria-labelledby="key-actions" data-field="actions">
            <legend id="key-actions">Actions</legend>
            <div className="check-row">
              {ACTIONS.map((action) => (
                <label key={action} className="check">
                  <input type="checkbox" checked={actions.includes(action)} onChange={(event) => setActions(event.target.checked ? [...actions, action] : actions.filter((a) => a !== action))} />
                  {action}
                </label>
              ))}
            </div>
            {failure?.fields.actions ? <p className="field-error">{failure.fields.actions}</p> : null}
          </fieldset>
          <Field label="Expires in (days)" hint="A whole number from 1 to 365, or empty for never." error={failure?.fields.expires_in_days}>
            {(props) => <input {...props} type="text" inputMode="numeric" data-field="expires_in_days" value={days} onChange={(event) => setDays(event.target.value)} />}
          </Field>
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Create key</button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function KeysPage() {
  const list = useResource(() => api.get<{ keys: KeyRow[] }>("/api/keys"), []);
  const [creating, setCreating] = useState(false);
  const shown = useShown();
  const empty = list.data?.keys.length === 0;
  const open = <Button primary={empty} onClick={() => setCreating(true)}>New key</Button>;
  const revoke = async (key: KeyRow): Promise<void> => {
    await api.del(`/api/keys/${key.id}`);
    announce(`Key ${key.name} revoked.`);
    list.reload();
  };
  return (
    <div className="stack">
      <div className="page-head"><h1>Keys</h1>{empty ? null : open}</div>
      {list.error ? <LoadFailed failure={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <Skeleton /> : null}
      {empty ? <EmptyBand line="No API keys yet.">{open}</EmptyBand> : null}
      {list.data && !empty ? (
        <div className="table-wrap">
          <table className="data" aria-label="Keys">
            <thead><tr><th scope="col">Name</th><th scope="col">Stream pattern</th><th scope="col">Actions</th><th scope="col">Expires</th><th scope="col">Key</th><th scope="col">Status</th><th scope="col" /></tr></thead>
            <tbody>
              {list.data.keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td><td className="mono">{key.stream_pattern}</td><td>{key.actions.join(", ")}</td>
                  <td className="mono">{key.expires_at ? shown(key.expires_at) : "never"}</td><td className="mono">...{key.last4}</td>
                  <td>{key.revoked ? "revoked" : "active"}</td>
                  <td>{key.revoked ? null : <Button onClick={() => void revoke(key)} aria-label={`Revoke ${key.name}`}>Revoke</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {creating ? <NewKeyDialog onClose={() => setCreating(false)} onDone={list.reload} /> : null}
    </div>
  );
}

interface SavedSearch { id: number; name: string; stream: string; needs_attention: boolean }

function NewSpaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        await api.post("/api/spaces", { name, slug });
        announce(`Space ${name} created.`);
        onClose();
        onCreated();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="New space" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} labels={{ name: "Space name", slug: "Space slug" }} />
        <Field label="Space name" error={failure?.fields.name}>
          {(props) => <input {...props} type="text" data-field="name" value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="Space slug" hint="1 to 40 characters: a-z, 0-9, _ or -." error={failure?.fields.slug}>
          {(props) => <input {...props} type="text" data-field="slug" className="mono" autoCapitalize="none" spellCheck={false} value={slug} onChange={(event) => setSlug(event.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Create space</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

function AddMemberDialog({ slug, onClose, onAdded }: { slug: string; onClose: () => void; onAdded: () => void }) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("viewer");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        const added = await api.post<{ username: string; role: string }>(`/api/spaces/${slug}/members`, { username, role });
        announce(`${added.username} added as ${added.role}.`);
        onClose();
        onAdded();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="Add member" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} labels={{ username: "Member username", role: "Role" }} />
        <Field label="Member username" error={failure?.fields.username}>
          {(props) => <input {...props} type="text" data-field="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} />}
        </Field>
        <Field label="Role" error={failure?.fields.role}>
          {(props) => (
            <select {...props} data-field="role" value={role} onChange={(event) => setRole(event.target.value)}>
              {["viewer", "editor", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Add</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

function CopyDialog({ search, onClose, onCopied }: { search: SavedSearch; onClose: () => void; onCopied: (message: string) => void }) {
  const me = useAppState((s) => s.me) as Me;
  const targets = me.spaces.filter((space) => space.slug !== me.space.slug);
  const [target, setTarget] = useState(targets[0]?.slug ?? "");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        const copied = await api.post<{ message: string }>(`/api/saved-searches/${search.id}/copy`, { space: target });
        onCopied(copied.message);
        onClose();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="Copy to space" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} />
        <Field label="Target space">
          {(props) => (
            <select {...props} value={target} onChange={(event) => setTarget(event.target.value)}>
              {targets.map((space) => <option key={space.slug} value={space.slug}>{space.name}</option>)}
            </select>
          )}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Copy</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SpacesPage() {
  const me = useAppState((s) => s.me) as Me;
  const members = useResource(() => api.get<{ members: Array<{ username: string; role: string }> }>(`/api/spaces/${me.space.slug}/members`), [me.space.slug]);
  const saved = useResource(() => api.get<{ saved_searches: SavedSearch[] }>("/api/saved-searches"), [me.space.slug]);
  const [dialog, setDialog] = useState<"space" | "member" | null>(null);
  const [copying, setCopying] = useState<SavedSearch | null>(null);
  const [copied, setCopied] = useState("");
  const refreshMe = async (): Promise<void> => update({ me: await api.get<Me>("/api/me") });
  const admin = me.space.role === "admin";
  const editor = me.space.role !== "viewer";
  const loadError = members.error ?? saved.error;
  return (
    <div className="stack">
      <div className="page-head"><h1>Spaces</h1><Button onClick={() => setDialog("space")}>New space</Button></div>
      {loadError ? <LoadFailed failure={loadError} onRetry={() => { members.reload(); saved.reload(); }} /> : null}
      <div className="table-wrap">
        <table className="data" aria-label="Spaces">
          <thead><tr><th scope="col">Space</th><th scope="col">Slug</th><th scope="col">Your role</th></tr></thead>
          <tbody>{me.spaces.map((space) => <tr key={space.slug}><td>{space.name}</td><td className="mono">{space.slug}</td><td>{space.role}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="page-head"><h2>Members of {me.space.name}</h2>{admin ? <Button onClick={() => setDialog("member")}>Add member</Button> : null}</div>
      <div className="table-wrap">
        <table className="data" aria-label="Members">
          <thead><tr><th scope="col">Username</th><th scope="col">Role</th></tr></thead>
          <tbody>{members.data?.members.map((member) => <tr key={member.username}><td className="mono">{member.username}</td><td>{member.role}</td></tr>)}</tbody>
        </table>
      </div>
      <h2>Saved searches</h2>
      {copied ? <p role="status" aria-label="Copied" className="notice">{copied}</p> : null}
      {saved.data?.saved_searches.length === 0 ? <p className="muted">No saved searches in this space.</p> : null}
      <ul className="plain-list" aria-label="Saved searches">
        {saved.data?.saved_searches.map((search) => (
          <li key={search.id} className="saved-item">
            <Link to={`/explore?saved=${search.id}`}>{search.name}</Link>
            <span className="mono muted small">{search.stream}</span>
            {search.needs_attention ? <span className="badge badge-warning">Needs attention</span> : null}
            {editor && me.spaces.length > 1 ? <Button onClick={() => setCopying(search)}>Copy to space</Button> : null}
          </li>
        ))}
      </ul>
      {dialog === "space" ? <NewSpaceDialog onClose={() => setDialog(null)} onCreated={() => void refreshMe()} /> : null}
      {dialog === "member" ? <AddMemberDialog slug={me.space.slug} onClose={() => setDialog(null)} onAdded={members.reload} /> : null}
      {copying ? <CopyDialog search={copying} onClose={() => setCopying(null)} onCopied={setCopied} /> : null}
    </div>
  );
}
