import { Download, Upload, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Dialog } from "../components/Dialog";
import { api, downloadLink, RequestError, upload } from "../lib/api";
import { useSession } from "../session";
import { COPY, copyFor } from "../../shared/copy";
import type { FileKind, FileRecord, Project } from "../../shared/domain";
import { FoldMotif } from "./FoldMotif";
import { AccessEnded, NotFound } from "./Missing";
import { stateWord } from "./Overview";
import { studioMoment } from "./Receipt";

const MAX_BYTES = 10_000_000;
const STEPS = [0, 25, 50, 75, 100];

function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function refusal(error: unknown, name: string): string {
  if (!(error instanceof RequestError)) return COPY.storageUpload;
  if (error.code === "unsupported_file_type" || error.code === "unsupported_media_type") return copyFor.badType(name);
  if (error.code === "file_too_large") return copyFor.tooLarge(name);
  if (error.status === 422) return COPY.nameRefused;
  if (error.code === "storage_unavailable" || error.status === 0) return COPY.storageUpload;
  return error.body.message;
}

function FileList({ files, empty, onDownload }: { files: FileRecord[]; empty: string; onDownload: (file: FileRecord) => void }) {
  if (!files.length) {
    return (
      <div className="empty empty--small">
        <FoldMotif />
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <ul className="file-list">
      {files.map((file) => (
        <li key={file.id} className="file-row">
          <span className="file-row__name">{file.name}</span>
          <span className="file-row__meta">
            {file.uploadedBy} · <span className="mono">{size(file.size)}</span> · <span className="mono">{studioMoment(file.uploadedAt)}</span>
          </span>
          <button type="button" className="button button--secondary button--small" aria-label={`Download ${file.name}`} onClick={() => onDownload(file)}>
            <Download aria-hidden="true" size={16} />
            Download
          </button>
        </li>
      ))}
    </ul>
  );
}

function InviteDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    setStatus(COPY.sendingInvite);
    try {
      await api(`/api/projects/${projectId}/invites`, { body: { email } });
      setStatus(copyFor.inviteSent(email.trim()));
      setEmail("");
    } catch (failure) {
      setStatus("");
      if (failure instanceof RequestError && failure.status === 422) setError(failure.body.fields?.email ?? failure.body.message);
      else setStatus(failure instanceof RequestError ? failure.body.message : "We couldn't send the invite. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} label="Invite teammate" onClose={onClose}>
      <h2 className="dialog__title">Invite teammate</h2>
      <p className="dialog__text">Teammates can upload brand assets and download deliverables on every project of your account. They don't see billing.</p>
      <form onSubmit={send} noValidate className="dialog__form">
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={error ? "invite-email-error" : undefined} aria-invalid={error ? true : undefined} />
          {error ? <p id="invite-email-error" className="field-error">{error}</p> : null}
        </div>
        <p role="status" aria-label="Invite status" className="live">{status}</p>
        <div className="dialog__actions">
          <button type="submit" className="button button--primary" disabled={pending}>
            Send invite
          </button>
          <button type="button" className="button button--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const { user } = useSession();
  const [project, setProject] = useState<Project | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "ended" | "failed">("loading");
  const [progress, setProgress] = useState<number | null>(null);
  const [inviting, setInviting] = useState(false);
  const announcer = useRef<HTMLParagraphElement>(null);

  // The upload live region is written directly, so each announced step lands in order even when
  // several arrive in one frame.
  const say = (text: string) => {
    if (announcer.current) announcer.current.textContent = text;
  };

  const load = useCallback(() => {
    api<Project>(`/api/projects/${projectId}`)
      .then((body) => {
        setProject(body);
        setState("ok");
      })
      .catch((error) => {
        if (error instanceof RequestError && error.code === "access_ended") setState("ended");
        else if (error instanceof RequestError && error.status === 404) setState("missing");
        else setState("failed");
      });
  }, [projectId]);

  useEffect(load, [load]);

  if (state === "missing") return <NotFound />;
  if (state === "ended") return <AccessEnded />;
  if (!project) {
    return (
      <div className="ledger-page">
        <h1>Project</h1>
        <p className="muted">{state === "failed" ? "We couldn't load this project. Try again in a moment." : "Loading the project…"}</p>
      </div>
    );
  }

  const role = user?.role;
  const canAssets = role === "client_owner" || role === "teammate";
  const canDeliverables = role === "studio_owner" || role === "contractor";
  const closed = project.closedAt !== null;

  const send = async (event: ChangeEvent<HTMLInputElement>, kind: FileKind) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      say(copyFor.tooLarge(file.name));
      return;
    }
    let announced = -1;
    const step = (percent: number) => {
      for (const mark of STEPS) {
        if (mark > announced && percent >= mark) {
          announced = mark;
          say(copyFor.uploading(file.name, mark));
        }
      }
      setProgress(percent);
    };
    try {
      await upload(`/api/projects/${project.id}/${kind === "asset" ? "assets" : "deliverables"}`, file, step);
      say(copyFor.uploaded(file.name));
      load();
    } catch (error) {
      say(refusal(error, file.name));
    } finally {
      setProgress(null);
    }
  };

  const download = async (file: FileRecord) => {
    try {
      const link = await api<{ url: string }>(`/api/files/${file.id}/links`, { body: {} });
      await downloadLink(link.url, file.name);
    } catch (error) {
      if (error instanceof RequestError && error.code === "access_ended") setState("ended");
      else if (error instanceof RequestError && error.code === "link_expired") say(COPY.linkExpired);
      else if (error instanceof RequestError && error.status === 404) setState("missing");
      else say(COPY.storageUpload);
    }
  };

  return (
    <div className="ledger-page project">
      <p className="eyebrow">
        Project · <span className="mono">{project.orderNumber}</span>
      </p>
      <h1>
        {project.businessName} · {project.planName}
      </h1>
      <p className="project__state">
        Order state: <span className={`pill pill--${project.state}`}>{stateWord(project.state)}</span>
        {closed ? <span className="muted"> · closed {studioMoment(project.closedAt!)}</span> : null}
      </p>
      {role === "client_owner" ? (
        <p>
          <button type="button" className="button button--secondary" onClick={() => setInviting(true)}>
            <UserPlus aria-hidden="true" size={18} />
            Invite teammate
          </button>
        </p>
      ) : null}

      <div className="uploads">
        {canAssets && !closed ? (
          <label className="upload-control">
            <Upload aria-hidden="true" size={18} />
            <span>Upload brand asset</span>
            <input type="file" aria-label="Upload brand asset" onChange={(event) => send(event, "asset")} />
          </label>
        ) : null}
        {canDeliverables && !closed ? (
          <label className="upload-control">
            <Upload aria-hidden="true" size={18} />
            <span>Upload deliverable</span>
            <input type="file" aria-label="Upload deliverable" onChange={(event) => send(event, "deliverable")} />
          </label>
        ) : null}
        <p className="allowlist">{COPY.allowlist}</p>
        {progress !== null ? (
          <div className="progress" aria-hidden="true">
            <span style={{ inlineSize: `${progress}%` }} />
          </div>
        ) : null}
        <p role="status" aria-label="Upload status" className="live" ref={announcer} />
      </div>

      <div className="project__files">
        <section aria-label="Brand assets" className="ledger-section">
          <h2>Brand assets</h2>
          <FileList files={project.assets} empty="No brand assets yet. Logos, palettes and fonts go here." onDownload={download} />
        </section>
        <section aria-label="Deliverables" className="ledger-section">
          <h2>Deliverables</h2>
          <FileList files={project.deliverables} empty="No deliverables yet. Mockups and exports from the studio land here." onDownload={download} />
        </section>
      </div>

      {role === "client_owner" || role === "studio_owner" ? (
        <section aria-labelledby="contractors-title" className="ledger-section">
          <h2 id="contractors-title">Assigned contractors</h2>
          {project.contractors.length ? (
            <ul className="plain-list">
              {project.contractors.map((c) => (
                <li key={c.id}>
                  {c.name} · <span className="mono">{c.email}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No contractors assigned.</p>
          )}
        </section>
      ) : null}
      {role === "client_owner" ? <InviteDialog projectId={project.id} open={inviting} onClose={() => setInviting(false)} /> : null}
    </div>
  );
}
