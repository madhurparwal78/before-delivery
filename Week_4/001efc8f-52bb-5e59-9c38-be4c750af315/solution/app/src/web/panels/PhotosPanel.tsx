import { useCallback, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { api, apiMessage } from "../api";
import { notify } from "../store";
import { Dialog } from "../components/Dialog";
import { TagMark } from "../components/TagMark";
import { useLiveEvent } from "../hooks";
import { channelPath, dropParameter, navigate } from "../route";
import type { Channel, GalleryPhoto, Message } from "../types";

type GalleryPage = { photos: GalleryPhoto[]; next_cursor: string | null };

function galleryPath(channelId: string, before: string | null, limit = 30): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", before);
  return `/api/channels/${channelId}/gallery?${params.toString()}`;
}

// The channel's photos, newest first, as thumbnails.
export function PhotosPanel({ channel }: { channel: Channel }) {
  const [photos, setPhotos] = useState<GalleryPhoto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    api<GalleryPage>("GET", galleryPath(channel.id, null)).then(
      (page) => {
        setPhotos(page.photos);
        setCursor(page.next_cursor);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [channel.id]);
  useEffect(load, [load]);
  useLiveEvent((event) => {
    const data = event.data as { channel_id?: string; message?: { channel_id: string; attachments: unknown[] } };
    if (event.name === "stream.reset") load();
    if (event.name === "message.deleted" && data.channel_id === channel.id) load();
    if (event.name === "message.created" && data.message?.channel_id === channel.id && data.message.attachments.length > 0) load();
  });

  const more = async () => {
    if (!cursor) return;
    try {
      const page = await api<GalleryPage>("GET", galleryPath(channel.id, cursor));
      setPhotos((current) => [...(current ?? []), ...page.photos]);
      setCursor(page.next_cursor);
    } catch (failure) {
      notify(apiMessage(failure));
    }
  };

  return (
    <section className="panel" aria-labelledby="panel-photos">
      <h2 id="panel-photos" className="panel-title">
        Photos
      </h2>
      {photos === null && !failed ? <p className="panel-note">Loading photos…</p> : null}
      {failed ? <p className="panel-note">Could not load the photos.</p> : null}
      {photos?.length === 0 ? (
        <div className="empty-state">
          <TagMark size={48} />
          <p>No photos in #{channel.name} yet. Attach gauge or nameplate photos from the composer.</p>
        </div>
      ) : null}
      {photos && photos.length > 0 ? (
        <ul className="gallery" aria-label="Photos">
          {photos.map((photo) => (
            <li key={photo.attachment_id}>
              <a
                className="gallery-link"
                href={channelPath(channel.id, { photo: photo.attachment_id })}
                aria-label={`Photo ${photo.filename} by ${photo.uploaded_by.name}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(channelPath(channel.id, { photo: photo.attachment_id }));
                }}
              >
                <GalleryThumb src={photo.thumb_url} />
                <span className="gallery-caption" aria-hidden="true">
                  {photo.filename}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {cursor ? (
        <button className="button button-quiet" type="button" onClick={() => void more()}>
          Load more photos
        </button>
      ) : null}
    </section>
  );
}

function GalleryThumb({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="thumb-missing">
        <ImageOff aria-hidden="true" size={20} />
      </span>
    );
  }
  return <img src={src} alt="" onError={() => setBroken(true)} />;
}

type PhotoState =
  | { kind: "loading" }
  | { kind: "ready"; url: string; photo: GalleryPhoto }
  | { kind: "error"; copy: string };

// Finds the photo in this channel's gallery, so a photo from elsewhere is not found here.
async function findInGallery(channelId: string, attachmentId: string): Promise<GalleryPhoto | null> {
  let before: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const body: GalleryPage = await api<GalleryPage>("GET", galleryPath(channelId, before, 100));
    const found = body.photos.find((p) => p.attachment_id === attachmentId);
    if (found) return found;
    if (!body.next_cursor) return null;
    before = body.next_cursor;
  }
  return null;
}

export function PhotoDialog(props: { channel: Channel; attachmentId: string; onGoTo: (message: Message) => void }) {
  const { channel, attachmentId } = props;
  const [state, setState] = useState<PhotoState>({ kind: "loading" });

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    (async () => {
      const photo = await findInGallery(channel.id, attachmentId);
      if (!photo) return setState({ kind: "error", copy: "That was not found." });
      const response = await fetch(photo.url, { credentials: "same-origin" });
      if (response.status === 503) return setState({ kind: "error", copy: "Photo unavailable while storage is unreachable." });
      if (!response.ok) return setState({ kind: "error", copy: "That was not found." });
      url = URL.createObjectURL(await response.blob());
      if (live) setState({ kind: "ready", url, photo });
    })().catch(() => setState({ kind: "error", copy: "That was not found." }));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [channel.id, attachmentId]);

  useLiveEvent((event) => {
    if (event.name !== "message.deleted" || state.kind !== "ready") return;
    if ((event.data as { message_id: string }).message_id === state.photo.message_id) setState({ kind: "error", copy: "That was not found." });
  });

  const goTo = async () => {
    if (state.kind !== "ready") return;
    const { message } = await api<{ message: Message }>("GET", `/api/messages/${state.photo.message_id}`);
    props.onGoTo(message);
  };

  return (
    <Dialog title="Photo" onClose={dropParameter} wide>
      <div className="photo-frame">
        {state.kind === "loading" ? <div className="photo-placeholder" aria-hidden="true" /> : null}
        {state.kind === "error" ? <p className="panel-note">{state.copy}</p> : null}
        {state.kind === "ready" ? (
          <figure>
            <img src={state.url} alt={state.photo.filename} />
            <figcaption>
              {state.photo.filename} · {state.photo.uploaded_by.name}
            </figcaption>
          </figure>
        ) : null}
      </div>
      <div className="dialog-actions">
        <button className="button button-primary" type="button" onClick={() => void goTo()} disabled={state.kind !== "ready"}>
          Go to message
        </button>
        <button className="button button-quiet" type="button" onClick={dropParameter}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
