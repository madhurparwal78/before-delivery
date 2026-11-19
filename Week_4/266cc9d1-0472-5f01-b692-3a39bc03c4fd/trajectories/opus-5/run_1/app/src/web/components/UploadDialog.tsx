import { useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog.jsx";
import { ApiFailure, api, sha256Hex } from "../lib/api.js";
import { useAnnounce } from "./LiveRegions.jsx";
import { assetKindLabel, type AssetKind } from "../../shared/format.js";
import {
  UPLOAD_INVALID_TRACK,
  UPLOAD_STORAGE_UNREACHABLE,
  uploadMismatch,
  uploadProgress,
  uploadStored,
  uploadVerifying,
} from "../../shared/copy.js";
import type { Asset } from "../lib/types.js";

export interface UploadProps {
  corridorId: string;
  onClose: () => void;
  onAssetChange: () => void;
}

interface Chosen {
  path: string;
  file: File;
  bytes: ArrayBuffer;
  sha256: string;
}

export function UploadDialog(props: UploadProps): ReactNode {
  const [kind, setKind] = useState<AssetKind>("tileset");
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const announce = useAnnounce();

  const upload = async (): Promise<void> => {
    const files = [...(input.current?.files ?? [])];
    if (files.length === 0 || pending) return;
    setPending(true);
    const kindLabel = assetKindLabel(kind);
    try {
      const chosen: Chosen[] = [];
      for (const file of files) {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        const path = relative && relative !== "" ? relative.split("/").slice(1).join("/") : file.name;
        const bytes = await file.arrayBuffer();
        chosen.push({ path: path === "" ? file.name : path, file, bytes, sha256: await sha256Hex(bytes) });
      }

      const declared = await api<{ asset: Asset }>(
        "POST",
        `/api/corridors/${props.corridorId}/assets`,
        {
          body: {
            kind,
            files: chosen.map((item) => ({
              path: item.path,
              size_bytes: item.bytes.byteLength,
              sha256: item.sha256,
            })),
          },
        },
      );
      props.onAssetChange();

      let done = 0;
      for (const item of chosen) {
        announce("Upload status", uploadProgress(done, chosen.length, kindLabel));
        await api<{ asset: Asset }>(
          "PUT",
          `/api/assets/${declared.asset.id}/files/${item.path}`,
          { rawBody: item.bytes },
        );
        done += 1;
      }
      announce("Upload status", uploadVerifying(chosen.length));

      // The state always comes from the server, never from the browser's own
      // upload events.
      const confirmed = await api<{ asset: Asset }>("GET", `/api/assets/${declared.asset.id}`);
      props.onAssetChange();
      if (confirmed.asset.state === "stored") {
        announce("Upload status", uploadStored(kindLabel, confirmed.asset.files.length));
      }
    } catch (error) {
      props.onAssetChange();
      if (error instanceof ApiFailure) {
        if (error.code === "checksum_mismatch") {
          const failed = [...(input.current?.files ?? [])][0]?.name ?? "";
          announce("Upload status", uploadMismatch(kindLabel, failed));
        } else if (error.code === "invalid_czml") {
          announce("Upload status", UPLOAD_INVALID_TRACK);
        } else if (error.code === "storage_unavailable" || error.status === 0) {
          announce("Upload status", UPLOAD_STORAGE_UNREACHABLE);
        } else {
          announce("Upload status", error.message);
        }
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      title="Upload survey assets"
      onClose={props.onClose}
      footer={
        <>
          <button
            type="button"
            className="button button--primary"
            aria-disabled={pending}
            onClick={() => void upload()}
          >
            Upload
          </button>
          <button type="button" className="button" onClick={props.onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="field" role="radiogroup" aria-label="Asset kind">
        <span className="field__label" aria-hidden="true">
          Asset kind
        </span>
        {(["tileset", "terrain", "czml"] as AssetKind[]).map((option) => (
          <label key={option} className="radio">
            <input
              type="radio"
              name="asset-kind"
              value={option}
              checked={kind === option}
              onChange={() => setKind(option)}
            />
            <span>{assetKindLabel(option)}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span className="field__label">Files</span>
        <input ref={input} className="field__input" type="file" multiple />
      </label>
    </Dialog>
  );
}
