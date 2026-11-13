import { base64urlDecode } from '../../shared/scheme.js';
import { digestOf, openAttachment } from '../crypto/seal.js';
import { api } from './api.js';

export class CorruptedAttachment extends Error {
  constructor() {
    super('attachment corrupted');
    this.name = 'CorruptedAttachment';
  }
}

export interface AttachmentKeys {
  blob_id: string;
  key: string;
  iv: string;
  digest: string;
  type: string;
}

const urls = new Map<string, string>();

/** Downloads sealed bytes, checks them against the sealed digest, then opens them. */
export async function fetchAttachment(descriptor: AttachmentKeys): Promise<Uint8Array> {
  const sealed = await api.downloadBlob(descriptor.blob_id);
  if ((await digestOf(sealed)) !== descriptor.digest) throw new CorruptedAttachment();
  return openAttachment(
    base64urlDecode(descriptor.key),
    base64urlDecode(descriptor.iv),
    sealed,
  );
}

export async function attachmentUrl(descriptor: AttachmentKeys): Promise<string> {
  const cached = urls.get(descriptor.blob_id);
  if (cached !== undefined) return cached;
  const bytes = await fetchAttachment(descriptor);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: descriptor.type }),
  );
  urls.set(descriptor.blob_id, url);
  return url;
}

export async function downloadToDisk(descriptor: AttachmentKeys, name: string): Promise<void> {
  const url = await attachmentUrl(descriptor);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}
