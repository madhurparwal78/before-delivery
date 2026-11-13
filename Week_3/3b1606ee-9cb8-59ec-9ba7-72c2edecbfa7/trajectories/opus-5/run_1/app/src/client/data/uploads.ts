import { base64urlEncode } from '../../shared/scheme.js';
import type { AttachmentDescriptor } from '../../shared/types.js';
import { sealAttachment } from '../crypto/seal.js';
import { api } from './api.js';
import type { PreparedPhoto } from './photos.js';
import { state } from './store.js';

export interface SealedUpload {
  blobId: string;
  sealed: Uint8Array;
  descriptor: AttachmentDescriptor;
}

/** The sealed size is the file size plus the 16-byte tag; the cap applies to it. */
export function overCap(size: number): boolean {
  return size + 16 > state.config.attachment_max_bytes;
}

export async function sealForUpload(
  bytes: Uint8Array,
  name: string,
  type: string,
  extra: { width?: number; height?: number; thumb?: string } = {},
): Promise<SealedUpload> {
  const blobId = crypto.randomUUID();
  const { key, iv, sealed, digest } = await sealAttachment(bytes);
  return {
    blobId,
    sealed,
    descriptor: {
      blob_id: blobId,
      key: base64urlEncode(key),
      iv: base64urlEncode(iv),
      digest,
      size: bytes.length,
      name,
      type,
      ...extra,
    },
  };
}

/** A profile photo is kind photo and is attached through the profile call. */
export async function uploadProfilePhoto(prepared: PreparedPhoto): Promise<{
  blob_id: string;
  key: string;
  iv: string;
  digest: string;
  type: string;
}> {
  const upload = await sealForUpload(prepared.bytes, 'profile.jpg', prepared.type);
  await api.declareBlob(upload.blobId, 'photo', upload.sealed.length);
  await api.uploadBlob(upload.blobId, upload.sealed);
  return {
    blob_id: upload.blobId,
    key: upload.descriptor.key,
    iv: upload.descriptor.iv,
    digest: upload.descriptor.digest,
    type: prepared.type,
  };
}
