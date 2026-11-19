// Survey assets: the asset rows with their files and download links, and the upload dialog.
import { Download, FolderOpen } from "lucide-react";
import { useId, useState, type DragEvent } from "react";
import type { Asset, AssetKind } from "../api";
import { counted } from "../../../shared/text";
import { Dialog } from "./Dialog";

export const KIND_LABELS: Record<AssetKind, string> = { tileset: "Tileset", terrain: "Terrain", czml: "Flight track" };
const STATE_LABELS = { pending: "Pending", stored: "Stored", rejected: "Rejected" } as const;

export interface PickedFile {
  path: string;
  file: File;
}

interface AssetsPanelProps {
  assets: Asset[];
  expanded: ReadonlySet<string>;
  onToggle: (assetId: string) => void;
  fileUrl: (asset: Asset, path: string) => string;
}

export function AssetsPanel({ assets, expanded, onToggle, fileUrl }: AssetsPanelProps) {
  return (
    <section className="assets" aria-label="Survey assets">
      {assets.length === 0 && <p className="rail-empty">No survey assets declared for this corridor yet.</p>}
      {assets.map((asset) => {
        const open = expanded.has(asset.id);
        return (
          <div className="asset-row" key={asset.id}>
            <div className="head">
              <span>
                {KIND_LABELS[asset.kind]} · {counted(asset.files.length, "file")} ·{" "}
                <span className={asset.state === "stored" ? "stored state-word" : "state-word"}>{STATE_LABELS[asset.state]}</span>
              </span>
              <button type="button" className="button" aria-expanded={open} onClick={() => onToggle(asset.id)}>
                Files
              </button>
            </div>
            {open && (
              <ul className="asset-files">
                {asset.files.map((file) => (
                  <li key={file.path}>
                    {file.state === "stored" ? (
                      <a href={fileUrl(asset, file.path)} download aria-label={`Download ${file.path}`}>
                        <Download size={14} aria-hidden="true" />
                        {file.path}
                      </a>
                    ) : (
                      <span className="mono meta">
                        {file.path} · {STATE_LABELS[file.state]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

function entries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

/** Reads dropped files and folders; a dropped folder's files keep their paths relative to that folder. */
async function droppedFiles(items: DataTransferItemList): Promise<PickedFile[]> {
  const picked: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry instanceof FileSystemFileEntry) {
      const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
      picked.push({ path: `${prefix}${entry.name}`, file });
    } else if (entry instanceof FileSystemDirectoryEntry) {
      for (const child of await entries(entry)) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const item of [...items]) {
    const root = item.webkitGetAsEntry();
    if (root instanceof FileSystemDirectoryEntry) {
      for (const child of await entries(root)) await walk(child, "");
    } else if (root !== null) {
      await walk(root, "");
    }
  }
  return picked;
}

interface UploadDialogProps {
  opener: HTMLElement | null;
  onUpload: (kind: AssetKind, files: PickedFile[]) => Promise<Record<string, string> | null>;
  onClosed: () => void;
}

export function UploadDialog({ opener, onUpload, onClosed }: UploadDialogProps) {
  const ids = useId();
  const [kind, setKind] = useState<AssetKind>("tileset");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState(false);

  const fromInput = (list: FileList | null) =>
    setFiles(
      [...(list ?? [])].map((file) => ({
        path: file.webkitRelativePath === "" ? file.name : file.webkitRelativePath.split("/").slice(1).join("/"),
        file,
      })),
    );

  const drop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    setFiles(await droppedFiles(event.dataTransfer.items));
  };

  return (
    <Dialog title="Upload survey assets" opener={opener} onClosed={onClosed}>
      {(close) => (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            void onUpload(kind, files).then((fields) => {
              setPending(false);
              if (fields === null) close();
              else setErrors(fields);
            });
          }}
        >
          <fieldset className="radio-row" role="radiogroup" aria-label="Asset kind">
            <legend>Asset kind</legend>
            {(Object.keys(KIND_LABELS) as AssetKind[]).map((k) => (
              <label key={k}>
                <input type="radio" name={`${ids}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
                {KIND_LABELS[k]}
              </label>
            ))}
          </fieldset>
          <div
            className={`dropzone${over ? " over" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => void drop(event)}
          >
            <FolderOpen size={22} aria-hidden="true" />
            <label className="button" htmlFor={`${ids}-files`}>
              Files
            </label>
            <span className="meta" id={`${ids}-hint`}>
              Choose files, or drop files and folders here. Folder paths are kept.
            </span>
            <input
              id={`${ids}-files`}
              className="visually-hidden"
              type="file"
              multiple
              aria-describedby={`${ids}-hint`}
              onChange={(event) => fromInput(event.target.files)}
            />
          </div>
          {files.length > 0 && <p className="meta">{counted(files.length, "file")} chosen</p>}
          {Object.entries(errors).map(([key, message]) => (
            <p className="field-error" key={key}>
              {message}
            </p>
          ))}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={close}>
              Close
            </button>
            <button type="submit" className="button primary" aria-disabled={pending}>
              Upload
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
