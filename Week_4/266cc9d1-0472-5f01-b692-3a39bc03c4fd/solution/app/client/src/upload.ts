// Uploading an asset: SHA-256 of each file in the browser, the manifest declaration, then each
// file's bytes. Every state shown comes from the server's answers, never from the browser's own
// upload events.
import { api, ApiFailure, type Asset, type AssetKind } from "./api";
import { KIND_LABELS, type PickedFile } from "./components/Assets";
import { counted } from "../../shared/text";

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function filePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

interface UploadHooks {
  report: (text: string) => void;
  progress: (fraction: number) => void;
  onAsset: (asset: Asset) => void;
}

/** Declares the asset; resolves with field messages if the manifest is refused, else uploads in the background. */
export async function startUpload(corridorId: string, kind: AssetKind, files: PickedFile[], hooks: UploadHooks): Promise<Record<string, string> | null> {
  const label = KIND_LABELS[kind];
  const manifest = await Promise.all(files.map(async (f) => ({ path: f.path, size_bytes: f.file.size, sha256: await sha256(f.file) })));
  let asset: Asset;
  try {
    asset = (await api<{ asset: Asset }>("POST", `/api/corridors/${corridorId}/assets`, { body: { kind, files: manifest } })).asset;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 422) return error.fields;
    return { form: error instanceof ApiFailure ? error.message : "The upload could not start." };
  }
  hooks.onAsset(asset);
  void sendFiles(asset, label, files, hooks);
  return null;
}

async function sendFiles(declared: Asset, label: string, files: PickedFile[], hooks: UploadHooks): Promise<void> {
  const total = files.length;
  for (const [index, picked] of files.entries()) {
    hooks.report(`Uploading ${index + 1} of ${counted(total, "file")} for ${label}`);
    hooks.progress(index / total);
    try {
      const result = await api<{ asset: Asset }>("PUT", `/api/assets/${declared.id}/files/${filePath(picked.path)}`, { raw: picked.file });
      hooks.onAsset(result.asset);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === "checksum_mismatch") hooks.report(`${label} rejected: ${picked.path} did not match its checksum.`);
      else if (error.code === "invalid_czml") hooks.report("Flight track rejected: no position samples with an epoch and availability.");
      else if (error.code === "storage_unavailable") hooks.report("Tile storage is unreachable. Upload paused; nothing was stored.");
      else hooks.report(error.message);
      hooks.progress(0);
      const latest = await api<{ asset: Asset }>("GET", `/api/assets/${declared.id}`).catch(() => null);
      if (latest !== null) hooks.onAsset(latest.asset);
      return;
    }
  }
  hooks.report(`Verifying ${counted(total, "file")} with storage`);
  hooks.progress(1);
  const verified = (await api<{ asset: Asset }>("GET", `/api/assets/${declared.id}`)).asset;
  hooks.onAsset(verified);
  if (verified.state === "stored") hooks.report(`${label} stored: ${counted(total, "file")} verified.`);
  hooks.progress(0);
}
