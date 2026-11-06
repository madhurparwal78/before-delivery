import { useEffect, useState } from "react";
import { api, ApiCallError } from "./lib/api";
import { formatExpiry, formatTime } from "./lib/hooks";

interface ReviewCheckpoint {
  name: string;
  saved_at: string;
  expires_at: string;
  files: { path: string; content: string }[];
}

export function ReviewPage(): React.ReactElement {
  const [checkpoint, setCheckpoint] = useState<ReviewCheckpoint | null>(null);
  const [status, setStatus] = useState("Loading checkpoint…");

  useEffect(() => {
    const token = window.location.pathname.split("/")[2] ?? "";
    void (async () => {
      try {
        const res = await api<{ checkpoint: ReviewCheckpoint }>("GET", `/api/review/${encodeURIComponent(token)}`);
        if (res.data?.checkpoint) {
          setCheckpoint(res.data.checkpoint);
          setStatus("");
        }
      } catch (err) {
        if (err instanceof ApiCallError) {
          if (err.code === "link_expired") setStatus("This review link has expired.");
          else if (err.code === "link_revoked") setStatus("This review link was revoked.");
          else if (err.code === "link_not_found") setStatus("This review link doesn't exist.");
          else if (err.code === "checkpoint_damaged") setStatus("This checkpoint can't be shown because its stored files are damaged.");
          else if (err.code === "storage_unavailable") setStatus("This checkpoint can't be loaded right now. Try again shortly.");
          else setStatus("This review link doesn't exist.");
        } else {
          setStatus("This checkpoint can't be loaded right now. Try again shortly.");
        }
      }
    })();
  }, []);

  return (
    <div className="review-page">
      {checkpoint ? (
        <>
          <h1 className="serif">{checkpoint.name}</h1>
          <p className="mono saved-at">{formatTime(checkpoint.saved_at)}</p>
          <p className="mono expiry">Link expires {formatExpiry(checkpoint.expires_at)}</p>
          <div className="review-files">
            <ul className="path-list mono" aria-hidden="true">
              {checkpoint.files.map((f) => (
                <li key={f.path}>{f.path}</li>
              ))}
            </ul>
            <ul aria-label="Files" className="file-blocks">
              {checkpoint.files.map((f) => (
                <li key={f.path}>
                  <section aria-label={f.path}>
                    <h2 className="mono">{f.path}</h2>
                    <pre className="mono">{f.content}</pre>
                  </section>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
      <p className="status" role="status" aria-label="Review status">
        {status}
      </p>
    </div>
  );
}
