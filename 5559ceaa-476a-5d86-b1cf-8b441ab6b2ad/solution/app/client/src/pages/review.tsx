import { useEffect, useState } from "react";
import { api, Refusal } from "../api";
import { stamp } from "../format";

interface Reviewed {
  name: string;
  saved_at: string;
  expires_at: string;
  files: Array<{ path: string; content: string }>;
}

const REVIEW_ERRORS: Record<string, string> = {
  link_expired: "This review link has expired.",
  link_revoked: "This review link was revoked.",
  link_not_found: "This review link doesn't exist.",
  checkpoint_damaged: "This checkpoint can't be shown because its stored files are damaged.",
  storage_unavailable: "This checkpoint can't be loaded right now. Try again shortly.",
};

export function ReviewPage({ token }: { token: string }) {
  const [checkpoint, setCheckpoint] = useState<Reviewed | null>(null);
  const [status, setStatus] = useState("Loading checkpoint…");

  useEffect(() => {
    api<{ checkpoint: Reviewed }>(`/api/review/${encodeURIComponent(token)}`)
      .then((r) => {
        setCheckpoint(r.checkpoint);
        setStatus("");
      })
      .catch((error: unknown) =>
        setStatus(REVIEW_ERRORS[error instanceof Refusal ? error.code : ""] ?? "This checkpoint can't be loaded right now. Try again shortly."),
      );
  }, [token]);

  return (
    <main className="review">
      <p className="brand review-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Relay Bench</span>
        <span className="review-tag">Read-only checkpoint</span>
      </p>
      <p role="status" aria-label="Review status" className={checkpoint ? "region visually-hidden" : "region review-status"}>
        {status}
      </p>
      {checkpoint && (
        <>
          <header className="review-head">
            <h1 className="display review-title">{checkpoint.name}</h1>
            <p className="review-meta">
              Saved <span className="num">{stamp(checkpoint.saved_at)}</span>
              <span className="meta-sep" aria-hidden="true">·</span>
              <span className="num">Link expires {stamp(checkpoint.expires_at)}</span>
            </p>
          </header>
          <div className="review-body">
            <nav className="review-index" aria-label="Paths">
              <ul>
                {checkpoint.files.map((f, i) => (
                  <li key={f.path}>
                    <a href={`#file-${i}`} className="mono">
                      {f.path}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <ul aria-label="Files" className="review-files">
              {checkpoint.files.map((f, i) => (
                <li key={f.path}>
                  <section aria-label={f.path} id={`file-${i}`} className="review-file">
                    <h2 className="review-path mono">{f.path}</h2>
                    <pre className="code-block" tabIndex={0}>
                      <code>{f.content}</code>
                    </pre>
                  </section>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </main>
  );
}
