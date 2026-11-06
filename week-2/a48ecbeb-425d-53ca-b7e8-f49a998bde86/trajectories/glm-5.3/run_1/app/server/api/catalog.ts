import express, { Router, type Request, type Response } from 'express';
import { withClient } from '../db.js';
import { databaseName } from '../env.js';
import * as pb from '../services/pocketbase.js';
import * as cartDomain from '../domain/cart.js';
import { quoteFor, QuoteValidationError, loadProvinces } from '../domain/quote.js';
import { FLAVOUR_ORDER, getFlavour, stockForAll } from '../domain/catalogue.js';
import { CANADIAN_PROVINCES } from '../domain/geo.js';
import { putObject, S3Unavailable } from '../services/s3.js';
import { randomUUID } from 'node:crypto';


const router = Router();

const STOCKISTS = [
  { name: 'Epicerie Feuille Verte', address: '210 avenue du Parc', city: 'Montreal', province: 'QC', lat: 45.5231, lng: -73.5817 },
  { name: 'Marche du Fleuve', address: '15 rue du Quai', city: 'Quebec City', province: 'QC', lat: 46.8123, lng: -71.2145 },
  { name: 'Canopy Grocer', address: '300 Queen Street West', city: 'Toronto', province: 'ON', lat: 43.6532, lng: -79.3832 },
  { name: 'Riverbend Pantry', address: '88 Bank Street', city: 'Ottawa', province: 'ON', lat: 45.4215, lng: -75.6972 },
  { name: 'Orchard Row Market', address: '1500 Barrington Street', city: 'Halifax', province: 'NS', lat: 44.6488, lng: -63.5752 },
  { name: 'Night Sky Provisions', address: '120 Stephen Avenue', city: 'Calgary', province: 'AB', lat: 51.0447, lng: -114.0719 },
  { name: 'Cedar & Salt', address: '455 Main Street', city: 'Vancouver', province: 'BC', lat: 49.2827, lng: -123.1207 },
];

export const STOCKIST_CITIES = STOCKISTS.map((s) => s.city);

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export function cartJson(state: cartDomain.CartState): Record<string, unknown> {
  return {
    slots: state.slots.map((s) => (s.flavour === null ? null : { flavour: s.flavour, status: 'held' })),
    count: state.count,
    province: state.province,
    subscribe: state.subscribe,
    cadence: state.cadence,
    hold: state.hold,
    server_time: new Date().toISOString(),
  };
}

export async function defaultProvinceFor(userId: string | null): Promise<string> {
  if (userId) {
    try {
      const addresses = await pb.listAddresses(userId);
      const def = addresses.find((a) => a.is_default);
      if (def) return def.province;
    } catch {
      // fall through to ON
    }
  }
  return 'ON';
}

export async function cartFromRequest(req: Request, res: Response): Promise<string> {
  const existing = req.cookies?.ceibo_cart as string | undefined;
  const id = await cartDomain.ensureCart(existing, req.userId ?? null, await defaultProvinceFor(req.userId ?? null));
  if (existing !== id) {
    res.cookie('ceibo_cart', id, { httpOnly: true, sameSite: 'lax' });
  }
  return id;
}

router.get('/flavours', async (_req, res) => {
  const flavours = await withClient(async (client) => {
    const q = await client.query(
      'select slug, name, can_price_cents, limited, subscribable from flavours order by array_position($1::text[], slug)',
      [FLAVOUR_ORDER]
    );
    return q.rows as { slug: string; name: string; can_price_cents: number; limited: boolean; subscribable: boolean }[];
  });
  const stock = await stockForAll();
  const byFlavour = new Map(stock.map((s) => [s.flavour, s.available]));
  res.json({
    flavours: flavours.map((f) => ({
      slug: f.slug,
      name: f.name,
      can_price_cents: f.can_price_cents,
      limited: f.limited,
      subscribable: f.subscribable,
      stock_left: byFlavour.get(f.slug) ?? 0,
    })),
  });
});

router.get('/stockists', (req, res) => {
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
  const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    res.json({ stockists: STOCKISTS.map((s) => ({ ...s, distance_km: null })), cities: STOCKIST_CITIES });
    return;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(422).json({ error: 'validation', message: 'Pick a valid location.', fields: { lat: 'Pick a valid location.' } });
    return;
  }
  const sorted = STOCKISTS.map((s) => ({ ...s, distance_km: distanceKm(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.distance_km - b.distance_km || a.name.localeCompare(b.name))
    .slice(0, 5);
  res.json({ stockists: sorted });
});

router.get('/flavours/:slug/reviews', async (req, res) => {
  try {
    const reviews = await pb.listReviews(databaseName(), req.params.slug, 'approved');
    const out = [];
    for (const review of reviews) {
      out.push({
        id: review.id,
        rating: review.rating,
        body: review.body,
        author_first_name: await pb.userFirstName(review.user),
        created_at: review.created,
      });
    }
    res.json({ reviews: out });
  } catch (e) {
    if (e instanceof pb.PocketBaseUnavailable) {
      res.status(503).json({ error: 'accounts_unavailable', message: 'Accounts are unreachable right now.' });
      return;
    }
    throw e;
  }
});

router.post('/quote', async (req, res) => {
  const body = req.body as { province?: unknown; subscribe?: unknown; cans?: unknown };
  if (typeof body.province !== 'string' || typeof body.subscribe !== 'boolean' || !Array.isArray(body.cans)) {
    res.status(422).json({
      error: 'validation',
      message: 'Check the highlighted fields.',
      fields: { province: "We don't ship to that province yet.", cans: 'Pick at least one can of each flavour.' },
    });
    return;
  }
  for (const can of body.cans as { flavour?: unknown; quantity?: unknown }[]) {
    if (typeof can.flavour !== 'string' || typeof can.quantity !== 'number' || !Number.isInteger(can.quantity) || can.quantity < 1) {
      res.status(422).json({
        error: 'validation',
        message: 'Check the highlighted fields.',
        fields: { cans: 'Pick at least one can of each flavour.' },
      });
      return;
    }
  }
  const totalQty = (body.cans as { quantity: number }[]).reduce((s, c) => s + c.quantity, 0);
  if (totalQty > 12) {
    res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { cans: 'A crate holds up to 12 cans.' } });
    return;
  }
  try {
    const quote = await withClient((client) =>
      quoteFor(client, {
        province: body.province as string,
        subscribe: body.subscribe as boolean,
        cans: (body.cans as { flavour: string; quantity: number }[]).map((c) => ({ flavour: c.flavour, quantity: c.quantity })),
      })
    );
    res.json(quote);
  } catch (e) {
    if (e instanceof QuoteValidationError) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { [e.field]: e.message } });
      return;
    }
    throw e;
  }
});

router.get('/cart', async (req, res) => {
  const id = await cartFromRequest(req, res);
  const state = await withClient((client) => cartDomain.cartState(id, client));
  res.json({ cart: cartJson(state) });
});

router.post('/cart/items', async (req, res) => {
  const id = await cartFromRequest(req, res);
  const body = req.body as { flavour?: unknown; quantity?: unknown };
  const flavour = await getFlavour(typeof body.flavour === 'string' ? body.flavour : '');
  if (!flavour) {
    res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { flavour: 'Pick from the listed flavours.' } });
    return;
  }
  const quantity = body.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 12) {
    res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { quantity: 'Pick between 1 and 12 cans.' } });
    return;
  }
  try {
    const result = await cartDomain.addCans(id, flavour.slug, quantity);
    res.status(201).json({
      cart: cartJson(result.cart),
      added: { flavour: result.added.flavour, slots: result.added.slots },
      stock_left: result.stockLeft,
    });
  } catch (e) {
    if (e instanceof cartDomain.HoldLimit) {
      res.status(409).json({
        error: 'hold_limit',
        message: e.limit === 'crate' ? 'Your crate is full.' : 'You can hold up to 6 cans of a limited drop.',
        limit: e.limit,
        stock_left: e.stockLeft,
      });
      return;
    }
    if (e instanceof cartDomain.SoldOut) {
      res.status(409).json({
        error: 'sold_out',
        message: "Couldn't add that flavour: sold out.",
        stock_left: e.stockLeft,
      });
      return;
    }
    throw e;
  }
});

router.delete('/cart/items/:slot', async (req, res) => {
  const id = await cartFromRequest(req, res);
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot > 11) {
    res.status(404).json({ error: 'not_found', message: "We couldn't find that slot." });
    return;
  }
  const filled = await withClient(async (client) => {
    const q = await client.query('select flavour from cart_slots where cart_id = $1 and slot = $2', [id, slot]);
    return q.rows.length > 0 && q.rows[0].flavour !== null;
  });
  if (!filled) {
    res.status(404).json({ error: 'not_found', message: 'That slot is empty.' });
    return;
  }
  const result = await cartDomain.removeCan(id, slot);
  res.json({ cart: cartJson(result.cart), stock_left: result.stockLeft });
});

router.patch('/cart', async (req, res) => {
  const id = await cartFromRequest(req, res);
  const body = req.body as { province?: unknown; subscribe?: unknown; cadence?: unknown };
  const patch: { province?: string; subscribe?: boolean; cadence?: string } = {};
  if (body.province !== undefined) {
    if (typeof body.province !== 'string') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { province: "We don't ship to that province yet." } });
      return;
    }
    const provinces = await loadProvinces();
    if (!provinces.some((p) => p.code === body.province)) {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { province: "We don't ship to that province yet." } });
      return;
    }
    patch.province = body.province;
  }
  if (body.cadence !== undefined) {
    if (body.cadence !== 'monthly' && body.cadence !== 'bimonthly') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { cadence: 'Pick a delivery rhythm.' } });
      return;
    }
    patch.cadence = body.cadence;
  }
  if (body.subscribe !== undefined) {
    if (typeof body.subscribe !== 'boolean') {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { subscribe: 'Choose whether to subscribe.' } });
      return;
    }
    patch.subscribe = body.subscribe;
  }
  try {
    const state = await cartDomain.updateCartSettings(id, patch);
    res.json({ cart: cartJson(state) });
  } catch (e) {
    if ((e as Error).message === 'not_subscribable') {
      res.status(409).json({ error: 'not_subscribable', message: 'Subscriptions come as 12 of one flavour or 4 of each.' });
      return;
    }
    throw e;
  }
});

export interface ParsedFile {
  filename: string;
  data: Buffer;
}

export function parseMultipart(raw: Buffer, contentType: string): Record<string, string | ParsedFile> {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const boundary = boundaryMatch ? (boundaryMatch[1] ?? boundaryMatch[2]) : '';
  const out: Record<string, string | ParsedFile> = {};
  if (!boundary) return out;
  const delim = Buffer.from(`--${boundary}`);
  let idx = raw.indexOf(delim);
  while (idx !== -1) {
    const start = idx + delim.length;
    const next = raw.indexOf(delim, start);
    if (next === -1) break;
    let part = raw.subarray(start, next);
    if (part[0] === 13 && part[1] === 10) part = part.subarray(2);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) part = part.subarray(0, part.length - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const data = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      if (nameMatch) {
        const name = nameMatch[1];
        if (fileMatch && fileMatch[1] !== '') {
          out[name] = { filename: fileMatch[1], data: Buffer.from(data) };
        } else {
          out[name] = data.toString('utf8');
        }
      }
    }
    idx = next;
  }
  return out;
}

export function detectType(data: Buffer): string | null {
  if (data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'application/pdf';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}

router.post('/retailer-applications', express.raw({ type: 'multipart/form-data', limit: '5200000' }), async (req, res: Response) => {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    res.status(415).json({ error: 'unsupported_type', message: 'Send your licence as a file.' });
    return;
  }
  const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
  if (raw.length > 5_100_000) {
    res.status(413).json({ error: 'too_large', message: 'Licence files can be up to 5,000,000 bytes.' });
    return;
  }
  const parts = parseMultipart(raw, contentType);
  const businessName = typeof parts.business_name === 'string' ? parts.business_name.trim() : '';
  const contactName = typeof parts.contact_name === 'string' ? parts.contact_name.trim() : '';
  const email = typeof parts.email === 'string' ? parts.email.trim() : '';
  const province = typeof parts.province === 'string' ? parts.province.trim().toUpperCase() : '';
  const licence = parts.licence ?? parts['licence_file'] ?? parts.file;
  const fields: Record<string, string> = {};
  if (businessName.length < 2 || businessName.length > 120) fields.business_name = 'Enter your business name.';
  if (contactName.length < 2 || contactName.length > 80) fields.contact_name = 'Enter your contact name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter a valid email.';
  if (!CANADIAN_PROVINCES.includes(province)) fields.province = 'Pick a Canadian province or territory.';
  if (licence === undefined || typeof licence === 'string') {
    fields.licence = 'Upload a PDF, PNG or JPEG.';
  } else if (licence.data.length > 5_000_000) {
    res.status(413).json({ error: 'too_large', message: 'Licence files can be up to 5,000,000 bytes.' });
    return;
  } else {
    const type = detectType(licence.data);
    if (!type) {
      res.status(415).json({ error: 'unsupported_type', message: 'Upload a PDF, PNG or JPEG.' });
      return;
    }
  }
  if (Object.keys(fields).length > 0) {
    res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields });
    return;
  }
  const file = licence as ParsedFile;
  const type = detectType(file.data)!;
  const id = randomUUID();
  const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg';
  try {
    await putObject(`licences/${id}/licence.${ext}`, file.data, type);
  } catch (e) {
    if (e instanceof S3Unavailable) {
      res.status(503).json({ error: 'files_unavailable', message: 'Uploads are unavailable right now. Nothing was submitted.' });
      return;
    }
    throw e;
  }
  await withClient(async (client) => {
    await client.query(
      `insert into applications (id, business_name, contact_name, email, province, licence_object, licence_type)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, businessName, contactName, email, province, `licences/${id}/licence.${ext}`, type]
    );
  });
  res.status(201).json({
    application: {
      id,
      status: 'submitted',
      business_name: businessName,
      submitted_at: new Date().toISOString(),
    },
  });
});

router.get('/retailer-applications/:id', async (req, res) => {
  const q = await withClient(async (client) => {
    const r = await client.query('select * from applications where id = $1', [req.params.id]);
    return r.rows[0];
  });
  if (!q) {
    res.status(404).json({ error: 'not_found', message: "We couldn't find that application." });
    return;
  }
  res.json({
    application: {
      id: q.id,
      status: q.status,
      business_name: q.business_name,
      submitted_at: (q.submitted_at as Date).toISOString(),
    },
  });
});

export { router as catalogRouter, STOCKISTS };
export function healthRoute(_req: Request, res: Response): void {
  res.json({ status: 'ok' });
}
