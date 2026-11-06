import type { GltfJson, GltfBufferView } from './gltf.js';
import { writeGlb } from './gltf.js';
import type { ZipEntry } from './zip.js';
import { readZip, escapesFolder, ZipReadError } from './zip.js';

/** Which published `file` copy a package refusal carries. */
export type PackageFault = 'path_escape' | 'contents';

export class PackageError extends Error {
  readonly fault: PackageFault;

  constructor(fault: PackageFault) {
    super(fault);
    this.name = 'PackageError';
    this.fault = fault;
  }
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash + 1);
}

/** Resolves a relative URI against the `.gltf` file's folder. */
function resolveEntry(folder: string, uri: string): string {
  const decoded = decodeURIComponent(uri);
  const parts = `${folder}${decoded}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function dataUriBytes(uri: string): Buffer | null {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(uri);
  if (match === null) return null;
  return Buffer.from(match[1] ?? '', 'base64');
}

function pad4(length: number): number {
  return (4 - (length % 4)) % 4;
}

/**
 * A glTF package: exactly one `.gltf` file with every buffer and image it
 * references present. Returns the equivalent glTF binary.
 */
export function assembleGlbFromPackage(archive: Buffer): Buffer {
  let entries: readonly ZipEntry[];
  try {
    entries = readZip(archive);
  } catch (error) {
    if (error instanceof ZipReadError) throw new PackageError('contents');
    throw error;
  }

  for (const entry of entries) {
    if (escapesFolder(entry.name)) throw new PackageError('path_escape');
  }

  const gltfEntries = entries.filter((e) => e.name.toLowerCase().endsWith('.gltf'));
  const gltfEntry = gltfEntries[0];
  if (gltfEntries.length !== 1 || gltfEntry === undefined) throw new PackageError('contents');

  let json: GltfJson;
  try {
    const parsed: unknown = JSON.parse(gltfEntry.bytes.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new PackageError('contents');
    }
    json = parsed as GltfJson;
  } catch (error) {
    if (error instanceof PackageError) throw error;
    throw new PackageError('contents');
  }

  const folder = folderOf(gltfEntry.name);
  const byName = new Map(entries.map((e) => [e.name, e.bytes]));
  const lookup = (uri: string): Buffer => {
    const inline = dataUriBytes(uri);
    if (inline !== null) return inline;
    const bytes = byName.get(resolveEntry(folder, uri));
    if (bytes === undefined) throw new PackageError('contents');
    return bytes;
  };

  // Every buffer becomes part of one binary chunk; views keep their order.
  const chunks: Buffer[] = [];
  const bufferStart: number[] = [];
  let total = 0;
  for (const buffer of json.buffers ?? []) {
    if (buffer.uri === undefined) throw new PackageError('contents');
    const bytes = lookup(buffer.uri);
    bufferStart.push(total);
    chunks.push(bytes);
    total += bytes.length;
    const padding = pad4(total);
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
      total += padding;
    }
  }

  const views: GltfBufferView[] = (json.bufferViews ?? []).map((view) => ({
    ...view,
    buffer: 0,
    byteOffset: (bufferStart[view.buffer] ?? 0) + (view.byteOffset ?? 0),
  }));

  const images = (json.images ?? []).map((image) => {
    if (image.uri === undefined) return image;
    const bytes = lookup(image.uri);
    const byteOffset = total;
    chunks.push(bytes);
    total += bytes.length;
    const padding = pad4(total);
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
      total += padding;
    }
    views.push({ buffer: 0, byteOffset, byteLength: bytes.length });
    return { bufferView: views.length - 1 };
  });

  const bin = Buffer.concat(chunks);
  const out: GltfJson = {
    ...json,
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
  };
  if (images.length > 0) out.images = images;
  else delete out.images;
  return writeGlb(out, bin);
}
