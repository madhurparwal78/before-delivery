import { useState, type FormEvent, type ReactNode } from "react";
import { EMAIL, fieldError, notice } from "../../shared/notices.js";
import type { Member, Role } from "../../shared/types.js";
import { api } from "../api.js";
import { FieldMessage } from "../ui/FieldMessage.js";
import { announce } from "../ui/announcer.js";
import { Dialog } from "../ui/Dialog.js";
import { Icon } from "../ui/icons.js";
import { useEditor } from "./context.js";

function Frame({ label, title, children, onSubmit, wide }: { label: string; title?: string; children: ReactNode; onSubmit?: (e: FormEvent) => void; wide?: boolean }) {
  const { act } = useEditor();
  return (
    <Dialog label={label} onDismiss={act.closeDialog} className={wide ? "pl-dialog-wide" : ""}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(e);
        }}
      >
        <h2 className="pl-dialog-title">{title ?? label}</h2>
        {children}
      </form>
    </Dialog>
  );
}

function Actions({ primary, children }: { primary: string; children?: ReactNode }) {
  const { act } = useEditor();
  return (
    <div className="pl-dialog-actions">
      {children}
      <button type="button" className="pl-button" onClick={act.closeDialog}>
        Cancel
      </button>
      <button type="submit" className="pl-primary">
        {primary}
      </button>
    </div>
  );
}

function NameField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string | null }) {
  const id = `dialog-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={`pl-field${error ? " pl-field-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="pl-input" value={value} maxLength={80} data-autofocus onChange={(e) => onChange(e.target.value)} aria-describedby={error ? `${id}-error` : undefined} />
      {error && <FieldMessage id={`${id}-error`}>{error}</FieldMessage>}
    </div>
  );
}

function ShareDialog() {
  const { state, act } = useEditor();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const send = async () => {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) return setError(fieldError.emailInvalid);
    setBusy(true);
    const r = await api<Member>("POST", `/api/workspaces/${state.workspaceId}/invites`, { email: address, role });
    setBusy(false);
    if (r.ok) {
      setError(null);
      announce(notice.inviteSent(address), true);
      act.loadMembers();
    } else if (r.error.code === "already_member") setError(notice.alreadyMember(address));
    else if (r.error.code === "already_invited") setError(notice.alreadyInvited(address));
    else if (r.error.code === "mail_unavailable") {
      setError(notice.inviteFailed);
      announce(notice.inviteFailed, true);
    } else setError(r.error.fields.email ?? r.error.message);
  };
  const changeRole = async (member: Member, next: Role) => {
    setRoles((current) => ({ ...current, [member.email]: next }));
    const r = await api<Member>("PATCH", `/api/workspaces/${state.workspaceId}/members/${member.userId}`, { role: next });
    if (!r.ok) {
      announce(r.error.message, true);
      setRoles(({ [member.email]: _dropped, ...rest }) => rest);
    }
    act.loadMembers();
  };
  const remove = async (member: Member) => {
    const r = member.status === "invited" ? await api("DELETE", `/api/invites/${member.inviteId}`) : await api("DELETE", `/api/workspaces/${state.workspaceId}/members/${member.userId}`);
    if (!r.ok) announce(r.error.message, true);
    act.loadMembers();
  };
  return (
    <Frame label={`Share ${state.doc.name}`} wide onSubmit={() => void send()}>
      <div className="pl-share-form">
        <div className={`pl-field${error ? " pl-field-error" : ""}`}>
          <label htmlFor="share-email">Email</label>
          <input id="share-email" className="pl-input" type="email" value={email} data-autofocus onChange={(e) => (setEmail(e.target.value), setError(null))} aria-describedby={error ? "share-email-error" : undefined} />
          {error && (
            <FieldMessage id="share-email-error">{error}</FieldMessage>
          )}
        </div>
        <div className="pl-field">
          <label htmlFor="share-role">Role</label>
          <select id="share-role" className="pl-select" value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <button type="submit" className="pl-primary" aria-busy={busy || undefined} disabled={busy}>
          <Icon name="send" />
          Send invite
        </button>
      </div>
      <h3 className="pl-subhead">Members</h3>
      <ul aria-label="Members" className="pl-members">
        {state.members.map((m) => (
          <li key={m.userId ?? m.inviteId}>
            <span className="pl-member-email">{m.email}</span>
            <span className="pl-member-status">{m.status === "active" ? "Active" : "Invited"}</span>
            {m.role === "owner" ? (
              <span className="pl-muted">Owner</span>
            ) : m.status === "active" ? (
              <select className="pl-select" aria-label={`Role for ${m.email}`} value={roles[m.email] ?? m.role} onChange={(e) => void changeRole(m, e.target.value as Role)}>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            ) : (
              <span className="pl-muted">{m.role === "editor" ? "Editor" : "Viewer"}</span>
            )}
            {m.role !== "owner" && (
              <button type="button" className="pl-button" onClick={() => void remove(m)}>
                {m.status === "invited" ? `Revoke ${m.email}` : `Remove ${m.email}`}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="pl-dialog-actions">
        <button type="button" className="pl-button" onClick={act.closeDialog}>
          Done
        </button>
      </div>
    </Frame>
  );
}

function PlaceImageDialog({ parentId, index }: { parentId: string; index: number }) {
  const { state, act } = useEditor();
  const [imageId, setImageId] = useState("");
  const [alt, setAlt] = useState("");
  const [errors, setErrors] = useState<{ image?: string; alt?: string }>({});
  const chosen = imageId || state.images[0]?.id || "";
  return (
    <Frame
      label="Place image"
      onSubmit={() => {
        const next: { image?: string; alt?: string } = {};
        if (!chosen) next.image = "Upload an image in Images first.";
        if (!alt.trim()) next.alt = fieldError.altEmpty;
        setErrors(next);
        if (!next.image && !next.alt) act.placeImage(parentId, index, chosen, alt.trim());
      }}
    >
      <div className={`pl-field${errors.image ? " pl-field-error" : ""}`}>
        <label htmlFor="place-image">Image</label>
        <select id="place-image" className="pl-select" value={chosen} data-autofocus onChange={(e) => setImageId(e.target.value)}>
          {state.images.length === 0 && <option value="">No confirmed images yet</option>}
          {state.images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.fileName}
            </option>
          ))}
        </select>
        {errors.image && <FieldMessage>{errors.image}</FieldMessage>}
      </div>
      <div className={`pl-field${errors.alt ? " pl-field-error" : ""}`}>
        <label htmlFor="place-alt">Alt text</label>
        <input id="place-alt" className="pl-input" value={alt} maxLength={2000} onChange={(e) => setAlt(e.target.value)} aria-describedby={errors.alt ? "place-alt-error" : undefined} />
        {errors.alt && (
          <FieldMessage id="place-alt-error">{errors.alt}</FieldMessage>
        )}
      </div>
      <Actions primary="Place" />
    </Frame>
  );
}

function NamedDialog({ label, field, primary, initial, onSave }: { label: string; field: string; primary: string; initial: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <Frame
      label={label}
      onSubmit={() => {
        if (!name.trim()) return setError(`Enter a ${field.toLowerCase()}.`);
        onSave(name.trim());
      }}
    >
      <NameField label={field} value={name} onChange={(v) => (setName(v), setError(null))} error={error} />
      <Actions primary={primary} />
    </Frame>
  );
}

export function Dialogs() {
  const { state, act } = useEditor();
  const d = state.dialog;
  if (!d) return null;
  switch (d.kind) {
    case "delete":
      return (
        <Frame label={`Delete ${d.name}?`} onSubmit={() => act.confirmDelete(d.nodeId)}>
          <p>This removes {d.name} and everything inside it from the page. You can undo it with Ctrl+Z.</p>
          <Actions primary="Delete" />
        </Frame>
      );
    case "component":
      return <NamedDialog label="Create shared component" field="Component name" primary="Create" initial={d.name} onSave={(name) => act.createComponent(d.nodeId, name)} />;
    case "saveVersion":
      return (
        <Frame label="Save version" onSubmit={(e) => act.saveVersion(String(new FormData(e.target as HTMLFormElement).get("version") ?? ""))}>
          <div className="pl-field">
            <label htmlFor="version-name">Version name</label>
            <input id="version-name" name="version" className="pl-input" maxLength={80} data-autofocus />
          </div>
          <p className="pl-hint">Leave it empty to number the version.</p>
          <Actions primary="Save" />
        </Frame>
      );
    case "restore":
      return (
        <Frame label="Restore version" onSubmit={act.restore}>
          <p>The document becomes exactly {state.preview?.name}. Everyone sees it at once, comments are kept, and you can undo it.</p>
          <Actions primary="Restore" />
        </Frame>
      );
    case "publish":
      return (
        <Frame label="Publish page" onSubmit={act.publish}>
          <p>
            Publish {state.page.name} as a fixed snapshot{state.publishStatus?.url ? <> at <span className="pl-mono">{state.publishStatus.url}</span></> : null}. Later edits stay in the draft until you publish again.
          </p>
          <Actions primary="Publish now" />
        </Frame>
      );
    case "share":
      return <ShareDialog />;
    case "placeImage":
      return <PlaceImageDialog parentId={d.parentId} index={d.index} />;
    case "addPage":
      return <NamedDialog label="Add page" field="Page name" primary="Add page" initial="" onSave={act.addPage} />;
  }
}
