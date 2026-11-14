import { useEffect, useRef, useState } from "preact/hooks";
import type { ShareAccess } from "../../shared/access.js";
import { COLOURS, type Colour, type Layout } from "../../shared/layout.js";
import type { Model } from "../../shared/model.js";
import { formatBusinessTime } from "../../shared/time.js";
import { api } from "../api.js";
import { pageConfig } from "../config.js";
import { copy } from "../copy.js";
import { Dialog, FieldErrors } from "../ui.js";
import { columnLabel, linkLabel, linksOf } from "./describe.js";

const capital = (c: string) => c[0]!.toUpperCase() + c.slice(1);

export function SaveVersionDialog({
  projectId,
  onClose,
  onSaved,
  announce,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: (n: number) => void;
  announce: (text: string) => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    setPending(true);
    announce(copy.saving);
    const result = await api<{ number: number }>("POST", `/api/projects/${projectId}/versions`, { name });
    setPending(false);
    if (result.ok) onSaved(result.data.number);
    else {
      announce("");
      setFields(result.error?.fields ?? { name: result.error?.message ?? "" });
    }
  };
  return (
    <Dialog label="Save version" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FieldErrors fields={fields} ids={{ name: "version-name" }} />
        <div class="field">
          <label class="field-control">
            <span class="field-label">Version name</span>
            <input
              id="version-name"
              type="text"
              value={name}
              aria-describedby={fields?.name ? "version-name-error" : undefined}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          {fields?.name && (
            <span class="field-error" id="version-name-error">
              {fields.name}
            </span>
          )}
        </div>
        <div class="button-row">
          <button type="submit" class="button button-primary" disabled={pending}>
            {pending ? copy.saving : "Save"}
          </button>
          <button type="button" class="button button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface VersionJson {
  number: number;
  name: string;
  createdAt: string;
  createdBy: { displayName: string };
}

export interface RestoredProject {
  revision: number;
  text: string;
  layout: Layout;
}

export function VersionsDialog({
  base,
  canEdit,
  onClose,
  onPending,
  onRestored,
}: {
  base: string;
  canEdit: boolean;
  onClose: () => void;
  onPending: (text: string) => void;
  onRestored: (n: number, m: number, project: RestoredProject) => void;
}) {
  const [versions, setVersions] = useState<VersionJson[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [comparison, setComparison] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const load = async () => {
    const result = await api<{ versions: VersionJson[] }>("GET", `${base}/versions`);
    if (!result.ok) return;
    setVersions(result.data.versions);
    const numbers = result.data.versions.map((v) => v.number);
    if (numbers.length) {
      setFrom((f) => f || String(Math.min(...numbers)));
      setTo((t) => t || String(Math.max(...numbers)));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const compare = async () => {
    const result = await api<{ from: number; to: number; added: string[]; removed: string[]; changed: string[] }>(
      "GET",
      `${base}/versions/compare?from=${from}&to=${to}`,
    );
    if (!result.ok) {
      setComparison([result.error?.message ?? ""]);
      return;
    }
    const { added, removed, changed } = result.data;
    if (added.length + removed.length + changed.length === 0) {
      setComparison([`No entity changes between version ${result.data.from} and version ${result.data.to}.`]);
      return;
    }
    setComparison([
      `Version ${result.data.from} to version ${result.data.to}: ${added.length} added, ${removed.length} removed, ${changed.length} changed`,
      ...added.map((e) => `Added entity ${e}`),
      ...removed.map((e) => `Removed entity ${e}`),
      ...changed.map((e) => `Changed entity ${e}`),
    ]);
  };
  const restore = async (n: number) => {
    setRestoring(true);
    onPending(copy.restoring(n));
    const result = await api<{ version: { number: number }; project: RestoredProject }>("POST", `${base}/versions/${n}/restore`);
    setRestoring(false);
    setConfirm(null);
    if (result.ok) {
      onRestored(n, result.data.version.number, result.data.project);
      void load();
    }
  };
  return (
    <Dialog label="Versions" onClose={onClose} className="dialog-wide">
      {versions && versions.length === 0 && <p class="muted">{copy.noVersions}</p>}
      {versions && versions.length > 0 && (
        <ul class="version-list" aria-label="Version history">
          {versions.map((v) => (
            <li key={v.number} class="version-item">
              <span class="version-title">
                Version {v.number}: {v.name}
              </span>
              <span class="muted">{formatBusinessTime(v.createdAt, pageConfig.timeZone)}</span>
              <span class="muted">by {v.createdBy.displayName}</span>
              {canEdit && (
                <button type="button" class="button button-secondary button-small" onClick={() => setConfirm(v.number)}>
                  Restore version {v.number}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {versions && versions.length > 0 && (
        <div class="compare-row">
          <div class="field">
            <label class="field-control">
              <span class="field-label">From version</span>
              <select value={from} onChange={(e) => setFrom(e.currentTarget.value)}>
                {[...versions].reverse().map((v) => (
                  <option value={String(v.number)} key={v.number}>
                    Version {v.number}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div class="field">
            <label class="field-control">
              <span class="field-label">To version</span>
              <select value={to} onChange={(e) => setTo(e.currentTarget.value)}>
                {[...versions].reverse().map((v) => (
                  <option value={String(v.number)} key={v.number}>
                    Version {v.number}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" class="button button-primary" onClick={() => void compare()}>
            Compare versions
          </button>
        </div>
      )}
      <div role="region" aria-label="Comparison" class="comparison">
        {comparison.map((line, i) => (
          <p key={i} class={i === 0 ? "comparison-head" : ""}>
            {line}
          </p>
        ))}
      </div>
      <div class="button-row">
        <button type="button" class="button button-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {confirm !== null && (
        <Dialog label={`Restore version ${confirm}?`} role="alertdialog" onClose={() => setConfirm(null)}>
          <p>The text, positions and colours of version {confirm} come back as a new version. Every version stays.</p>
          <div class="button-row">
            <button type="button" class="button button-primary" disabled={restoring} onClick={() => void restore(confirm)}>
              {restoring ? copy.restoring(confirm) : "Restore"}
            </button>
            <button type="button" class="button button-secondary" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}

interface ShareJson {
  id: string;
  access: ShareAccess;
  status: string;
  url: string;
  email: string | null;
  invitation: { status: "queued" | "sent" | "failed" } | null;
}

interface MemberJson {
  userId: string;
  displayName: string;
  role: "editor" | "viewer";
}

const INVITATION: Record<string, string> = { queued: "Invitation queued", sent: "Invitation sent", failed: "Invitation failed" };

export function ShareDialog({
  projectId,
  onClose,
  announce,
  alert,
}: {
  projectId: string;
  onClose: () => void;
  announce: (text: string) => void;
  alert: (text: string) => void;
}) {
  const [access, setAccess] = useState<ShareAccess>("view");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareJson[]>([]);
  const [members, setMembers] = useState<MemberJson[]>([]);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const base = `/api/projects/${projectId}`;
  const load = async () => {
    const [s, m] = await Promise.all([
      api<{ shares: ShareJson[] }>("GET", `${base}/shares`),
      api<{ members: MemberJson[] }>("GET", `${base}/members`),
    ]);
    if (s.ok) setShares(s.data.shares.filter((x) => x.status === "active"));
    if (m.ok) setMembers(m.data.members);
  };
  useEffect(() => {
    void load();
  }, []);

  const reportInvitation = (share: ShareJson, prefix: string) => {
    if (!share.email || !share.invitation) {
      announce(prefix);
      return;
    }
    if (share.invitation.status === "sent") announce(`${prefix}${prefix ? " " : ""}${copy.invitationSent(share.email)}`);
    else {
      if (prefix) announce(prefix);
      alert(copy.invitationFailed(share.email));
    }
  };

  const create = async (event: Event) => {
    event.preventDefault();
    setFields(null);
    const invite = email.trim();
    setPending("create");
    announce(invite ? copy.sendingInvitation : copy.creatingLink);
    const result = await api<ShareJson>("POST", `${base}/shares`, invite ? { access, email: invite } : { access });
    setPending(null);
    if (!result.ok) {
      announce("");
      setFields(result.error?.fields ?? null);
      return;
    }
    setEmail("");
    reportInvitation(result.data, copy.linkCreated(access));
    void load();
  };

  const act = async (share: ShareJson, action: "rotate" | "revoke" | "invitation") => {
    if (action === "invitation") {
      setPending(share.id);
      announce(copy.sendingInvitation);
    }
    const result = await api<ShareJson>("POST", `${base}/shares/${share.id}/${action}`);
    setPending(null);
    if (action === "rotate" && result.ok) announce(copy.rotated);
    if (action === "revoke" && result.ok) announce(copy.turnedOff);
    if (action === "invitation") {
      if (result.ok) announce(copy.invitationSent(share.email!));
      else {
        announce("");
        alert(copy.invitationFailed(share.email!));
      }
    }
    void load();
  };

  const changeRole = async (member: MemberJson, role: "editor" | "viewer") => {
    const result = await api("PATCH", `${base}/members/${member.userId}`, { role });
    if (result.ok) announce(role === "viewer" ? copy.canOnlyView(member.displayName) : copy.canEdit(member.displayName));
    void load();
  };

  const remove = async (member: MemberJson) => {
    const result = await api("DELETE", `${base}/members/${member.userId}`);
    if (result.ok) announce(copy.noLongerHasAccess(member.displayName));
    void load();
  };

  return (
    <Dialog label="Share project" onClose={onClose} className="dialog-wide">
      <form onSubmit={create} noValidate>
        <FieldErrors fields={fields} ids={{ access: "share-access-view", email: "share-email" }} />
        <div role="radiogroup" aria-label="Access" class="radio-row">
          {(["view", "edit"] as const).map((a) => (
            <label class="radio" key={a}>
              <input type="radio" name="share-access" id={`share-access-${a}`} checked={access === a} onChange={() => setAccess(a)} />
              <span>{a === "view" ? "Can view" : "Can edit"}</span>
            </label>
          ))}
        </div>
        <div class="field">
          <label class="field-control">
            <span class="field-label">Invite by email (optional)</span>
            <input
              id="share-email"
              type="email"
              value={email}
              aria-describedby={fields?.email ? "share-email-error" : undefined}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
          {fields?.email && (
            <span class="field-error" id="share-email-error">
              {fields.email}
            </span>
          )}
        </div>
        <button type="submit" class="button button-primary" disabled={pending === "create"}>
          {pending === "create" ? (email.trim() ? copy.sendingInvitation : copy.creatingLink) : "Create link"}
        </button>
      </form>
      <h3 class="dialog-subhead">Links</h3>
      {shares.length === 0 ? (
        <p class="muted">No links yet.</p>
      ) : (
        <ul aria-label="Links" class="share-list">
          {shares.map((share) => (
            <li key={share.id} class="share-item">
              <span class="share-title">{share.access === "view" ? "View link" : "Edit link"}</span>
              {share.email && <span class="muted">{share.email}</span>}
              {share.invitation && <span class="muted">{INVITATION[share.invitation.status]}</span>}
              <div class="button-row">
                <button
                  type="button"
                  class="button button-secondary button-small"
                  onClick={() => void navigator.clipboard?.writeText(`${location.origin}${share.url}`)}
                >
                  Copy {share.access} link
                </button>
                <button type="button" class="button button-secondary button-small" onClick={() => void act(share, "rotate")}>
                  Rotate {share.access} link
                </button>
                <button type="button" class="button button-secondary button-small" onClick={() => void act(share, "revoke")}>
                  Turn off {share.access} link
                </button>
                {share.invitation?.status === "failed" && (
                  <button
                    type="button"
                    class="button button-secondary button-small"
                    disabled={pending === share.id}
                    onClick={() => void act(share, "invitation")}
                  >
                    {pending === share.id ? copy.sendingInvitation : "Send again"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 class="dialog-subhead">People with access</h3>
      <ul aria-label="People with access" class="share-list">
        {members.map((member) => (
          <li key={member.userId} class="share-item" aria-label={`${member.displayName}, ${member.role}`}>
            <span class="share-title">{member.displayName}</span>
            <div class="field field-inline">
              <label class="field-control">
                <span class="visually-hidden">Access for {member.displayName}</span>
                <select value={member.role} onChange={(e) => void changeRole(member, e.currentTarget.value as "editor" | "viewer")}>
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
              </label>
            </div>
            <button type="button" class="button button-secondary button-small" onClick={() => void remove(member)}>
              Remove {member.displayName}
            </button>
          </li>
        ))}
      </ul>
      <div class="button-row">
        <button type="button" class="button button-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export interface ImportReply {
  id: string;
  revision: number;
  changed: boolean;
  report: { line: number; kind: string; name: string; status: string }[];
  notes: string[];
  counts: { added: number; merged: number; skipped: number; ambiguous: number };
}

export function ImportDialog({
  projectId,
  entityNames,
  prepare,
  onClose,
  onImported,
  announce,
  alert,
}: {
  projectId: string;
  entityNames: string[];
  prepare: () => Promise<number>;
  onClose: () => void;
  onImported: (reply: ImportReply) => void;
  announce: (text: string) => void;
  alert: (text: string) => void;
}) {
  const [dialect, setDialect] = useState<"postgresql" | "mysql">("postgresql");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [ddl, setDdl] = useState("");
  const file = useRef<File | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [reply, setReply] = useState<ImportReply | null>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    setPending(true);
    setErrors([]);
    announce(copy.importing);
    const baseRevision = await prepare();
    const body: BodyInit = file.current ?? ddl;
    const result = await api<ImportReply>(
      "POST",
      `/api/projects/${projectId}/imports?dialect=${dialect}&mode=${mode}&baseRevision=${baseRevision}`,
      undefined,
      { data: body, type: "application/sql" },
    );
    setPending(false);
    if (result.ok) {
      setReply(result.data);
      const c = result.data.counts;
      announce(result.data.changed ? copy.imported(c.added, c.merged, c.skipped, c.ambiguous) : copy.importUnchanged);
      onImported(result.data);
      return;
    }
    announce("");
    if (result.error?.error === "import_failed") {
      setErrors(result.error.lines ?? []);
      alert(copy.importRejected);
    } else if (result.status === 503) alert(copy.importStorageDown);
    else alert(result.error?.message ?? copy.importRejected);
  };
  const resultLine = (r: ImportReply["report"][number]) => {
    if (r.kind === "statement") return `Line ${r.line}: ${r.name} skipped`;
    if (r.status === "ambiguous") {
      const existing = entityNames.find((n) => n.toLowerCase() === r.name.toLowerCase() && n !== r.name) ?? r.name;
      return `Line ${r.line}: table ${r.name} ambiguous, it matches ${existing} only by letter case, not imported`;
    }
    return `Line ${r.line}: ${r.kind} ${r.name} ${r.status}`;
  };
  return (
    <Dialog label="Import DDL" onClose={onClose} className="dialog-wide">
      <form onSubmit={submit} noValidate>
        <div role="radiogroup" aria-label="DDL dialect" class="radio-row">
          {(["postgresql", "mysql"] as const).map((d) => (
            <label class="radio" key={d}>
              <input type="radio" name="import-dialect" checked={dialect === d} onChange={() => setDialect(d)} />
              <span>{d === "postgresql" ? "PostgreSQL" : "MySQL"}</span>
            </label>
          ))}
        </div>
        <div role="radiogroup" aria-label="Import mode" class="radio-row">
          {(["merge", "replace"] as const).map((m) => (
            <label class="radio" key={m}>
              <input type="radio" name="import-mode" checked={mode === m} onChange={() => setMode(m)} />
              <span>{m === "merge" ? "Merge by table name" : "Replace all text"}</span>
            </label>
          ))}
        </div>
        <div class="field">
          <label class="field-control">
            <span class="field-label">DDL to import</span>
            <textarea
              class="code-small"
              rows={8}
              value={ddl}
              spellcheck={false}
              onInput={(e) => {
                setDdl(e.currentTarget.value);
                file.current = null;
              }}
            />
          </label>
        </div>
        <div class="field">
          <label class="field-control">
            <span class="field-label">SQL file</span>
            <input
              type="file"
              accept=".sql,text/plain,application/sql"
              onChange={(e) => {
                const chosen = e.currentTarget.files?.[0] ?? null;
                file.current = chosen;
                if (chosen) void chosen.text().then(setDdl);
              }}
            />
          </label>
        </div>
        <button type="submit" class="button button-primary" disabled={pending}>
          {pending ? copy.importing : "Import"}
        </button>
      </form>
      {errors.length > 0 && (
        <ul aria-label="Import errors" class="import-errors">
          {errors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {reply && (
        <div role="region" aria-label="Import report" class="import-report">
          <ul aria-label="Import results">
            {reply.report.map((r, i) => (
              <li key={i}>{resultLine(r)}</li>
            ))}
          </ul>
          {reply.notes.length > 0 && (
            <ul aria-label="Import notes">
              {reply.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <a class="text-link" href={`/api/projects/${projectId}/imports/${reply.id}/original`} download>
            Download original DDL
          </a>
        </div>
      )}
      <div class="button-row">
        <button type="button" class="button button-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function GroupDialog({
  onClose,
  onCreate,
  error,
}: {
  onClose: () => void;
  onCreate: (name: string, colour: Colour) => void;
  error: Record<string, string> | null;
}) {
  const [name, setName] = useState("");
  const [colour, setColour] = useState<Colour>("blue");
  return (
    <Dialog label="Group entities" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name, colour);
        }}
        noValidate
      >
        <FieldErrors fields={error} ids={{ name: "group-name", color: "group-colour-blue", entities: "group-name" }} />
        <div class="field">
          <label class="field-control">
            <span class="field-label">Group name</span>
            <input id="group-name" type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
        </div>
        <div role="radiogroup" aria-label="Group colour" class="radio-row swatches">
          {COLOURS.map((c) => (
            <label class={`radio swatch colour-${c}`} key={c}>
              <input type="radio" name="group-colour" id={`group-colour-${c}`} checked={colour === c} onChange={() => setColour(c)} />
              <span>{capital(c)}</span>
            </label>
          ))}
        </div>
        <div class="button-row">
          <button type="submit" class="button button-primary">
            Create group
          </button>
          <button type="button" class="button button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function RenameEntityDialog({
  entity,
  onClose,
  onRename,
  error,
}: {
  entity: string;
  onClose: () => void;
  onRename: (to: string) => void;
  error: Record<string, string> | null;
}) {
  const [name, setName] = useState(entity);
  return (
    <Dialog label="Rename entity" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRename(name);
        }}
        noValidate
      >
        <FieldErrors fields={error} ids={{ to: "entity-new-name", from: "entity-new-name" }} />
        <div class="field">
          <label class="field-control">
            <span class="field-label">New name</span>
            <input id="entity-new-name" type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
        </div>
        <div class="button-row">
          <button type="submit" class="button button-primary">
            Rename
          </button>
          <button type="button" class="button button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function EntityDetailDialog({
  model,
  entity,
  canEdit,
  onClose,
  onRename,
}: {
  model: Model;
  entity: string;
  canEdit: boolean;
  onClose: () => void;
  onRename: () => void;
}) {
  const found = model.entities.find((e) => e.name === entity);
  if (!found) return null;
  return (
    <Dialog label={`Entity ${entity}`} onClose={onClose} className="sheet-bottom">
      <h3 class="dialog-subhead">Columns</h3>
      <ul aria-label={`Columns of ${entity}`} class="detail-list">
        {found.columns.map((c) => (
          <li key={c.name}>{columnLabel(model, found, c)}</li>
        ))}
      </ul>
      <h3 class="dialog-subhead">Links</h3>
      <ul aria-label={`Links of ${entity}`} class="detail-list">
        {linksOf(model, entity).map((l, i) => (
          <li key={i}>{linkLabel(l)}</li>
        ))}
      </ul>
      <div class="button-row">
        {canEdit && (
          <button type="button" class="button button-primary" onClick={onRename}>
            Rename entity
          </button>
        )}
        <button type="button" class="button button-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export const SHORTCUTS: [string, string][] = [
  ["Tab (in the text)", "Insert two spaces"],
  ["Shift+Tab (in the text)", "Remove up to two leading spaces from each selected line"],
  ["Escape, then Tab", "Leave the text for the diagram"],
  ["Ctrl+S or Cmd+S", "Save a version"],
  ["Tab / Shift+Tab (diagram)", "Next or previous entity"],
  ["Arrow keys", "Move the focused entity one grid step; Shift moves five"],
  ["Space", "Select or deselect the focused entity"],
  ["Enter", "Go into the entity's columns"],
  ["Up / Down", "Previous or next column"],
  ["Escape", "Leave the columns; again to clear the selection"],
  ["L", "Start a link from the focused column"],
  ["I", "Open the entity's details"],
  ["R", "Rename the focused entity"],
  ["G", "Group the selected entities"],
  ["+ / − / 0", "Zoom in, zoom out, reset to 100 percent"],
];

export function ShortcutTable() {
  return (
    <table class="shortcut-table">
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">What it does</th>
        </tr>
      </thead>
      <tbody>
        {SHORTCUTS.map(([key, effect]) => (
          <tr key={key}>
            <td>
              <kbd>{key}</kbd>
            </td>
            <td>{effect}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KeyboardDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose} className="dialog-wide">
      <ShortcutTable />
      <div class="button-row">
        <button type="button" class="button button-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function ReplaceTextDialog({ onClose, onReplace }: { onClose: () => void; onReplace: () => void }) {
  return (
    <Dialog label="Replace the text?" role="alertdialog" onClose={onClose}>
      <p>The template replaces everything in the text pane. Saved versions stay as they are.</p>
      <div class="button-row">
        <button type="button" class="button button-primary" onClick={onReplace}>
          Replace text
        </button>
        <button type="button" class="button button-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
