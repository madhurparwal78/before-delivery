import { useEffect, useState } from "react";
import { api, ApiCallError } from "../lib/api";
import { Dialog } from "./dialogs";
import { formatExpiry, formatTime } from "../lib/hooks";
import type { CheckpointRow, FileWithContent } from "../workspace/state";

export function CheckpointDialog({
  checkpoint,
  files,
  onClose,
}: {
  checkpoint: CheckpointRow;
  files: FileWithContent[];
  onClose: () => void;
}): React.ReactElement {
  const [contents, setContents] = useState<Record<string, string>>({});
  useEffect(() => {
    void (async () => {
      for (const f of checkpoint.files ?? []) {
        try {
          const res = await api<{ file: { content: string } }>(
            "GET",
            `/api/checkpoints/${checkpoint.id}/files/${f.file_id}`,
          );
          if (res.data?.file) {
            setContents((prev) => ({ ...prev, [f.path]: res.data!.file.content }));
          }
        } catch (err) {
          if (err instanceof ApiCallError && err.code === "storage_unavailable") {
            setContents((prev) => ({ ...prev, [f.path]: "Storage is unreachable, so checkpoints can't be opened or restored right now." }));
          } else if (err instanceof ApiCallError && err.code === "checkpoint_damaged") {
            setContents((prev) => ({ ...prev, [f.path]: "This checkpoint's stored files don't match its record, so it can't be restored." }));
          } else if (err instanceof ApiCallError && err.code === "checkpoint_not_saved") {
            setContents((prev) => ({ ...prev, [f.path]: "This checkpoint hasn't finished uploading yet." }));
          }
        }
      }
    })();
  }, [checkpoint]);
  return (
    <Dialog label={`Checkpoint ${checkpoint.name}`} onClose={onClose} wide>
      <h2>{checkpoint.name}</h2>
      <p className="mono">{formatTime(checkpoint.created_at)} · {checkpoint.file_count} files</p>
      <ul className="checkpoint-files">
        {(checkpoint.files ?? []).map((f) => {
          const current = files.find((x) => x.id === f.file_id);
          const note = current
            ? current.path !== f.path
              ? `now ${current.path}`
              : ""
            : "deleted since";
          return (
            <li key={f.file_id}>
              <span className="mono">{f.path}</span>
              {note ? <span className="mono note"> {note}</span> : null}
              <pre className="mono">{contents[f.path] ?? ""}</pre>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

interface LinkRow {
  id: string;
  url: string;
  expires_at: string;
  state: string;
  email_status: string;
}

export function ShareDialog({
  checkpoint,
  onClose,
}: {
  checkpoint: CheckpointRow;
  onClose: () => void;
}): React.ReactElement {
  const [hours, setHours] = useState(48);
  const [email, setEmail] = useState("");
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [linkField, setLinkField] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  const loadLinks = async () => {
    try {
      const res = await api<{ links: LinkRow[] }>("GET", `/api/checkpoints/${checkpoint.id}/reviewer-links`);
      setLinks(res.data?.links ?? []);
    } catch {
      // refresh keeps the old rows when the request fails
    }
  };

  useEffect(() => {
    if (checkpoint.state !== "saved") return;
    void loadLinks();
    const timer = window.setInterval(() => void loadLinks(), 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpoint.id, checkpoint.state]);

  const create = async () => {
    if (pending) return;
    if (!Number.isInteger(hours) || hours < 1 || hours > 336) {
      setStatus("Choose between 1 and 336 hours.");
      return;
    }
    if (checkpoint.state !== "saved") {
      setStatus("This checkpoint hasn't finished uploading yet.");
      return;
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setStatus("Enter an email address like name@example.com.");
      return;
    }
    setPending(true);
    try {
      const res = await api<{ link: LinkRow }>(
        "POST",
        `/api/checkpoints/${checkpoint.id}/reviewer-links`,
        { expires_in_hours: hours, ...(email ? { email: email.trim() } : {}) },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      const link = res.data?.link;
      if (link) {
        setLinkField(link.url);
        const chip = link.email_status === "sent" ? " Email sent" : link.email_status === "queued" ? " Email queued" : "";
        setStatus(`Reviewer link created. It expires ${formatExpiry(link.expires_at)}.${chip}`);
        void loadLinks();
      }
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "validation") {
          const fields = err.extra["fields"] as Record<string, string> | undefined;
          if (fields?.["expires_in_hours"]) setStatus("Choose between 1 and 336 hours.");
          else if (fields?.["email"]) setStatus("Enter an email address like name@example.com.");
          else setStatus("Choose between 1 and 336 hours.");
        } else if (err.code === "checkpoint_not_saved") {
          setStatus("This checkpoint hasn't finished uploading yet.");
        } else {
          setStatus("Something went wrong. Try again.");
        }
      } else {
        setStatus("Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api("POST", `/api/reviewer-links/${id}/revoke`);
      setStatus("Link revoked. It no longer opens.");
      void loadLinks();
    } catch (err) {
      if (err instanceof ApiCallError && err.code === "illegal_transition") {
        setStatus("Link revoked. It no longer opens.");
        void loadLinks();
      } else {
        setStatus("Something went wrong. Try again.");
      }
    }
  };

  const regenerate = async (id: string) => {
    try {
      const res = await api<{ link: LinkRow }>("POST", `/api/reviewer-links/${id}/regenerate`);
      const link = res.data?.link;
      if (link) setLinkField(link.url);
      setStatus("New link created. The old link no longer opens.");
      void loadLinks();
    } catch (err) {
      if (err instanceof ApiCallError && err.code === "illegal_transition") {
        setStatus("New link created. The old link no longer opens.");
        void loadLinks();
      } else {
        setStatus("Something went wrong. Try again.");
      }
    }
  };

  return (
    <Dialog label="Share with a reviewer" onClose={onClose} wide>
      <h2>Share with a reviewer</h2>
      <label htmlFor="share-hours">Expires in hours</label>
      <input
        id="share-hours"
        type="number"
        className="mono"
        min={1}
        max={336}
        value={hours}
        onChange={(e) => setHours(Number(e.target.value))}
      />
      <label htmlFor="share-email">Reviewer email (optional)</label>
      <input id="share-email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button onClick={() => void create()} disabled={pending}>
        Create link
      </button>
      <label htmlFor="share-link">Reviewer link</label>
      <input id="share-link" readOnly className="mono" value={linkField} />
      <button onClick={() => void navigator.clipboard.writeText(linkField)} disabled={!linkField}>
        Copy link
      </button>
      <ul aria-label="Reviewer links" className="reviewer-links">
        {links.map((l) => (
          <li key={l.id} className="mono">
            <span className={`link-state state-${l.state}`}>
              {l.state === "active" ? "Active" : l.state === "expired" ? "Expired" : "Revoked"}
            </span>
            <span>{formatExpiry(l.expires_at)}</span>
            {l.state === "active" ? (
              <>
                <button onClick={() => void revoke(l.id)}>Revoke</button>
                <button onClick={() => void regenerate(l.id)}>Regenerate</button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="status" role="status" aria-label="Share status">
        {status}
      </p>
    </Dialog>
  );
}
