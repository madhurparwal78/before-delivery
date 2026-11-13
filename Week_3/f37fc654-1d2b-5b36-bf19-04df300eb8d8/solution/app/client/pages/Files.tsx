// `/c/<commission id>/files` — the brief PDF, venue photos and GLB models, each Stored with its SHA-256.
import { useRef, useState } from "react";
import { cleanFileName } from "../../shared/format";
import { Icon } from "../components/icons";
import { HttpError, call } from "../lib/api";
import { CommissionLinks, Empty, Failed, Missing, Skeleton, failureText, useLoad, useScene } from "./common";

export interface StoredFile { id: string; kind: string; fileName: string; contentType: string; sizeBytes: number; sha256: string; status: string; createdAt: string }

const KINDS = [
  { kind: "brief_pdf", button: "Upload brief PDF", accept: "application/pdf,.pdf", label: "brief PDF" },
  { kind: "venue_photo", button: "Upload venue photo", accept: "image/jpeg,image/png,.jpg,.jpeg,.png", label: "venue photo" },
  { kind: "installation_glb", button: "Upload GLB model", accept: ".glb,model/gltf-binary", label: "GLB model" },
] as const;


export function Files({ id }: { id: string }) {
  useScene("working");
  const [load, reload] = useLoad<{ files: StoredFile[] }>(`/api/commissions/${id}/files`);
  const [status, setStatus] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const upload = async (kind: string, file: File): Promise<void> => {
    const shown = cleanFileName(file.name);
    setStatus(`Uploading ${shown}...`);
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file, file.name);
    try {
      const stored = await call<StoredFile>(`/api/commissions/${id}/files`, { form });
      setStatus(`Stored ${stored.fileName} — ${stored.sizeBytes} bytes, SHA-256 ${stored.sha256}.`);
      await reload();
    } catch (error) {
      setStatus(error instanceof HttpError && error.code === "file_too_large" ? error.message : failureText(error));
    }
  };

  if (load.status === "missing") return <Missing />;
  if (load.status === "failed") return <Failed message={load.message} />;
  return (
    <main className="column wide">
      <header className="page-head">
        <p className="eyebrow">Venue files</p>
        <h1>Files</h1>
        <p className="muted">Briefs up to 10,485,760 bytes, venue photos (JPEG or PNG) up to 12,582,912 bytes and GLB models up to 26,214,400 bytes.</p>
      </header>
      <div className="upload-row">
        {KINDS.map((k) => (
          <span key={k.kind}>
            <button type="button" className="button" style={{ width: "100%" }} onClick={() => inputs.current[k.kind]?.click()}><Icon name="upload" /> {k.button}</button>
            <input ref={(el) => { inputs.current[k.kind] = el; }} type="file" accept={k.accept} hidden tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(k.kind, file);
              }} />
          </span>
        ))}
      </div>
      <p role="status" aria-label="Upload status" className="status-line" style={{ marginTop: 16 }}>{status}</p>
      <section className="section" aria-labelledby="files-title">
        <h2 id="files-title">Stored files</h2>
        {load.status === "loading" && <Skeleton rows={2} />}
        {load.status === "ready" && (load.data.files.length ? (
          <ul className="list" aria-label="Files">
            {load.data.files.map((f) => (
              <li key={f.id}>
                <div className="section-head"><strong style={{ fontWeight: 400 }}>{f.fileName}</strong><span className="badge on">Stored</span></div>
                <p className="muted">{KINDS.find((k) => k.kind === f.kind)?.label} · {f.sizeBytes} bytes</p>
                <p className="mono-hash">SHA-256 {f.sha256}</p>
              </li>
            ))}
          </ul>
        ) : <Empty question="No files yet. Add a venue photo?" drawing="tray" />)}
      </section>
      <section className="section" aria-label="Commission pages"><CommissionLinks id={id} /></section>
    </main>
  );
}
