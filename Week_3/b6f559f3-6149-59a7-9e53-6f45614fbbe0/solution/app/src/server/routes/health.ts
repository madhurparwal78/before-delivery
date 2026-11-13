import { json, router } from '../http';
import { storage } from '../services';

router.get('/api/health', async () => json(200, { status: (await storage.healthy()) ? 'ok' : 'unavailable' }));
