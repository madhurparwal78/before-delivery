import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { CHUNK_BYTES } from "../../shared/limits";
import type { MediaRecord, UploadRecord } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { checksumColour } from "../lib/format";
import { notify, setBanner } from "../lib/notices";
import { hashFile } from "../lib/sha256";
import { useShell } from "../lib/session";
import { Dialog, Field, Page, useDialogState } from "../ui";

interface Progress {
  key: string;
  name: string;
  percent: number;
  mode: "resume" | "hashing" | "uploading";
}

const UPLOAD_FOLDER = "Uploads";

async function listAllMedia(query: string): Promise<MediaRecord[]> {
  const found: MediaRecord[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (query) params.set("q", query);
    if (cursor) params.set("cursor", cursor);
    const page: { items: MediaRecord[]; next_cursor: string | null } = await api.get(`/api/media?${params.toString()}`);
    found.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return found;
}

export function Library(): ReactNode {
  const { session } = useShell();
  const [media, setMedia] = useState<MediaRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [queryError, setQueryError] = useState<string | undefined>();
  const [progress, setProgress] = useState<Progress[]>([]);
  const deleting = useDialogState();
  const [target, setTarget] = useState<MediaRecord | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (text: string): Promise<void> => {
    const mine = ++sequence.current;
    try {
      const items = await listAllMedia(text);
      if (mine !== sequence.current) return;
      setQueryError(undefined);
      setMedia(items);
    } catch (error) {
      if (mine === sequence.current && error instanceof ApiError) setQueryError(error.fields["q"] ?? error.message);
    }
  }, []);

  const loadOpenUploads = useCallback(async (): Promise<void> => {
    const { items } = await api.get<{ items: UploadRecord[] }>("/api/uploads");
    setProgress((current) => [
      ...current.filter((item) => item.mode !== "resume"),
      ...items.map((upload): Progress => ({
        key: upload.sha256,
        name: upload.file_name,
        percent: Math.floor((upload.chunks_received.length / upload.chunks) * 100),
        mode: "resume",
      })),
    ]);
  }, []);

  useEffect(() => {
    void load("");
    if (session.isOwner) void loadOpenUploads();
  }, [load, loadOpenUploads, session.isOwner]);

  const patch = (key: string, change: Partial<Progress> | null): void =>
    setProgress((current) => (change ? current.map((item) => (item.key === key ? { ...item, ...change } : item)) : current.filter((item) => item.key !== key)));

  const upload = async (file: File): Promise<void> => {
    const key = `${file.name}:${file.size}`;
    setProgress((current) => [...current.filter((item) => item.name !== file.name), { key, name: file.name, percent: 0, mode: "hashing" }]);
    try {
      const sha256 = await hashFile(file);
      const started = await api.post<{ duplicate?: boolean; media?: MediaRecord; upload_id?: string; chunks?: number; chunks_received?: number[] }>("/api/uploads", {
        file_name: file.name,
        bytes: file.size,
        sha256,
        folder: UPLOAD_FOLDER,
      });
      if (started.duplicate && started.media) {
        notify(`${file.name} is already in the library as ${started.media.name}.`);
        patch(key, null);
        return;
      }
      const { upload_id: id = "", chunks = 0, chunks_received: received = [] } = started;
      const have = new Set(received);
      patch(key, { mode: "uploading", percent: Math.floor((have.size / chunks) * 100) });
      notify(`Uploading ${file.name} — ${Math.floor((have.size / chunks) * 100)}%`);
      for (let n = 0; n < chunks; n += 1) {
        if (have.has(n)) continue;
        await api.putRaw(`/api/uploads/${id}/chunks/${n}`, file.slice(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES), "application/octet-stream");
        have.add(n);
        const percent = Math.floor((have.size / chunks) * 100);
        patch(key, { percent });
        notify(`Uploading ${file.name} — ${percent}%`);
      }
      const done = await api.post<{ duplicate: boolean; media: MediaRecord }>(`/api/uploads/${id}/complete`);
      notify(done.duplicate ? `${file.name} is already in the library as ${done.media.name}.` : `${file.name} is in the library.`);
      setBanner("storage", null);
    } catch (error) {
      if (error instanceof ApiError) {
        notify(error.message);
        if (error.code === "storage_unavailable") setBanner("storage", error.message);
      } else throw error;
    } finally {
      patch(key, null);
      await load(query);
      await loadOpenUploads();
    }
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    for (const file of files) await upload(file);
  };

  const remove = async (item: MediaRecord): Promise<void> => {
    try {
      await api.del(`/api/media/${item.id}`);
      notify(`${item.name} deleted.`);
      deleting.hide();
      await load(query);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      notify(error.message);
      setDeleteError(error.message);
    }
  };
  const [deleteError, setDeleteError] = useState("");

  const folders = groupByFolder(media ?? []);
  const empty = media !== null && media.length === 0;

  return (
    <Page>
      <div className="library-tools band-row">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void load(query);
          }}
        >
          <Field label="Search media" name="q" error={queryError}>
            {(a11y) => (
              <input
                {...a11y}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  void load(event.target.value);
                }}
              />
            )}
          </Field>
        </form>
        {session.isOwner ? (
          <label className="file-choose">
            <span className="button-like">Upload files</span>
            <input type="file" multiple className="visually-hidden" onChange={(event) => void choose(event)} />
          </label>
        ) : null}
      </div>
      <ul aria-label="Uploads" className="uploads">
        {progress.map((item) => {
          const text =
            item.mode === "resume"
              ? `${item.name} — ${item.percent}% · choose the file again to resume`
              : item.mode === "hashing"
                ? `Reading ${item.name}…`
                : `Uploading ${item.name} — ${item.percent}%`;
          return (
            <li key={item.key}>
              <div role="progressbar" aria-label={item.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.percent} aria-valuetext={text} className="progress">
                <span className="progress-fill" style={{ width: `${item.percent}%` }} />
                <span className="progress-text tnum">{text}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {empty ? <p className="empty">{query ? `No files match ${query}.` : "No files yet. Upload rushes to start the library."}</p> : null}
      <section role="region" aria-label="Media library" className="library sheet">
        {media === null ? <div className="sheet-frame loading" /> : null}
        {folders.map(([folder, files]) => (
          <div role="group" aria-label={folder} key={folder} className="folder" style={{ ["--span" as string]: files.length }}>
            <p className="folder-title">{folder}</p>
            <p className="muted folder-used">{usedIn(files)}</p>
            <div className="files">
              {files.map((file) => (
                <MediaTile
                  key={file.id}
                  file={file}
                  canDelete={session.isOwner}
                  onDelete={(opener) => {
                    setTarget(file);
                    setDeleteError("");
                    deleting.show(opener);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
      {deleting.open && target ? (
        <Dialog title="Delete media" opener={deleting.opener} onClose={deleting.hide}>
          <p>{target.name}</p>
          {deleteError ? <p className="field-error">Error: {deleteError}</p> : null}
          <div className="actions">
            <button type="button" data-autofocus="" onClick={deleting.hide}>
              Keep
            </button>
            <button type="button" onClick={() => void remove(target)}>
              Delete
            </button>
          </div>
        </Dialog>
      ) : null}
    </Page>
  );
}

function groupByFolder(media: readonly MediaRecord[]): [string, MediaRecord[]][] {
  const folders = new Map<string, MediaRecord[]>();
  for (const file of media) folders.set(file.folder, [...(folders.get(file.folder) ?? []), file]);
  return [...folders];
}

const usedIn = (files: readonly MediaRecord[]): string => {
  const titles = [...new Set(files.flatMap((file) => file.used_in))].sort();
  return titles.length ? `Used in ${titles.join(", ")}` : "Not used yet";
};

function MediaTile({ file, canDelete, onDelete }: { file: MediaRecord; canDelete: boolean; onDelete: (opener: HTMLElement) => void }): ReactNode {
  return (
    <div data-media-id={file.id} className="tile">
      {file.kind === "wav" ? (
        <Waveform id={file.id} name={file.name} />
      ) : (
        <div
          className="media-box"
          role="img"
          aria-label={`${file.name}, ${file.width} by ${file.height}`}
          style={{ aspectRatio: `${file.width ?? 16} / ${file.height ?? 9}`, background: checksumColour(file.sha256) }}
        />
      )}
      <p className="tile-name">{file.name}</p>
      {canDelete ? (
        <button type="button" aria-label={`Delete ${file.name}`} onClick={(event) => onDelete(event.currentTarget)}>
          Delete
        </button>
      ) : null}
    </div>
  );
}

function Waveform({ id, name }: { id: string; name: string }): ReactNode {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .get<{ peaks: number[] }>(`/api/media/${id}/peaks`)
      .then((result) => alive && setPeaks(result.peaks))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  const path = (peaks ?? []).map((peak, index) => `M${index} ${48 - peak * 48}V${48 + peak * 48}`).join("");
  return (
    <svg className="waveform" role="img" aria-label={`${name} waveform`} viewBox="0 0 1000 96" preserveAspectRatio="none" height={96}>
      <path d={path} stroke="#ffffff" strokeWidth={1} fill="none" />
    </svg>
  );
}
