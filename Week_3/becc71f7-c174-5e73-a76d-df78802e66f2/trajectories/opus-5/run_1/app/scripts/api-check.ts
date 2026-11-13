/** An end-to-end check of the API against a running copy. Not shipped. */
import { addDays, brusselsDate, formatDateOnly, isoSeconds, monthOf, addMonths, startOfBrusselsDay } from '../src/shared/brussels.js';

const base = process.env['CHECK_URL'] ?? 'http://127.0.0.1:4173';
let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL ${label} ${detail}`);
  }
}

function eq(label: string, got: unknown, want: unknown): void {
  ok(label, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

interface Reply {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

const jars = new Map<string, string>();

async function call(
  method: string,
  path: string,
  options: { body?: unknown; jar?: string; headers?: Record<string, string>; raw?: BodyInit; contentType?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;
  if (options.jar !== undefined) {
    const cookie = jars.get(options.jar);
    if (cookie !== undefined) headers['cookie'] = cookie;
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie !== null && options.jar !== undefined) {
    jars.set(options.jar, setCookie.split(';')[0] as string);
  }
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, body, text };
}

const Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const allInstants = (value: unknown, label: string): void => {
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(node)) {
        ok(`${label} whole-second Z at ${path}`, Z.test(node), node);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, entry] of Object.entries(node)) walk(entry, `${path}.${key}`);
    }
  };
  walk(value, label);
};

const camelCase = (value: unknown, label: string): void => {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, entry] of Object.entries(node)) {
        ok(`${label} camelCase key ${key}`, /^[a-z][A-Za-z0-9]*$/.test(key), key);
        walk(entry);
      }
    }
  };
  walk(value);
};

// ── API conventions ───────────────────────────────────────────────────────────
{
  const health = await call('GET', '/api/health');
  eq('health status', health.status, 200);
  eq('health body', health.text, '{"status":"ok"}');

  const unknown = await call('GET', '/api/nope');
  eq('unknown api path', unknown.status, 404);
  eq('unknown api code', unknown.body?.error?.code, 'not_found');

  const wrongMethod = await call('DELETE', '/api/health');
  eq('wrong method', wrongMethod.status, 405);
  eq('wrong method code', wrongMethod.body?.error?.code, 'method_not_allowed');
  eq('wrong method allow', wrongMethod.headers.get('allow'), 'GET');

  const wrongType = await call('POST', '/api/session', { raw: '{}', contentType: 'text/plain' });
  eq('wrong content type', wrongType.status, 415);
  eq('wrong content type code', wrongType.body?.error?.code, 'unsupported_media_type');

  const tooBig = await call('POST', '/api/session', {
    raw: JSON.stringify({ email: 'a'.repeat(70_000) }),
    contentType: 'application/json',
  });
  eq('oversized json', tooBig.status, 413);
  eq('oversized json code', tooBig.body?.error?.code, 'payload_too_large');

  const exact = 'x'.repeat(65_536 - 13);
  const atLimit = await call('POST', '/api/session', {
    raw: `{"email":"${exact}"}`,
    contentType: 'application/json',
  });
  eq('json at the limit is allowed', atLimit.status, 401);

  const malformed = await call('POST', '/api/session', { raw: '{oops', contentType: 'application/json' });
  eq('malformed json', malformed.status, 400);
  eq('malformed json code', malformed.body?.error?.code, 'malformed_json');

  const notFoundScreen = await fetch(`${base}/not-a-screen`);
  eq('unknown screen status', notFoundScreen.status, 404);
  ok('unknown screen is html', (notFoundScreen.headers.get('content-type') ?? '').includes('text/html'));
  const railScreen = await fetch(`${base}/`);
  eq('rail screen status', railScreen.status, 200);
}

// ── Staff sign-in ─────────────────────────────────────────────────────────────
{
  const wrongPassword = await call('POST', '/api/session', {
    body: { email: 'margaux@atelier-ourlet.example', password: 'nope' },
  });
  const unknownEmail = await call('POST', '/api/session', {
    body: { email: 'nobody@atelier-ourlet.example', password: 'ourlet-owner-2027' },
  });
  eq('wrong password status', wrongPassword.status, 401);
  eq('unknown email status', unknownEmail.status, 401);
  eq('same code', wrongPassword.body?.error?.code, unknownEmail.body?.error?.code);

  const owner = await call('POST', '/api/session', {
    body: { email: 'margaux@atelier-ourlet.example', password: 'ourlet-owner-2027' },
    jar: 'owner',
  });
  eq('owner sign-in', owner.status, 200);
  eq('owner home route', owner.body?.homeRoute, '/staff/consignors');
  eq('owner role', owner.body?.member?.role, 'owner');
  const cookie = owner.headers.get('set-cookie') ?? '';
  ok('cookie name', cookie.startsWith('ourlet_session='), cookie);
  ok('cookie httponly', /HttpOnly/i.test(cookie), cookie);
  ok('cookie samesite lax', /SameSite=Lax/i.test(cookie), cookie);
  ok('cookie path', /Path=\//.test(cookie), cookie);
  ok('cookie has no max-age', !/Max-Age|Expires/i.test(cookie), cookie);

  await call('POST', '/api/session', {
    body: { email: 'noor@atelier-ourlet.example', password: 'ourlet-noor-2027' },
    jar: 'noor',
  });
  await call('POST', '/api/session', {
    body: { email: 'jules@atelier-ourlet.example', password: 'ourlet-jules-2027' },
    jar: 'jules',
  });
  const books = await call('POST', '/api/session', {
    body: { email: 'ines@atelier-ourlet.example', password: 'ourlet-ines-2027' },
    jar: 'ines',
  });
  eq('bookkeeper home route', books.body?.homeRoute, '/staff/sales-book');
  const assistant = await call('GET', '/api/session', { jar: 'noor' });
  eq('assistant home route', assistant.body?.homeRoute, '/staff/pieces');

  const noSession = await call('GET', '/api/session');
  eq('no session', noSession.status, 401);
  eq('no session code', noSession.body?.error?.code, 'unauthenticated');

  // a throwaway session that is signed out
  await call('POST', '/api/session', {
    body: { email: 'jules@atelier-ourlet.example', password: 'ourlet-jules-2027' },
    jar: 'temp',
  });
  const tempCookie = jars.get('temp') as string;
  const signedOut = await call('DELETE', '/api/session', { jar: 'temp' });
  eq('sign-out', signedOut.status, 204);
  const afterSignOut = await call('GET', '/api/session', { headers: { cookie: tempCookie } });
  eq('after sign-out status', afterSignOut.status, 401);
  eq('after sign-out code', afterSignOut.body?.error?.code, 'session_ended');
  const clearedCookie = signedOut.headers.get('set-cookie') ?? '';
  ok('sign-out clears the cookie', /ourlet_session=;/.test(clearedCookie), clearedCookie);

  const bookkeeperWrite = await call('POST', '/api/consignors', {
    jar: 'ines',
    body: { name: 'No', email: 'no@consignors.example' },
  });
  eq('bookkeeper write refused', bookkeeperWrite.status, 403);
  eq('bookkeeper write code', bookkeeperWrite.body?.error?.code, 'forbidden');
}

// ── Members ───────────────────────────────────────────────────────────────────
{
  const list = await call('GET', '/api/members', { jar: 'owner' });
  eq('members listed', list.body?.members?.length, 4);
  camelCase(list.body, 'members');
  allInstants(list.body, 'members');

  const notOwner = await call('GET', '/api/members', { jar: 'noor' });
  eq('members need the owner', notOwner.status, 403);

  const added = await call('POST', '/api/members', {
    jar: 'owner',
    body: { name: 'Lieve', email: 'lieve@atelier-ourlet.example', password: 'start-here-4821', role: 'assistant' },
  });
  eq('member added', added.status, 201);
  const lieveId = added.body?.member?.id as string;

  const dupe = await call('POST', '/api/members', {
    jar: 'owner',
    body: { name: 'Lieve', email: 'LIEVE@atelier-ourlet.example', password: 'start-here-4821', role: 'assistant' },
  });
  eq('member email taken', dupe.status, 409);
  eq('member email taken code', dupe.body?.error?.code, 'member_email_taken');

  const badRole = await call('POST', '/api/members', {
    jar: 'owner',
    body: { name: 'X', email: 'x@atelier-ourlet.example', password: 'start-here-4821', role: 'owner' },
  });
  eq('member bad role', badRole.status, 422);

  const reroled = await call('PATCH', `/api/members/${lieveId}`, {
    jar: 'owner',
    body: { role: 'bookkeeper' },
  });
  eq('member re-roled', reroled.body?.member?.role, 'bookkeeper');

  await call('POST', '/api/session', {
    body: { email: 'lieve@atelier-ourlet.example', password: 'start-here-4821' },
    jar: 'lieve',
  });
  const lieveSession = await call('GET', '/api/session', { jar: 'lieve' });
  eq('new member signs in', lieveSession.status, 200);

  const removed = await call('DELETE', `/api/members/${lieveId}`, { jar: 'owner' });
  eq('member removed', removed.status, 204);
  const afterRemoval = await call('GET', `/api/members/${lieveId}`, { jar: 'owner' });
  eq('removed member answers 404', afterRemoval.status, 404);
  const unknownMember = await call('GET', '/api/members/11111111-1111-1111-1111-111111111111', { jar: 'owner' });
  eq('unknown member answers 404', unknownMember.status, 404);
  const removedSignIn = await call('POST', '/api/session', {
    body: { email: 'lieve@atelier-ourlet.example', password: 'start-here-4821' },
  });
  eq('removed member cannot sign in', removedSignIn.status, 401);
  eq('removed member code', removedSignIn.body?.error?.code, 'invalid_credentials');
  const removedSession = await call('GET', '/api/session', { jar: 'lieve' });
  eq('removed member session ended', removedSession.status, 401);

  const ownerRow = (await call('GET', '/api/members', { jar: 'owner' })).body.members.find(
    (m: any) => m.role === 'owner',
  );
  const removeOwner = await call('DELETE', `/api/members/${ownerRow.id}`, { jar: 'owner' });
  eq('owner cannot be removed', removeOwner.status, 409);
  eq('owner removal code', removeOwner.body?.error?.code, 'cannot_remove_owner');
}

// ── The rail and the seeded ladder ────────────────────────────────────────────
let railBody: any;
{
  const rail = await call('GET', '/api/rail');
  railBody = rail.body;
  eq('rail status', rail.status, 200);
  eq('rail count', rail.body?.pieces?.length, 6);
  camelCase(rail.body, 'rail');

  const byTag = new Map(rail.body.pieces.map((p: any) => [p.tagCode, p]));
  eq('HG-1000042-0 price', (byTag.get('HG-1000042-0') as any)?.currentPriceCents, 3743);
  eq('HG-1000042-0 station', (byTag.get('HG-1000042-0') as any)?.station, 'off_25');
  eq('HG-1000042-0 previous price', (byTag.get('HG-1000042-0') as any)?.previousPriceCents, 4990);
  eq('HG-1000043-8 price', (byTag.get('HG-1000043-8') as any)?.currentPriceCents, 1990);
  eq('HG-1000043-8 previous price', (byTag.get('HG-1000043-8') as any)?.previousPriceCents, null);
  eq('HG-1000044-6 price', (byTag.get('HG-1000044-6') as any)?.currentPriceCents, 6000);
  eq('HG-1000046-1 price', (byTag.get('HG-1000046-1') as any)?.currentPriceCents, 1950);
  eq('HG-1000051-1 price', (byTag.get('HG-1000051-1') as any)?.currentPriceCents, 3500);
  eq('HG-1000052-9 price', (byTag.get('HG-1000052-9') as any)?.currentPriceCents, 6675);

  const order = rail.body.pieces.map((p: any) => p.tagCode);
  eq(
    'rail order newest intake first',
    order.join(','),
    'HG-1000043-8,HG-1000051-1,HG-1000052-9,HG-1000042-0,HG-1000044-6,HG-1000046-1',
  );
  ok('rail carries no consignor', !rail.text.includes('consignor'), rail.text.slice(0, 120));

  eq('rail bad category', (await call('GET', '/api/rail?category=hats')).status, 422);
  eq('rail bad size', (await call('GET', '/api/rail?size=xxl')).status, 422);
  eq('rail bad price band', (await call('GET', '/api/rail?price=cheap')).status, 422);
  eq(
    'rail unknown brand is empty',
    (await call('GET', '/api/rail?brand=Nothing')).body?.pieces?.length,
    0,
  );
  eq('rail category filter', (await call('GET', '/api/rail?category=coats')).body?.pieces?.length, 2);
  eq('rail size filter', (await call('GET', '/api/rail?size=m')).body?.pieces?.length, 2);
  eq('rail band under 50', (await call('GET', '/api/rail?price=under-50')).body?.pieces?.length, 4);
  eq('rail band 50-100', (await call('GET', '/api/rail?price=50-100')).body?.pieces?.length, 2);
  eq('rail search wool', (await call('GET', '/api/rail?q=wool')).body?.pieces?.length, 2);
  eq('rail search by tag code', (await call('GET', '/api/rail?q=hg10000420')).body?.pieces?.length, 1);
  eq('rail search by brand', (await call('GET', '/api/rail?q=linnea')).body?.pieces?.length, 1);
}

// ── Public piece page and the sold-piece lifetime ──────────────────────────────
{
  const onRail = railBody.pieces.find((p: any) => p.tagCode === 'HG-1000042-0');
  const page = await call('GET', `/api/public/pieces/${onRail.id}`);
  eq('public piece status', page.status, 200);
  eq('public piece stations', page.body?.piece?.stations?.length, 4);
  allInstants(page.body, 'public piece');
  const stations = page.body.piece.stations;
  eq('station 1 label', stations[0].label, 'Full price');
  eq('station 2 label', stations[1].label, '25% off');
  eq('station 3 label', stations[2].label, '50% off');
  eq('station 4 label', stations[3].label, 'Period ends');
  eq('station 1 state', stations[0].state, 'done');
  eq('station 2 state', stations[1].state, 'current');
  eq('station 3 state', stations[2].state, 'next');
  eq('station 1 price', stations[0].priceCents, 4990);
  eq('station 2 price', stations[1].priceCents, 3743);
  eq('station 3 price', stations[2].priceCents, 2495);
  eq('station 4 price', stations[3].priceCents, 2495);
  ok('public piece hides consignor', !page.text.includes('Zo'), page.text.slice(0, 200));

  const unknown = await call('GET', '/api/public/pieces/11111111-1111-1111-1111-111111111111');
  eq('unknown public piece', unknown.status, 404);

  const all = await call('GET', '/api/pieces', { jar: 'noor' });
  eq('staff pieces count', all.body?.pieces?.length, 12);
  const soldLongAgo = all.body.pieces.find((p: any) => p.tagCode === 'HG-1000049-5');
  const goneCheck = await call('GET', `/api/public/pieces/${soldLongAgo.id}`);
  eq('sold piece past its lifetime', goneCheck.status, 410);
  eq('sold piece gone code', goneCheck.body?.error?.code, 'piece_gone');
  eq('sold piece gone message', goneCheck.body?.error?.message, 'This piece has left the rail.');

  const soldRecently = all.body.pieces.find((p: any) => p.tagCode === 'HG-1000045-3');
  const stillThere = await call('GET', `/api/public/pieces/${soldRecently.id}`);
  eq('recently sold piece still shows', stillThere.status, 200);
  eq('recently sold status', stillThere.body?.piece?.status, 'sold');
  ok('recently sold carries soldAt', Z.test(stillThere.body?.piece?.soldAt), stillThere.body?.piece?.soldAt);

  const archived = all.body.pieces.find((p: any) => p.tagCode === 'HG-1000053-7');
  eq('archived piece hidden from the public', (await call('GET', `/api/public/pieces/${archived.id}`)).status, 404);
  eq('archived status', archived.status, 'archived');
  eq('returns shelf status', all.body.pieces.find((p: any) => p.tagCode === 'HG-1000047-9').status, 'returns_shelf');
  eq('donation box status', all.body.pieces.find((p: any) => p.tagCode === 'HG-1000048-7').status, 'donation_box');
  eq('choice open piece', all.body.pieces.find((p: any) => p.tagCode === 'HG-1000046-1').choice, null);
  eq('returns shelf choice', all.body.pieces.find((p: any) => p.tagCode === 'HG-1000047-9').choice, 'return');

  eq('pieces status filter', (await call('GET', '/api/pieces?status=sold', { jar: 'noor' })).body?.pieces?.length, 3);
  eq('pieces bad status', (await call('GET', '/api/pieces?status=nope', { jar: 'noor' })).status, 422);
}

// ── Tag codes ─────────────────────────────────────────────────────────────────
{
  const lower = await call('GET', '/api/pieces/lookup?tag=hg10000420', { jar: 'noor' });
  eq('lookup lower no dash', lower.body?.piece?.tagCode, 'HG-1000042-0');
  const dashed = await call('GET', '/api/pieces/lookup?tag=HG-1000042-0', { jar: 'noor' });
  eq('lookup dashed', dashed.body?.piece?.tagCode, 'HG-1000042-0');
  const badCheck = await call('GET', '/api/pieces/lookup?tag=HG-1000042-1', { jar: 'noor' });
  eq('lookup bad check digit', badCheck.status, 422);
  eq('lookup bad check message', badCheck.body?.error?.fields?.tag, `This tag code's check digit doesn't match.`);
  const noPiece = await call('GET', '/api/pieces/lookup?tag=HG-9999999-7', { jar: 'noor' });
  eq('lookup well-formed unknown code', noPiece.status, 404);
}

// ── Intake ────────────────────────────────────────────────────────────────────
let newPieceId = '';
{
  const consignors = await call('GET', '/api/consignors', { jar: 'noor' });
  const zoe = consignors.body.consignors.find((c: any) => c.name.startsWith('Zo'));
  eq('consignor iban stored form', zoe.iban, 'BE21001234567803');
  eq('consignor iban valid', zoe.ibanValid, true);
  const lotte = consignors.body.consignors.find((c: any) => c.name === 'Lotte Janssens');
  eq('seeded invalid iban', lotte.ibanValid, false);

  const today = brusselsDate(Date.now());

  const twoRules = await call('POST', '/api/pieces', {
    jar: 'noor',
    body: {
      consignorId: '11111111-1111-1111-1111-111111111111',
      category: 'coats',
      brand: 'X',
      description: 'Y',
      size: 'm',
      condition: 'good',
      askingPriceCents: 1,
      intakeDate: today,
    },
  });
  eq('unknown consignor beats a bad price', twoRules.status, 404);

  const badFields = await call('POST', '/api/pieces', {
    jar: 'noor',
    body: {
      consignorId: zoe.id,
      category: 'hats',
      brand: '',
      description: '',
      size: 'xxl',
      condition: 'mint',
      askingPriceCents: 1,
      intakeDate: addDays(today, 1),
    },
  });
  eq('intake field problems', badFields.status, 422);
  eq('asking price message', badFields.body?.error?.fields?.askingPriceCents, 'Enter a price from €1.00 to €10,000.00.');
  eq('intake date message', badFields.body?.error?.fields?.intakeDate, 'Choose today or a date up to 730 days back.');

  const created = await call('POST', '/api/pieces', {
    jar: 'noor',
    body: {
      consignorId: zoe.id,
      category: 'coats',
      brand: 'Maison Arlo',
      description: 'Wool wrap coat, camel',
      size: 'm',
      condition: 'very_good',
      askingPriceCents: 4990,
      intakeDate: today,
    },
  });
  eq('piece created', created.status, 201);
  eq('next tag code', created.body?.piece?.tagCode, 'HG-1000054-5');
  eq('new piece station', created.body?.piece?.station, 'full_price');
  eq('new piece price', created.body?.piece?.currentPriceCents, 4990);
  eq('new piece version', created.body?.piece?.version, 1);
  allInstants(created.body, 'new piece');
  camelCase(created.body, 'new piece');
  newPieceId = created.body.piece.id;

  const reload = await call('GET', `/api/pieces/${newPieceId}`, { jar: 'noor' });
  eq('new piece reloads', reload.body?.piece?.tagCode, 'HG-1000054-5');

  // price edit
  const edited = await call('PATCH', `/api/pieces/${newPieceId}`, {
    jar: 'owner',
    body: { askingPriceCents: 4500 },
    headers: { 'If-Match': '"1"' },
  });
  eq('price edited', edited.status, 200);
  eq('price edited value', edited.body?.piece?.currentPriceCents, 4500);
  eq('price edited version', edited.body?.piece?.version, 2);
  eq('price edited previous', edited.body?.piece?.previousPriceCents, 4990);
  eq('station 2 follows the new price', edited.body?.piece?.stations?.[1]?.priceCents, 3375);

  const stale = await call('PATCH', `/api/pieces/${newPieceId}`, {
    jar: 'owner',
    body: { askingPriceCents: 4000 },
    headers: { 'If-Match': '"1"' },
  });
  eq('stale edit', stale.status, 412);
  eq('stale edit code', stale.body?.error?.code, 'stale_edit');

  const badPriceStale = await call('PATCH', `/api/pieces/${newPieceId}`, {
    jar: 'owner',
    body: { askingPriceCents: 1 },
    headers: { 'If-Match': '"1"' },
  });
  eq('a bad price beats a stale edit', badPriceStale.status, 422);

  const assistantEdit = await call('PATCH', `/api/pieces/${newPieceId}`, {
    jar: 'noor',
    body: { askingPriceCents: 4000 },
  });
  eq('only the owner edits a price', assistantEdit.status, 403);
}

// ── Photos ────────────────────────────────────────────────────────────────────
{
  const png = (width: number, height: number): Buffer => {
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    const crc = (buffer: Buffer): number => {
      let c = 0xffffffff;
      for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      const checksum = Buffer.alloc(4);
      checksum.writeUInt32BE(crc(body));
      return Buffer.concat([length, body, checksum]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const raw = Buffer.alloc(height * (1 + width * 3));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = y * (1 + width * 3) + 1 + x * 3;
        raw[at] = 200;
        raw[at + 1] = 90;
        raw[at + 2] = 60;
      }
    }
    const zlib = require('node:zlib') as typeof import('node:zlib');
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  };

  const multipart = (name: string, filename: string, type: string, bytes: Buffer): { body: Buffer; contentType: string } => {
    const boundary = '----ourletcheck';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
      'latin1',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1');
    return { body: Buffer.concat([head, bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
  };

  const small = multipart('photo', 'coat.txt', 'text/plain', png(2200, 400));
  const saved = await call('POST', `/api/pieces/${newPieceId}/photos`, {
    jar: 'noor',
    raw: small.body,
    contentType: small.contentType,
  });
  eq('photo saved despite its file name', saved.status, 201);
  eq('photo content type by content', saved.body?.photo?.contentType, 'image/png');
  eq('public copy longest side', saved.body?.photo?.width, 1600);
  eq('public copy height', saved.body?.photo?.height, 291);
  const photoId = saved.body.photo.id as string;

  const notAnImage = multipart('photo', 'coat.png', 'image/png', Buffer.from('definitely not a photo'));
  const refused = await call('POST', `/api/pieces/${newPieceId}/photos`, {
    jar: 'noor',
    raw: notAnImage.body,
    contentType: notAnImage.contentType,
  });
  eq('wrong photo content', refused.status, 422);
  eq('wrong photo message', refused.body?.error?.fields?.photo, 'Use a JPEG, PNG or WebP photo.');

  const oversized = multipart('photo', 'big.png', 'image/png', Buffer.alloc(5_000_001, 0x89));
  const tooBig = await call('POST', `/api/pieces/${newPieceId}/photos`, {
    jar: 'noor',
    raw: oversized.body,
    contentType: oversized.contentType,
  });
  eq('oversized photo file', tooBig.status, 413);
  eq('oversized photo message', tooBig.body?.error?.message, 'This photo is over 5,000,000 bytes.');

  const hugeBody = multipart('photo', 'big.png', 'image/png', Buffer.alloc(6_000_001, 0x89));
  const bodyTooBig = await call('POST', `/api/pieces/${newPieceId}/photos`, {
    jar: 'noor',
    raw: hugeBody.body,
    contentType: hugeBody.contentType,
  });
  eq('oversized photo body', bodyTooBig.status, 413);

  const publicBytes = await fetch(`${base}/api/photos/${photoId}`);
  eq('public copy served', publicBytes.status, 200);
  const publicBuffer = Buffer.from(await publicBytes.arrayBuffer());
  ok('public copy is a png', publicBuffer.subarray(1, 4).toString('latin1') === 'PNG');
  ok('public copy has no exif', !publicBuffer.includes(Buffer.from('eXIf', 'latin1')));

  const originalAsOwner = await call('GET', `/api/photos/${photoId}/original`, { jar: 'owner' });
  eq('owner downloads the original', originalAsOwner.status, 200);
  const originalAsAssistant = await call('GET', `/api/photos/${photoId}/original`, { jar: 'noor' });
  eq('only the owner downloads the original', originalAsAssistant.status, 403);
  const originalAnonymous = await call('GET', `/api/photos/${photoId}/original`);
  eq('the public cannot download the original', originalAnonymous.status, 401);

  const piece = await call('GET', `/api/pieces/${newPieceId}`, { jar: 'noor' });
  eq('piece lists its photo', piece.body?.piece?.photos?.length, 1);
  eq('rail piece carries photo urls', piece.body?.piece?.photoUrls?.[0], `/api/photos/${photoId}`);
}

// ── Holds ─────────────────────────────────────────────────────────────────────
let holdToken = '';
{
  const rail = await call('GET', '/api/rail');
  const target = rail.body.pieces.find((p: any) => p.tagCode === 'HG-1000051-1');

  const badFields = await call('POST', `/api/pieces/${target.id}/holds`, {
    body: { name: '', email: 'nope' },
  });
  eq('hold field problems', badFields.status, 422);
  eq('hold name message', badFields.body?.error?.fields?.name, 'Enter a name.');
  eq('hold email message', badFields.body?.error?.fields?.email, 'Enter an email address like name@example.be.');

  const unknownPiece = await call('POST', '/api/pieces/11111111-1111-1111-1111-111111111111/holds', {
    body: { name: '', email: 'nope' },
  });
  eq('an unknown piece beats field problems', unknownPiece.status, 404);

  const held = await call('POST', `/api/pieces/${target.id}/holds`, {
    body: { name: 'Camille', email: 'camille@shoppers.example' },
  });
  eq('hold placed', held.status, 201);
  eq('hold status', held.body?.hold?.status, 'active');
  allInstants(held.body, 'hold');
  const startsAt = Date.parse(held.body.hold.startsAt);
  const endsAt = Date.parse(held.body.hold.endsAt);
  eq('hold lasts HOLD_SECONDS', (endsAt - startsAt) / 1000, 7200);

  const second = await call('POST', `/api/pieces/${target.id}/holds`, {
    body: { name: 'Other', email: 'other@shoppers.example' },
  });
  eq('one hold per piece', second.status, 409);
  eq('hold taken code', second.body?.error?.code, 'hold_taken');
  ok(
    'hold taken copy',
    /^Someone else is holding this piece until \d{2}:\d{2}\.$/.test(second.body?.error?.message ?? ''),
    second.body?.error?.message,
  );

  const railAfter = await call('GET', '/api/rail');
  eq(
    'held piece shows on hold',
    railAfter.body.pieces.find((p: any) => p.tagCode === 'HG-1000051-1')?.status,
    'on_hold',
  );

  const holds = await call('GET', '/api/holds', { jar: 'noor' });
  eq('holds listed', holds.body?.holds?.length, 1);
  eq('hold tag code', holds.body?.holds?.[0]?.tagCode, 'HG-1000051-1');
  const holdId = holds.body.holds[0].id as string;

  const holdRow = await call('GET', `/api/holds/${holdId}`, { jar: 'noor' });
  eq('hold row', holdRow.body?.hold?.shopperName, 'Camille');

  const mails = await (await fetch(`${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/search?query=camille%40shoppers.example`)).json() as any;
  eq('one hold mail', mails.messages_count, 1);
  const mail = mails.messages[0];
  ok('hold mail subject', /^Your hold at Atelier Ourlet until \d{2}:\d{2}$/.test(mail.Subject), mail.Subject);
  const mailBody = await (await fetch(`${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/message/${mail.ID}`)).json() as any;
  ok('hold mail has the tag code', mailBody.Text.includes('HG-1000051-1'), mailBody.Text);
  ok('hold mail has the shop address', mailBody.Text.includes(`Rue de l'Ourlet 12, 1000 Brussels`), mailBody.Text);
  ok('hold mail has no shopper name', !mailBody.Text.includes('Camille'), mailBody.Text);
  const tokenMatch = /\/h\/([A-Za-z0-9_-]+)/.exec(mailBody.Text);
  ok('hold mail has the hold page address', tokenMatch !== null, mailBody.Text);
  holdToken = tokenMatch?.[1] ?? '';

  const page = await call('GET', `/api/holds/by-token/${holdToken}`);
  eq('hold page', page.status, 200);
  eq('hold page shop address', page.body?.hold?.shopAddress, `Rue de l'Ourlet 12, 1000 Brussels`);
  eq('hold page tag code', page.body?.hold?.piece?.tagCode, 'HG-1000051-1');
  ok('hold page seconds left', page.body?.hold?.secondsLeft > 7000, page.body?.hold?.secondsLeft);
  ok('hold page carries no shopper', !page.text.includes('Camille'), page.text);
  eq('unknown hold token', (await call('GET', '/api/holds/by-token/nope')).status, 404);

  const letGo = await call('POST', `/api/holds/by-token/${holdToken}/release`);
  eq('let the hold go', letGo.status, 200);
  eq('released status', letGo.body?.hold?.status, 'released');
  const again = await call('POST', `/api/holds/by-token/${holdToken}/release`);
  eq('releasing twice', again.status, 409);
  eq('releasing twice code', again.body?.error?.code, 'hold_ended');

  const soldPiece = (await call('GET', '/api/pieces?status=sold', { jar: 'noor' })).body.pieces[0];
  const holdSold = await call('POST', `/api/pieces/${soldPiece.id}/holds`, {
    body: { name: 'Camille', email: 'camille@shoppers.example' },
  });
  eq('a sold piece is not for sale', holdSold.status, 409);
  eq('not for sale code', holdSold.body?.error?.code, 'not_for_sale');
}

// ── The till ──────────────────────────────────────────────────────────────────
let saleId = '';
{
  const rail = await call('GET', '/api/rail');
  const target = rail.body.pieces.find((p: any) => p.tagCode === 'HG-1000044-6');

  const badPayment = await call('POST', '/api/sales', {
    jar: 'noor',
    body: { pieceId: target.id, payment: 'cheque' },
  });
  eq('bad payment', badPayment.status, 422);

  const unknownPiece = await call('POST', '/api/sales', {
    jar: 'noor',
    body: { pieceId: '11111111-1111-1111-1111-111111111111', payment: 'cheque' },
  });
  eq('an unknown piece beats a bad payment', unknownPiece.status, 404);

  const sold = await call('POST', '/api/sales', {
    jar: 'noor',
    body: { pieceId: target.id, payment: 'card' },
    headers: { 'Request-Key': 'till-check-1' },
  });
  eq('sale recorded', sold.status, 201);
  eq('sale price is the price in force', sold.body?.sale?.priceCents, 6000);
  eq('sale share 60 per cent', sold.body?.sale?.consignorShareCents, 3600);
  eq('sale commission', sold.body?.sale?.commissionCents, 2400);
  eq('sale vat', sold.body?.sale?.vatCents, 417);
  eq('sale sold by', sold.body?.sale?.soldBy?.name, 'Noor');
  eq('sale tag code', sold.body?.sale?.tagCode, 'HG-1000044-6');
  allInstants(sold.body, 'sale');
  camelCase(sold.body, 'sale');
  saleId = sold.body.sale.id;

  const repeated = await call('POST', '/api/sales', {
    jar: 'noor',
    body: { pieceId: target.id, payment: 'card' },
    headers: { 'Request-Key': 'till-check-1' },
  });
  eq('repeated request key answers the first response', repeated.status, 201);
  eq('repeated request key records one sale', repeated.body?.sale?.id, saleId);

  const differentBody = await call('POST', '/api/sales', {
    jar: 'noor',
    body: { pieceId: target.id, payment: 'cash' },
    headers: { 'Request-Key': 'till-check-1' },
  });
  eq('same key different body', differentBody.status, 409);
  eq('same key different body code', differentBody.body?.error?.code, 'request_key_reused');

  const soldAgain = await call('POST', '/api/sales', {
    jar: 'jules',
    body: { pieceId: target.id, payment: 'cash' },
  });
  eq('already sold', soldAgain.status, 409);
  eq('already sold code', soldAgain.body?.error?.code, 'already_sold');
  ok(
    'already sold copy',
    /^Sold by Noor at \d{2}:\d{2}\. Nothing was charged\.$/.test(soldAgain.body?.error?.message ?? ''),
    soldAgain.body?.error?.message,
  );

  const railWithSale = await call('GET', '/api/rail');
  eq(
    'a piece sold today still shows on the rail',
    railWithSale.body.pieces.find((p: any) => p.tagCode === 'HG-1000044-6')?.status,
    'sold',
  );

  const refunded = await call('POST', `/api/sales/${saleId}/refund`, { jar: 'noor' });
  eq('refund recorded', refunded.status, 200);
  ok('refund instant', Z.test(refunded.body?.sale?.refundedAt), refunded.body?.sale?.refundedAt);
  eq(
    'refunded piece is back on the rail',
    (await call('GET', `/api/pieces/${target.id}`, { jar: 'noor' })).body?.piece?.status,
    'on_rail',
  );
  const refundTwice = await call('POST', `/api/sales/${saleId}/refund`, { jar: 'noor' });
  eq('already refunded', refundTwice.status, 409);
  eq('already refunded code', refundTwice.body?.error?.code, 'already_refunded');

  // an earlier sale, and its refund window
  const earlier = await call('POST', '/api/sales', {
    jar: 'noor',
    body: {
      pieceId: target.id,
      payment: 'cash',
      soldAt: isoSeconds(startOfBrusselsDay(addDays(brusselsDate(Date.now()), -13)) + 12 * 3_600_000),
    },
  });
  eq('earlier sale recorded', earlier.status, 201);
  eq('earlier sale price in force then', earlier.body?.sale?.priceCents, 9000);
  const earlierRefund = await call('POST', `/api/sales/${earlier.body.sale.id}/refund`, { jar: 'noor' });
  eq('a sale 13 days back can be refunded', earlierRefund.status, 200);

  const tooOld = await call('POST', '/api/sales', {
    jar: 'noor',
    body: {
      pieceId: target.id,
      payment: 'cash',
      soldAt: isoSeconds(startOfBrusselsDay(addDays(brusselsDate(Date.now()), -16)) + 12 * 3_600_000),
    },
  });
  eq('a sale 16 days back is recorded', tooOld.status, 201);
  const tooOldRefund = await call('POST', `/api/sales/${tooOld.body.sale.id}/refund`, { jar: 'noor' });
  eq('a sale 16 days back cannot be refunded', tooOldRefund.status, 409);
  eq('refund window code', tooOldRefund.body?.error?.code, 'refund_window_closed');
  eq('refund window copy', tooOldRefund.body?.error?.message, 'This sale can no longer be refunded.');

  const ahead = await call('POST', '/api/sales', {
    jar: 'noor',
    body: { pieceId: target.id, payment: 'cash', soldAt: isoSeconds(Date.now() + 86_400_000) },
  });
  eq('a sale ahead of now is refused', ahead.status, 422);

  const shelfPiece = (await call('GET', '/api/pieces?status=donation_box', { jar: 'noor' })).body.pieces[0];
  const sellShelf = await call('POST', '/api/sales', {
    jar: 'noor',
    body: { pieceId: shelfPiece.id, payment: 'cash' },
  });
  eq('a donation box piece is not for sale', sellShelf.status, 409);
  eq('not for sale code', sellShelf.body?.error?.code, 'not_for_sale');

  const bookkeeperReads = await call('GET', `/api/sales/${saleId}`, { jar: 'ines' });
  eq('the bookkeeper reads a sale', bookkeeperReads.status, 200);
}

// ── Sales book ────────────────────────────────────────────────────────────────
{
  const thisMonth = monthOf(brusselsDate(Date.now()));
  const lastMonth = addMonths(thisMonth, -1);

  const bookAsAssistant = await call('GET', `/api/sales?month=${thisMonth}`, { jar: 'noor' });
  eq('sales book needs the books', bookAsAssistant.status, 403);

  const month = await call('GET', `/api/sales?month=${thisMonth}`, { jar: 'ines' });
  eq('sales listed', month.status, 200);
  camelCase(month.body, 'sales');
  allInstants(month.body, 'sales');
  const sums = month.body.lines.reduce(
    (total: any, line: any) => ({
      priceCents: total.priceCents + line.priceCents,
      consignorShareCents: total.consignorShareCents + line.consignorShareCents,
      commissionCents: total.commissionCents + line.commissionCents,
      vatCents: total.vatCents + line.vatCents,
    }),
    { priceCents: 0, consignorShareCents: 0, commissionCents: 0, vatCents: 0 },
  );
  eq('totals match the lines', JSON.stringify(month.body.totals), JSON.stringify(sums));
  eq('bad month', (await call('GET', '/api/sales?month=nope', { jar: 'ines' })).status, 422);

  const file = await fetch(`${base}/api/sales-book?month=${lastMonth}`, {
    headers: { cookie: jars.get('ines') as string },
  });
  eq('sales book file status', file.status, 200);
  eq('sales book content type', file.headers.get('content-type'), 'text/csv; charset=utf-8');
  eq(
    'sales book attachment',
    file.headers.get('content-disposition'),
    `attachment; filename="sales-book-${lastMonth}.csv"`,
  );
  const csv = await file.text();
  const lines = csv.split('\r\n');
  eq(
    'sales book header',
    lines[0],
    '"Sale date","Tag code","Description","Sale price","Consignor share","Commission","VAT"',
  );
  ok('sales book uses CRLF', csv.includes('\r\n'), 'no CRLF');
  ok('sales book has no BOM', csv.charCodeAt(0) !== 0xfeff, 'BOM found');
  const totalLine = lines.filter((l) => l !== '').at(-1) as string;
  ok('sales book totals row', totalLine.startsWith('"Total","",""'), totalLine);

  for (let attempt = 2; attempt <= 5; attempt += 1) {
    const more = await call('GET', `/api/sales-book?month=${lastMonth}`, { jar: 'ines' });
    eq(`sales book download ${attempt}`, more.status, 200);
  }
  const sixth = await call('GET', `/api/sales-book?month=${lastMonth}`, { jar: 'ines' });
  eq('sixth sales book download', sixth.status, 429);
  eq('download limit code', sixth.body?.error?.code, 'rate_limited');
  eq(
    'download limit copy',
    sixth.body?.error?.message,
    `You've downloaded the sales book 5 times in a short while. Try again in a moment.`,
  );
  ok('download limit retry-after', Number(sixth.headers.get('retry-after')) > 0, sixth.headers.get('retry-after'));
  const otherMember = await call('GET', `/api/sales-book?month=${lastMonth}`, { jar: 'owner' });
  eq('the limit is counted per member', otherMember.status, 200);
}

// ── Payout runs ───────────────────────────────────────────────────────────────
{
  const thisMonth = monthOf(brusselsDate(Date.now()));
  const lastMonth = addMonths(thisMonth, -1);

  const notEnded = await call('POST', '/api/payout-runs', { jar: 'owner', body: { month: thisMonth } });
  eq('month not ended', notEnded.status, 409);
  eq('month not ended code', notEnded.body?.error?.code, 'month_not_ended');

  const badMonth = await call('POST', '/api/payout-runs', { jar: 'owner', body: { month: 'nope' } });
  eq('a bad month beats the state', badMonth.status, 422);

  const notOwner = await call('POST', '/api/payout-runs', { jar: 'noor', body: { month: lastMonth } });
  eq('only the owner starts a run', notOwner.status, 403);

  const run = await call('POST', '/api/payout-runs', { jar: 'owner', body: { month: lastMonth } });
  ok('payout run started or nothing due', run.status === 201 || run.status === 409, `${run.status} ${run.text}`);

  if (run.status === 201) {
    eq('run is ready', run.body?.run?.status, 'ready');
    eq('run msg id', run.body?.run?.msgId, `PAYOUT-${lastMonth}`);
    allInstants(run.body, 'run');
    camelCase(run.body, 'run');
    const payouts = run.body.run.payouts as any[];
    ok('payout ids', payouts.every((p, i) => p.id === `PO-${lastMonth}-${String(i + 1).padStart(3, '0')}`), JSON.stringify(payouts.map((p) => p.id)));
    const heldBack = payouts.filter((p) => p.status === 'held_back');
    for (const payout of heldBack) {
      eq('held back reason', payout.reason, 'No valid IBAN on file — held back until the next run.');
    }
    const paid = payouts.filter((p) => p.status === 'paid');
    eq(
      'control sum matches the paid payouts',
      run.body.run.controlSumCents,
      paid.reduce((sum, p) => sum + p.amountCents, 0),
    );

    const again = await call('POST', '/api/payout-runs', { jar: 'owner', body: { month: lastMonth } });
    eq('a second start gives the same run', again.status, 200);
    eq('a second start names who started it', again.body?.run?.startedBy?.name, 'Margaux');
    eq('a second start keeps the same instant', again.body?.run?.startedAt, run.body.run.startedAt);

    const file = await fetch(`${base}/api/payout-runs/${lastMonth}/file`, {
      headers: { cookie: jars.get('ines') as string },
    });
    eq('bank file status', file.status, 200);
    eq('bank file content type', file.headers.get('content-type'), 'application/xml');
    const xml = await file.text();
    ok('bank file namespace', xml.includes('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'), xml.slice(0, 200));
    ok('bank file msg id', xml.includes(`<MsgId>PAYOUT-${lastMonth}</MsgId>`), xml.slice(0, 400));
    ok('bank file payment method', xml.includes('<PmtMtd>TRF</PmtMtd>'), 'no PmtMtd');
    ok('bank file service level', xml.includes('<Cd>SEPA</Cd>'), 'no SvcLvl');
    ok('bank file charge bearer', xml.includes('<ChrgBr>SLEV</ChrgBr>'), 'no ChrgBr');
    ok('bank file debtor agent', xml.includes('<Id>NOTPROVIDED</Id>'), 'no DbtrAgt');
    ok('bank file shop iban', xml.includes('<IBAN>BE68539007547034</IBAN>'), 'no shop IBAN');
    ok('bank file initiating party', xml.includes('<Nm>Atelier Ourlet SRL</Nm>'), 'no InitgPty');
    ok('bank file transfer count', xml.includes(`<NbOfTxs>${paid.length}</NbOfTxs>`), 'wrong NbOfTxs');
    ok('bank file sepa names', xml.includes('<Nm>Zoe Orsted-Haek</Nm>') || paid.length === 0, 'no SEPA name');
    ok('bank file remittance', /<Ustrd>Consignment payout [A-Z][a-z]+ \d{4}<\/Ustrd>/.test(xml), 'no RmtInf');
    ok('bank file hides held-back payouts', heldBack.every((p) => !xml.includes(p.id)), 'held back in the file');

    const refundInRun = await call('POST', `/api/sales/${saleId}/refund`, { jar: 'noor' });
    ok('a sale already refunded stays refused', refundInRun.status === 409, String(refundInRun.status));

    const runRow = await call('GET', `/api/payout-runs/${lastMonth}`, { jar: 'ines' });
    eq('run read by the bookkeeper', runRow.status, 200);
    const runs = await call('GET', '/api/payout-runs', { jar: 'ines' });
    eq('runs listed', runs.body?.runs?.length, 1);
    ok('listed runs carry no payouts', runs.body.runs[0].payouts === undefined, JSON.stringify(runs.body.runs[0]));

    const statements = (await (
      await fetch(`${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/search?query=subject%3Astatement`)
    ).json()) as any;
    ok('one statement per consignor in the run', statements.messages_count >= paid.length, String(statements.messages_count));
    const statement = statements.messages[0];
    ok('statement subject', /^Your Atelier Ourlet statement for [A-Z][a-z]+ \d{4}$/.test(statement.Subject), statement.Subject);
    const statementBody = (await (
      await fetch(`${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/message/${statement.ID}`)
    ).json()) as any;
    ok('statement hides the full iban', !/BE\d{14}/.test(statementBody.Text), statementBody.Text);
    ok('statement hides commission', !statementBody.Text.toLowerCase().includes('commission'), statementBody.Text);
  }

  const unknownRun = await call('GET', '/api/payout-runs/1999-01', { jar: 'ines' });
  eq('unknown run', unknownRun.status, 404);
}

// ── Consignors and the consignor page ─────────────────────────────────────────
{
  const badIban = await call('POST', '/api/consignors', {
    jar: 'noor',
    body: { name: 'Bad', email: 'bad@consignors.example', iban: 'BE68 5390 0754 7035' },
  });
  eq('an invalid iban is refused', badIban.status, 422);
  eq('iban message', badIban.body?.error?.fields?.iban, 'Enter a valid IBAN, for example BE68 5390 0754 7034.');

  const created = await call('POST', '/api/consignors', {
    jar: 'noor',
    body: {
      name: 'Amélie Kint',
      email: 'amelie.kint@consignors.example',
      phone: '+32 471 22 33 44',
      iban: 'be35 3101 2345 6737',
    },
  });
  eq('consignor created', created.status, 201);
  eq('iban stored without spaces in upper case', created.body?.consignor?.iban, 'BE35310123456737');
  eq('consignor status', created.body?.consignor?.status, 'active');

  const dupe = await call('POST', '/api/consignors', {
    jar: 'noor',
    body: { name: 'Other', email: 'AMELIE.KINT@consignors.example' },
  });
  eq('consignor email taken', dupe.status, 409);
  eq('consignor email taken code', dupe.body?.error?.code, 'consignor_email_taken');

  const consignors = await call('GET', '/api/consignors', { jar: 'noor' });
  const lotte = consignors.body.consignors.find((c: any) => c.name === 'Lotte Janssens');

  const link = await call('POST', `/api/consignors/${lotte.id}/portal-link`, { jar: 'noor' });
  eq('page address sent', link.status, 201);
  ok('page address ends at', Z.test(link.body?.pageEndsAt), link.body?.pageEndsAt);

  const mails = (await (
    await fetch(`${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/search?query=lotte.janssens%40consignors.example`)
  ).json()) as any;
  const portalMail = mails.messages.find((m: any) => m.Subject === 'Your Atelier Ourlet consignor page');
  ok('consignor page mail', portalMail !== undefined, JSON.stringify(mails.messages?.map((m: any) => m.Subject)));
  const portalBody = (await (
    await fetch(`${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/message/${portalMail.ID}`)
  ).json()) as any;
  const portalToken = (/\/c\/([A-Za-z0-9_-]+)/.exec(portalBody.Text) ?? [])[1] as string;
  ok('consignor page address in the mail', portalToken !== undefined, portalBody.Text);

  const page = await call('GET', `/api/portal/${portalToken}`);
  eq('consignor page', page.status, 200);
  camelCase(page.body, 'portal');
  allInstants(page.body, 'portal');
  eq('consignor page name', page.body?.consignor?.name, 'Lotte Janssens');
  eq('consignor page iban last four', page.body?.consignor?.ibanLast4, '7035');
  eq('consignor page iban not valid', page.body?.consignor?.ibanValid, false);
  ok('consignor page hides the full iban', !page.text.includes('BE68539007547035'), page.text);
  ok('consignor page hides commission', !page.text.includes('commission'), page.text);
  ok('consignor page hides shopper data', !page.text.toLowerCase().includes('shopper'), page.text);
  eq('consignor page lists only their pieces', page.body?.pieces?.length, 2);
  const openPiece = page.body.pieces.find((p: any) => p.tagCode === 'HG-1000046-1');
  eq('choice open', openPiece?.choiceOpen, true);
  eq('choice not yet made', openPiece?.choice, null);

  const otherConsignorPiece = (await call('GET', '/api/pieces', { jar: 'noor' })).body.pieces.find(
    (p: any) => p.tagCode === 'HG-1000042-0',
  );
  const notTheirs = await call('GET', `/api/portal/${portalToken}/pieces/${otherConsignorPiece.id}`);
  eq(`another consignor's piece answers 404`, notTheirs.status, 404);

  const notTheirsChoice = await call('PUT', `/api/portal/${portalToken}/choices`, {
    body: { choices: [{ pieceId: otherConsignorPiece.id, choice: 'return' }] },
  });
  eq(`another consignor's piece in a choices body answers 404`, notTheirsChoice.status, 404);

  const saved = await call('PUT', `/api/portal/${portalToken}/choices`, {
    body: { choices: [{ pieceId: openPiece.id, choice: 'return' }] },
  });
  eq('choices saved', saved.status, 200);
  eq(
    'choice recorded',
    saved.body.pieces.find((p: any) => p.id === openPiece.id)?.choice,
    'return',
  );

  const closedPiece = page.body.pieces.find((p: any) => p.tagCode !== 'HG-1000046-1');
  if (closedPiece !== undefined) {
    const closed = await call('PUT', `/api/portal/${portalToken}/choices`, {
      body: { choices: [{ pieceId: closedPiece.id, choice: 'donate' }] },
    });
    eq('a closed choice is refused', closed.status, 409);
    eq('closed choice code', closed.body?.error?.code, 'choice_closed');
    ok(
      'closed choice copy',
      /^The choice for HG-\d{7}-\d is closed\.$/.test(closed.body?.error?.message ?? ''),
      closed.body?.error?.message,
    );
  }

  // a new page address ends the old one
  const second = await call('POST', `/api/consignors/${lotte.id}/portal-link`, { jar: 'noor' });
  eq('a second page address', second.status, 201);
  const oldPage = await call('GET', `/api/portal/${portalToken}`);
  eq('the old page address has ended', oldPage.status, 410);
  eq('old page code', oldPage.body?.error?.code, 'page_ended');
  eq('old page copy', oldPage.body?.error?.message, 'This page has ended. Ask the shop for a new link.');
  eq('an unknown page token answers 404', (await call('GET', '/api/portal/nope')).status, 404);

  const endedByOwner = await call('DELETE', `/api/consignors/${lotte.id}/portal-link`, { jar: 'owner' });
  eq('the owner ends a page address', endedByOwner.status, 204);
  const endedByAssistant = await call('DELETE', `/api/consignors/${lotte.id}/portal-link`, { jar: 'noor' });
  eq('only the owner ends a page address', endedByAssistant.status, 403);
}

// ── Appointments ──────────────────────────────────────────────────────────────
{
  const slots = await call('GET', '/api/appointment-slots');
  eq('slots status', slots.status, 200);
  camelCase(slots.body, 'slots');
  allInstants(slots.body, 'slots');
  eq('first week has no previous week', slots.body?.previousWeek, null);
  ok('first week has a next week', slots.body?.nextWeek !== null, String(slots.body?.nextWeek));
  ok('slots exist', slots.body.slots.length > 0, String(slots.body.slots.length));
  const perDay = new Map<string, number>();
  for (const slot of slots.body.slots) {
    const day = slot.startsAt.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  ok(
    'a full open day has 24 slots',
    [...perDay.values()].some((count) => count === 24),
    JSON.stringify([...perDay.entries()]),
  );

  eq('a week that is not a Monday', (await call('GET', '/api/appointment-slots?week=2027-03-30')).status, 422);
  eq('a week outside the range', (await call('GET', '/api/appointment-slots?week=2020-03-30')).status, 422);
  const dstWeek = await call('GET', '/api/appointment-slots?week=2027-03-29');
  if (dstWeek.status === 200) {
    const tuesday = dstWeek.body.slots.find((s: any) => s.startsAt.startsWith('2027-03-30'));
    eq('a slot keeps its wall clock across a clock change', tuesday?.startsAt, '2027-03-30T08:00:00Z');
  }

  const free = slots.body.slots.find((s: any) => s.free);
  const badSlot = await call('POST', '/api/appointments', {
    body: { startsAt: '2027-03-30T08:07:00Z', name: 'Amélie Kint', email: 'book1@consignors.example' },
  });
  eq('an instant that is not a slot', badSlot.status, 422);
  eq('bad slot field', Object.keys(badSlot.body?.error?.fields ?? {})[0], 'startsAt');

  const booked = await call('POST', '/api/appointments', {
    body: { startsAt: free.startsAt, name: 'Amélie Kint', email: 'book1@consignors.example' },
  });
  eq('booking created', booked.status, 201);
  allInstants(booked.body, 'appointment');
  eq('slot is 20 minutes', (Date.parse(booked.body.appointment.endsAt) - Date.parse(booked.body.appointment.startsAt)) / 60_000, 20);

  const takenAgain = await call('POST', '/api/appointments', {
    body: { startsAt: free.startsAt, name: 'Other', email: 'book2@consignors.example' },
  });
  eq('one booking per slot', takenAgain.status, 409);
  eq('slot taken code', takenAgain.body?.error?.code, 'slot_taken');
  ok(
    'slot taken copy names the next free slot',
    /^That slot was just taken\. The next free slot is [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\.$/.test(
      takenAgain.body?.error?.message ?? '',
    ),
    takenAgain.body?.error?.message,
  );

  const slotsAfter = await call('GET', '/api/appointment-slots');
  eq(
    'the booked slot is no longer free',
    slotsAfter.body.slots.find((s: any) => s.startsAt === free.startsAt)?.free,
    false,
  );

  const others = slotsAfter.body.slots.filter((s: any) => s.free).slice(0, 3);
  await call('POST', '/api/appointments', {
    body: { startsAt: others[0].startsAt, name: 'Amélie', email: 'BOOK1@consignors.example' },
  });
  await call('POST', '/api/appointments', {
    body: { startsAt: others[1].startsAt, name: 'Amélie', email: 'book1@CONSIGNORS.example' },
  });
  const fourth = await call('POST', '/api/appointments', {
    body: { startsAt: others[2].startsAt, name: 'Amélie', email: 'book1@consignors.example' },
  });
  eq('booking limit', fourth.status, 429);
  eq('booking limit code', fourth.body?.error?.code, 'rate_limited');
  eq('booking limit copy', fourth.body?.error?.message, 'This email address has booked 3 slots in a short while. Try again later.');
  ok('booking limit retry-after', Number(fourth.headers.get('retry-after')) > 0, fourth.headers.get('retry-after'));

  const mails = (await (
    await fetch(`${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/search?query=book1%40consignors.example`)
  ).json()) as any;
  eq('one mail per booking', mails.messages_count, 3);
  const mail = mails.messages[0];
  ok(
    'slot mail subject',
    /^Your intake appointment on [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/.test(mail.Subject),
    mail.Subject,
  );
  const mailBody = (await (
    await fetch(`${process.env['MAILPIT_URL'] ?? 'http://mailpit:8025'}/api/v1/message/${mail.ID}`)
  ).json()) as any;
  const cancelToken = (/\/appointments\/cancel\/([A-Za-z0-9_-]+)/.exec(mailBody.Text) ?? [])[1] as string;
  ok('slot mail cancel address', cancelToken !== undefined, mailBody.Text);
  ok('slot mail shop address', mailBody.Text.includes(`Rue de l'Ourlet 12, 1000 Brussels`), mailBody.Text);

  const staffList = await call('GET', '/api/appointments', { jar: 'noor' });
  eq('staff see the bookings', staffList.body?.appointments?.length, 3);

  const byToken = await call('GET', `/api/appointments/by-token/${cancelToken}`);
  eq('appointment by token', byToken.body?.appointment?.status, 'booked');
  const cancelled = await call('POST', `/api/appointments/by-token/${cancelToken}/cancel`);
  eq('appointment cancelled', cancelled.body?.appointment?.status, 'cancelled');
  const cancelTwice = await call('POST', `/api/appointments/by-token/${cancelToken}/cancel`);
  eq('cancelling twice', cancelTwice.status, 409);
  eq('cancelling twice code', cancelTwice.body?.error?.code, 'already_cancelled');
  eq('unknown cancel token', (await call('GET', '/api/appointments/by-token/nope')).status, 404);
}

// ── The old spreadsheet ───────────────────────────────────────────────────────
{
  const today = brusselsDate(Date.now());
  const header =
    'item_no,consignor_name,consignor_email,consignor_phone,consignor_iban,category,brand,description,size,condition,asking_price,intake_date';
  const sheet = [
    header,
    `A-1,Zoë Ørsted-Hæk,ZOE.ORSTED@consignors.example,,,Coats,Fjell,Camel duffel coat,L,Good,88.50,${today}`,
    `A-2,Noa Vermeulen,noa.vermeulen@consignors.example,+32 470 00 11 22,BE21 0012 3456 7803,Dresses,Linnea,Wrap dress,S,Excellent,64.00,${today}`,
    `A-3,noa  vermeulen,,,,Knitwear,Fjell,Lambswool jumper,M,Very good,42.00,${today}`,
    `A-4,,nobody@consignors.example,,,Coats,Fjell,No name,L,Good,10.00,${today}`,
    `A-1,Zoë Ørsted-Hæk,zoe.orsted@consignors.example,,,Coats,Fjell,Repeat,L,Good,88.50,${today}`,
    `A-5,Someone,not-an-email,,,Coats,Fjell,Bad email,L,Good,10.00,${today}`,
    `A-6,Someone,someone@consignors.example,,BE68 5390 0754 7035,Coats,Fjell,Bad iban,L,Good,10.00,${today}`,
    `A-7,Someone Else,else@consignors.example,,,Hats,Fjell,Bad category,L,Good,10.00,${today}`,
    `A-8,Someone Else,else@consignors.example,,,Coats,Fjell,Bad price,L,Good,0.50,${today}`,
    `A-9,Someone Else,else@consignors.example,,,Coats,Fjell,Bad date,L,Good,10.00,2000-01-01`,
    `A-10,Short Row,short@consignors.example,,,Coats`,
    `,Nobody,nobody2@consignors.example,,,Coats,Fjell,No item number,L,Good,10.00,${today}`,
  ].join('\n');

  const wrongHeader = await call('POST', '/api/imports/preview', {
    jar: 'owner',
    raw: 'a,b,c\n1,2,3\n',
    contentType: 'text/csv',
  });
  eq('a wrong header is refused', wrongHeader.status, 422);
  eq('wrong header field', Object.keys(wrongHeader.body?.error?.fields ?? {})[0], 'file');

  const wrongType = await call('POST', '/api/imports/preview', {
    jar: 'owner',
    raw: sheet,
    contentType: 'application/json',
  });
  eq('the spreadsheet needs text/csv', wrongType.status, 415);

  const preview = await call('POST', '/api/imports/preview', {
    jar: 'owner',
    raw: sheet,
    contentType: 'text/csv',
  });
  eq('preview status', preview.status, 200);
  camelCase(preview.body, 'preview');
  const rows = preview.body.rows as any[];
  const byRow = new Map(rows.map((r) => [r.row, r]));
  const at = (row: number): any => byRow.get(row);
  eq('rows are numbered from 2', rows[0]?.row, 2);
  eq('matched by email in any case', at(2)?.status, 'matched');
  eq('matched name is the stored one', at(2)?.consignorName, 'Zoë Ørsted-Hæk');
  eq('a new consignor', at(3)?.status, 'new');
  eq('a later row shares the new consignor by name', at(4)?.status, 'matched');
  eq('missing consignor name', at(5)?.reason, 'Missing consignor name.');
  eq('repeat item number', at(6)?.reason, 'Item number appears twice in this file.');
  eq('bad email', at(7)?.reason, `Email address isn't valid.`);
  eq('bad iban', at(8)?.reason, `IBAN doesn't pass its check.`);
  eq('unknown category', at(9)?.reason, 'Unknown category.');
  eq('bad asking price', at(10)?.reason, 'Asking price must be between €1.00 and €10,000.00.');
  eq('bad intake date', at(11)?.reason, 'Intake date must be today or up to 730 days back.');
  eq('short row', at(12)?.reason, 'This row has 6 fields; the header has 12.');
  eq('missing item number', at(13)?.reason, 'Missing item number.');
  eq('preview counts matched', preview.body.counts.matched, 2);
  eq('preview counts new', preview.body.counts.new, 1);
  eq('preview counts refused', preview.body.counts.refused, 9);
  eq('preview counts already', preview.body.counts.already, 0);

  const beforeSave = (await call('GET', '/api/pieces', { jar: 'noor' })).body.pieces.length;
  const sameAgain = await call('POST', '/api/imports/preview', { jar: 'owner', raw: sheet, contentType: 'text/csv' });
  eq('the preview saves nothing', (await call('GET', '/api/pieces', { jar: 'noor' })).body.pieces.length, beforeSave);
  eq('the preview is repeatable', JSON.stringify(sameAgain.body.counts), JSON.stringify(preview.body.counts));

  const saved = await call('POST', '/api/imports', { jar: 'owner', raw: sheet, contentType: 'text/csv' });
  eq('import saved', saved.status, 200);
  eq('pieces brought over', saved.body?.piecesCreated, 3);
  eq('consignors brought over', saved.body?.consignorsCreated, 1);

  const afterSave = (await call('GET', '/api/pieces', { jar: 'noor' })).body.pieces;
  eq('pieces exist after saving', afterSave.length, beforeSave + 3);
  const brought = afterSave.find((p: any) => p.description === 'Camel duffel coat');
  eq('brought-over intake date', brought?.intakeDate, today);
  eq('brought-over consignor', brought?.consignor?.name, 'Zoë Ørsted-Hæk');

  const twice = await call('POST', '/api/imports', { jar: 'owner', raw: sheet, contentType: 'text/csv' });
  eq('saving the same file twice', twice.status, 200);
  eq('saving twice brings nothing over', twice.body?.piecesCreated, 0);
  eq('saving twice creates no consignor', twice.body?.consignorsCreated, 0);
  eq('rows already brought over', twice.body?.counts?.already, 3);
  eq('no new pieces', (await call('GET', '/api/pieces', { jar: 'noor' })).body.pieces.length, beforeSave + 3);

  const notOwner = await call('POST', '/api/imports/preview', { jar: 'noor', raw: sheet, contentType: 'text/csv' });
  eq('only the owner brings a spreadsheet over', notOwner.status, 403);
}

// ── Archive, bring back, collect and erasure ──────────────────────────────────
{
  const pieces = (await call('GET', '/api/pieces', { jar: 'noor' })).body.pieces;
  const onRail = pieces.find((p: any) => p.tagCode === 'HG-1000043-8');

  const archived = await call('POST', `/api/pieces/${onRail.id}/archive`, { jar: 'owner' });
  eq('piece archived', archived.status, 200);
  eq('archived status', archived.body?.piece?.status, 'archived');
  ok('archived instant', Z.test(archived.body?.piece?.archivedAt), archived.body?.piece?.archivedAt);
  const archiveTwice = await call('POST', `/api/pieces/${onRail.id}/archive`, { jar: 'owner' });
  eq('archiving twice', archiveTwice.status, 409);
  eq('archiving twice code', archiveTwice.body?.error?.code, 'cannot_archive');

  const restored = await call('POST', `/api/pieces/${onRail.id}/restore`, { jar: 'owner' });
  eq('piece brought back', restored.status, 200);
  eq('brought back status', restored.body?.piece?.status, 'on_rail');
  eq('brought back tag code', restored.body?.piece?.tagCode, onRail.tagCode);
  eq('brought back price', restored.body?.piece?.currentPriceCents, onRail.currentPriceCents);
  eq('brought back stations', JSON.stringify(restored.body?.piece?.stations), JSON.stringify(onRail.stations));
  const restoreTwice = await call('POST', `/api/pieces/${onRail.id}/restore`, { jar: 'owner' });
  eq('bringing back twice', restoreTwice.status, 409);
  eq('bringing back twice code', restoreTwice.body?.error?.code, 'not_archived');

  const shelf = pieces.find((p: any) => p.tagCode === 'HG-1000047-9');
  const collected = await call('POST', `/api/pieces/${shelf.id}/collected`, { jar: 'noor' });
  eq('piece collected', collected.status, 200);
  eq('collected status', collected.body?.piece?.status, 'returned');
  const collectTwice = await call('POST', `/api/pieces/${shelf.id}/collected`, { jar: 'noor' });
  eq('collecting twice', collectTwice.status, 409);
  eq('collecting twice code', collectTwice.body?.error?.code, 'not_on_returns_shelf');

  const consignors = (await call('GET', '/api/consignors', { jar: 'noor' })).body.consignors;
  const maarten = consignors.find((c: any) => c.name === 'Maarten De Smet');

  const notOwner = await call('POST', `/api/consignors/${maarten.id}/erase`, { jar: 'noor' });
  eq('only the owner erases', notOwner.status, 403);

  const erased = await call('POST', `/api/consignors/${maarten.id}/erase`, { jar: 'owner' });
  eq('erase accepted', erased.status, 202);
  eq('erased name', erased.body?.consignor?.name, 'Erased consignor');
  eq('erased email', erased.body?.consignor?.email, null);
  eq('erased phone', erased.body?.consignor?.phone, null);
  eq('erased iban', erased.body?.consignor?.iban, null);
  eq('erased status', erased.body?.consignor?.status, 'erased');

  const eraseTwice = await call('POST', `/api/consignors/${maarten.id}/erase`, { jar: 'owner' });
  eq('erasing twice', eraseTwice.status, 409);
  eq('erasing twice code', eraseTwice.body?.error?.code, 'already_erased');

  const edit = await call('PATCH', `/api/consignors/${maarten.id}`, {
    jar: 'noor',
    body: { name: 'Back again' },
  });
  eq('editing an erased consignor', edit.status, 409);
  eq('editing an erased consignor code', edit.body?.error?.code, 'consignor_erased');

  const theirPieces = (await call('GET', '/api/pieces', { jar: 'noor' })).body.pieces.filter(
    (p: any) => p.consignor.id === maarten.id,
  );
  ok(
    'their unsold pieces are archived',
    theirPieces.filter((p: any) => p.status !== 'sold').every((p: any) => p.status === 'archived'),
    JSON.stringify(theirPieces.map((p: any) => [p.tagCode, p.status])),
  );
  ok(
    'their sold pieces keep Erased consignor',
    theirPieces.every((p: any) => p.consignor.name === 'Erased consignor'),
    JSON.stringify(theirPieces.map((p: any) => p.consignor.name)),
  );

  const archivedOfErased = theirPieces.find((p: any) => p.status === 'archived');
  const bringBack = await call('POST', `/api/pieces/${archivedOfErased.id}/restore`, { jar: 'owner' });
  eq('bringing back an erased consignor piece', bringBack.status, 409);
  eq('bringing back an erased consignor piece code', bringBack.body?.error?.code, 'consignor_erased');

  const newPieceForErased = await call('POST', '/api/pieces', {
    jar: 'noor',
    body: {
      consignorId: maarten.id,
      category: 'coats',
      brand: 'X',
      description: 'Y',
      size: 'm',
      condition: 'good',
      askingPriceCents: 1000,
      intakeDate: brusselsDate(Date.now()),
    },
  });
  eq('an erased consignor cannot take a new piece', newPieceForErased.status, 404);

  const book = await call('GET', `/api/sales?month=${monthOf(brusselsDate(Date.now()))}`, { jar: 'ines' });
  ok(
    'the sales book keeps Erased consignor',
    book.body.lines.every((line: any) => typeof line.consignorName === 'string'),
    JSON.stringify(book.body.lines.map((l: any) => l.consignorName)),
  );
  ok(
    'no response names the erased consignor',
    !JSON.stringify(book.body).includes('Maarten'),
    JSON.stringify(book.body),
  );
}

// ── Edge cases ────────────────────────────────────────────────────────────────
{
  // A role change applies from that member's next request.
  const added = await call('POST', '/api/members', {
    jar: 'owner',
    body: { name: 'Wies', email: 'wies@atelier-ourlet.example', password: 'start-here-9931', role: 'assistant' },
  });
  const wiesId = added.body.member.id as string;
  await call('POST', '/api/session', {
    body: { email: 'wies@atelier-ourlet.example', password: 'start-here-9931' },
    jar: 'wies',
  });
  eq('an assistant may read the pieces', (await call('GET', '/api/pieces', { jar: 'wies' })).status, 200);
  await call('PATCH', `/api/members/${wiesId}`, { jar: 'owner', body: { role: 'bookkeeper' } });
  eq(
    'the role change applies from the next request',
    (await call('GET', '/api/pieces', { jar: 'wies' })).status,
    403,
  );
  eq(
    'the new role may read the sales book',
    (await call('GET', `/api/sales?month=${monthOf(brusselsDate(Date.now()))}`, { jar: 'wies' })).status,
    200,
  );
  await call('DELETE', `/api/members/${wiesId}`, { jar: 'owner' });

  // 405 with Allow on more than one path.
  const onPieces = await call('DELETE', '/api/pieces');
  eq('405 on /api/pieces', onPieces.status, 405);
  eq('Allow on /api/pieces', onPieces.headers.get('allow'), 'GET, POST');
  const onSession = await call('PATCH', '/api/session');
  eq('405 on /api/session', onSession.status, 405);
  eq('Allow on /api/session', onSession.headers.get('allow'), 'DELETE, GET, POST');
  const onRail = await call('POST', '/api/rail', { body: {} });
  eq('405 on /api/rail', onRail.status, 405);
  eq('Allow on /api/rail', onRail.headers.get('allow'), 'GET');

  // A literal path beats a piece id.
  eq(
    'the lookup path is not read as a piece id',
    (await call('GET', '/api/pieces/lookup?tag=HG-1000043-8', { jar: 'noor' })).body?.piece?.tagCode,
    'HG-1000043-8',
  );

  // A piece on the Returns shelf moves to the Donation box after 14 Brussels days.
  const consignors = await call('GET', '/api/consignors', { jar: 'noor' });
  const zoe = consignors.body.consignors.find((c: any) => c.name.startsWith('Zo'));
  const today = brusselsDate(Date.now());
  const shelfPiece = await call('POST', '/api/pieces', {
    jar: 'noor',
    body: {
      consignorId: zoe.id,
      category: 'coats',
      brand: 'Fjell',
      description: 'Shelf timing',
      size: 'l',
      condition: 'good',
      askingPriceCents: 5000,
      intakeDate: addDays(today, -100),
    },
  });
  eq('a piece 100 days in is in the Donation box', shelfPiece.body.piece.status, 'donation_box');
  const latePiece = await call('POST', '/api/pieces', {
    jar: 'noor',
    body: {
      consignorId: zoe.id,
      category: 'coats',
      brand: 'Fjell',
      description: 'Shelf timing late',
      size: 'l',
      condition: 'good',
      askingPriceCents: 5000,
      intakeDate: addDays(today, -110),
    },
  });
  eq('a piece 110 days in is in the Donation box too', latePiece.body.piece.status, 'donation_box');

  // The sales book guards a cell that starts with a formula character.
  const risky = await call('POST', '/api/pieces', {
    jar: 'noor',
    body: {
      consignorId: zoe.id,
      category: 'accessories',
      brand: 'Oriel',
      description: '=SUM(A1:A9) silk scarf',
      size: 'one_size',
      condition: 'good',
      askingPriceCents: 2000,
      intakeDate: today,
    },
  });
  await call('POST', '/api/sales', {
    jar: 'noor',
    body: { pieceId: risky.body.piece.id, payment: 'cash' },
  });
  const book = await fetch(`${base}/api/sales-book?month=${monthOf(today)}`, {
    headers: { cookie: jars.get('owner') as string },
  });
  const csv = await book.text();
  ok(
    'a cell starting with = gets an apostrophe',
    csv.includes(`"'=SUM(A1:A9) silk scarf"`),
    csv.split('\r\n').find((line) => line.includes('SUM')) ?? csv,
  );

  // A photo under the file limit inside a larger request is accepted.
  const boundary = '----edge';
  const filler = Buffer.alloc(4_999_000, 0x20);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    filler.subarray(8),
  ]);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\n${'x'.repeat(400_000)}\r\n`,
      'latin1',
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n`,
      'latin1',
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
  ]);
  eq('the request body is over the file limit', body.length > 5_000_000, true);
  eq('the request body is under its own limit', body.length <= 6_000_000, true);
  const inLargeRequest = await fetch(`${base}/api/pieces/${newPieceId}/photos`, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: jars.get('noor') as string,
    },
    body,
  });
  const inLargeBody = await inLargeRequest.json();
  eq(
    'a photo under the file limit inside a larger request is read, not rejected for size',
    inLargeRequest.status,
    422,
  );
  eq('it is refused on its content', (inLargeBody as any).error.code, 'validation_failed');
}

// ── Photo orientation ─────────────────────────────────────────────────────────
{
  const jpeg = await (async (): Promise<Buffer> => {
    // A tiny 8x4 baseline JPEG, then an EXIF block declaring orientation 6.
    const { default: encode, init } = (await import('@jsquash/jpeg/encode.js')) as any;
    const { readFile } = await import('node:fs/promises');
    const { createRequire } = await import('node:module');
    const require = createRequire(`${process.cwd()}/`);
    await init(
      await WebAssembly.compile(
        await readFile(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
      ),
    );
    const width = 8;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      data[index * 4] = 200;
      data[index * 4 + 1] = 90;
      data[index * 4 + 2] = 60;
      data[index * 4 + 3] = 255;
    }
    const base = Buffer.from(await encode({ data, width, height }, { quality: 80 }));

    const tiff = Buffer.alloc(22);
    tiff.write('II', 0, 'latin1');
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x0112, 10);
    tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(6, 18);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(payload.length + 2);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
    return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
  })();

  const boundary = '----orient';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="turned.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      'latin1',
    ),
    jpeg,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
  ]);
  const saved = await fetch(`${base}/api/pieces/${newPieceId}/photos`, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: jars.get('noor') as string,
    },
    body,
  });
  const savedBody = (await saved.json()) as any;
  eq('a turned photo is saved', saved.status, 201);
  eq('the camera orientation is applied: width', savedBody.photo.width, 4);
  eq('the camera orientation is applied: height', savedBody.photo.height, 8);

  const publicCopy = await fetch(`${base}/api/photos/${savedBody.photo.id}`);
  const publicBytes = Buffer.from(await publicCopy.arrayBuffer());
  ok('the public copy carries no EXIF', !publicBytes.includes(Buffer.from('Exif\0\0', 'latin1')));

  const original = await fetch(`${base}/api/photos/${savedBody.photo.id}/original`, {
    headers: { cookie: jars.get('owner') as string },
  });
  const originalBytes = Buffer.from(await original.arrayBuffer());
  ok('the original is stored byte for byte', originalBytes.equals(jpeg), `${originalBytes.length} vs ${jpeg.length}`);
}

// ── The bank file comes back byte for byte ────────────────────────────────────
{
  const runs = await call('GET', '/api/payout-runs', { jar: 'owner' });
  if (runs.body.runs.length > 0) {
    const month = runs.body.runs[0].month as string;
    const first = await fetch(`${base}/api/payout-runs/${month}/file`, {
      headers: { cookie: jars.get('owner') as string },
    });
    const second = await fetch(`${base}/api/payout-runs/${month}/file`, {
      headers: { cookie: jars.get('ines') as string },
    });
    const a = Buffer.from(await first.arrayBuffer());
    const b = Buffer.from(await second.arrayBuffer());
    ok('the bank file comes back byte for byte', a.equals(b) && a.length > 0, `${a.length} vs ${b.length}`);
    ok(
      'the bank file created instant is whole-second Z',
      /<CreDtTm>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/CreDtTm>/.test(a.toString('utf8')),
      a.toString('utf8').slice(0, 400),
    );
  }
}

// @@PART4@@
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
export {};
