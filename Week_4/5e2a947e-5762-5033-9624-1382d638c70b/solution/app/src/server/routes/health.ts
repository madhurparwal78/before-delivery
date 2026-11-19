import { json, route } from '../http.ts';
import { storageReachable } from '../s3.ts';

route('GET', '/api/health', {
  stages: {},
  handle: async () => json(200, { status: (await storageReachable()) ? 'ok' : 'unavailable' }),
});
