import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { announceActivity, onActivity, openActivityStream, ownRoleChanged, rememberFocus, session, syncedSeq } from "./app-state.ts";
import { firstMessage, focusFirstInvalid, TextField } from "./forms.tsx";
import { afterRender, api, ApiFailure, businessTime, enc, isAdmin, useStore, viewerTime, type Role, type User } from "./lib.ts";
import { Shell } from "./shell.tsx";
import { focusEl, Overlay } from "./ui.tsx";

interface AuditRow {
  id: string;
  seq: number;
  at: string;
  actor: { id: string; name: string };
  actor_role: string;
  action: string;
  target: { type: string; id: string };
  before: unknown;
  after: unknown;
}

interface AuditPage {
  rows: AuditRow[];
  total: number;
  next_before_seq: number | null;
}

interface BackState {
  oldest: number;
  followed: number;
}

const PAGE = 50;
const ROLES: Role[] = ["Admin", "Steward", "Analyst", "Viewer"];

const json = (value: unknown) => (value === null || value === undefined ? "" : JSON.stringify(value));

function failureOf(error: unknown): ApiFailure {
  return error instanceof ApiFailure ? error : new ApiFailure(0, "unknown", "Something went wrong. Try again.");
}

export function Admin() {
  const me = useStore(session)!;
  const admin = isAdmin(me.role);
  return (
    <Shell screen="admin">
      {admin ? <AdminConsole me={me} /> : <AdminOnly />}
    </Shell>
  );
}

function AdminOnly() {
  useLayoutEffect(() => {
    openActivityStream(null);
    return onActivity((event) => {
      if (event.action === "user.role_change" && event.target.id === session.get()!.id) void ownRoleChanged();
      syncedSeq.set(event.seq);
    });
  }, []);
  return (
    <section class="admin">
      <h1 id="admin-only-heading" class="screen-title" tabIndex={-1}>Admin only</h1>
      <p class="admin-refusal">You don't have permission to do that.</p>
    </section>
  );
}

interface UserDialog {
  kind: "add" | "reset";
  target: User | null;
  name: string;
  email: string;
  role: Role;
  password: string;
  errors: Record<string, string>;
  status: string;
  pending: boolean;
}

function AdminConsole({ me }: { me: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [held, setHeld] = useState<AuditRow[]>([]);
  const [heldNote, setHeldNote] = useState("");
  const [shownStatus, setShownStatus] = useState("");
  const [chain, setChain] = useState("");
  const [wall, setWall] = useState("");
  const [pitStatus, setPitStatus] = useState("");
  const [dialog, setDialog] = useState<UserDialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const rowsRef = useRef<AuditRow[]>([]);
  const heldRef = useRef<AuditRow[]>([]);
  const totalRef = useRef(0);
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  const restoreFocus = useRef<(() => void) | null>(null);
  const opener = useRef<string | null>(null);

  const showRows = (next: AuditRow[], nextTotal: number) => {
    rowsRef.current = next;
    totalRef.current = nextTotal;
    setRows(next);
    setTotal(nextTotal);
    setShownStatus(`Showing ${next.length} of ${nextTotal}.`);
  };

  useLayoutEffect(() => {
    restoreFocus.current?.();
    restoreFocus.current = null;
    if (anchor.current) {
      const delta = anchor.current.el.getBoundingClientRect().top - anchor.current.top;
      anchor.current = null;
      if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" });
    }
  });

  const loadUsers = async () => {
    const body = await api<{ users: User[] }>("GET", "/api/users");
    restoreFocus.current = rememberFocus();
    setUsers(body.users);
  };

  /** First load, or the re-read when Back returns from a point-in-time view (DP-87). */
  const loadAudit = async () => {
    const back = (history.state as { admin?: BackState } | null)?.admin;
    let page = await api<AuditPage>("GET", `/api/audit?limit=${PAGE}`);
    let all = page.rows;
    while (back && page.next_before_seq !== null && all[all.length - 1].seq > back.oldest) {
      page = await api<AuditPage>("GET", `/api/audit?limit=500&before_seq=${page.next_before_seq}`);
      all = [...all, ...page.rows.filter((r) => r.seq >= back.oldest)];
    }
    showRows(all, page.total);
    setNextBefore(all.length && all[all.length - 1].seq > 1 ? all[all.length - 1].seq : null);
    return back ?? null;
  };

  /** Rows committed since the newest shown: shown at the top, or held while the reader is scrolled away (DP-05). */
  const receiveRows = async () => {
    const newest = Math.max(rowsRef.current[0]?.seq ?? 0, heldRef.current[0]?.seq ?? 0);
    const page = await api<AuditPage>("GET", `/api/audit?limit=500`);
    const fresh = page.rows.filter((r) => r.seq > newest);
    if (!fresh.length) return;
    const first = document.querySelector(".audit-table [role=row].audit-row");
    const holding = heldRef.current.length > 0 || (first !== null && first.getBoundingClientRect().top < 0);
    const visible = [...document.querySelectorAll(".audit-table [role=row].audit-row")].find((r) => r.getBoundingClientRect().top >= 0);
    if (visible) anchor.current = { el: visible, top: visible.getBoundingClientRect().top };
    if (holding) {
      const nextHeld = [...fresh, ...heldRef.current];
      if (!heldRef.current.length) setHeldNote(`${nextHeld.length} new audit rows.`);
      heldRef.current = nextHeld;
      setHeld(nextHeld);
    } else {
      showRows([...fresh, ...rowsRef.current], totalRef.current + fresh.length);
    }
  };

  const showHeld = async () => {
    const inserted = heldRef.current;
    heldRef.current = [];
    setHeld([]);
    showRows([...inserted, ...rowsRef.current], totalRef.current + inserted.length);
    await afterRender();
    const link = document.querySelector<HTMLElement>(".audit-table [role=row].audit-row a");
    if (link) {
      link.closest("[role=row]")?.scrollIntoView({ block: "nearest", behavior: "instant" });
      focusEl(link);
    }
  };

  useLayoutEffect(() => {
    void (async () => {
      // The tables first paint with their final fonts, so a late font swap never moves them.
      const [, back] = await Promise.all([loadUsers().catch(() => undefined), loadAudit().catch(() => null),
        document.fonts.ready]);
      setReady(true);
      if (!back) return;
      await afterRender();
      const link = document.querySelector<HTMLElement>(`[data-focus-key="seq-${back.followed}"]`);
      if (link) {
        link.closest("[role=row]")?.scrollIntoView({ block: "center", behavior: "instant" });
        focusEl(link);
      }
    })();
    openActivityStream(null);
    let chain = Promise.resolve();
    return onActivity((event) => {
      chain = chain.then(async () => {
        if (event.action === "user.role_change" && event.target.id === session.get()!.id) {
          const user = await ownRoleChanged();
          if (!isAdmin(user.role)) {
            await afterRender();
            if (document.activeElement === document.body) focusEl(document.getElementById("admin-only-heading"));
            syncedSeq.set(event.seq);
            return;
          }
        }
        if (event.action === "user.create" || event.action === "user.role_change") await loadUsers();
        await receiveRows();
        await afterRender();
        syncedSeq.set(event.seq);
      }).catch(() => undefined);
    });
  }, []);

  const loadOlder = async () => {
    if (nextBefore === null) return;
    setShownStatus("Loading...");
    try {
      const page = await api<AuditPage>("GET", `/api/audit?limit=${PAGE}&before_seq=${nextBefore}`);
      showRows([...rowsRef.current, ...page.rows], page.total);
      setNextBefore(page.next_before_seq);
    } catch (error) {
      setShownStatus(failureOf(error).message);
    }
  };

  const changeRole = async (user: User, role: Role) => {
    announceActivity("Saving...");
    try {
      await api("PATCH", `/api/users/${enc(user.id)}`, { role });
      announceActivity(`Role updated: ${user.name} is now ${role}.`);
    } catch (error) {
      announceActivity(failureOf(error).message);
    }
    await loadUsers();
  };

  const checkChain = async () => {
    setChain("Checking...");
    try {
      const r = await api<{ intact: boolean; checked_through: number; first_broken_seq: number | null }>("GET", "/api/audit/chain");
      setChain(r.intact ? `Audit chain intact through seq ${r.checked_through}.` : `Audit chain broken at seq ${r.first_broken_seq}.`);
    } catch (error) {
      setChain(failureOf(error).message);
    }
  };

  const openAsOf = async (event: Event) => {
    event.preventDefault();
    const instant = businessTime(wall);
    if (!instant) {
      setPitStatus("Use YYYY-MM-DDTHH:mm:ss in America/Chicago time.");
      return;
    }
    setPitStatus("Resolving...");
    try {
      const r = await api<{ as_of_seq: number }>("GET", `/api/search?as_of_time=${encodeURIComponent(instant)}`);
      location.assign(`/catalog?as_of=${r.as_of_seq}`);
    } catch (error) {
      setPitStatus(failureOf(error).message);
    }
  };

  const followSeq = (seq: number) => {
    const oldest = rowsRef.current[rowsRef.current.length - 1]?.seq ?? seq;
    history.replaceState({ ...(history.state ?? {}), admin: { oldest, followed: seq } }, "");
  };

  const openUserDialog = (kind: "add" | "reset", target: User | null) => {
    opener.current = kind === "add" ? "add-user" : `reset-${target!.id}`;
    setDialog({ kind, target, name: "", email: "", role: "Viewer", password: "", errors: {}, status: "", pending: false });
    setDialogOpen(true);
  };

  const closeDialog = async () => {
    setDialogOpen(false);
    await afterRender();
    if (!focusEl(document.querySelector(`[data-focus-key="${opener.current}"]`))) focusEl(document.getElementById("admin-heading"));
  };

  const submitDialog = async () => {
    if (!dialog || dialog.pending) return;
    const d = dialog;
    setDialog({ ...d, pending: true, status: "Saving..." });
    try {
      if (d.kind === "add") {
        const r = await api<{ user: User }>("POST", "/api/users", { name: d.name, email: d.email, role: d.role, password: d.password });
        announceActivity(`User created: ${r.user.name}.`);
        setDialog({ ...d, pending: false, status: `User created: ${r.user.name}.`, errors: {} });
      } else {
        const r = await api<{ sessions_ended: number }>("PATCH", `/api/users/${enc(d.target!.id)}`, { password: d.password });
        const copy = `Password reset: ${d.target!.name} was signed out of ${r.sessions_ended} sessions.`;
        announceActivity(copy);
        setDialog({ ...d, pending: false, status: copy, errors: {} });
      }
      await loadUsers();
      await closeDialog();
    } catch (error) {
      const f = failureOf(error);
      const order = d.kind === "add" ? ["name", "email", "role", "password"] : ["password"];
      const errors = f.status === 422 ? f.fields : {};
      setDialog({ ...d, pending: false, errors, status: f.status === 422 ? firstMessage(errors, order) ?? f.message : f.message });
      if (f.status === 422) {
        await focusFirstInvalid(errors, d.kind === "add"
          ? [["name", "user-name"], ["email", "user-email"], ["role", "user-role"], ["password", "user-password"]]
          : [["password", "reset-password"]]);
      }
    }
  };

  if (!ready) {
    return (
      <section class="admin">
        <h1 id="admin-heading" class="screen-title" tabIndex={-1}>Admin</h1>
      </section>
    );
  }

  return (
    <section class="admin">
      <h1 id="admin-heading" class="screen-title" tabIndex={-1}>Admin</h1>

      <section class="admin-block" aria-labelledby="users-heading">
        <h2 id="users-heading" class="section-title">Users</h2>
        <div role="table" aria-label="Users" class="table users-table">
          <div role="rowgroup" class="thead">
            <div role="row" class="tr">
              <span role="columnheader">Name</span>
              <span role="columnheader">Email</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">Password</span>
            </div>
          </div>
          <div role="rowgroup">
            {users.map((u) => (
              <div role="row" class="tr" key={u.id}>
                <span role="cell" data-label="Name">{u.name}</span>
                <span role="cell" data-label="Email" class="mono wrap">{u.email}</span>
                <span role="cell" data-label="Role">
                  {u.id === me.id ? (
                    <span class="role-self">{u.role}</span>
                  ) : (
                    <select aria-label={`Role for ${u.name}`} data-focus-key={`role-${u.id}`} value={u.role}
                      onChange={(e) => void changeRole(u, e.currentTarget.value as Role)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </span>
                <span role="cell" data-label="Password">
                  {u.id !== me.id && (
                    <button type="button" class="btn btn-quiet" aria-label={`Reset password for ${u.name}`} data-focus-key={`reset-${u.id}`}
                      onClick={() => openUserDialog("reset", u)}>
                      Reset password
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
        <button type="button" class="btn btn-ink" data-focus-key="add-user" onClick={() => openUserDialog("add", null)}>Add user</button>
      </section>

      <section class="admin-block admin-tools">
        <form role="group" aria-label="Catalog as of" class="asof" onSubmit={openAsOf} noValidate>
          <h2 class="section-title">Catalog as of</h2>
          <label class="field">
            <span class="field-label">Business time</span>
            <input type="text" class="mono" placeholder="2026-09-30T23:59:59" value={wall} onInput={(e) => setWall(e.currentTarget.value)} />
          </label>
          <p class="hint">America/Chicago wall time.</p>
          <button type="submit" class="btn btn-ink">Open catalog as of</button>
          <div role="status" aria-label="Point in time status" class="inline-status">{pitStatus}</div>
        </form>
        <div class="chain">
          <h2 class="section-title">Audit chain</h2>
          <button type="button" class="btn btn-quiet" onClick={checkChain}>Check audit chain</button>
          <div role="status" aria-label="Chain check" class="inline-status">{chain}</div>
        </div>
      </section>

      <section class="admin-block" aria-labelledby="audit-heading">
        <h2 id="audit-heading" class="section-title">Audit log</h2>
        <div role="status" aria-label="Audit log updates" class="inline-status">{heldNote}</div>
        {held.length > 0 && (
          <button type="button" class="btn btn-ink held" onClick={() => void showHeld()}>{`Show ${held.length} new audit rows`}</button>
        )}
        <div role="table" aria-label="Audit log" class="table audit-table">
          <div role="rowgroup" class="thead">
            <div role="row" class="tr">
              {["Seq", "When", "Actor", "Role", "Action", "Target", "Before", "After"].map((h) => <span role="columnheader" key={h}>{h}</span>)}
            </div>
          </div>
          <div role="rowgroup">
            {rows.map((r) => (
              <div role="row" class="tr audit-row" key={r.seq}>
                <span role="cell" data-label="Seq" class="mono">
                  <a href={`/catalog?as_of=${r.seq}`} data-focus-key={`seq-${r.seq}`} onClick={() => followSeq(r.seq)}>{String(r.seq)}</a>
                </span>
                <span role="cell" data-label="When" class="mono">
                  <span data-at={r.at}>{viewerTime(r.at)}</span>
                </span>
                <span role="cell" data-label="Actor">{r.actor.name}</span>
                <span role="cell" data-label="Role">{r.actor_role}</span>
                <span role="cell" data-label="Action" class="mono">{r.action}</span>
                <span role="cell" data-label="Target" class="mono wrap">{`${r.target.type} ${r.target.id}`}</span>
                <span role="cell" data-label="Before" class="mono wrap json">{json(r.before)}</span>
                <span role="cell" data-label="After" class="mono wrap json">{json(r.after)}</span>
              </div>
            ))}
          </div>
        </div>
        <div role="status" aria-label="Audit rows shown" class="inline-status">{shownStatus}</div>
        {nextBefore !== null && (
          <button type="button" class="btn btn-quiet" onClick={() => void loadOlder()}>Load older audit rows</button>
        )}
      </section>

      {dialog && (
        <Overlay
          open={dialogOpen}
          kind="dialog"
          label={dialog.kind === "add" ? "Add user" : "Reset password"}
          onEscape={() => void closeDialog()}
          initialFocus={() => document.getElementById(dialog.kind === "add" ? "user-name" : "reset-password")}
        >
          <h2 class="dialog-title">{dialog.kind === "add" ? "Add user" : `Reset password for ${dialog.target!.name}`}</h2>
          <form class="dialog-form" onSubmit={(e) => (e.preventDefault(), void submitDialog())} noValidate>
            {dialog.kind === "add" ? (
              <>
                <TextField id="user-name" label="Name" value={dialog.name} error={dialog.errors.name} onInput={(v) => setDialog({ ...dialog, name: v })} />
                <TextField id="user-email" label="Email" type="email" value={dialog.email} error={dialog.errors.email} onInput={(v) => setDialog({ ...dialog, email: v })} />
                <div class="field">
                  <label for="user-role" class="field-label">Role</label>
                  <select id="user-role" value={dialog.role} aria-invalid={dialog.errors.role ? "true" : undefined}
                    aria-describedby={dialog.errors.role ? "user-role-error" : undefined}
                    onChange={(e) => setDialog({ ...dialog, role: e.currentTarget.value as Role })}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <p id="user-role-error" class="field-error">{dialog.errors.role ?? ""}</p>
                </div>
                <TextField id="user-password" label="Password" type="password" value={dialog.password} error={dialog.errors.password}
                  onInput={(v) => setDialog({ ...dialog, password: v })} />
              </>
            ) : (
              <TextField id="reset-password" label="New password" type="password" value={dialog.password} error={dialog.errors.password}
                onInput={(v) => setDialog({ ...dialog, password: v })} />
            )}
            <div class="dialog-actions">
              <button type="submit" class="btn btn-ink">{dialog.kind === "add" ? "Create user" : "Reset password"}</button>
              <button type="button" class="btn btn-quiet" onClick={() => void closeDialog()}>Cancel</button>
            </div>
            <div role="status" aria-label="Dialog status" class="dialog-status">{dialog.status}</div>
          </form>
        </Overlay>
      )}
    </section>
  );
}
