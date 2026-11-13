import { useState } from "react";
import type { Booking, Material, PrepLink } from "../../shared/api";
import { isEnded } from "../../shared/status";
import { useAction } from "../lib/actions";
import { apiPost, apiUpload, fetchFile } from "../lib/api";
import { PENDING, SUCCESS, uploading } from "../lib/copy";
import { dateTimeOf, withCommas } from "../lib/format";
import { announceError, announceStatus } from "../lib/live";

const NO_FILE_MESSAGE = "Choose a file to upload. A non-empty file is required.";

/** Saves a downloaded file under its original name without leaving the page. */
function saveAs(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function DownloadButton({ booking, material }: { booking: Booking; material: Material }) {
  const action = useAction();
  const press = () =>
    void action.run({
      kind: "download",
      pending: PENDING.download,
      work: async () => {
        const link = await apiPost<PrepLink>(`/api/bookings/${booking.id}/materials/${material.id}/link`);
        saveAs(await fetchFile(link.url), material.name);
      },
      success: () => "",
    });
  return (
    <button type="button" className="btn btn--small" aria-label={`Download ${material.name}`} disabled={action.pending} onClick={press}>
      {action.pending ? PENDING.download : "Download"}
    </button>
  );
}

interface PrepProps {
  booking: Booking;
  canUpload: boolean;
  canDownload: boolean;
  onUploaded: () => void;
}

/** Prep materials: the files with their size and upload time, the upload control and the holders' downloads. */
export function PrepPanel({ booking, canUpload, canDownload, onUploaded }: PrepProps) {
  const [fileKey, setFileKey] = useState(0);
  const [chosen, setChosen] = useState<File | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const action = useAction();

  const upload = async () => {
    if (chosen === null) {
      setFieldError(NO_FILE_MESSAGE);
      announceStatus("");
      announceError(NO_FILE_MESSAGE);
      return;
    }
    setFieldError(null);
    const material = await action.run({
      kind: "upload",
      pending: uploading(chosen.name),
      work: () => apiUpload<Material>(`/api/bookings/${booking.id}/materials`, chosen),
      success: (stored) => SUCCESS.attached(stored.name),
    });
    if (material !== undefined) {
      setChosen(null);
      setFileKey((key) => key + 1);
      onUploaded();
    }
  };

  return (
    <section className="panel" aria-labelledby="prep-heading">
      <h3 id="prep-heading" className="section-label">
        Prep materials
      </h3>
      {booking.materials.length === 0 ? (
        <p className="empty-note">{canDownload || canUpload ? "No files attached yet." : "Prep materials appear here once you hold a seat."}</p>
      ) : (
        <ul className="files">
          {booking.materials.map((material) => (
            <li key={material.id} className="file">
              <span className="file-name">{material.name}</span>
              <span className="file-meta mono">
                {withCommas(material.size_bytes)} bytes · {dateTimeOf(material.uploaded_at)}
              </span>
              {canDownload ? <DownloadButton booking={booking} material={material} /> : null}
            </li>
          ))}
        </ul>
      )}
      {canUpload && !isEnded(booking.status) ? (
        <div className="upload">
          <label htmlFor="attach-input" className="field-label">
            Attach prep material
          </label>
          <input
            key={fileKey}
            id="attach-input"
            type="file"
            className="file-input"
            aria-describedby={fieldError ? "attach-error" : undefined}
            onChange={(event) => {
              setChosen(event.target.files?.[0] ?? null);
              setFieldError(null);
            }}
          />
          {fieldError ? (
            <p id="attach-error" className="field-error">
              {fieldError}
            </p>
          ) : null}
          <button type="button" className="btn" disabled={action.pending} onClick={() => void upload()}>
            {action.pending && chosen ? uploading(chosen.name) : "Upload"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
