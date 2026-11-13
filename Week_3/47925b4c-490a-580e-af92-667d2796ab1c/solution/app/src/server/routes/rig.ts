import {
  countLinkRequest,
  resolveLink,
  rigView,
  setCircuitLive,
} from '../data/sheets.js';
import { latestSequence, readEvents, readSheetEvents } from '../events/outbox.js';
import { route } from '../http/server.js';
import { openStream } from '../http/sse.js';
import { Validation, readBoolean } from '../http/validate.js';
import { storedPdf } from './sheets.js';

route('GET', '/api/rig/:token', async (context) => {
  const link = await resolveLink(context.params['token'] as string);
  await countLinkRequest(link.token);
  return { status: 200, body: await rigView(link.sheet) };
});

route('GET', '/api/rig/:token/sheet.pdf', async (context) => {
  const link = await resolveLink(context.params['token'] as string);
  await countLinkRequest(link.token);
  return {
    status: 200,
    raw: await storedPdf(link.sheet.objectKey),
    contentType: 'application/pdf',
  };
});

route(
  'POST',
  '/api/rig/:token/circuits/:circuitId/live',
  async (context) => {
    const link = await resolveLink(context.params['token'] as string);
    await countLinkRequest(link.token);
    const check = new Validation();
    const live = readBoolean(check, context.body, 'live');
    check.finish();
    const circuit = await setCircuitLive(link.sheet, context.params['circuitId'] as string, live as boolean);
    return { status: 200, body: circuit };
  },
  { shape: { live: true } },
);

route(
  'GET',
  '/api/rig/:token/events',
  async (context) => {
    const link = await resolveLink(context.params['token'] as string);
    await countLinkRequest(link.token);
    await openStream(context, {
      read: (after) => readSheetEvents(link.sheet.id, after, 200),
      stillOpen: async () => {
        try {
          await resolveLink(link.token);
          return true;
        } catch {
          return false;
        }
      },
    });
    return { status: 200 };
  },
  { stream: true },
);

route(
  'GET',
  '/api/events',
  async (context) => {
    await openStream(context, { read: (after) => readEvents(after, 200) });
    return { status: 200 };
  },
  { stream: true },
);

route('GET', '/api/events/head', async () => ({
  status: 200,
  body: { sequence: await latestSequence() },
  headers: { 'Cache-Control': 'no-store' },
}));
