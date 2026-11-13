import { issuePrepLink, resolvePrepLink, uploadMaterial } from '../../actions/materials.js';
import { contentDispositionFor } from '../../domain/prep-names.js';
import { agencyIso } from '../../domain/time.js';
import { getObjectStream, StorageUnavailable } from '../../services/s3.js';
import { requireVisibleBooking } from '../../store/visibility.js';
import { apiError } from '../errors.js';
import { parseFileParts } from '../multipart.js';
import { requireRole } from '../roles.js';
import { actor, route } from '../router.js';

route('POST', '/api/bookings/:id/materials', async (ctx) => {
  const user = actor(ctx);
  const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
  requireRole(user, 'requester', 'coordinator');
  const part = parseFileParts(ctx.rawBody, ctx.contentType).find(
    (candidate) => candidate.fieldName === 'file',
  );
  const material = await uploadMaterial(booking.id, part);
  return {
    status: 201,
    body: {
      id: material.id,
      name: material.name,
      size_bytes: material.size_bytes,
      content_type: material.content_type,
      sha256: material.sha256,
      uploaded_at: agencyIso(new Date(material.uploaded_at)),
    },
  };
});

route(
  'POST',
  '/api/bookings/:id/materials/:mid/link',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'interpreter');
    const link = await issuePrepLink(user, booking, ctx.params['mid'] ?? '', ctx.now);
    return { status: 201, body: link };
  },
  { idempotent: true },
);

route(
  'GET',
  '/api/prep/:token',
  async (ctx) => {
    const user = actor(ctx);
    const { material } = await resolvePrepLink(user, ctx.params['token'] ?? '', ctx.now);
    const object = await getObjectStream(material.object_key).catch((cause: unknown) => {
      if (cause instanceof StorageUnavailable) throw apiError('storage_unavailable');
      throw cause;
    });
    ctx.res.writeHead(200, {
      'content-type': material.content_type,
      'content-length': String(material.size_bytes),
      'x-content-type-options': 'nosniff',
      'content-disposition': contentDispositionFor(material.name),
      'cache-control': 'no-store',
    });
    await new Promise<void>((done) => {
      const release = (): void => {
        object.stream.destroy();
        done();
      };
      ctx.res.on('close', release);
      object.stream.on('error', release);
      object.stream.on('end', () => done());
      object.stream.pipe(ctx.res);
    });
    return { status: 200 };
  },
  { raw: true },
);
