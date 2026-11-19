// The uploads panel, docked at the bottom of the centre pane whenever an upload exists.
import { useStore } from "../store";
import { Icon } from "../icons";
import { cancel, dismiss, pause, progress, resume, uploads, type UploadRow } from "./manager";

function label(row: UploadRow): string {
  switch (row.state) {
    case "uploading": return `Uploading ${progress(row)}%`;
    case "paused": return "Paused";
    case "waiting": return "Waiting for storage";
    case "done": return "Done";
    case "expired": return "Expired";
  }
}

export function UploadsPanel() {
  const rows = useStore(uploads);
  if (!rows.length) return null;
  return (
    <section aria-label="Uploads" className="uploads">
      <h2 className="pane-title uploads-title">Uploads</h2>
      <ul className="upload-rows">
        {rows.map((row) => {
          const value = row.state === "done" ? 100 : progress(row);
          return (
            <li key={row.key} className={`upload-row state-${row.state}`}>
              <span className="upload-name">{row.name}</span>
              <span className={`upload-state${row.state === "expired" || row.state === "waiting" ? " warn" : ""}`}>{label(row)}</span>
              <div role="progressbar" aria-label={row.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="progress">
                <span className="progress-fill" style={{ transform: `scaleX(${value / 100})` }} />
              </div>
              <span className="upload-actions">
                {(row.state === "uploading" || row.state === "waiting") && (
                  <button type="button" className="icon-text" aria-label={`Pause ${row.name}`} onClick={() => void pause(row.key)}>Pause</button>
                )}
                {row.state === "paused" && (
                  <button type="button" className="icon-text" aria-label={`Resume ${row.name}`} onClick={() => void resume(row.key)}>Resume</button>
                )}
                {(row.state === "uploading" || row.state === "paused" || row.state === "waiting") && (
                  <button type="button" className="icon-text" aria-label={`Cancel ${row.name}`} onClick={() => void cancel(row.key)}>Cancel</button>
                )}
                {(row.state === "done" || row.state === "expired") && (
                  <button type="button" className="icon-text" aria-label={`Dismiss ${row.name}`} onClick={() => void dismiss(row.key)}><Icon name="x" size={14} />Dismiss</button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
