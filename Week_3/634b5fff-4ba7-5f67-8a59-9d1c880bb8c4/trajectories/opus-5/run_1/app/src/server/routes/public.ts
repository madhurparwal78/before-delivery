import { Router } from 'express';
import { EDITION_SIZE, plateFor } from '../../shared/copy.js';
import { sentencesOf } from '../../shared/tale.js';
import type { SearchHit } from '../../shared/types.js';
import { plateArtRecord } from '../art.js';
import { liveBoxStates, remainingStock } from '../boxes.js';
import { businessNow, editionClosed } from '../clock.js';
import { EDITION_CLOSES_AT, formatCopenhagenLocal } from '../copenhagen.js';
import { price, publicBoxState, saleSplit } from '../domain.js';
import { fail, failStorage } from '../errors.js';
import { handler, type PressRequest } from '../http.js';
import { lookupOrder } from '../lookup.js';
import { loadOrder } from '../orders.js';
import { CHARITY_NAME, rateAt } from '../rates.js';
import { SearchUnreachable, searchPublic } from '../services/search.js';
import { getObject } from '../services/storage.js';
import { valkeyUp } from '../services/valkey.js';
import { statementPdf } from '../statements.js';
import { addShelfListener } from '../sse.js';

export const publicRouter: Router = Router();

publicRouter.get('/api/health', (unusedRequest, res) => {
  res.json({ status: 'ok' });
});

publicRouter.get(
  '/api/edition',
  handler(async (unusedRequest, res) => {
    const rateBasisPoints = await rateAt(businessNow());
    const split = saleSplit(rateBasisPoints);
    res.json({
      edition: EDITION_SIZE,
      priceOre: price.grossOre,
      netOre: price.netOre,
      vatOre: price.vatOre,
      courierOre: price.courierOre,
      totalOre: price.totalOre,
      charityName: CHARITY_NAME,
      rateBasisPoints,
      charityOre: split.charityOre,
      closesAt: EDITION_CLOSES_AT.toISOString(),
      salesOpen: !editionClosed(),
    });
  }),
);

publicRouter.get(
  '/api/shelf',
  handler(async (unusedRequest, res) => {
    const states = await liveBoxStates();
    res.json({
      salesPaused: !valkeyUp(),
      remaining: await remainingStock(),
      boxes: [...states.entries()].map(([number, state]) => ({
        number,
        plate: plateFor(number),
        state: publicBoxState(state),
      })),
    });
  }),
);

publicRouter.get('/api/shelf/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: sales\ndata: ${JSON.stringify({ salesPaused: !valkeyUp(), salesOpen: !editionClosed() })}\n\n`);
  addShelfListener(res);
  const beat = setInterval(() => res.write(': beat\n\n'), 20_000);
  req.on('close', () => clearInterval(beat));
});

publicRouter.get(
  '/api/boxes/:number',
  handler(async (req, res) => {
    const number = Number.parseInt(String(req.params.number), 10);
    const states = await liveBoxStates();
    const state = states.get(number);
    if (state === undefined) throw fail(404, 'not_found');
    const plate = plateFor(number);
    const art = await plateArtRecord(plate);
    res.json({
      number,
      plate,
      state: publicBoxState(state),
      artUrl: art === null ? null : `/api/plates/${plate.toLowerCase()}/art`,
    });
  }),
);

publicRouter.get(
  '/api/plates/:plate/art',
  handler(async (req, res) => {
    const art = await plateArtRecord(String(req.params.plate));
    if (art === null) throw fail(404, 'not_found');
    let stored;
    try {
      stored = await getObject(art.objectKey);
    } catch {
      throw failStorage('download');
    }
    if (stored === null) throw fail(404, 'not_found');
    res.setHeader('Content-Type', art.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(stored.body);
  }),
);

function excerptFor(text: string, terms: string[]): string {
  const sentences = sentencesOf(text);
  const best = sentences.find((sentence) =>
    terms.some((term) => term.length > 2 && sentence.toLowerCase().includes(term)),
  );
  return best ?? sentences[0] ?? text;
}

publicRouter.get(
  '/api/search',
  handler(async (req, res) => {
    const text = typeof req.query.q === 'string' ? req.query.q : '';
    if (text.trim() === '' || text.length > 100) {
      res.json({ hits: [] });
      return;
    }
    let documents;
    try {
      documents = await searchPublic(text);
    } catch (error) {
      if (error instanceof SearchUnreachable) throw fail(503, 'search_unreachable');
      throw error;
    }
    const states = await liveBoxStates();
    const terms = text.toLowerCase().split(/\s+/);
    const hits: SearchHit[] = [];
    for (const document of documents) {
      if (document.kind === 'passage') {
        hits.push({
          kind: 'passage',
          passageId: document.passageId,
          chapter: document.chapter,
          excerpt: excerptFor(document.text, terms),
        });
      } else {
        const state = states.get(document.number);
        if (state === undefined) continue;
        hits.push({
          kind: 'box',
          number: document.number,
          plate: document.plate,
          state: publicBoxState(state),
        });
      }
    }
    res.json({ hits: hits.slice(0, 20) });
  }),
);

publicRouter.post(
  '/api/orders/lookup',
  handler(async (req, res) => {
    const body = req.jsonBody ?? {};
    const client = req.socket.remoteAddress ?? 'unknown';
    res.json(await lookupOrder(client, body.reference, body.email));
  }),
);

function tokenFrom(req: PressRequest): string {
  const header = req.headers['x-order-token'];
  if (typeof header === 'string' && header !== '') return header;
  return typeof req.query.token === 'string' ? req.query.token : '';
}

publicRouter.get(
  '/api/orders/:reference',
  handler(async (req, res) => {
    const order = await loadOrder(String(req.params.reference));
    if (order === null || order.order_token !== tokenFrom(req)) throw fail(404, 'not_found');
    const states = await liveBoxStates();
    res.json({
      reference: order.reference,
      number: order.box_number,
      plate: order.plate,
      method: order.method,
      paymentState: order.payment_state,
      boxState: states.get(order.box_number) ?? 'available',
      totalOre: order.total_ore,
      charityOre: order.charity_ore,
      transfer:
        order.transfer_id === null || order.transfer_deadline_at === null
          ? null
          : {
              iban: 'DK0000000000000000',
              paymentReference: order.reference,
              amountOre: order.total_ore,
              deadlineAt: formatCopenhagenLocal(order.transfer_deadline_at),
            },
      certificate: { state: order.certificate_state },
    });
  }),
);

publicRouter.get(
  '/api/orders/:reference/certificate',
  handler(async (req, res) => {
    const order = await loadOrder(String(req.params.reference));
    if (order === null || order.order_token !== tokenFrom(req)) throw fail(404, 'not_found');
    if (order.certificate_state === 'cancelled') throw fail(410, 'certificate_cancelled');
    if (order.certificate_state === 'pending') throw fail(409, 'certificate_pending');
    if (order.certificate_state === 'none' || order.certificate_key === null) {
      throw fail(404, 'not_found');
    }
    let stored;
    try {
      stored = await getObject(order.certificate_key);
    } catch {
      throw failStorage('download');
    }
    if (stored === null) throw fail(404, 'not_found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(stored.body);
  }),
);

publicRouter.get(
  '/api/statements/:id/pdf',
  handler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    let pdf;
    try {
      pdf = await statementPdf(String(req.params.id), token);
    } catch {
      throw failStorage('download');
    }
    if (pdf === null) throw fail(404, 'not_found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(pdf);
  }),
);
