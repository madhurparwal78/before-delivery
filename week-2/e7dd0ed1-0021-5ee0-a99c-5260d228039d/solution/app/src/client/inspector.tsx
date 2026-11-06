// The object inspector drawer (brief: Screens and layout, Right inspector; Interactions, Opening objects,
// Versions, Retrying a replica).
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatCount, formatTime, shortVersion } from "../shared/format";
import { isLocked, retentionInForce } from "../shared/locks";
import { ApiError, type Bucket, type LockState, type ObjectMeta, type Replica, type ReplicaRecord, type StoredObject, type Version, api, query } from "./api";
import type { Scope } from "./console";
import { Dialog, Field, Status, reducedMotion, trapTab } from "./dialog";
import { Icon } from "./icons";
import { ReplicaMap } from "./replicaMap";
import { ShareDialog } from "./share";
import { ReplicaWake } from "./wake";

const POLL_MS = 1000;
const ANNOUNCE_GAP_MS = 120;
const NARROW = "(max-width: 767px)";

const isoFromTyped = (typed: string): string => {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(typed.trim());
  return match ? `${match[1]}T${match[2]}Z` : typed;
};

const typedFromIso = (iso: string | null): string => (iso ? formatTime(iso).slice(0, 19) : "");

interface InspectorProps {
  scope: Scope;
  bucket: Bucket;
  meta: ObjectMeta;
  // Opened by the user: the drawer slides in and focus moves to the key. Restored from the address it
  // simply appears.
  focusOnOpen: boolean;
  closing: boolean;
  stored: StoredObject | null;
  onClose: () => void;
  onClosed: () => void;
  onDeleted: () => void;
  onUploadVersion: (file: File, meta: ObjectMeta) => void;
}

export function Inspector(props: InspectorProps): JSX.Element {
  const { scope, bucket, focusOnOpen, closing, stored, onClose, onClosed, onDeleted, onUploadVersion } = props;
  const [meta, setMeta] = useState(props.meta);
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionStatus, setVersionStatus] = useState("");
  const [sharing, setSharing] = useState(false);
  const [retention, setRetention] = useState<Version | null>(null);
  const [doomed, setDoomed] = useState<Version | null>(null);
  const [holds, setHolds] = useState<Record<string, boolean>>({});
  const [, setFrame] = useState(0);
  // Actions and versions wait for the first replica answer, so the map arriving never pushes them down.
  const [polled, setPolled] = useState(false);
  const wake = useRef<ReplicaWake | null>(null);
  const frameRequest = useRef(0);
  const knownVersions = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const key = meta.key;
  const base = `/api/w/${scope.ws}/buckets/${bucket.name}`;
  const canWrite = scope.role !== "viewer";

  const rerender = (): void => setFrame((n) => n + 1);

  // Wake frames run on requestAnimationFrame and read performance.now(); nothing runs once the wake is done.
  const tick = (): void => {
    frameRequest.current = 0;
    wake.current?.step(performance.now());
    rerender();
    if (wake.current?.playingWake) frameRequest.current = requestAnimationFrame(tick);
  };
  const keepPlaying = (): void => {
    if (wake.current?.playingWake && !frameRequest.current) frameRequest.current = requestAnimationFrame(tick);
    speakNext();
  };
  // Each waiting announcement gets its own update of the live region.
  const speaking = useRef(0);
  const speakNext = (): void => {
    if (speaking.current || !wake.current?.announcementsWaiting) return;
    speaking.current = window.setTimeout(() => {
      speaking.current = 0;
      if (wake.current?.nextAnnouncement()) rerender();
      speakNext();
    }, ANNOUNCE_GAP_MS);
  };

  const loadVersions = async (): Promise<void> => {
    const list = (await api<{ versions: Version[] }>("GET", `${base}/object/versions${query({ key })}`)).versions;
    for (const v of list) knownVersions.current.add(v.version_id);
    setVersions(list);
    setHolds({});
  };

  const receive = (record: ReplicaRecord): void => {
    const current = wake.current;
    if (!current) {
      wake.current = new ReplicaWake(record, scope.regionName, reducedMotion());
    } else {
      const newVersion = record.version_id !== current.versionId;
      current.receive(record, performance.now(), newVersion && knownVersions.current.has(record.version_id));
      if (newVersion) {
        void api<ObjectMeta>("GET", `${base}/object${query({ key })}`).then(setMeta);
        void loadVersions();
      }
    }
    rerender();
    keepPlaying();
  };

  useLayoutEffect(() => {
    if (focusOnOpen) heading.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    let timer = 0;
    const poll = async (): Promise<void> => {
      try {
        const record = await api<ReplicaRecord>("GET", `${base}/object/replicas${query({ key })}`);
        if (!live) return;
        receive(record);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return;
      } finally {
        if (live) setPolled(true);
      }
      if (live) timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    void loadVersions();
    return () => {
      live = false;
      clearTimeout(timer);
      cancelAnimationFrame(frameRequest.current);
      clearTimeout(speaking.current);
    };
  }, [key]);

  // This tab stored a new version of the open object.
  useEffect(() => {
    if (stored && stored.key === key) receive(stored);
  }, [stored]);

  const retry = async (region: string): Promise<void> => {
    try {
      await api<Replica>("POST", `${base}/object/replicas/${region}/retry${query({ key })}`);
      wake.current?.retried(region);
      rerender();
      speakNext();
    } catch (error) {
      setVersionStatus(scope.report(error));
    }
  };

  const deleteObject = async (): Promise<void> => {
    try {
      await api("DELETE", `${base}/object${query({ key })}`);
      onDeleted();
    } catch (error) {
      setVersionStatus(scope.report(error));
    }
  };

  const deleteVersion = async (version: Version): Promise<void> => {
    const short = shortVersion(version.version_id);
    setDoomed(null);
    setVersionStatus(`Updating version ${short}…`);
    try {
      await api("DELETE", `${base}/object/version${query({ key, version: version.version_id })}`);
      setVersionStatus(`Version ${short} deleted.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "object_locked") {
        setVersionStatus(
          error.body.legal_hold
            ? `Version ${short} is on legal hold; it can't be deleted.`
            : `Version ${short} is held until ${formatTime(error.body.retain_until ?? "")}; it can't be deleted.`,
        );
      } else {
        setVersionStatus(scope.report(error));
      }
    }
    await loadVersions();
  };

  const toggleHold = async (version: Version, on: boolean): Promise<void> => {
    const short = shortVersion(version.version_id);
    setHolds({ ...holds, [version.version_id]: on });
    setVersionStatus(`Updating version ${short}…`);
    try {
      await api<LockState>("PUT", `${base}/object/legal-hold${query({ key, version: version.version_id })}`, { on });
      setVersionStatus(on ? `Legal hold on for version ${short}.` : `Legal hold off for version ${short}.`);
      await loadVersions();
    } catch (error) {
      setHolds((h) => ({ ...h, [version.version_id]: version.legal_hold }));
      setVersionStatus(scope.report(error));
    }
  };

  const download = (): void => {
    const link = document.createElement("a");
    link.href = `${base}/object/content${query({ key, version: meta.version_id })}`;
    link.download = "";
    link.click();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (drawer.current && matchMedia(NARROW).matches) trapTab(event, drawer.current);
  };

  const current = wake.current;
  const tags = Object.entries(meta.tags);
  const metadata = Object.entries(meta.metadata);
  return (
    <section
      ref={drawer}
      class={closing ? "inspector inspector--closing" : focusOnOpen ? "inspector inspector--entering" : "inspector"}
      role="region"
      aria-label="Object inspector"
      onKeyDown={onKeyDown}
      onAnimationEnd={() => closing && onClosed()}
    >
      <div class="inspector__top">
        <button type="button" class="button button--icon" aria-label="Close inspector" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <h2 ref={heading} class="inspector__key" tabIndex={-1}>
        {key}
      </h2>
      <dl class="facts">
        <div>
          <dt>Version</dt>
          <dd class="mono">{meta.version_id}</dd>
        </div>
        <div>
          <dt>ETag</dt>
          <dd class="mono">{meta.etag}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd class="mono">{formatCount(meta.size)} bytes</dd>
        </div>
        <div>
          <dt>Last modified</dt>
          <dd class="mono">{formatTime(meta.last_modified)}</dd>
        </div>
        <div>
          <dt>Content type</dt>
          <dd>{meta.content_type}</dd>
        </div>
        <div>
          <dt>Tags</dt>
          <dd class="mono">{tags.length ? tags.map(([k, v]) => `${k}=${v}`).join(", ") : "none"}</dd>
        </div>
        <div>
          <dt>Metadata</dt>
          <dd class="mono">{metadata.length ? metadata.map(([k, v]) => `${k}: ${v}`).join(", ") : "none"}</dd>
        </div>
      </dl>
      {current && (
        <ReplicaMap
          pins={current.pins}
          versionId={current.versionId}
          announcement={current.announcement}
          regions={scope.regions}
          canRetry={canWrite}
          onRetry={(region) => void retry(region)}
        />
      )}
      {polled && (
        <>
          <div class="inspector__actions">
            <button type="button" class="button" onClick={download}>
              <Icon name="download" />
              Download
            </button>
            <button type="button" class="button" onClick={() => setSharing(true)}>
              <Icon name="link" />
              Share link
            </button>
            {canWrite && (
              <>
                <button type="button" class="button" onClick={() => fileInput.current?.click()}>
                  <Icon name="upload" />
                  Upload new version
                </button>
                <input ref={fileInput} type="file" hidden onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) onUploadVersion(file, meta);
                }} />
                <button type="button" class="button" onClick={() => void deleteObject()}>
                  <Icon name="trash-2" />
                  Delete object
                </button>
              </>
            )}
          </div>
          <h3 class="inspector__subhead">Versions</h3>
          <ul class="versions" aria-label="Versions">
            {versions.map((version) => {
              const short = shortVersion(version.version_id);
              const now = new Date();
              const held = retentionInForce(version.retain_until, now);
              return (
                <li key={version.version_id} class="version">
                  <p class="version__line mono">
                    {short} · {formatCount(version.size)} bytes · {formatTime(version.created_at)}
                  </p>
                  <p class="version__state">
                    {version.current ? "current" : `noncurrent since ${formatTime(version.noncurrent_since ?? version.created_at)}`}
                    {held && <span class="tag">held until {formatTime(version.retain_until ?? "")}</span>}
                    {version.legal_hold && <span class="tag">legal hold</span>}
                  </p>
                  {canWrite && (
                    <div class="version__actions">
                      {!version.current && !isLocked(version, now) && (
                        <button type="button" class="button button--small" onClick={() => setDoomed(version)}>
                          Delete version<span class="vh"> {short}</span>
                        </button>
                      )}
                      <button type="button" class="button button--small" onClick={() => setRetention(version)}>
                        Retention<span class="vh"> for {short}</span>
                      </button>
                      {scope.role === "owner" && (
                        <label class="choice choice--small">
                          <input type="checkbox" aria-label={`Legal hold on ${short}`}
                            checked={holds[version.version_id] ?? version.legal_hold}
                            onChange={(e) => void toggleHold(version, e.currentTarget.checked)} />
                          <span aria-hidden="true">Legal hold</span>
                        </label>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Status label="Version status" text={versionStatus} />
      {sharing && <ShareDialog scope={scope} bucket={bucket} meta={meta} onClose={() => setSharing(false)} />}
      {retention && (
        <RetentionDialog
          version={retention}
          path={`${base}/object/retention${query({ key, version: retention.version_id })}`}
          onStatus={setVersionStatus}
          report={scope.report}
          onDone={() => {
            setRetention(null);
            void loadVersions();
          }}
          onClose={() => setRetention(null)}
        />
      )}
      {doomed && (
        <Dialog title={`Delete version ${shortVersion(doomed.version_id)} for good? This can't be undone.`} onClose={() => setDoomed(null)}>
          <div class="form__actions">
            <button type="button" class="button" data-autofocus onClick={() => setDoomed(null)}>
              Keep it
            </button>
            <button type="button" class="button button--primary" onClick={() => void deleteVersion(doomed)}>
              Delete version
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

interface RetentionDialogProps {
  version: Version;
  path: string;
  onStatus: (text: string) => void;
  report: (error: unknown) => string;
  onDone: () => void;
  onClose: () => void;
}

function RetentionDialog({ version, path, onStatus, report, onDone, onClose }: RetentionDialogProps): JSX.Element {
  const [typed, setTyped] = useState(typedFromIso(version.retain_until));
  const [fieldError, setFieldError] = useState("");
  const short = shortVersion(version.version_id);

  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    setFieldError("");
    onStatus(`Updating version ${short}…`);
    try {
      const saved = await api<LockState>("PUT", path, { retain_until: isoFromTyped(typed) });
      onStatus(`Version ${short} held until ${formatTime(saved.retain_until ?? "")}.`);
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === "retention_locked") {
        onStatus("Retention can be extended but not shortened.");
      } else if (error instanceof ApiError && error.body.errors?.["retain_until"]) {
        setFieldError(error.body.errors["retain_until"]);
        onStatus(error.body.errors["retain_until"]);
      } else {
        onStatus(report(error));
      }
    }
  };

  return (
    <Dialog title="Retention" onClose={onClose}>
      <form class="form" onSubmit={save}>
        <p class="dialog__lead">
          Version <span class="mono">{short}</span> can be extended but never shortened.
        </p>
        <Field label="Retain until (UTC)" hint="YYYY-MM-DD HH:MM:SS" error={fieldError}>
          {(described, id) => (
            <input id={id} class="mono-input" value={typed} placeholder="YYYY-MM-DD HH:MM:SS" spellcheck={false}
              aria-describedby={described} aria-invalid={fieldError ? true : undefined}
              onInput={(e) => setTyped(e.currentTarget.value)} />
          )}
        </Field>
        <div class="form__actions">
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button button--primary">
            Save retention
          </button>
        </div>
      </form>
    </Dialog>
  );
}
