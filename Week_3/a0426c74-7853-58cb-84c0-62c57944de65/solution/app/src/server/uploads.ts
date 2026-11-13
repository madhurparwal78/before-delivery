// Underlay images: checked for size, type and quota in the published order, stored under their content hash, then attached to the drawing.
import { createHash, randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError } from '../shared/errors.ts';
import { MINIMUM_ROLE } from '../shared/rules.ts';
import type { Underlay } from '../shared/types.ts';
import { requireUser } from './auth.ts';
import { config } from './config.ts';
import { numberParam } from './fields.ts';
import { getDrawing } from './drawings.ts';
import { attachUnderlay } from './ops.ts';
import { withOutageText } from './outage.ts';
import { roleOnDrawing } from './roles.ts';
import { route } from './router.ts';
import { s3 } from './s3.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);

interface ImageKind { extension: 'png' | 'jpg'; contentType: string }
const PNG: ImageKind = { extension: 'png', contentType: 'image/png' };
const JPEG: ImageKind = { extension: 'jpg', contentType: 'image/jpeg' };

/** Type is judged by content only: the PNG signature or the JPEG start-of-image bytes. */
function imageKind(bytes: Buffer): ImageKind | null {
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return PNG;
  if (bytes.subarray(0, JPEG_START.length).equals(JPEG_START)) return JPEG;
  return null;
}

const underlayBody = ({ id, key, bytes, x1, y1, x2, y2 }: Underlay) => ({ id, key, bytes, x1, y1, x2, y2 });

route('POST', '/api/drawings/:id/underlays', async (ctx) => {
  const { username } = requireUser(ctx);
  const drawingId = ctx.params.id;
  await roleOnDrawing(ctx, drawingId, MINIMUM_ROLE.editDrawing);
  const bytes = ctx.rawBody();
  const image = imageKind(bytes);
  if (!image) throw new ApiError('wrong_type', copy.UNDERLAY_WRONG_TYPE);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const runtime = await getDrawing(drawingId);
  // The whole decision runs in the drawing's queue: of two uploads of one image, or two that together pass the quota, the second sees the first.
  return runtime.enqueue(async () => {
    const { underlays } = runtime.state;
    const identical = underlays.find((underlay) => underlay.sha256 === sha256);
    if (identical) return ctx.reply(200, underlayBody(identical));
    if (underlays.reduce((total, underlay) => total + underlay.bytes, 0) + bytes.length > config.drawingQuotaBytes) {
      throw new ApiError('quota_exceeded', copy.underlayQuota(config.drawingQuotaBytes));
    }
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((name) => numberParam(ctx.query, name, copy.UNDERLAY_CORNERS));
    const key = `underlays/${drawingId}/${sha256}.${image.extension}`;
    await withOutageText(copy.UNDERLAY_OUTAGE, () => s3.put(key, bytes, image.contentType));
    const underlay: Underlay = { id: randomUUID(), key, bytes: bytes.length, sha256, x1, y1, x2, y2 };
    await attachUnderlay(runtime, username, underlay);
    return ctx.reply(201, underlayBody(underlay));
  });
}, { bodyLimit: config.underlayMaxBytes });
