// Open client flags, newest first, each answered once from here.
import { useState } from "react";
import { api, NoResponse, Stale } from "../api";
import { Dialog } from "../components/Dialog";
import { usePoll } from "../hooks";

interface Flag {
  id: string;
  line_label: string;
  comment: string;
  mission_name: string;
  client_name: string;
}

export function Flags() {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [replying, setReplying] = useState<Flag | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const refresh = usePoll(async () => {
    const r = await api<Flag[]>("/api/flags?state=open");
    if (r.ok) setFlags(r.data);
  }, 5000, []);

  const send = async () => {
    if (!replying) return;
    try {
      const r = await api(`/api/flags/${replying.id}/reply`, { method: "POST", body: { text } });
      if (r.ok || r.error?.error === "flag_answered") {
        setFlags((list) => (list ?? []).filter((f) => f.id !== replying.id));
        setStatus(r.error ? r.error.message : `Reply sent for ${replying.line_label}`);
        setReplying(null);
        refresh();
      } else setError(r.error?.errors?.text ?? r.error?.message ?? null);
    } catch (e) {
      if (e instanceof NoResponse) setError(`Could not reach Swathdeck — the reply to ${replying.line_label} is not sent yet`);
      else if (!(e instanceof Stale)) throw e;
    }
  };

  return (
    <main className="page">
      <h1>Client flags</h1>
      <p role="status" aria-live="polite" aria-label="Flags status">{status}</p>
      {!flags ? <p className="muted">Loading flags…</p> : (
        <ul aria-label="Open flags" className="slip-rows">
          {flags.length === 0 && <li className="muted">No open flags.</li>}
          {flags.map((f) => (
            <li key={f.id}>
              <span className="wrap-anywhere">{f.client_name} · {f.mission_name} · {f.line_label} · {f.comment}</span>
              <button type="button" aria-label={`Reply to ${f.line_label}`} onClick={() => {
                setReplying(f);
                setText("");
                setError(null);
              }}>Reply</button>
            </li>
          ))}
        </ul>
      )}
      {replying && (
        <Dialog label="Reply to flag" onClose={() => setReplying(null)}>
          <h2>Reply to flag</h2>
          <p className="muted">{replying.client_name} · {replying.line_label} · {replying.comment}</p>
          <div className="field">
            <label htmlFor="reply">Reply</label>
            <textarea id="reply" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            {error && <p className="field-error">{error}</p>}
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void send()}>Send reply</button>
            <button type="button" onClick={() => setReplying(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
