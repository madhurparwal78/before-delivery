import { useRef } from "react";
import { publishStateText } from "../../../shared/notices.js";
import { isLive } from "../../../shared/publishing.js";
import type { VersionSummary } from "../../../shared/types.js";
import { Icon } from "../../ui/icons.js";
import { wrapTab } from "../../ui/Dialog.js";
import { useEditor, type Panel } from "../context.js";
import { CollectionPanel } from "./Collection.js";
import { CommentsBody } from "./Comments.js";
import { TokensPanel } from "./Tokens.js";

const TITLE: Record<Panel, string> = { tokens: "Tokens", collection: "Collection", images: "Images", history: "History", comments: "Comments", publish: "Publish" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** History line: `<version name> · <author name> · <d Mon yyyy, HH:mm> UTC`. */
function versionLine(v: VersionSummary): string {
  const at = new Date(v.createdAt);
  const month = MONTHS[at.getUTCMonth()];
  const time = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
  return `${v.name} · ${v.author.name} · ${at.getUTCDate()} ${month} ${at.getUTCFullYear()}, ${time} UTC`;
}

function ImagesPanel() {
  const { state, act } = useEditor();
  return (
    <>
      <label className={`pl-file${state.busy.upload ? " pl-busy" : ""}`}>
        <Icon name="upload" />
        <span>Image file</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Image file"
          aria-busy={state.busy.upload || undefined}
          disabled={state.busy.upload}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            act.upload(files);
          }}
        />
      </label>
      <p className="pl-hint">PNG, JPEG or WebP, up to 5,000,000 bytes. An image can be placed once storage confirms it.</p>
      <ul aria-label="Images" className="pl-image-list">
        {state.images.map((image) => (
          <li key={image.id}>
            <img src={`/api/images/${image.id}`} alt="" />
            <span>{image.fileName}</span>
            <span className="pl-mono pl-muted">
              {image.width}×{image.height}
            </span>
          </li>
        ))}
      </ul>
      {state.images.length === 0 && <p className="pl-panel-empty">No images yet.</p>}
    </>
  );
}

function HistoryPanel() {
  const { state, act } = useEditor();
  const versions = state.versions;
  return (
    <>
      {versions === null ? (
        <p className="pl-panel-empty">Loading versions…</p>
      ) : versions.length === 0 ? (
        <p className="pl-panel-empty">No saved versions yet. Save version keeps the whole site as it is now.</p>
      ) : null}
      <ul aria-label="Versions" className="pl-versions">
        {(versions ?? []).map((v) => (
          <li key={v.id}>
            <a
              href={`/w/${state.workspaceId}/edit?version=${v.id}&page=${state.page.id}`}
              onClick={(e) => {
                e.preventDefault();
                act.openVersion(v.id);
              }}
            >
              {versionLine(v)}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PublishBody({ readOnly }: { readOnly: boolean }) {
  const { state, act } = useEditor();
  const status = state.publishStatus;
  const live = isLive(status?.state);
  return (
    <>
      <p id="publish-state" tabIndex={-1} className={`pl-publish-state pl-state-${status?.state ?? "loading"}`}>
        {status ? publishStateText[status.state] : "Checking…"}
      </p>
      {live && status?.url && (
        <p className="pl-live-address">
          <Icon name="globe" />
          <a href={status.url} target="_blank" rel="noreferrer">
            {status.url}
          </a>
        </p>
      )}
      {status?.publishedSeq !== null && status?.publishedSeq !== undefined && (
        <p className="pl-muted">
          Published from <span className="pl-mono">seq {status.publishedSeq}</span>
        </p>
      )}
      {!readOnly && (
        <div className="pl-publish-actions">
          <button type="button" className="pl-primary" onClick={() => act.openDialog({ kind: "publish" })} aria-busy={state.busy.publish || undefined} disabled={state.busy.publish}>
            Publish
          </button>
          {state.publishFailed && (
            <button type="button" className="pl-button" onClick={act.publish} aria-busy={state.busy.publish || undefined} disabled={state.busy.publish}>
              Try publishing again
            </button>
          )}
          {live && state.role === "owner" && (
            <button type="button" className="pl-button" onClick={act.unpublish}>
              Unpublish
            </button>
          )}
        </div>
      )}
    </>
  );
}

export function Sheet({ panel }: { panel: Panel }) {
  const { act, state } = useEditor();
  const ref = useRef<HTMLElement>(null);
  return (
    <section
      id={`sheet-${panel}`}
      ref={ref}
      role="region"
      aria-label={TITLE[panel]}
      className="pl-sheet"
      onKeyDown={(e) => ref.current && wrapTab(e, ref.current)}
    >
      <div className="pl-panel-head">
        <h2 className="pl-panel-title" tabIndex={-1} data-sheet-heading>
          {TITLE[panel]}
        </h2>
        <button type="button" className="pl-icon-button" aria-label={`Close ${TITLE[panel]}`} onClick={act.closePanel}>
          <Icon name="x" />
        </button>
      </div>
      <div className="pl-sheet-body">
        {panel === "tokens" && <TokensPanel />}
        {panel === "collection" && <CollectionPanel />}
        {panel === "images" && <ImagesPanel />}
        {panel === "history" && <HistoryPanel />}
        {panel === "comments" && <CommentsBody />}
        {panel === "publish" && <PublishBody readOnly={state.readOnly} />}
      </div>
    </section>
  );
}
