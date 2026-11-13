// The dialogs of the part page and the head-conflict alert.
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { SAVE_OUTAGE, etagOf } from "../shared/copy";
import type { ApiError, PartJson, Person, RevisionJson, RoomJson } from "../shared/api";
import type { Values } from "../shared/tine";
import { KeyedAction } from "./api";
import { Dialog } from "./dialog";
import { Icon } from "./icons";
import { navigate } from "./router";

const NOT_SENT = "Not sent yet. Try again.";

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <Icon name="alert" />
      <div>{children}</div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="field-error">
      <Icon name="alert" size={16} />
      {message}
    </p>
  ) : null;
}

function Busy({ pending, children }: { pending: boolean; children: ReactNode }) {
  return <span className={pending ? "busy" : undefined}>{children}</span>;
}

interface SaveProps {
  part: PartJson;
  me: Person;
  values: Values;
  storageDown: boolean;
  knownHead: string;
  initialMessage: string;
  onClose: () => void;
  onSaved: (revision: RevisionJson, headTag: string) => void;
  onCopied: (slug: string) => void;
  onConflict: (head: RevisionJson, message: string) => void;
}

export function SaveDialog({ part, me, values, storageDown, knownHead, initialMessage, onClose, onSaved, onCopied, onConflict }: SaveProps) {
  const [message, setMessage] = useState(initialMessage);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useRef(new KeyedAction());
  const owner = me.id === part.owner.id;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (storageDown) {
      setAlert(SAVE_OUTAGE);
      return;
    }
    setPending(true);
    setAlert(null);
    setErrors({});
    const reply = owner
      ? await action.current.send<RevisionJson & ApiError>("POST", `/api/parts/${part.slug}/revisions`, { values, message }, { "If-Match": etagOf(knownHead) })
      : await action.current.send<{ slug: string } & ApiError>("POST", `/api/parts/${part.slug}/copies`, { values, message });
    setPending(false);
    if (!reply) {
      setAlert(NOT_SENT);
    } else if (reply.status === 201 && owner) {
      onSaved(reply.data as RevisionJson, reply.headers.get("ETag") ?? "");
    } else if (reply.status === 201) {
      onCopied((reply.data as { slug: string }).slug);
    } else if (reply.status === 412) {
      onConflict((reply.data as ApiError).head as RevisionJson, message);
    } else if (reply.status === 503) {
      setAlert(SAVE_OUTAGE);
    } else if (reply.status === 422 && (reply.data as ApiError).errors) {
      setErrors((reply.data as ApiError).errors as Record<string, string>);
    } else {
      setAlert((reply.data as ApiError).message);
    }
  };

  return (
    <Dialog title="Save revision" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {owner ? null : (
          <p className="muted">
            {`This part belongs to ${part.owner.displayName}. Saving makes your own copy: ${part.title} (my configuration).`}
          </p>
        )}
        <label className="stacked">
          <span>Message</span>
          <input type="text" value={message} onChange={(event) => setMessage(event.target.value)} autoComplete="off" />
        </label>
        <FieldError message={errors.message ?? errors.values} />
        {alert ? <Alert>{alert}</Alert> : null}
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={pending} aria-disabled={storageDown || pending ? true : undefined} onClick={(event) => storageDown && (event.preventDefault(), setAlert(SAVE_OUTAGE))}>
            <Busy pending={pending}>{pending ? "Saving..." : "Save"}</Busy>
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SignUpDialog({ next, onClose }: { next: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const action = useRef(new KeyedAction());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setAlert(null);
    const reply = await action.current.send<ApiError>("POST", "/api/auth/signup", { email, password, displayName, next });
    setPending(false);
    if (!reply) setAlert(NOT_SENT);
    else if (reply.status === 201) setSent(`Check your inbox: we sent a link to ${email}. It brings you back to this exact configuration.`);
    else if (reply.status === 409) setErrors({ email: reply.data.message });
    else if (reply.status === 422 && reply.data.errors) setErrors(reply.data.errors);
    else setAlert(reply.data.message);
  };

  return (
    <Dialog title="Sign up to save" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label className="stacked">
          <span>Email</span>
          <input type="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>
        <FieldError message={errors.email} />
        <label className="stacked">
          <span>Display name</span>
          <input type="text" name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" />
        </label>
        <FieldError message={errors.displayName} />
        <label className="stacked">
          <span>Password</span>
          <input type="password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </label>
        <FieldError message={errors.password} />
        {sent ? <p className="success">{sent}</p> : null}
        {alert ? <Alert>{alert}</Alert> : null}
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={pending}>
            <Busy pending={pending}>Create account and send link</Busy>
          </button>
          <a
            href={`/signin?next=${encodeURIComponent(next)}`}
            className="button"
            onClick={(event) => {
              event.preventDefault();
              onClose();
              navigate(`/signin?next=${encodeURIComponent(next)}`);
            }}
          >
            I already have an account
          </a>
        </div>
      </form>
    </Dialog>
  );
}

interface RestoreProps {
  slug: string;
  revision: RevisionJson;
  knownHead: string;
  storageDown: boolean;
  onClose: () => void;
  onRestored: (revision: RevisionJson) => void;
  onConflict: (head: RevisionJson) => void;
}

export function RestoreDialog({ slug, revision, knownHead, storageDown, onClose, onRestored, onConflict }: RestoreProps) {
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const action = useRef(new KeyedAction());

  const run = async () => {
    if (pending) return;
    if (storageDown) {
      setAlert(SAVE_OUTAGE);
      return;
    }
    setPending(true);
    setAlert(null);
    const reply = await action.current.send<RevisionJson & ApiError>("POST", `/api/parts/${slug}/revisions/${revision.id}/restore`, {}, { "If-Match": etagOf(knownHead) });
    setPending(false);
    if (!reply) setAlert(NOT_SENT);
    else if (reply.status === 201) onRestored(reply.data as RevisionJson);
    else if (reply.status === 412) onConflict((reply.data as ApiError).head as RevisionJson);
    else if (reply.status === 503) setAlert(SAVE_OUTAGE);
    else setAlert((reply.data as ApiError).message);
  };

  return (
    <Dialog title={`Restore ${revision.label} as a new revision?`} onClose={onClose}>
      <p className="muted">The current head stays in the history.</p>
      {alert ? <Alert>{alert}</Alert> : null}
      <div className="dialog-actions">
        <button type="button" className="button primary" aria-disabled={storageDown || pending ? true : undefined} disabled={pending} onClick={run}>
          <Busy pending={pending}>Restore</Busy>
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

interface ForkProps {
  revisionId: string;
  operation: number;
  bodyIndex: number;
  knownHead: string;
  storageDown: boolean;
  onClose: () => void;
  onForked: (revision: RevisionJson) => void;
  onConflict: (head: RevisionJson) => void;
}

export function ForkDialog({ revisionId, operation, bodyIndex, knownHead, storageDown, onClose, onForked, onConflict }: ForkProps) {
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const action = useRef(new KeyedAction());
  const blocked = operation < bodyIndex;

  const run = async () => {
    if (pending || blocked) return;
    if (storageDown) {
      setAlert(SAVE_OUTAGE);
      return;
    }
    setPending(true);
    setAlert(null);
    const reply = await action.current.send<RevisionJson & ApiError>("POST", `/api/revisions/${revisionId}/fork`, { operation }, { "If-Match": etagOf(knownHead) });
    setPending(false);
    if (!reply) setAlert(NOT_SENT);
    else if (reply.status === 201) onForked(reply.data as RevisionJson);
    else if (reply.status === 412) onConflict((reply.data as ApiError).head as RevisionJson);
    else if (reply.status === 503) setAlert(SAVE_OUTAGE);
    else setAlert(reply.data.errors?.operation ?? (reply.data as ApiError).message);
  };

  return (
    <Dialog title={`Fork from operation ${operation}?`} onClose={onClose}>
      <p className="muted">{`The new revision keeps operations 0 to ${operation} and drops the rest.`}</p>
      {alert ? <Alert>{alert}</Alert> : null}
      <div className="dialog-actions">
        <button type="button" className="button primary" disabled={blocked || pending} aria-disabled={storageDown ? true : undefined} onClick={run}>
          <Busy pending={pending}>Fork</Busy>
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function ReviewDialog({ slug, onClose, onCreated }: { slug: string; onClose: () => void; onCreated: (room: RoomJson) => void }) {
  const [title, setTitle] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const action = useRef(new KeyedAction());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setAlert(null);
    const emails = reviewers.split(",").map((e) => e.trim()).filter(Boolean);
    const reply = await action.current.send<RoomJson & ApiError>("POST", `/api/parts/${slug}/rooms`, { title, reviewers: emails });
    setPending(false);
    if (!reply) setAlert(NOT_SENT);
    else if (reply.status === 201) onCreated(reply.data as RoomJson);
    else if (reply.status === 422 && reply.data.errors) setErrors(reply.data.errors);
    else setAlert(reply.data.message);
  };

  return (
    <Dialog title="Start a review" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label className="stacked">
          <span>Room title</span>
          <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />
        </label>
        <FieldError message={errors.title} />
        <label className="stacked">
          <span>Reviewer emails</span>
          <textarea value={reviewers} onChange={(event) => setReviewers(event.target.value)} rows={3} />
        </label>
        <p className="muted small">Separate addresses with commas.</p>
        <FieldError message={errors.reviewers} />
        {alert ? <Alert>{alert}</Alert> : null}
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={pending}>
            <Busy pending={pending}>Create room</Busy>
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface ConflictProps {
  message: string;
  head: RevisionJson;
  lines: string[];
  onOpen: () => void;
  onKeep: () => void;
}

export function ConflictAlert({ message, head, lines, onOpen, onKeep }: ConflictProps) {
  return (
    <div className="alert alert-conflict" role="alert">
      <Icon name="alert" />
      <div>
        <p>{message}</p>
        <ul aria-label={`Changes in ${head.label}`} className="changes">
          {lines.length ? lines.map((line) => <li key={line}>{line}</li>) : <li>No parameter changes.</li>}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onOpen}>
            Open {head.label}
          </button>
          <button type="button" className="button primary" onClick={onKeep}>
            Keep my values on {head.label}
          </button>
        </div>
      </div>
    </div>
  );
}
