import { route } from './router.ts';
import { s3 } from './s3.ts';

// MinIO is checked afresh on every request; the answer is HTTP 200 either way (never 503).
route('GET', '/api/health', async (ctx) => ctx.reply(200, { status: (await s3.reachable()) ? 'ok' : 'unavailable' }), { access: 'public' });
