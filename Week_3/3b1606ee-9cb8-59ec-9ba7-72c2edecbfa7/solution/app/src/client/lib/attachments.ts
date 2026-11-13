import { openFile } from '../crypto/sealing';
import { downloadBlob } from '../store/api';

export interface OpenableAttachment {
  blob_id: string;
  key: string;
  iv: string;
  digest: string;
  type: string;
}

export type Fetched = { status: 'ok'; url: string; bytes: Uint8Array<ArrayBuffer> } | { status: 'corrupted' } | { status: 'unavailable' };

const cache = new Map<string, Promise<Fetched>>();

/** Downloads a sealed attachment, checks it against the digest sealed in its letter, and unseals it. */
export function fetchAttachment(attachment: OpenableAttachment): Promise<Fetched> {
  const cached = cache.get(attachment.blob_id);
  if (cached) return cached;
  const made = (async (): Promise<Fetched> => {
    try {
      const opened = await openFile(await downloadBlob(attachment.blob_id), attachment);
      if (!opened.ok) return { status: 'corrupted' };
      return { status: 'ok', url: URL.createObjectURL(new Blob([opened.bytes], { type: attachment.type })), bytes: opened.bytes };
    } catch {
      return { status: 'unavailable' };
    }
  })();
  cache.set(attachment.blob_id, made);
  void made.then((result) => {
    if (result.status === 'unavailable') cache.delete(attachment.blob_id);
  });
  return made;
}

/** The unsealed bytes of a picture already on this device (a letter just written), shown without a download. */
export const localPictures = new Map<string, string>();
