// Console upload (brief: Interactions, Uploading; Feedback states, Upload). Files go one at a time as raw
// PUTs; each file keeps one idempotency key across automatic retries after a dropped connection.
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatCount, formatRegionCount, shortVersion } from "../shared/format";
import { ApiError, type Bucket, type ErrorBody, MUTATION_HEADERS, type ObjectMeta, type StoredObject, api, query, signInUrl } from "./api";
import type { Scope } from "./console";
import { STORAGE_OUTAGE } from "./copy";
import { Dialog, Field } from "./dialog";
import { Icon } from "./icons";

export type UploadTarget = { kind: "files"; prefix: string } | { kind: "version"; key: string; etag: string };

const ATTEMPTS = 3;
const TAGS_COPY = "These tags break the tag limits for an object.";

interface Queued {
  file: File;
  idempotencyKey: string;
  bytes: ArrayBuffer | null;
}

type Answer = { status: number; body: unknown } | "aborted" | "unreachable";

// "env=qa, team=art" → URL query encoding for x-amz-tagging.
function taggingHeader(tags: string): string {
  return tags
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf("=");
      const [key, value] = at < 0 ? [pair, ""] : [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");
}

function storedCopy(result: StoredObject): string {
  const pending = result.replicas.filter((r) => r.role === "replica" && r.state === "pending").length;
  const base = `Stored ${result.key} as version ${shortVersion(result.version_id)}.`;
  return pending === 0 ? base : `${base} Copies pending in ${formatRegionCount(pending)}.`;
}

interface UploadDialogProps {
  scope: Scope;
  bucket: Bucket;
  files: File[];
  target: UploadTarget;
  status: string;
  onStatus: (text: string) => void;
  onStored: (result: StoredObject) => void;
  onClose: () => void;
}

export function UploadDialog({ scope, bucket, files, target, status, onStatus, onStored, onClose }: UploadDialogProps): JSX.Element {
  const [queue, setQueue] = useState<Queued[]>(() => files.map((file) => ({ file, idempotencyKey: crypto.randomUUID(), bytes: null })));
  const [prefix, setPrefix] = useState(target.kind === "files" ? target.prefix : "");
  const [tags, setTags] = useState("");
  const [onlyOpened, setOnlyOpened] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [confirmStop, setConfirmStop] = useState(false);
  const [tagError, setTagError] = useState("");
  const request = useRef<XMLHttpRequest | null>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const objectPath = `/api/w/${scope.ws}/buckets/${bucket.name}/object`;

  // Each file is read once when the dialog opens: Start upload then sends at once, and every retry sends
  // exactly the bytes of the first attempt.
  useEffect(() => {
    void Promise.all(files.map((file) => file.arrayBuffer())).then((contents) =>
      setQueue((entries) => entries.map((entry) => ({ ...entry, bytes: contents[files.indexOf(entry.file)] ?? null }))),
    );
  }, []);

  useLayoutEffect(() => {
    if (confirmStop) keepButton.current?.focus();
  }, [confirmStop]);

  const attempt = (entry: Queued, key: string, bytes: ArrayBuffer): Promise<Answer> =>
    new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      request.current = xhr;
      xhr.open("PUT", objectPath + query({ key }));
      const headers: Record<string, string> = {
        ...MUTATION_HEADERS,
        "Content-Type": entry.file.type || "application/octet-stream",
        "X-Upload-Size": String(entry.file.size),
        "Idempotency-Key": entry.idempotencyKey,
      };
      const tagging = taggingHeader(tags);
      if (tagging) headers["x-amz-tagging"] = tagging;
      if (target.kind === "version" && onlyOpened) headers["If-Match"] = target.etag;
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (event) => {
        setProgress({ sent: event.loaded, total: entry.file.size });
        onStatus(`Uploading ${entry.file.name}: ${formatCount(event.loaded)} of ${formatCount(entry.file.size)} bytes`);
      };
      xhr.onload = () => {
        if (xhr.status === 0) {
          resolve("unreachable");
          return;
        }
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => resolve("unreachable");
      xhr.onabort = () => resolve("aborted");
      xhr.send(bytes);
    });

  const sendFile = async (entry: Queued, key: string, bytes: ArrayBuffer): Promise<Answer> => {
    for (let n = 1; ; n++) {
      const answer = await attempt(entry, key, bytes);
      if (answer !== "unreachable" || n === ATTEMPTS) return answer;
    }
  };

  const refusalCopy = async (error: ApiError, file: File, key: string): Promise<string> => {
    const fields = error.body.errors ?? {};
    if (error.code === "validation_failed") {
      if (fields["size"]) return `${file.name} changed while uploading. Nothing was saved; try again.`;
      if (fields["key"]) return `${file.name} has a name Farshore can't store as a key.`;
      if (fields["content"]) return `${file.name} is an SVG with scripts. Farshore doesn't store scripted SVG files.`;
      if (fields["tags"]) {
        setTagError(TAGS_COPY);
        return TAGS_COPY;
      }
      if (fields["metadata"]) return "This file's metadata is over the size limit.";
    }
    if (error.code === "payload_too_large") return `${file.name} is over the single-upload limit. Use a multipart upload through the S3 API.`;
    if (error.code === "precondition_failed") {
      const current = await api<ObjectMeta>("GET", objectPath + query({ key }));
      return `${key} changed since you opened it. Reload to get version ${shortVersion(current.version_id)} before saving.`;
    }
    if (error.code === "not_found" && target.kind === "version") return `${key} was deleted since you opened it. Nothing was saved.`;
    if (error.code === "quota_exceeded") {
      return `${file.name} would put ${scope.workspaceName} over its ${formatCount(error.body.quota_bytes ?? 0)} byte storage limit. Nothing was saved.`;
    }
    if (error.code === "region_offline") {
      const origin = scope.regionName(bucket.placement[0] ?? "");
      return `${bucket.name} can't take uploads while its origin region ${origin} is offline. Nothing was saved; try again later.`;
    }
    return scope.report(error);
  };

  const start = async (): Promise<void> => {
    setUploading(true);
    setTagError("");
    let remaining = queue;
    for (const entry of queue) {
      const key = target.kind === "version" ? target.key : prefix + entry.file.name;
      setProgress({ sent: 0, total: entry.file.size });
      onStatus(`Uploading ${entry.file.name}: 0 of ${formatCount(entry.file.size)} bytes`);
      const answer = await sendFile(entry, key, entry.bytes as ArrayBuffer);
      if (answer === "aborted") return;
      if (answer === "unreachable") {
        onStatus(STORAGE_OUTAGE);
        setUploading(false);
        return;
      }
      if (answer.status === 201) {
        const result = answer.body as StoredObject;
        remaining = remaining.filter((q) => q !== entry);
        setQueue(remaining);
        onStatus(storedCopy(result));
        onStored(result);
        continue;
      }
      if (answer.status === 401) {
        location.assign(signInUrl());
        return;
      }
      // A refused file starts over with a fresh idempotency key once the user changes something.
      setQueue(remaining.map((q) => (q === entry ? { ...q, idempotencyKey: crypto.randomUUID() } : q)));
      onStatus(await refusalCopy(new ApiError(answer.status, answer.body as ErrorBody), entry.file, key));
      setUploading(false);
      return;
    }
    setUploading(false);
    onClose();
  };

  const requestClose = (): void => {
    if (confirmStop) setConfirmStop(false);
    else if (uploading) setConfirmStop(true);
    else onClose();
  };

  const stop = (): void => {
    request.current?.abort();
    onClose();
  };

  return (
    <Dialog title="Upload" onClose={requestClose}>
      <ul class="upload__files" aria-label="Files to upload">
        {queue.map(({ file, idempotencyKey }) => (
          <li key={idempotencyKey} class="upload__file">
            <Icon name="file" />
            <span class="upload__name">{file.name}</span>
            <span class="num upload__size">{formatCount(file.size)} bytes</span>
          </li>
        ))}
      </ul>
      {target.kind === "files" ? (
        <Field label="Key prefix">
          {(described, id) => (
            <input id={id} class="mono-input" value={prefix} spellcheck={false} aria-describedby={described} disabled={uploading}
              onInput={(e) => setPrefix(e.currentTarget.value)} />
          )}
        </Field>
      ) : (
        <p class="upload__target">
          Saves as <span class="mono">{target.key}</span>
        </p>
      )}
      <Field label="Tags" hint="key=value, separated by commas" error={tagError}>
        {(described, id) => (
          <input id={id} class="mono-input" value={tags} spellcheck={false} aria-describedby={described} disabled={uploading}
            aria-invalid={tagError ? true : undefined} onInput={(e) => setTags(e.currentTarget.value)} />
        )}
      </Field>
      {target.kind === "version" && (
        <label class="choice">
          <input type="checkbox" checked={onlyOpened} disabled={uploading} onChange={(e) => setOnlyOpened(e.currentTarget.checked)} />
          <span>Only overwrite the version I opened</span>
        </label>
      )}
      <progress class="upload__progress" aria-label="Upload progress" max={Math.max(progress.total, 1)} value={progress.sent} />
      <p class="upload__line" aria-hidden="true">
        {status}
      </p>
      {confirmStop ? (
        <div class="confirm">
          <p class="confirm__question">Stop uploading? Files already stored stay stored.</p>
          <div class="form__actions">
            <button type="button" class="button" onClick={stop}>
              Stop
            </button>
            <button ref={keepButton} type="button" class="button button--primary" onClick={() => setConfirmStop(false)}>
              Keep uploading
            </button>
          </div>
        </div>
      ) : (
        <div class="form__actions">
          <button type="button" class="button" onClick={requestClose}>
            Cancel
          </button>
          <button type="button" class="button button--primary" disabled={uploading || queue.length === 0 || queue.some((entry) => entry.bytes === null)} onClick={() => void start()}>
            <Icon name="upload" />
            Start upload
          </button>
        </div>
      )}
    </Dialog>
  );
}
