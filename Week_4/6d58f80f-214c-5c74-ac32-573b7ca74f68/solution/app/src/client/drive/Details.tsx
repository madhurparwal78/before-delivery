// The details panel (brief: Screens and layout; DP-24): facts, preview, people with access and the activity
// ledger, newest first, with mono Phoenix times.
import { useEffect, useRef, useState } from "react";
import { api, ApiError, query } from "../api";
import { changes, coalesce, folders as folderStore, serviceStatus, session } from "../data";
import { useStore } from "../store";
import { formatSize, grantDaysLeft, kindOf, phoenixMinute, filesWord } from "../format";
import { FOOTNOTE, NO_PREVIEW, PREVIEW_OUTAGE } from "../copy";
import { SheetThumb } from "../drawings";
import { Icon } from "../icons";
import { HIDDEN_FOLDER_NAME, mayShare } from "../../shared/rules";
import type { DriveFile, Folder, Grant, LedgerEntry, Named } from "../../shared/api";

export type DetailsTarget = { kind: "file" | "folder"; id: string } | null;

const folderName = (f: { name: string } | undefined) => f?.name ?? HIDDEN_FOLDER_NAME;

/** One sentence per entry; in a folder's activity a file is named, in a file's own activity it is "this file". */
function sentence(entry: LedgerEntry, onFile: boolean): string {
  const d = entry.detail;
  const it = onFile ? "this file" : d.name ?? "a file";
  switch (entry.action) {
    case "uploaded": return `uploaded ${it} to ${folderName(d.folder)}`;
    case "renamed": return `renamed ${d.oldName ?? "it"} to ${d.newName ?? ""}`;
    case "moved": return `moved ${it} from ${folderName(d.from)} to ${folderName(d.to)}`;
    case "locked": return `locked ${it}`;
    case "unlocked": return `unlocked ${it}`;
    case "binned": return `moved ${it} from ${folderName(d.folder)} to the bin`;
    case "restored": return `restored ${it} to ${folderName(d.folder)}`;
    case "purged": return `deleted ${d.name ?? "a file"} for good`;
    case "folder_created": return `created ${d.name ?? "this folder"}`;
    case "shared": return `shared ${d.item?.name ?? "this"} with ${d.person?.name ?? ""} as ${d.role ?? ""} until ${d.endDate ?? ""}`;
    case "access_changed": return `made ${d.person?.name ?? ""} ${d.role ?? ""} on ${d.item?.name ?? "this"} until ${d.endDate ?? ""}`;
    case "access_removed": return `removed ${d.person?.name ?? ""} from ${d.item?.name ?? "this"}`;
    case "access_ended": return `ended ${d.person?.name ?? ""}'s ${d.role ?? ""} access to ${d.item?.name ?? "this"}`;
    case "handover_offered": return `offered this project to ${d.to?.name ?? ""} until ${d.lapseDate ?? ""}`;
    case "handover_accepted": return `accepted this project from ${d.from?.name ?? ""}`;
    case "handover_declined": return `declined this project from ${d.from?.name ?? ""}`;
    case "handover_lapsed": return `lapsed the handover of this project to ${d.to?.name ?? ""}`;
    case "policy_scheduled": return `scheduled a policy change from ${d.effectiveFrom ?? ""}`;
    case "policy_withdrawn": return `withdrew the policy change from ${d.effectiveFrom ?? ""}`;
  }
}

// pdf.js's legacy build: it runs on current browsers without the newest language features.
type PdfModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfModule> | null = null;

function loadPdf(): Promise<PdfModule> {
  pdfjs ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjs;
}

function PdfCanvas({ url, name }: { url: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) return;
      const data = new Uint8Array(await response.arrayBuffer());
      const lib = await loadPdf();
      const doc = await lib.getDocument({ data, verbosity: 0 }).promise;
      const page = await doc.getPage(1);
      const target = canvas.current;
      if (cancelled || !target) return;
      const width = target.parentElement?.clientWidth ?? 280;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * Math.min(2, devicePixelRatio || 1) });
      target.width = viewport.width;
      target.height = viewport.height;
      const context = target.getContext("2d");
      if (!context) return;
      await page.render({ canvas: target, canvasContext: context, viewport }).promise;
      if (!cancelled) setReady(true);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <div className={`preview-sheet${ready ? " is-ready" : ""}`}>
      {!ready && <SheetThumb name={name} />}
      <canvas ref={canvas} role="img" aria-label={name} />
    </div>
  );
}

function Preview({ file }: { file: DriveFile }) {
  const status = useStore(serviceStatus);
  const [state, setState] = useState<{ url: string } | "loading" | "outage" | "none">("loading");
  useEffect(() => {
    if (!file.previewable) {
      setState("none");
      return;
    }
    if (status.storage === "down") {
      setState("outage");
      return;
    }
    let cancelled = false;
    setState("loading");
    api<{ url: string }>("POST", `/api/files/${file.id}/links`, { purpose: "preview" }).then((link) => {
      if (!cancelled) setState({ url: link.url });
    }, (failure: unknown) => {
      if (!cancelled && failure instanceof ApiError && failure.code === "storage_unavailable") setState("outage");
    });
    return () => {
      cancelled = true;
    };
  }, [file.id, file.previewable, file.modifiedAt, status.storage]);
  return (
    <section aria-label="Preview" className="preview">
      {state === "none" && <p className="preview-note">{NO_PREVIEW}</p>}
      {state === "outage" && <><SheetThumb name={file.name} /><p className="preview-note warn">{PREVIEW_OUTAGE}</p></>}
      {state === "loading" && <div className="preview-sheet"><SheetThumb name={file.name} /></div>}
      {typeof state === "object" && (file.contentType.startsWith("image/")
        ? <img src={state.url} alt={file.name} className="preview-image" />
        : <PdfCanvas url={state.url} name={file.name} />)}
    </section>
  );
}

interface Loaded {
  file: DriveFile | null;
  folder: Folder | null;
  path: Named[];
  entries: LedgerEntry[];
  grants: Grant[];
}

export function Details({ target, onGone, onHandOver, onClose }: {
  target: DetailsTarget; onGone: () => void; onHandOver: (folder: Folder) => void; onClose?: () => void;
}) {
  const me = useStore(session);
  const all = useStore(folderStore);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const staff = me?.kind === "staff";
  const gone = useRef(onGone);
  gone.current = onGone;

  const load = useRef<() => void>(() => undefined);
  load.current = () => {
    if (!target) {
      setLoaded(null);
      return;
    }
    const base = target.kind === "file" ? `/api/files/${target.id}` : `/api/folders/${target.id}`;
    void Promise.all([
      api<{ file?: DriveFile; folder?: Folder; path: Named[] }>("GET", base),
      api<{ entries: LedgerEntry[] }>("GET", `${base}/activity`),
      staff ? api<{ grants: Grant[] }>("GET", `/api/grants${query({ itemType: target.kind, itemId: target.id })}`) : Promise.resolve({ grants: [] }),
    ]).then(([item, activity, grants]) => {
      setLoaded({ file: item.file ?? null, folder: item.folder ?? null, path: item.path, entries: activity.entries, grants: grants.grants });
    }, (failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 404) {
        setLoaded(null);
        gone.current();
      }
    });
  };

  useEffect(() => {
    setLoaded(null);
    load.current();
  }, [target?.kind, target?.id]);

  useEffect(() => {
    const again = coalesce(() => load.current());
    return changes.on("change", again);
  }, []);

  const file = loaded?.file ?? null;
  const folder = loaded?.folder ?? null;
  const name = file?.name ?? folder?.name ?? "";
  const owningFolder = file ? all.find((f) => f.id === file.folderId) : folder;
  const owner = owningFolder?.owner.name ?? "";
  const canHandOver = folder !== null && me && folder.parentId === null && mayShare(me, folder.owner.id);

  return (
    <div className="details-body">
      <div className="details-head">
        {target ? (
          <div className="title-sheet">
            <div className="ts-cell">
              <span className="ts-label">Name</span>
              <h2 className="pane-title details-name">{name || " "}</h2>
            </div>
            <div className="ts-cell ts-sheet">
              <span className="ts-label">Kind</span>
              <span className="ts-kind">{loaded ? (file ? kindOf(file.contentType) : "Folder") : " "}</span>
            </div>
            {loaded && (
              <dl className="ts-facts">
                <div className="ts-cell ts-wide">
                  <dt className="ts-label">Location</dt>
                  <dd>{(file ? loaded.path : loaded.path.slice(0, -1)).map((p) => p.name).join(" › ") || (file ? file.folderName : staff ? "Projects" : "Shared with me")}</dd>
                </div>
                {file && <div className="ts-cell"><dt className="ts-label">Size</dt><dd className="num">{formatSize(file.size)}</dd></div>}
                {file && <div className="ts-cell"><dt className="ts-label">Modified</dt><dd className="num">{phoenixMinute(file.modifiedAt)}</dd></div>}
                {folder && <div className="ts-cell"><dt className="ts-label">Files</dt><dd className="num">{filesWord(folder.fileCount)}</dd></div>}
                <div className="ts-cell"><dt className="ts-label">Owner</dt><dd>{owner}</dd></div>
                {file && <div className="ts-cell"><dt className="ts-label">Lock</dt><dd>{file.locked ? <span className="badge badge-lock"><Icon name="lock" size={11} />Locked</span> : "Not locked"}</dd></div>}
                {file?.accessEnds && <div className="ts-cell"><dt className="ts-label">Access ends</dt><dd className="num">{file.accessEnds}</dd></div>}
              </dl>
            )}
          </div>
        ) : <h2 className="pane-title details-name">Details</h2>}
        {onClose && <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}><Icon name="x" /></button>}
      </div>
      {!target && <p className="details-hint">Select a file or folder to see its facts, preview and activity.</p>}
      {loaded && (
        <>
          <p className="footnote">{FOOTNOTE}</p>
          {canHandOver && folder && (
            <button type="button" className="button" onClick={() => onHandOver(folder)}><Icon name="users" />Hand over</button>
          )}
          {file && <Preview file={file} />}
          {staff && (
            <section className="details-section">
              <h3 className="section-title">People with access</h3>
              {loaded.grants.length ? (
                <ul className="details-people">
                  {loaded.grants.map((g) => (
                    <li key={g.id}><span>{g.person.name}</span> <span className="muted">{g.role === "editor" ? "Editor" : "Viewer"} · ends <span className="num">{g.endDate}</span> · <span className="num">{grantDaysLeft(g.daysLeft)}</span></span></li>
                  ))}
                </ul>
              ) : <p className="muted">Lintelworks staff only.</p>}
            </section>
          )}
          <section className="details-section">
            <h3 className="section-title" id="activity-title">Activity</h3>
            <ul aria-label="Activity" className="activity">
              {loaded.entries.map((entry) => (
                <li key={entry.id}>
                  <span className="num activity-time">{phoenixMinute(entry.at)}</span>
                  <span><strong>{entry.actor?.name ?? "Lintel Drive"}</strong> {sentence(entry, target?.kind === "file")}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
