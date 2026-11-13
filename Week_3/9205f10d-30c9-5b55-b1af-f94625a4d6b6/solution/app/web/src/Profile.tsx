import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { OFFLINE_COPY, api } from "./api";
import { longDateOf } from "./format";
import type { Credential } from "./types";

const FILE_LIMIT = 5_000_000;
const STORAGE_COPY = "Certificate storage is unreachable. Nothing was saved or opened; try again in a few minutes.";
const STATUS_WORD = { uploaded: "Uploaded", verified: "Verified", expired: "Expired" } as const;

/** The interpreter's profile: upload a certificate, and see every credential's status. */
export function Profile() {
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [type, setType] = useState("NIC");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"ok" | "alert">("ok");
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = await api<{ credentials: Credential[] }>("GET", "/api/me/credentials");
    if (result.ok) setCredentials(result.data.credentials);
  }, []);
  useEffect(() => void load(), [load]);

  const say = (text: string, kind: "ok" | "alert") => {
    setMessage(text);
    setTone(kind);
  };

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      say("Choose a certificate file to upload.", "alert");
      return;
    }
    if (file.size > FILE_LIMIT) {
      say("That file is over 5,000,000 bytes. Choose a smaller file.", "alert");
      return;
    }
    const form = new FormData();
    form.append("credential_type", type);
    form.append("file", file, file.name);
    setPending(true);
    say("Uploading certificate…", "ok");
    const result = await api<Credential>("POST", "/api/me/credentials", form);
    setPending(false);
    if (result.ok) {
      say("Certificate uploaded. A coordinator will verify it.", "ok");
      if (fileInput.current) fileInput.current.value = "";
      void load();
      return;
    }
    const copy: Record<string, string> = {
      payload_too_large: "That file is over 5,000,000 bytes. Choose a smaller file.",
      unsupported_type: "Upload a PDF, PNG or JPEG file.",
      storage_unavailable: STORAGE_COPY,
    };
    say(result.error ? (copy[result.error.code] ?? result.error.message) : OFFLINE_COPY, "alert");
  };

  return (
    <div className="page profile">
      <h1>Profile</h1>
      <div className="profile-grid">
        <form className="panel upload-form" aria-label="Upload certificate" onSubmit={(e) => void upload(e)}>
          <h2>Upload certificate</h2>
          <p className="quiet">PDF, PNG or JPEG, up to 5,000,000 bytes. A coordinator checks it and enters its expiry date.</p>
          <div className="field">
            <label htmlFor="credential-type">Credential type</label>
            <select id="credential-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {["NIC", "CDI", "SC:L", "EIPA"].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="certificate-file">Certificate file</label>
            <input id="certificate-file" ref={fileInput} className="input input--file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" />
          </div>
          <button type="submit" className="button button--primary" disabled={pending}>
            Upload certificate
          </button>
          <p className={`live${tone === "alert" ? " live--alert" : ""}`} role="status" aria-label="Upload status">
            {message}
          </p>
        </form>
        <section className="panel" aria-labelledby="my-credentials-heading">
          <h2 id="my-credentials-heading">My credentials</h2>
          <table className="data-table stack" aria-label="My credentials">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Expires</th>
                <th scope="col">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {(credentials ?? []).map((c) => (
                <tr key={c.id}>
                  <td data-label="Type">{c.credential_type}</td>
                  <td data-label="Status" className={`credential-status credential-status--${c.status}`}>
                    {STATUS_WORD[c.status]}
                  </td>
                  <td data-label="Expires" className="num">
                    {c.expires_on ? longDateOf(c.expires_on) : "—"}
                  </td>
                  <td data-label="Uploaded" className="num">
                    {longDateOf(c.uploaded_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {credentials?.length === 0 && <p className="empty">No credentials yet.</p>}
        </section>
      </div>
    </div>
  );
}
