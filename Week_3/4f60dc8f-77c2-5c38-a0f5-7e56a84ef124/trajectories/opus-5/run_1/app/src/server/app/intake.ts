import { randomUUID } from 'node:crypto';
import { fail } from '../http/app-error.js';
import { MultipartMalformed, MultipartReader, boundaryOf } from '../http/multipart.js';
import type { Ctx } from '../http/kernel.js';
import {
  displayNameOf,
  extensionOf,
  intakeObjectKey,
  stillContentType,
  stillObjectKey,
  typeForExtension,
  STILL_CAP_BYTES,
  type IntakeType,
} from '../domain/intake.js';
import { GlbMalformedError, inspectGlbHead, type GlbHead } from '../domain/glb.js';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  headObject,
  putObject,
  uploadPart,
  MIN_PART_BYTES,
} from '../services/storage.js';
import { insertIntakeFile, setMeasurementState, type IntakeFileRow } from '../db/engagements.js';
import { publishMeasureJob } from '../services/measure-queue.js';
import type { ReviewMilestone } from '../../shared/domain.js';

class UploadRefusal extends Error {
  constructor(readonly code: 'file_type_mismatch' | 'file_too_large') {
    super(code);
  }
}

type StoredUpload = {
  fileId: string;
  displayName: string;
  type: IntakeType;
  sizeBytes: number;
  objectKey: string;
};

/**
 * Streams one uploaded intake file to MinIO while judging its type, cap and GLB structure.
 * A refusal aborts the multipart upload, so no object and no record survive.
 */
const streamIntakeFile = async (
  reader: MultipartReader,
  engagementId: string,
  filename: string | null,
): Promise<StoredUpload> => {
  const displayName = displayNameOf(filename ?? '');
  const type = typeForExtension(extensionOf(displayName));
  const fileId = randomUUID();

  const upload: { id: string | null; key: string } = { id: null, key: '' };
  const parts: { partNumber: number; etag: string }[] = [];
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let head = Buffer.alloc(0);
  let holding = true;
  let glbHead: GlbHead | null = null;
  let total = 0;

  const put = async (body: Buffer): Promise<void> => {
    if (upload.id === null) throw new Error('multipart upload not started');
    const etag = await uploadPart(upload.key, upload.id, parts.length + 1, body);
    parts.push({ partNumber: parts.length + 1, etag });
  };

  const flush = async (final: boolean): Promise<void> => {
    while (pendingBytes >= MIN_PART_BYTES) {
      const joined = Buffer.concat(pending);
      await put(joined.subarray(0, MIN_PART_BYTES));
      const rest = joined.subarray(MIN_PART_BYTES);
      pending = rest.length > 0 ? [rest] : [];
      pendingBytes = rest.length;
    }
    if (final && pendingBytes > 0) {
      await put(Buffer.concat(pending));
      pending = [];
      pendingBytes = 0;
    }
  };

  const beginUpload = async (kind: IntakeType): Promise<void> => {
    upload.key = intakeObjectKey(engagementId, fileId, kind.kind);
    upload.id = await createMultipartUpload(upload.key, kind.contentType);
    pending = [head];
    pendingBytes = head.length;
    holding = false;
  };

  try {
    await reader.streamPart(async (chunk) => {
      total += chunk.length;
      if (type === null) throw new UploadRefusal('file_type_mismatch');
      if (total > type.capBytes) throw new UploadRefusal('file_too_large');

      if (holding) {
        head = Buffer.concat([head, chunk]);
        const verdict = type.matches(head);
        if (verdict === false) throw new UploadRefusal('file_type_mismatch');
        if (verdict === 'need-more') return;
        if (type.kind === 'model') {
          const progress = inspectGlbHead(head);
          if (progress.kind === 'need') return;
          glbHead = progress.head;
        }
        await beginUpload(type);
        await flush(false);
        return;
      }

      pending.push(chunk);
      pendingBytes += chunk.length;
      await flush(false);
    });

    if (type === null) throw new UploadRefusal('file_type_mismatch');
    if (holding) {
      if (type.matches(head) !== true) throw new UploadRefusal('file_type_mismatch');
      if (type.kind === 'model') {
        const progress = inspectGlbHead(head);
        if (progress.kind === 'need') throw new GlbMalformedError('file ends inside its header');
        glbHead = progress.head;
      }
      await beginUpload(type);
    }
    if (type.kind === 'model' && (glbHead as GlbHead).headerLength !== total)
      throw new GlbMalformedError('header length does not match the file size');

    await flush(true);
    if (upload.id === null) throw new Error('multipart upload not started');
    await completeMultipartUpload(upload.key, upload.id, parts);

    const stored = await headObject(upload.key);
    if (stored === null || stored.size !== total) fail('storage_unavailable');

    return { fileId, displayName, type, sizeBytes: total, objectKey: upload.key };
  } catch (error) {
    if (upload.id !== null) await abortMultipartUpload(upload.key, upload.id);
    if (error instanceof UploadRefusal) fail(error.code);
    if (error instanceof GlbMalformedError) fail('gltf_malformed');
    throw error;
  }
};

const eachPart = async (
  ctx: Ctx,
  onFile: (filename: string | null, reader: MultipartReader) => Promise<void>,
  onField: (name: string, value: string) => void,
): Promise<void> => {
  const boundary = boundaryOf(ctx.request.headers['content-type']);
  if (boundary === null) fail('validation_failed', { fields: { file: 'Upload a file.' } });
  const reader = new MultipartReader(ctx.request, boundary);
  try {
    for (;;) {
      const part = await reader.nextPart();
      if (part === null) return;
      if (part.name === 'file') await onFile(part.filename, reader);
      else onField(part.name, await reader.readPartText(4096));
    }
  } catch (error) {
    if (error instanceof MultipartMalformed) return;
    throw error;
  }
};

export const receiveIntakeUpload = async (
  ctx: Ctx,
  engagementId: string,
  modelsAllowed: boolean,
): Promise<IntakeFileRow> => {
  let stored: StoredUpload | null = null;
  await eachPart(
    ctx,
    async (filename, reader) => {
      if (stored !== null) return;
      if (!modelsAllowed && typeForExtension(extensionOf(displayNameOf(filename ?? '')))?.kind === 'model')
        fail('quote_locked');
      stored = await streamIntakeFile(reader, engagementId, filename);
    },
    () => undefined,
  );
  if (stored === null) fail('validation_failed', { fields: { file: 'Upload a file.' } });
  const upload: StoredUpload = stored;

  const row = await insertIntakeFile({
    id: upload.fileId,
    engagementId,
    name: upload.displayName,
    kind: upload.type.kind,
    sizeBytes: upload.sizeBytes,
    objectKey: upload.objectKey,
    contentType: upload.type.contentType,
  });

  if (upload.type.kind !== 'model') return row;
  try {
    await publishMeasureJob(upload.fileId);
    return row;
  } catch {
    await setMeasurementState(upload.fileId, 'delayed');
    return { ...row, measurement: 'delayed' };
  }
};

export type StillUpload = {
  bytes: Buffer;
  contentType: 'image/png' | 'image/jpeg';
  shotCode: string;
  milestone: string;
};

/** Stills are small enough to judge in memory before anything is written to storage. */
export const readStillUpload = async (ctx: Ctx): Promise<StillUpload> => {
  const fields: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;

  await eachPart(
    ctx,
    async (_filename, reader) => {
      await reader.streamPart(async (chunk) => {
        total += chunk.length;
        if (total > STILL_CAP_BYTES) {
          tooLarge = true;
          return;
        }
        chunks.push(chunk);
      });
    },
    (name, value) => {
      fields[name] = value;
    },
  );

  if (tooLarge) fail('file_too_large');
  const bytes = Buffer.concat(chunks);
  const contentType = stillContentType(bytes);
  if (contentType === null) fail('file_type_mismatch');
  return {
    bytes,
    contentType: contentType as 'image/png' | 'image/jpeg',
    shotCode: fields.shot_code ?? '',
    milestone: fields.milestone ?? '',
  };
};

export const storeStill = async (
  engagementId: string,
  milestone: ReviewMilestone,
  upload: StillUpload,
): Promise<{ stillId: string; objectKey: string }> => {
  const stillId = randomUUID();
  const objectKey = stillObjectKey(engagementId, milestone, stillId, upload.contentType);
  await putObject(objectKey, upload.bytes, upload.contentType);
  const stored = await headObject(objectKey);
  if (stored === null) fail('storage_unavailable');
  return { stillId, objectKey };
};
