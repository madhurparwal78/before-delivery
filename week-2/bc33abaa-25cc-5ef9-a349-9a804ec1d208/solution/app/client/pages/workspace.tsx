// Workspace screens: dashboard, scene library, members, agent tokens, audit trail and settings.
import { useEffect, useState } from "preact/hooks";
import type { Dashboard as DashboardData, Member, Role, Workspace } from "../../shared/api-types.js";
import { isoSecond, localTime, zonedInstant } from "../../shared/format.js";
import { PLAN_CATALOG } from "../../shared/plans.js";
import { canInviteRole } from "../../shared/permissions.js";
import { ApiError, del, get, patch, post } from "../api.js";
import { Button, Dialog, EmptyDrawing, Field, Link, Status, navigate, useBusy } from "../ui.js";
import { allowed, useSession, type Session } from "./shell.js";

function subscriptionLine(data: DashboardData, timeZone: string): string {
  const sub = data.subscription;
  switch (sub.state) {
    case "trial": return `Trial ends ${sub.trialEndsAt ? localTime(sub.trialEndsAt, timeZone) : ""}`;
    case "active": return `Active: ${PLAN_CATALOG[sub.plan].name} ${sub.period}`;
    case "past_due": return `Past due: grace period ends ${sub.graceEndsAt ? localTime(sub.graceEndsAt, timeZone) : ""}`;
    case "suspended": return "Suspended";
    case "cancelled": return "Cancelled";
  }
}

export function Dashboard() {
  const { session } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { get<DashboardData>("/api/dashboard").then(setData, () => setData(null)); }, [session.subscription.state]);
  return (
    <div class="page">
      <div class="page-head"><h1>Dashboard</h1><Link class="button" href="/app/scenes">Open scenes</Link></div>
      {data ? (
        <div class="tiles">
          <section class="tile" aria-labelledby="tile-seats">
            <h2 id="tile-seats">Seats</h2>
            <p class="figure-value">{data.seatsUsed}<span class="muted"> / {data.seatsPurchased}</span></p>
            <p><span class="num">{data.seatsUsed}</span> of <span class="num">{data.seatsPurchased}</span> seats used</p>
          </section>
          <section class="tile" aria-labelledby="tile-subscription">
            <h2 id="tile-subscription">Subscription</h2>
            <p class="figure-value" style={{ fontSize: "var(--h3)" }}>{data.subscription.state === "past_due" ? "Past due" : data.subscription.state[0].toUpperCase() + data.subscription.state.slice(1)}</p>
            <p>{subscriptionLine(data, session.workspace.timeZone)}</p>
          </section>
          <section class="tile" aria-labelledby="tile-scenes">
            <h2 id="tile-scenes">Scenes</h2>
            <p class="figure-value">{data.scenes}</p>
            <p><span class="num">{data.scenes}</span> scenes, <span class="num">{data.publishedScenes}</span> published</p>
          </section>
          <section class="tile" aria-labelledby="tile-tokens">
            <h2 id="tile-tokens">Agent tokens</h2>
            <p class="figure-value">{data.activeAgentTokens}</p>
            <p><span class="num">{data.activeAgentTokens}</span> active agent tokens</p>
          </section>
        </div>
      ) : <div class="tiles" aria-hidden="true"><div class="tile" /><div class="tile" /><div class="tile" /><div class="tile" /></div>}
    </div>
  );
}

interface SceneSummary { id: string; name: string; latestSeq: number; updatedAt: string; publishedVersion: number | null }

export function Scenes() {
  const { session } = useSession();
  const [scenes, setScenes] = useState<SceneSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ scenes: { id: string; name: string }[]; assets: { id: string; name: string }[] } | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { get<{ scenes: SceneSummary[] }>("/api/scenes").then((r) => setScenes(r.scenes), () => setScenes([])); }, []);
  useEffect(() => {
    if ([...query.trim()].length < 2) { setResults(null); return; }
    const timer = window.setTimeout(() => {
      get<{ scenes: { id: string; name: string }[]; assets: { id: string; name: string }[] }>(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then(setResults, () => setResults(null));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query]);
  return (
    <div class="page">
      <div class="page-head">
        <h1>Scenes</h1>
        {allowed(session, "scene.create") ? <Button variant="primary" onClick={() => setCreating(true)}>New scene</Button> : null}
      </div>
      <div class="search-row">
        <div class="field" style={{ flex: "1 1 260px" }}>
          <label for="scene-search">Search scenes and assets</label>
          <input id="scene-search" type="search" aria-label="Search scenes" value={query} onInput={(e) => setQuery(e.currentTarget.value)} placeholder="Type at least 2 characters" />
        </div>
      </div>
      {results ? (
        <section class="panel" aria-labelledby="results-title">
          <div class="panel-title"><h2 id="results-title">Results for “{query.trim()}”</h2></div>
          <div class="panel-body">
            <ul aria-label="Search results" class="scene-list">
              {results.scenes.map((s) => <li key={s.id}><Link href={`/app/scenes/${s.id}`}><span class="scene-name truncate" title={s.name}>{s.name}</span><span class="muted small">Scene</span></Link></li>)}
              {results.assets.map((a) => <li key={a.id}><span class="panel" style={{ display: "grid", padding: "16px" }}><span class="truncate" title={a.name}>{a.name}</span><span class="muted small">Asset</span></span></li>)}
            </ul>
            {results.scenes.length + results.assets.length === 0 ? <p class="muted">Nothing in this workspace matches.</p> : null}
          </div>
        </section>
      ) : null}
      {scenes === null ? <p class="muted">Loading scenes…</p> : scenes.length === 0 ? (
        <div class="panel empty"><EmptyDrawing /><p>No scenes yet. Create one to start drafting.</p></div>
      ) : (
        <ul aria-label="Scenes" class="scene-list">
          {scenes.map((s) => (
            <li key={s.id}>
              <Link href={`/app/scenes/${s.id}`}>
                <span class="scene-name truncate" title={s.name}>{s.name}</span>
                <span class="muted small"><span class="num">{s.latestSeq}</span> operations{s.publishedVersion !== null ? <> · published <span class="num">v{s.publishedVersion}</span></> : null}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating ? <NewSceneDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function NewSceneDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  return (
    <Dialog title="New scene" onClose={onClose}>
      {(close) => (
        <form onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            try {
              const created = await post<{ id: string }>("/api/scenes", { name });
              close();
              navigate(`/app/scenes/${created.id}`);
            } catch (err) {
              setError(err instanceof ApiError ? (err.fieldErrors.name ?? "The scene could not be created.") : "The scene could not be created.");
            }
          });
        }}>
          <div class="dialog-body">
            <Field label="Scene name" value={name} onInput={(e) => setName(e.currentTarget.value)} error={error} />
          </div>
          <footer>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>Create scene</Button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}

const ROLE_NAMES: Record<Role, string> = { owner: "Owner", admin: "Admin", billing_manager: "Billing manager", editor: "Editor", viewer: "Viewer" };

interface Invite { id: string; email: string; role: Role; expiresAt: string; invitedBy: { name: string } }

export function Members() {
  const { session } = useSession();
  const [data, setData] = useState<{ members: Member[]; invites: Invite[] } | null>(null);
  const [status, setStatus] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<{ member: Member; opener: HTMLElement } | null>(null);
  const load = () => get<{ members: Member[]; invites: Invite[] }>("/api/members").then(setData, () => setData({ members: [], invites: [] }));
  useEffect(() => { void load(); }, []);
  const canManage = allowed(session, "member.manage");
  const canInvite = allowed(session, "member.invite");
  const revoke = async (invite: Invite) => {
    try { await del(`/api/members/invites/${invite.id}`); setStatus(`Invitation for ${invite.email} revoked. Its seat is free.`); await load(); }
    catch { setStatus("The invitation could not be revoked."); }
  };
  return (
    <div class="page">
      <div class="page-head">
        <h1>Members</h1>
        {canInvite ? <Button variant="primary" onClick={() => setInviting(true)}>Invite member</Button> : null}
      </div>
      <Status label="Members status" text={status} />
      <div class="panel table-wrap">
        <table class="ruled cards" aria-label="Members">
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {data?.members.map((m) => (
              <tr key={m.id}>
                <td data-label="Name"><span class="truncate" title={m.name}>{m.name}</span></td>
                <td data-label="Email"><span class="truncate" title={m.email}>{m.email}</span></td>
                <td data-label="Role">{ROLE_NAMES[m.role]}</td>
                <td data-label="Joined" class="num">{localTime(m.joinedAt, session.workspace.timeZone)}</td>
                <td data-label="Actions"><div class="row-actions">
                  {canManage && m.role !== "owner" ? <Button small onClick={(e) => setRemoving({ member: m, opener: e.currentTarget })}>{`Remove ${m.name}`}</Button> : null}
                </div></td>
              </tr>
            ))}
            {data?.invites.map((i) => (
              <tr key={i.id}>
                <td data-label="Name"><span class="badge">Invited</span></td>
                <td data-label="Email"><span class="truncate" title={i.email}>{i.email}</span></td>
                <td data-label="Role">{ROLE_NAMES[i.role]}</td>
                <td data-label="Joined" class="num">Expires {localTime(i.expiresAt, session.workspace.timeZone)}</td>
                <td data-label="Actions"><div class="row-actions">
                  {canInvite ? <Button small onClick={() => { void revoke(i); }}>{`Revoke invitation for ${i.email}`}</Button> : null}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data === null ? <p class="panel-body muted">Loading members…</p> : null}
      </div>
      {inviting ? <InviteDialog session={session} onClose={() => setInviting(false)} onDone={(text) => { setStatus(text); void load(); }} /> : null}
      {removing ? (
        <Dialog title="Remove member" alert initialFocus="[data-cancel]" returnFocus={removing.opener} onClose={() => setRemoving(null)}>
          {(close) => <RemoveMember member={removing.member} close={close} onDone={(text) => { setStatus(text); void load(); }} />}
        </Dialog>
      ) : null}
    </div>
  );
}

function RemoveMember({ member, close, onDone }: { member: Member; close: () => void; onDone: (text: string) => void }) {
  const [busy, run] = useBusy();
  const remove = () => run(async () => {
    try {
      await del(`/api/members/${member.id}`);
      onDone(`${member.name} was removed. Their seat is free.`);
    } catch (error) {
      onDone(error instanceof ApiError && error.code === "owner_cannot_be_removed" ? "The owner cannot be removed." : `${member.name} could not be removed.`);
    }
    close();
  });
  return (
    <>
      <div class="dialog-body"><p>{member.name} loses access at once. Their locks are released and their seat is freed. Their operations, comments and audit entries keep their name.</p></div>
      <footer>
        <Button data-cancel onClick={close}>Cancel</Button>
        <Button variant="danger" busy={busy} onClick={() => { void remove(); }}>Remove</Button>
      </footer>
    </>
  );
}

function InviteDialog({ session, onClose, onDone }: { session: Session; onClose: () => void; onDone: (text: string) => void }) {
  const roles = (["admin", "billing_manager", "editor", "viewer"] as const).filter((r) => canInviteRole({ kind: "member", role: session.member.role }, r));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  return (
    <Dialog title="Invite member" onClose={onClose}>
      {(close) => (
        <form onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            try {
              await post("/api/members/invites", { email, role });
              onDone(`Invitation created for ${email}. The email is on its way.`);
              close();
            } catch (error) {
              if (!(error instanceof ApiError)) return;
              if (error.code === "no_seats_left") { onDone("No seats left. Add seats in Billing or remove a member."); close(); }
              else if (error.code === "already_member") setErrors({ email: `${email} is already a member or invited.` });
              else setErrors(error.fieldErrors);
            }
          });
        }}>
          <div class="dialog-body">
            <Field label="Email" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} error={errors.email} />
            <div class="field">
              <label for="invite-role">Role</label>
              <select id="invite-role" value={role} onChange={(e) => { const value = e.currentTarget.value; setRole(roles.find((r) => r === value) ?? role); }}>
                {roles.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
              </select>
            </div>
          </div>
          <footer>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>Send invite</Button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}

interface Token { id: string; name: string; scope: "read" | "edit"; expiresAt: string; status: "active" | "expired" | "revoked"; issuedBy: { name: string } }

export const WALL_FORMAT_ERROR = "Use YYYY-MM-DD HH:mm:ss.";

export function Agents() {
  const { session } = useSession();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [status, setStatus] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const load = () => get<{ tokens: Token[] }>("/api/agent-tokens").then((r) => setTokens(r.tokens), () => setTokens([]));
  useEffect(() => { void load(); }, []);
  const revoke = async (token: Token) => {
    try { await del(`/api/agent-tokens/${token.id}`); setStatus(`Token ${token.name} revoked.`); await load(); }
    catch { setStatus(`Token ${token.name} could not be revoked.`); }
  };
  return (
    <div class="page">
      <div class="page-head"><h1>Agent tokens</h1><Button variant="primary" onClick={() => setIssuing(true)}>Issue token</Button></div>
      <Status label="Members status" text={status} />
      {secret ? (
        <section class="panel" aria-labelledby="new-token-title">
          <div class="panel-title"><h2 id="new-token-title">New token</h2><Button small onClick={() => setSecret(null)}>Done</Button></div>
          <div class="panel-body">
            <p class="notice">Copy this token now. It will not be shown again.</p>
            <code class="mono" style={{ wordBreak: "break-all", padding: "8px", border: "1px solid var(--putty)", background: "#fffdf8" }}>{secret}</code>
            <div><Button small onClick={() => { void navigator.clipboard.writeText(secret); }}>Copy token</Button></div>
          </div>
        </section>
      ) : null}
      <div class="panel table-wrap">
        <table class="ruled cards" aria-label="Agent tokens">
          <thead><tr><th scope="col">Name</th><th scope="col">Scope</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col">Issued by</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {tokens?.map((t) => (
              <tr key={t.id}>
                <td data-label="Name"><span class="truncate" title={t.name}>{t.name}</span></td>
                <td data-label="Scope">{t.scope === "edit" ? "Edit" : "Read"}</td>
                <td data-label="Expires" class="num">{localTime(t.expiresAt, session.workspace.timeZone)}</td>
                <td data-label="Status"><span class={`badge${t.status === "active" ? "" : " alert"}`}>{t.status[0].toUpperCase() + t.status.slice(1)}</span></td>
                <td data-label="Issued by">{t.issuedBy.name}</td>
                <td data-label="Actions"><div class="row-actions">{t.status === "active" ? <Button small onClick={() => { void revoke(t); }}>{`Revoke ${t.name}`}</Button> : null}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {tokens?.length === 0 ? <div class="empty"><EmptyDrawing /><p>No agent tokens yet.</p></div> : null}
      </div>
      {issuing ? (
        <IssueTokenDialog timeZone={session.workspace.timeZone} onClose={() => setIssuing(false)}
          onIssued={(token) => { setSecret(token.token); setStatus(`Token ${token.name} issued.`); void load(); }} />
      ) : null}
    </div>
  );
}

function IssueTokenDialog({ timeZone, onClose, onIssued }: { timeZone: string; onClose: () => void; onIssued: (t: { name: string; token: string }) => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "edit">("read");
  const [expires, setExpires] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  return (
    <Dialog title="Issue agent token" onClose={onClose}>
      {(close) => (
        <form onSubmit={(e) => {
          e.preventDefault();
          const at = zonedInstant(expires, timeZone);
          if (!at) { setErrors({ expiresAt: WALL_FORMAT_ERROR }); return; }
          void run(async () => {
            try {
              const issued = await post<{ name: string; token: string }>("/api/agent-tokens", { name, scope, expiresAt: isoSecond(at) });
              onIssued(issued);
              close();
            } catch (error) {
              if (error instanceof ApiError && error.code === "token_limit_reached") setErrors({ name: "This plan's agent token limit is reached. Revoke a token first." });
              else if (error instanceof ApiError) setErrors(error.fieldErrors);
            }
          });
        }}>
          <div class="dialog-body">
            <Field label="Token name" value={name} onInput={(e) => setName(e.currentTarget.value)} error={errors.name} />
            <div role="radiogroup" aria-label="Scope" class="choices">
              {(["read", "edit"] as const).map((s) => (
                <label class="choice" key={s}><input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} />{s === "read" ? "Read" : "Edit"}</label>
              ))}
            </div>
            <Field label="Expires" value={expires} placeholder="YYYY-MM-DD HH:mm:ss" onInput={(e) => setExpires(e.currentTarget.value)} error={errors.expiresAt} />
            <p class="muted small">Time zone: {timeZone}</p>
          </div>
          <footer>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>Issue token</Button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}

interface AuditEntry { id: string; at: string; actor: { kind: string; name: string }; action: string; target: { type: string; id: string } }

export function Audit() {
  const { session } = useSession();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => { get<{ entries: AuditEntry[] }>("/api/audit?limit=200").then((r) => setEntries(r.entries), () => setEntries([])); }, []);
  return (
    <div class="page">
      <div class="page-head"><h1>Audit trail</h1><p class="muted">Newest first</p></div>
      <div class="panel table-wrap">
        <table class="ruled cards" aria-label="Audit trail">
          <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target</th></tr></thead>
          <tbody>
            {entries?.map((e) => (
              <tr key={e.id}>
                <td data-label="Time" class="num">{localTime(e.at, session.workspace.timeZone)}</td>
                <td data-label="Actor">{e.actor.name}{e.actor.kind === "agent" ? " (agent)" : ""}</td>
                <td data-label="Action" class="mono">{e.action}</td>
                <td data-label="Target"><span class="truncate mono small" title={e.target.id}>{e.target.type} · {e.target.id}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries === null ? <p class="panel-body muted">Loading the trail…</p> : null}
      </div>
    </div>
  );
}

const ZONES = Intl.supportedValuesOf("timeZone");

export function Settings() {
  const { refresh } = useSession();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [zone, setZone] = useState("");
  const [links, setLinks] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, run] = useBusy();
  useEffect(() => {
    get<Workspace>("/api/workspace").then((w) => { setWorkspace(w); setZone(w.timeZone); setLinks(w.reviewLinksEnabled); }, () => undefined);
  }, []);
  if (!workspace) return <div class="page"><h1>Settings</h1><p class="muted">Loading settings…</p></div>;
  const save = () => run(async () => {
    try {
      await patch("/api/workspace", { timeZone: zone, reviewLinksEnabled: links });
      setStatus("Settings saved.");
      await refresh();
    } catch {
      setStatus("Settings could not be saved.");
    }
  });
  return (
    <div class="page">
      <div class="page-head"><h1>Settings</h1></div>
      <section class="panel" aria-labelledby="settings-title" style={{ maxWidth: "640px" }}>
        <div class="panel-title"><h2 id="settings-title">{workspace.name}</h2></div>
        <div class="panel-body">
          <div class="field">
            <label for="ws-zone">Workspace time zone</label>
            <select id="ws-zone" value={zone} onChange={(e) => setZone(e.currentTarget.value)}>
              {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <button type="button" role="switch" class="switch" aria-checked={links ? "true" : "false"} onClick={() => setLinks(!links)}>
            <span class="track" aria-hidden="true" />Allow review links
          </button>
          <p class="muted small">Turning review links off stops every existing link at once. Turning them back on restores links that have not expired.</p>
          <div><Button variant="primary" busy={busy} onClick={() => { void save(); }}>Save settings</Button></div>
          <Status label="Settings status" text={status} />
        </div>
      </section>
    </div>
  );
}
