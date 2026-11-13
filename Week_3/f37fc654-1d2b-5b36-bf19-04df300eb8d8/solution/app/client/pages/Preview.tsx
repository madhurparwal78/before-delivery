// `/c/<commission id>/preview` — request an AI concept preview of the piece in the venue photo.
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/icons";
import { AppLink } from "../components/Shell";
import { HttpError, call } from "../lib/api";
import { onEvent } from "../lib/events";
import { CommissionLinks, Empty, Failed, Missing, Skeleton, failureText, useLoad, useScene, type Commission } from "./common";
import type { StoredFile } from "./Files";

interface Render { id: string; state: string; progress: number; failureReason: string | null; previewSha256: string | null }

function statusText(render: Render | null): string {
  if (!render) return "";
  if (render.state === "ready") return "Preview ready.";
  if (render.state === "failed") return "The preview didn't render. Try again with another photo.";
  if (render.state === "callback_verified") return `Preview rendering — ${render.progress}% done.`;
  return "Preview queued.";
}

export function Preview({ id }: { id: string }) {
  useScene("working");
  const [load] = useLoad<Commission>(`/api/commissions/${id}`);
  const [files] = useLoad<{ files: StoredFile[] }>(`/api/commissions/${id}/files`);
  const [photo, setPhoto] = useState("");
  const [reference, setReference] = useState("");
  const [render, setRender] = useState<Render | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const follow = useCallback(async (renderId: string) => {
    const fresh = await call<Render>(`/api/renders/${renderId}`);
    setRender(fresh);
    setStatus(statusText(fresh));
  }, []);

  useEffect(() => {
    if (load.status === "ready" && load.data.latestRender && !render) void follow(load.data.latestRender.id);
  }, [load, render, follow]);

  useEffect(() => {
    if (!render || render.state === "ready" || render.state === "failed") return undefined;
    const timer = setInterval(() => void follow(render.id), 1500);
    const stop = onEvent((event, data) => {
      if (event === "render.updated" && data.renderId === render.id) void follow(render.id);
    });
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [render, follow]);

  const photos = files.status === "ready" ? files.data.files.filter((f) => f.kind === "venue_photo") : [];

  const request = async (): Promise<void> => {
    if (!photo || busy) return;
    setBusy(true);
    try {
      const created = await call<Render>(`/api/commissions/${id}/renders`, { json: { venuePhotoFileId: photo, ...(reference.trim() ? { referenceImageUrl: reference.trim() } : {}) } });
      setRender(created);
      setStatus("Preview queued.");
    } catch (error) {
      setStatus(error instanceof HttpError && error.status === 409 ? "Previews can be requested until the room is held." : failureText(error));
    } finally {
      setBusy(false);
    }
  };

  if (load.status === "missing") return <Missing />;
  if (load.status === "failed") return <Failed message={load.message} />;
  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">{load.status === "ready" ? load.data.title : "Concept preview"}</p>
        <h1>Concept preview</h1>
        <p className="muted">Pick a venue photo and the render partner places the piece in your own room.</p>
      </header>
      {files.status === "loading" && <Skeleton rows={2} />}
      {files.status === "ready" && !photos.length && (
        <Empty question="No files yet. Add a venue photo?" drawing="tray" action={<AppLink href={`/c/${id}/files`} className="button">Add a venue photo</AppLink>} />
      )}
      {photos.length > 0 && (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          void request();
        }}>
          <div role="radiogroup" aria-label="Venue photo" className="photo-choices">
            {photos.map((f) => (
              <label key={f.id} className="option">
                <input type="radio" name="venue-photo" value={f.id} checked={photo === f.id} onChange={() => setPhoto(f.id)} />
                <span>{f.fileName}</span>
              </label>
            ))}
          </div>
          <div className="field">
            <label htmlFor="reference">Reference image address (optional)</label>
            <input id="reference" className="input" type="url" placeholder="https://" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="row-actions">
            <button type="submit" className="button primary" disabled={!photo} aria-busy={busy || undefined}>Request preview <Icon name="arrowRight" /></button>
          </div>
        </form>
      )}
      <section className="section">
        <div role="progressbar" aria-label="Preview progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={render?.state === "ready" ? 100 : render?.progress ?? 0} className="progress">
          <span style={{ width: `${render?.state === "ready" ? 100 : render?.progress ?? 0}%` }} />
        </div>
        <p role="status" aria-label="Preview status" className="status-line">{status}</p>
        {render?.state === "ready" && (
          <>
            <img className="preview-image" src={`/api/renders/${render.id}/preview`} alt="Concept preview" />
            <div className="row-actions"><AppLink href={`/c/${id}/configure`} className="button primary">Configure the room <Icon name="arrowRight" /></AppLink></div>
          </>
        )}
      </section>
      <section className="section" aria-label="Commission pages"><CommissionLinks id={id} /></section>
    </main>
  );
}
