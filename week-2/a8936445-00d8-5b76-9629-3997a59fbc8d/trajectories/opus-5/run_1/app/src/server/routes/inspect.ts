import { route } from '../http/router.js';
import { inspectionFile, inspectionView } from '../services/inspect.js';

route('GET', '/api/inspect/:token', { public: true }, async (ctx) => ({
  status: 200,
  json: await inspectionView(ctx.params['token']!),
}));

route('GET', '/api/inspect/:token/documents/:id/file', { public: true }, async (ctx) => {
  const file = await inspectionFile(ctx.params['token']!, ctx.params['id']!);
  return {
    status: 200,
    buffer: file.bytes,
    contentType: file.contentType,
    headers: { 'content-disposition': `inline; filename="${file.fileName}"` },
  };
});
