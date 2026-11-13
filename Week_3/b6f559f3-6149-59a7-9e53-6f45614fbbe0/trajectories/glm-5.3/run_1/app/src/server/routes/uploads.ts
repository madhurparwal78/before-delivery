// Uploads: image, SVG and model files become usable layers only after
// storage confirms the object, with the original bytes kept unchanged.
import { sendJson } from '../http';
import { validationMessage, storageUnavailable } from '../errors';
import { COPY, mbLabel } from '../../domain/copy';
import type { RouteCtx } from '../routes';
import { requirePersonRoute, openProjectById, newId } from '../store';
import { createHash } from 'node:crypto';

function imageDimensions(buf: Buffer): { w: number; h: number } | null {
  // PNG
  if (buf.length > 24 && buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return { w, h };
  }
  // JPEG: scan markers
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = buf.readUInt16BE(i + 5);
        const w = buf.readUInt16BE(i + 7);
        return { w, h };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
    return null;
  }
  // WebP: VP8/VP8L/VP8X
  if (buf.length > 30 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') {
    const fmt = buf.subarray(12, 16).toString();
    if (fmt === 'VP8 ') {
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      return { w, h };
    }
    if (fmt === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >> 14) & 0x3fff) + 1;
      return { w, h };
    }
    if (fmt === 'VP8X') {
      const w = 1 + ((buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)) & 0xffffff);
      const h = 1 + ((buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)) & 0xffffff);
      return { w, h };
    }
  }
  return null;
}

export async function handleUpload(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { role } = await openProjectById(ctx.app, ctx, projectId, person);
  if (role === 'Viewer') {
    const { forbidden } = await import('../errors');
    throw forbidden(COPY.viewerEdit);
  }
  const raw = ctx.rawBody;
  if (!raw) throw validationMessage('Send a file.', 'file');
  const ct = ctx.req.headers['content-type'] ?? '';
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) throw validationMessage('Send a file.', 'file');
  const boundary = `--${m[1] ?? m[2]}`;
  const parts = parseMultipart(raw, boundary);
  const kindField = parts.find((p) => p.name === 'kind');
  const fileField = parts.find((p) => p.name === 'file');
  if (!kindField || !fileField) throw validationMessage('Send a file.', 'file');
  const kind = kindField.value.toString('utf8').trim();
  const bytes = fileField.value;
  const fileName = fileField.filename ?? 'file';

  const cfg = ctx.app.cfg;
  let meta: {
    width?: number;
    height?: number;
    vertices?: number;
    clips?: { name: string; durationS: number }[];
    parsed?: unknown;
    contentType: string;
  };
  let svgInfo: { points: { x: number; y: number }[]; width: number; height: number } | null = null;

  if (kind === 'image') {
    const sniff = sniffImage(bytes);
    if (!sniff) throw validationMessage(COPY.imageKind, 'file');
    if (bytes.length > cfg.imageMaxBytes) {
      throw validationMessage(
        COPY.imageSize(mbLabel(bytes.length), mbLabel(cfg.imageMaxBytes)),
        'file',
      );
    }
    const dims = imageDimensions(bytes);
    if (dims && (dims.w > cfg.imageMaxDimension || dims.h > cfg.imageMaxDimension)) {
      throw validationMessage(
        COPY.imageDimension(dims.w, dims.h, cfg.imageMaxDimension),
        'file',
      );
    }
    meta = {
      width: dims?.w,
      height: dims?.h,
      contentType: sniff,
    };
  } else if (kind === 'svg') {
    if (!/<svg[\s>]/i.test(bytes.toString('utf8'))) {
      throw validationMessage(COPY.svgNotSvg, 'file');
    }
    // The extrusion subset is checked at upload time, in the published order.
    const { parseSvgPath } = await import('../../domain/extrusion');
    const parsed = parseSvgPath(bytes.toString('utf8'));
    if (!parsed.ok) {
      const msg =
        parsed.error === 'path_count'
          ? COPY.svgPathCount(parsed.pathCount ?? 0)
          : parsed.error === 'commands'
            ? COPY.svgCommands
            : COPY.svgCrosses;
      throw validationMessage(msg, 'file');
    }
    svgInfo = {
      points: parsed.points,
      width: parsed.width,
      height: parsed.height,
    };
    meta = { contentType: 'image/svg+xml', parsed: svgInfo };
  } else if (kind === 'model') {
    const { buildModelInfo } = await import('../../domain/gltf');
    const parsed = buildModelInfo(new Uint8Array(bytes), cfg.modelMaxBytes, cfg.modelMaxVertices);
    if (!parsed.ok) {
      const refusal = parsed.refusal;
      const msg =
        refusal === 'size'
          ? COPY.modelSize(mbLabel(bytes.length), mbLabel(cfg.modelMaxBytes))
          : refusal === 'invalid'
            ? COPY.modelInvalid
            : refusal === 'version'
              ? COPY.modelVersion
              : refusal === 'compression'
                ? COPY.modelCompression(parsed.extension ?? '')
                : refusal === 'external'
                  ? COPY.modelExternal
                  : refusal === 'matrix'
                    ? COPY.modelMatrix
                    : refusal === 'cubicspline'
                      ? COPY.modelCubicspline
                      : COPY.modelVertices(0, cfg.modelMaxVertices);
      throw validationMessage(msg, 'file');
    }
    const vertexCount = parsed.vertices;
    meta = {
      vertices: vertexCount,
      clips: parsed.model.clips.map((c) => ({ name: c.name, durationS: c.duration })),
      contentType: fileName.toLowerCase().endsWith('.glb')
        ? 'model/gltf-binary'
        : 'model/gltf+json',
      parsed: parsed.model,
    };
  } else {
    throw validationMessage('Send a file.', 'kind');
  }

  // Store the original bytes, then confirm by reading the metadata back.
  const assetId = newId('ast');
  const key = `projects/${projectId}/assets/${assetId}/original`;
  try {
    await ctx.app.s3.putObject(key, bytes, meta.contentType);
    const head = await ctx.app.s3.headObject(key);
    if (!head || head.size !== bytes.length) {
      throw new Error('confirm failed');
    }
  } catch {
    throw storageUnavailable(COPY.storageOutage);
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await ctx.app.pool.query(
    `INSERT INTO assets (id, project_id, kind, file_name, bytes, sha256, status, content_type, width, height, vertices, clips, parsed)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $9, $10, $11, $12)`,
    [
      assetId,
      projectId,
      kind,
      fileName,
      bytes.length,
      sha256,
      meta.contentType,
      meta.width ?? null,
      meta.height ?? null,
      meta.vertices ?? null,
      meta.clips ? JSON.stringify(meta.clips) : null,
      meta.parsed ? JSON.stringify(meta.parsed) : null,
    ],
  );

  sendJson(ctx.res, 201, {
    asset: {
      id: assetId,
      kind,
      fileName,
      bytes: bytes.length,
      sha256,
      status: 'confirmed',
      width: meta.width ?? null,
      height: meta.height ?? null,
      vertices: meta.vertices ?? null,
      clips: meta.clips ?? null,
    },
  });
}

export interface MultipartPart {
  name: string;
  filename?: string;
  value: Buffer;
}

export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const sep = Buffer.from(boundary);
  let start = body.indexOf(sep);
  while (start >= 0) {
    const contentStart = body.indexOf(Buffer.from('\r\n\r\n'), start);
    if (contentStart < 0) break;
    const next = body.indexOf(sep, contentStart);
    if (next < 0) break;
    const headerText = body.subarray(start + sep.length + 2, contentStart).toString('utf8');
    const value = body.subarray(contentStart + 4, next - 2);
    const nameMatch = headerText.match(/name="([^"]*)"/);
    const fileMatch = headerText.match(/filename="([^"]*)"/);
    parts.push({
      name: nameMatch?.[1] ?? '',
      filename: fileMatch?.[1],
      value,
    });
    start = next;
  }
  return parts;
}

function sniffImage(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === 'PNG') {
    return 'image/png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length > 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
