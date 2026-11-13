import { bundleBytes, cancelMaskJob, jobView, requireJob, startMaskJob } from '../data/maskjobs.js';
import {
  endLink,
  issueSheet,
  regenerateLink,
  requireSheet,
  sheetView,
  withdrawSheet,
} from '../data/sheets.js';
import { problem } from '../http/problem.js';
import { route } from '../http/server.js';
import { StoreUnreachable, getObject } from '../services/store.js';

route(
  'POST',
  '/api/layouts/:layoutId/issue',
  async (context) => ({ status: 201, body: await issueSheet(context.params['layoutId'] as string) }),
  { keyed: true, emptyAllowed: true, shape: {} },
);

route('GET', '/api/sheets/:sheetId', async (context) => ({
  status: 200,
  body: await sheetView(await requireSheet(context.params['sheetId'] as string)),
}));

route('GET', '/api/sheets/:sheetId/pdf', async (context) => {
  const sheet = await requireSheet(context.params['sheetId'] as string);
  return { status: 200, raw: await storedPdf(sheet.objectKey), contentType: 'application/pdf' };
});

export async function storedPdf(key: string): Promise<Buffer> {
  try {
    const bytes = await getObject(key);
    if (bytes === null) throw problem('not_found');
    return bytes;
  } catch (error) {
    if (error instanceof StoreUnreachable) throw problem('sheet_store_unavailable');
    throw error;
  }
}

route(
  'POST',
  '/api/sheets/:sheetId/withdraw',
  async (context) => ({ status: 200, body: await withdrawSheet(context.params['sheetId'] as string) }),
  { emptyAllowed: true, shape: {} },
);

route(
  'POST',
  '/api/sheets/:sheetId/link',
  async (context) => ({ status: 201, body: await regenerateLink(context.params['sheetId'] as string) }),
  { emptyAllowed: true, shape: {} },
);

route('DELETE', '/api/sheets/:sheetId/link', async (context) => {
  await endLink(context.params['sheetId'] as string);
  return { status: 204 };
});

route(
  'POST',
  '/api/layouts/:layoutId/mask-jobs',
  async (context) => ({ status: 202, body: await startMaskJob(context.params['layoutId'] as string) }),
  { keyed: true, emptyAllowed: true, shape: {} },
);

route('GET', '/api/mask-jobs/:jobId', async (context) => ({
  status: 200,
  body: jobView(await requireJob(context.params['jobId'] as string)),
}));

route('DELETE', '/api/mask-jobs/:jobId', async (context) => ({
  status: 200,
  body: await cancelMaskJob(context.params['jobId'] as string),
}));

route('GET', '/api/mask-jobs/:jobId/bundle', async (context) => {
  const job = await requireJob(context.params['jobId'] as string);
  return { status: 200, raw: await bundleBytes(job), contentType: 'application/zip' };
});
