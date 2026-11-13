import { useCallback, useEffect, useState } from "react";
import { Placeholder } from "./Placeholder";
import { OFFLINE_COPY, api } from "./api";
import { longDateOf } from "./format";
import type { Credential } from "./types";

const STORAGE_COPY = "Certificate storage is unreachable. Nothing was saved or opened; try again in a few minutes.";

/** The coordinator's review queue: open each uploaded certificate, enter its expiry, verify it. */
export function Credentials() {
  const [queue, setQueue] = useState<Credential[] | null>(null);
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await api<{ credentials: Credential[] }>("GET", "/api/credentials?status=uploaded");
    if (result.ok) setQueue(result.data.credentials);
    else setMessage(result.error?.message ?? OFFLINE_COPY);
  }, []);
  useEffect(() => void load(), [load]);

  const who = (c: Credential) => `${c.interpreter?.display_name ?? ""} ${c.credential_type}`;

  const viewFile = async (c: Credential) => {
    setBusy(c.id);
    setMessage(`Opening the file for ${who(c)}…`);
    const result = await api<{ url: string }>("GET", `/api/credentials/${c.id}/file`);
    setBusy(null);
    if (result.ok) {
      window.open(result.data.url, "_blank", "noopener");
      setMessage(`Opened the file for ${who(c)}. The link works for 60 seconds.`);
    } else if (!result.error) setMessage(OFFLINE_COPY);
    else setMessage(result.error.code === "storage_unavailable" ? STORAGE_COPY : result.error.message);
  };

  const verify = async (c: Credential) => {
    const date = (expiry[c.id] ?? "").trim();
    setBusy(c.id);
    setMessage(`Verifying ${who(c)}…`);
    const result = await api<Credential>("POST", `/api/credentials/${c.id}/verify`, { expires_on: date });
    setBusy(null);
    if (result.ok) {
      setErrors(({ [c.id]: _cleared, ...rest }) => rest);
      setMessage(`Verified ${c.credential_type} for ${c.interpreter?.display_name ?? ""}, valid through ${longDateOf(result.data.expires_on ?? date)}.`);
      setQueue((rows) => (rows ?? []).filter((row) => row.id !== c.id));
      return;
    }
    if (!result.error) {
      setMessage(OFFLINE_COPY);
      return;
    }
    if (result.error.fields?.expires_on) setErrors((current) => ({ ...current, [c.id]: result.error?.fields?.expires_on ?? "" }));
    setMessage(result.error.message);
    if (result.error.code === "invalid_transition") void load();
  };

  return (
    <div className="page">
      <h1>Credentials</h1>
      <p className="lede">Certificates interpreters have uploaded. Open each file, enter the expiry date it shows, and verify it.</p>
      <p className="live" role="status" aria-label="Review status">
        {message}
      </p>
      {queue === null ? (
        <Placeholder />
      ) : (
        <table className="data-table stack" aria-label="Credentials awaiting review">
          <thead>
            <tr>
              <th scope="col">Interpreter</th>
              <th scope="col">Type</th>
              <th scope="col">Uploaded</th>
              <th scope="col">File</th>
              <th scope="col">Expiry date</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((c) => (
              <tr key={c.id}>
                <td data-label="Interpreter">
                  <strong>{c.interpreter?.display_name}</strong>
                  <span className="quiet block">{c.interpreter?.full_name}</span>
                </td>
                <td data-label="Type">{c.credential_type}</td>
                <td data-label="Uploaded" className="num">
                  {longDateOf(c.uploaded_at)}
                </td>
                <td data-label="File">
                  <button type="button" className="button" aria-label={`View file for ${who(c)}`} disabled={busy === c.id} onClick={() => void viewFile(c)}>
                    View file
                  </button>
                  {c.file_name && <span className="quiet block file-name">{c.file_name}</span>}
                </td>
                <td data-label="Expiry date">
                  <input
                    className="input num"
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    aria-label={`Expiry date for ${who(c)}`}
                    aria-invalid={errors[c.id] ? true : false}
                    aria-describedby={errors[c.id] ? `expiry-error-${c.id}` : undefined}
                    value={expiry[c.id] ?? ""}
                    onChange={(e) => setExpiry((current) => ({ ...current, [c.id]: e.target.value }))}
                  />
                  {errors[c.id] && (
                    <p id={`expiry-error-${c.id}`} className="field-error">
                      {errors[c.id]}
                    </p>
                  )}
                </td>
                <td data-label="Action">
                  <button type="button" className="button button--primary" aria-label={`Verify ${who(c)}`} disabled={busy === c.id} onClick={() => void verify(c)}>
                    Verify
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      
      {queue?.length === 0 && <p className="empty">No certificates are waiting for review.</p>}
    </div>
  );
}
