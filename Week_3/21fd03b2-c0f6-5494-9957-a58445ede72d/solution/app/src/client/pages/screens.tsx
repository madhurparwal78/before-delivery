import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EMPTY, INVITE_STATE, NOTICE, PAGES } from "../../shared/copy";
import { ApiFailure, get, send } from "../api";
import { notify } from "../notices";
import { Link, navigate } from "../router";
import { DockPanel, Muted, Screen, formatLocal, useMe } from "../ui";

type Role = "owner" | "editor" | "viewer";
const roleLabel = (role: string): string => role.charAt(0).toUpperCase() + role.slice(1);

interface Workspace {
  workspace: { id: string; name: string; role: Role };
  members: Array<{ userId: string; displayName: string; email: string; role: Role }>;
  invites: Array<{ id: string; email: string; role: Role; expiresAt: string }>;
}

function useLoaded<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: ApiFailure | null; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: ApiFailure | null }>({ data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data, error: null }),
      (error: unknown) => live && setState({ data: null, error: error instanceof ApiFailure ? error : new ApiFailure(0, "error", "Could not load.") }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

export function NotFoundPage(): JSX.Element {
  const me = useMe(true);
  return (
    <Screen me={me} workspaceId={null}>
      <DockPanel title="Not found">
        <h2 className="page-heading">{PAGES.notFound}</h2>
        <p className="empty-line">
          <Link href="/">Back to Rampwright</Link>
        </p>
      </DockPanel>
    </Screen>
  );
}

export function WorkspaceScreen({ wid }: { wid: string }): JSX.Element {
  const me = useMe();
  const workspace = useLoaded(() => get<Workspace>(`/api/workspaces/${wid}`), [wid]);
  const projects = useLoaded(() => get<{ projects: Array<{ id: string; name: string; sceneCount: number; assetCount: number }> }>(`/api/workspaces/${wid}/projects`), [wid]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (workspace.error?.status === 404) return <NotFoundPage />;
  const role = workspace.data?.workspace.role;
  const canEdit = role === "owner" || role === "editor";
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      const result = await send<{ project: { id: string; name: string } }>("POST", `/api/workspaces/${wid}/projects`, { name });
      notify(NOTICE.created(result.project.name));
      navigate(`/w/${wid}/p/${result.project.id}`);
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.fields.name ?? e.message) : "Something went wrong.");
    }
  };
  return (
    <Screen me={me} workspaceId={wid}>
      <DockPanel
        title="Projects"
        label="Projects"
        actions={
          <>
            <Link href={`/w/${wid}/settings`} className="chip">
              Settings
            </Link>
            <Link href={`/w/${wid}/activity`} className="chip">
              Activity
            </Link>
            {canEdit ? (
              <button type="button" className="chip" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
                New project
              </button>
            ) : null}
          </>
        }
      >
        {workspace.data ? <p className="subline">{workspace.data.workspace.name}</p> : null}
        {adding ? (
          <form className="inline-form" noValidate onSubmit={(event) => void create(event)}>
            <label htmlFor="project-name">Project name</label>
            <input id="project-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "project-name-error" : undefined} autoFocus />
            <button type="submit" className="chip primary">
              Create project
            </button>
            {error ? (
              <p id="project-name-error" className="field-error">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
        {!projects.data ? (
          <Muted>{NOTICE.loading}</Muted>
        ) : projects.data.projects.length === 0 ? (
          <Muted>{EMPTY.projects}</Muted>
        ) : (
          <ul className="rows">
            {projects.data.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/w/${wid}/p/${p.id}`} className="row-link">
                  <span>{p.name}</span>
                  <span className="muted">
                    {p.sceneCount} scenes · {p.assetCount} assets
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DockPanel>
    </Screen>
  );
}

import { Dialog } from "../ui";

const SCENE_STATES: Record<string, string> = { draft: "Draft", checkpointed: "Checkpointed", published: "Published", unpublished: "Unpublished" };

export function ProjectScreen({ wid, pid }: { wid: string; pid: string }): JSX.Element {
  const me = useMe();
  const project = useLoaded(() => get<{ project: { name: string }; scenes: Array<{ id: string; name: string; status: string }> }>(`/api/projects/${pid}`), [pid]);
  const role = me?.workspaces.find((w) => w.id === wid)?.role;
  const [open, setOpen] = useState(false);
  if (project.error?.status === 404) return <NotFoundPage />;
  return (
    <Screen me={me} workspaceId={wid}>
      <DockPanel
        title="Scenes"
        label="Scenes"
        actions={
          role === "owner" || role === "editor" ? (
            <button type="button" className="chip" onClick={() => setOpen(true)} aria-haspopup="dialog">
              New scene
            </button>
          ) : null
        }
      >
        {project.data ? <p className="subline">{project.data.project.name}</p> : null}
        {!project.data ? (
          <Muted>{NOTICE.loading}</Muted>
        ) : project.data.scenes.length === 0 ? (
          <Muted>{EMPTY.scenes}</Muted>
        ) : (
          <ul className="rows">
            {project.data.scenes.map((s) => (
              <li key={s.id}>
                <Link href={`/w/${wid}/s/${s.id}`} className="row-link">
                  <span>{s.name}</span>
                  <span className={`state-chip state-${s.status}`}>{SCENE_STATES[s.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DockPanel>
      {open ? <NewSceneDialog wid={wid} pid={pid} onClose={() => setOpen(false)} /> : null}
    </Screen>
  );
}

function NewSceneDialog({ wid, pid, onClose }: { wid: string; pid: string; onClose: () => void }): JSX.Element {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("blank");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      const result = await send<{ scene: { id: string; name: string } }>("POST", `/api/projects/${pid}/scenes`, { name, template });
      notify(NOTICE.created(result.scene.name));
      navigate(`/w/${wid}/s/${result.scene.id}`);
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.fields.name ?? e.fields.template ?? e.message) : "Something went wrong.");
    }
  };
  return (
    <Dialog title="New scene" onEscape={onClose} initialFocus="#scene-name">
      <form noValidate onSubmit={(event) => void submit(event)} className="stack">
        <div className="field">
          <label htmlFor="scene-name">Scene name</label>
          <input id="scene-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "scene-name-error" : undefined} />
          {error ? (
            <p id="scene-name-error" className="field-error">
              {error}
            </p>
          ) : null}
        </div>
        <fieldset className="radios">
          <legend>Template</legend>
          {(["blank", "ramp", "pendulum", "launcher"] as const).map((t) => (
            <label key={t} className="radio">
              <input type="radio" name="template" value={t} checked={template === t} onChange={() => setTemplate(t)} />
              {roleLabel(t)}
            </label>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="chip" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="chip primary">
            Create scene
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SettingsScreen({ wid }: { wid: string }): JSX.Element {
  const me = useMe();
  const data = useLoaded(() => get<Workspace>(`/api/workspaces/${wid}`), [wid]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (data.error?.status === 404) return <NotFoundPage />;
  const owner = data.data?.workspace.role === "owner";
  const invite = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setErrors({});
    notify(NOTICE.inviting);
    try {
      const result = await send<{ delivery: string; invite: { email: string } }>("POST", `/api/workspaces/${wid}/invites`, { email, role });
      notify(result.delivery === "sent" ? NOTICE.inviteSent(result.invite.email) : NOTICE.inviteQueued(result.invite.email));
      setEmail("");
      data.reload();
    } catch (e) {
      notify("");
      setErrors(e instanceof ApiFailure ? (Object.keys(e.fields).length > 0 ? e.fields : { email: e.message }) : { email: "Something went wrong." });
    }
  };
  const changeRole = async (userId: string, name: string, next: string): Promise<void> => {
    try {
      await send("PATCH", `/api/workspaces/${wid}/members/${userId}`, { role: next });
      notify(NOTICE.roleChanged(name, roleLabel(next)));
      data.reload();
    } catch (e) {
      notify(e instanceof ApiFailure ? (e.fields.role ?? e.message) : "Something went wrong.");
    }
  };
  const revoke = async (id: string, address: string): Promise<void> => {
    try {
      await send("DELETE", `/api/workspaces/${wid}/invites/${id}`);
      notify(NOTICE.inviteRevoked(address));
    } catch (e) {
      notify(e instanceof ApiFailure ? e.message : "Something went wrong.");
    }
    data.reload();
  };
  return (
    <Screen me={me} workspaceId={wid}>
      <DockPanel title="Members" label="Members" actions={<Link href={`/w/${wid}`} className="chip">Projects</Link>}>
        {!data.data ? (
          <Muted>{NOTICE.loading}</Muted>
        ) : (
          <table className="table" aria-label="Members">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {data.data.members.map((m) => (
                <tr key={m.userId}>
                  <td data-label="Name">{m.displayName}</td>
                  <td data-label="Email">{m.email}</td>
                  <td data-label="Role">
                    {m.role === "owner" ? (
                      "Owner"
                    ) : owner ? (
                      <select aria-label={`Role for ${m.displayName}`} value={m.role} onChange={(e) => void changeRole(m.userId, m.displayName, e.target.value)}>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      roleLabel(m.role)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DockPanel>
      {owner ? (
        <DockPanel title="Invite a co-tutor" label="Invite">
          <form noValidate className="inline-form wrap" onSubmit={(event) => void invite(event)}>
            <div className="field">
              <label htmlFor="invite-email">Invite email</label>
              <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? "invite-email-error" : undefined} />
              {errors.email ? (
                <p id="invite-email-error" className="field-error">
                  {errors.email}
                </p>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="invite-role">Invite role</label>
              <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} aria-invalid={errors.role ? true : undefined}>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              {errors.role ? <p className="field-error">{errors.role}</p> : null}
            </div>
            <button type="submit" className="chip primary">
              Send invite
            </button>
          </form>
          <h2 className="sub-title">Pending invites</h2>
          {data.data && data.data.invites.length === 0 ? <Muted>No pending invites.</Muted> : null}
          <table className="table" aria-label="Pending invites">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Expires</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(data.data?.invites ?? []).map((i) => (
                <tr key={i.id}>
                  <td data-label="Email">{i.email}</td>
                  <td data-label="Role">{roleLabel(i.role)}</td>
                  <td data-label="Expires">{formatLocal(i.expiresAt)}</td>
                  <td data-label="">
                    <button type="button" className="chip" aria-label={`Revoke invite to ${i.email}`} onClick={() => void revoke(i.id, i.email)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DockPanel>
      ) : null}
    </Screen>
  );
}

const PHRASES: Record<string, string> = {
  "workspace.created": "created workspace",
  "member.role_changed": "changed the role of",
  "invite.created": "invited",
  "invite.revoked": "withdrew the invite to",
  "invite.accepted": "accepted the invite for",
  "project.created": "created project",
  "scene.created": "created scene",
  "scene.edited": "edited scene",
  "asset.uploaded": "uploaded",
  "checkpoint.created": "saved checkpoint",
  "checkpoint.restored": "restored checkpoint",
  "scene.published": "published the lab for",
  "scene.unpublished": "unpublished the lab for",
  "lab_link.regenerated": "replaced the lab link for",
  "share_link.created": "created a read-only link to",
  "share_link.regenerated": "replaced a read-only link to",
  "share_link.revoked": "revoked a read-only link to",
};

interface ActivityEvent {
  id: string;
  at: string;
  actor: { userId: string; displayName: string };
  action: string;
  targetName: string;
}

export function ActivityScreen({ wid }: { wid: string }): JSX.Element {
  const me = useMe();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const load = useCallback(
    async (before: string | null): Promise<void> => {
      notify(NOTICE.loading);
      try {
        const page = await get<{ events: ActivityEvent[]; nextBefore: string | null }>(`/api/workspaces/${wid}/activity${before ? `?before=${encodeURIComponent(before)}` : ""}`);
        setEvents((current) => {
          const merged = [...current, ...page.events];
          if (merged.length > 0) notify(NOTICE.showing(merged.length));
          else notify("");
          return merged;
        });
        setNext(page.nextBefore);
        setLoaded(true);
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 404) setMissing(true);
        else notify("Could not load the activity.");
      }
    },
    [wid],
  );
  useEffect(() => {
    void load(null);
  }, [load]);
  if (missing) return <NotFoundPage />;
  return (
    <Screen me={me} workspaceId={wid}>
      <DockPanel title="Activity" label="Activity" actions={<Link href={`/w/${wid}`} className="chip">Projects</Link>}>
        {loaded && events.length === 0 ? <Muted>{EMPTY.activity}</Muted> : null}
        {!loaded ? <Muted>{NOTICE.loading}</Muted> : null}
        <ul className="rows activity" aria-label="Activity">
          {events.map((e) => (
            <li key={e.id}>
              <span>
                {e.actor.displayName} {PHRASES[e.action] ?? e.action} {e.targetName}
              </span>{" "}
              <time dateTime={e.at}>{formatLocal(e.at)}</time>
            </li>
          ))}
        </ul>
        {next ? (
          <button type="button" className="chip show-older" onClick={() => void load(next)}>
            Show older
          </button>
        ) : null}
      </DockPanel>
    </Screen>
  );
}

interface InviteView {
  workspaceName: string;
  email: string;
  role: Role;
  status: "pending" | "accepted" | "revoked" | "expired";
  reason: string | null;
}

export function InviteScreen({ token }: { token: string }): JSX.Element {
  const me = useMe(true);
  const [state, setState] = useState<{ invite: InviteView | null; superseded: boolean; missing: boolean; loading: boolean }>({ invite: null, superseded: false, missing: false, loading: true });
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    get<{ invite: InviteView }>(`/api/invites/${token}`, { quiet: true }).then(
      (r) => setState({ invite: r.invite, superseded: false, missing: false, loading: false }),
      (e: unknown) => setState({ invite: null, superseded: e instanceof ApiFailure && e.code === "invite_superseded", missing: !(e instanceof ApiFailure && e.code === "invite_superseded"), loading: false }),
    );
  }, [token]);
  if (state.missing) return <NotFoundPage />;
  const invite = state.invite;
  const accept = async (): Promise<void> => {
    try {
      const result = await send<{ landing: string }>("POST", `/api/invites/${token}/accept`);
      navigate(result.landing);
    } catch (e) {
      if (e instanceof ApiFailure) {
        if (e.code === "invite_superseded") setRefusal(INVITE_STATE.superseded);
        else if (e.code === "invite_revoked") setRefusal(INVITE_STATE.revoked);
        else if (e.code === "invite_expired") setRefusal(INVITE_STATE.expired);
        else if (e.code === "invite_used") setRefusal(INVITE_STATE.used);
        else if (e.code === "invite_email_mismatch" && invite) setRefusal(INVITE_STATE.mismatch(invite.email));
        else setRefusal(e.message);
      }
    }
  };
  let message: string | null = refusal;
  if (state.superseded) message = INVITE_STATE.superseded;
  else if (invite && invite.status === "expired") message = INVITE_STATE.expired;
  else if (invite && invite.status === "revoked") message = invite.reason === "superseded" ? INVITE_STATE.superseded : INVITE_STATE.revoked;
  else if (invite && invite.status === "accepted") message = INVITE_STATE.used;
  else if (invite && me && me.user.email.toLowerCase() !== invite.email.toLowerCase()) message = INVITE_STATE.mismatch(invite.email);
  const signedIn = Boolean(me);
  return (
    <Screen me={me} workspaceId={null}>
      <DockPanel title="Invite" label="Invite">
        {state.loading ? <Muted>{NOTICE.loading}</Muted> : null}
        {invite ? <h2 className="page-heading">Join {invite.workspaceName}</h2> : null}
        {invite && invite.status === "pending" ? (
          <p className="subline">
            You were invited as {roleLabel(invite.role)} at {invite.email}.
          </p>
        ) : null}
        {message ? <p className="empty-line message">{message}</p> : null}
        {invite?.status === "pending" && !signedIn ? (
          <p className="invite-links">
            <Link href={`/sign-in?invite=${encodeURIComponent(token)}`} className="chip">
              Sign in
            </Link>{" "}
            <Link href={`/sign-up?invite=${encodeURIComponent(token)}`} className="chip primary">
              Create account
            </Link>
          </p>
        ) : null}
        {invite?.status === "pending" && signedIn && !message ? (
          <button type="button" className="chip primary" onClick={() => void accept()}>
            Accept invite
          </button>
        ) : null}
        {invite?.status === "pending" && signedIn && message ? (
          <p className="invite-links">
            <Link href={`/sign-in?invite=${encodeURIComponent(token)}`} className="chip">
              Sign in
            </Link>
          </p>
        ) : null}
      </DockPanel>
    </Screen>
  );
}

