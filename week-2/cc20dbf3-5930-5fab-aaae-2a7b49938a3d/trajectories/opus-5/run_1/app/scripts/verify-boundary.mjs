/** Development checks for the server boundary, the error shape and the precedence order. */
const base = process.env.BASE ?? 'http://127.0.0.1:4173';

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
  }
}

async function raw(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json, headers: response.headers };
}

async function signIn(email) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pegboard-2026' }),
  });
  return response.headers.getSetCookie()[0].split(';')[0];
}

function multipart(bytes, filename, declaredType) {
  const boundary = '----shedlineboundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: ${declaredType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([head, bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

let counter = 0;
const key = () => `boundary-${Date.now()}-${(counter += 1)}`;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const main = async () => {
  const hal = await signIn('hal@members.example');
  const dev = await signIn('dev@commonshed.example');
  const rosa = await signIn('rosa@commonshed.example');
  const json = (cookie) => ({ cookie, 'content-type': 'application/json' });

  // ---- The error shape carries nothing else. ----
  const notFound = await raw('/api/loans/4f1a0000-0000-4000-8000-000000000000', { headers: { cookie: hal } });
  check('error body has one key', Object.keys(notFound.json).length === 1 && 'error' in notFound.json, notFound.json);
  check('error object has code and message only', JSON.stringify(Object.keys(notFound.json.error).sort()) === '["code","message"]', notFound.json.error);
  const validation = await raw('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  check('validation nests fields inside error', JSON.stringify(Object.keys(validation.json.error).sort()) === '["code","fields","message"]', validation.json.error);
  check('validation has no fields beside error', Object.keys(validation.json).length === 1);

  // ---- Same origin. ----
  const crossOrigin = await raw('/api/holds', {
    method: 'POST',
    headers: { ...json(hal), origin: 'http://evil.test', 'idempotency-key': key() },
    body: '{}',
  });
  check('cross origin wins over everything', crossOrigin.status === 403 && crossOrigin.json.error.code === 'cross_origin', crossOrigin.json);
  const sameOrigin = await raw('/api/counter/status', { headers: { cookie: dev, origin: base } });
  check('same origin is accepted', sameOrigin.status === 200);
  const deleteCross = await raw('/api/session', { method: 'DELETE', headers: { cookie: hal, origin: 'http://evil.test' } });
  check('cross origin delete is refused', deleteCross.json.error.code === 'cross_origin');
  check('no cors headers', (await raw('/api/health')).headers.get('access-control-allow-origin') === null);

  // ---- Precedence. ----
  const unauthenticatedKeyed = await raw('/api/holds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('unauthenticated beats everything after cross origin', unauthenticatedKeyed.json.error.code === 'unauthenticated', unauthenticatedKeyed.json);
  const unknownPathId = await raw('/api/holds/4f1a0000-0000-4000-8000-000000000000/ready', {
    method: 'POST',
    headers: json(hal),
    body: '{}',
  });
  check('unknown path id answers not found before the role check', unknownPathId.json.error.code === 'not_found', unknownPathId.json);
  const wrongMediaType = await raw('/api/loans', {
    method: 'POST',
    headers: { cookie: dev, 'content-type': 'text/plain', 'idempotency-key': key() },
    body: 'hello',
  });
  check('wrong media type', wrongMediaType.status === 415 && wrongMediaType.json.error.code === 'unsupported_media_type', wrongMediaType.json);
  const memberOnLoans = await raw('/api/loans', {
    method: 'POST',
    headers: { ...json(hal), 'idempotency-key': key() },
    body: '{}',
  });
  check('role check for a member on the staff endpoint', memberOnLoans.status === 403, memberOnLoans.json);
  const missingKey = await raw('/api/loans', { method: 'POST', headers: json(dev), body: '{}' });
  check('missing idempotency key', missingKey.status === 422 && missingKey.json.error.fields.idempotency_key !== undefined, missingKey.json);
  const shortKey = await raw('/api/loans', {
    method: 'POST',
    headers: { ...json(dev), 'idempotency-key': 'x'.repeat(101) },
    body: '{}',
  });
  check('over-long idempotency key', shortKey.json.error.fields.idempotency_key !== undefined, shortKey.json);

  // ---- Body limits. ----
  const bigJson = await raw('/api/holds', {
    method: 'POST',
    headers: { ...json(hal), 'idempotency-key': key() },
    body: JSON.stringify({ item_id: 'tile-saw', pad: 'x'.repeat(17_000) }),
  });
  check('json body over 16384 bytes', bigJson.status === 413 && bigJson.json.error.code === 'body_too_large', bigJson.json);
  const atLimit = await raw('/api/holds', {
    method: 'POST',
    headers: { ...json(hal), 'idempotency-key': key() },
    body: JSON.stringify({ item_id: 'tile-saw', pad: 'x'.repeat(16_300) }),
  });
  check('json body at the limit is read', atLimit.status === 422, atLimit.status);

  // ---- Photos: type, then size. ----
  const lanes = (await raw('/api/items/drill-driver/lanes', { headers: { cookie: dev } })).json;
  const library = (await raw('/api/library', { headers: { cookie: dev } })).json;
  const closed = new Set(library.closed_dates);
  const open = new Set(library.open_days);
  const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  let dueDate = lanes.from;
  for (let offset = 1; offset < 8; offset += 1) {
    const candidate = shift(lanes.from, offset);
    if (open.has(WEEKDAYS[new Date(`${candidate}T00:00:00Z`).getUTCDay()]) && !closed.has(candidate)) {
      dueDate = candidate;
      break;
    }
  }
  const loan = await raw('/api/loans', {
    method: 'POST',
    headers: { ...json(dev), 'idempotency-key': key() },
    body: JSON.stringify({ member_id: 'mem-mina', unit_id: 'drill-driver-4', due_date: dueDate }),
  });
  check('loan for the photo checks', loan.status === 201, loan.json);
  const loanId = loan.json.loan.id;

  const svg = multipart(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.jpg', 'image/jpeg');
  const svgAnswer = await raw(`/api/loans/${loanId}/photos`, {
    method: 'POST',
    headers: { cookie: dev, 'content-type': svg.contentType },
    body: svg.body,
  });
  check('svg judged by content is refused', svgAnswer.status === 415 && svgAnswer.json.error.code === 'unsupported_photo', svgAnswer.json);

  const bigJpeg = multipart(
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5_000_001, 1)]),
    'big.jpg',
    'image/jpeg',
  );
  const bigAnswer = await raw(`/api/loans/${loanId}/photos`, {
    method: 'POST',
    headers: { cookie: dev, 'content-type': bigJpeg.contentType },
    body: bigJpeg.body,
  });
  check('a photo over five million bytes is refused', bigAnswer.status === 413 && bigAnswer.json.error.code === 'photo_too_large', bigAnswer.json);

  const hugeBody = multipart(
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5_600_000, 1)]),
    'huge.jpg',
    'image/jpeg',
  );
  const hugeAnswer = await raw(`/api/loans/${loanId}/photos`, {
    method: 'POST',
    headers: { cookie: dev, 'content-type': hugeBody.contentType },
    body: hugeBody.body,
  });
  check('a body over the photo limit is refused', hugeAnswer.status === 413 && hugeAnswer.json.error.code === 'body_too_large', hugeAnswer.json);

  const exactly = multipart(
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5_000_000 - 4, 1)]),
    'exact.jpg',
    'image/jpeg',
  );
  const exactAnswer = await raw(`/api/loans/${loanId}/photos`, {
    method: 'POST',
    headers: { cookie: dev, 'content-type': exactly.contentType },
    body: exactly.body,
  });
  check('a photo of exactly five million bytes is accepted', exactAnswer.status === 201, exactAnswer.json);

  const missingField = multipart(Buffer.from([0xff, 0xd8, 0xff]), 'x.jpg', 'image/jpeg');
  const renamed = {
    body: Buffer.from(missingField.body.toString('latin1').replace('name="photo"', 'name="other"'), 'latin1'),
    contentType: missingField.contentType,
  };
  const missingAnswer = await raw(`/api/loans/${loanId}/photos`, {
    method: 'POST',
    headers: { cookie: dev, 'content-type': renamed.contentType },
    body: renamed.body,
  });
  check('a missing photo field answers validation', missingAnswer.status === 422 && missingAnswer.json.error.fields.photo === 'Required.', missingAnswer.json);

  const jsonToPhotos = await raw(`/api/loans/${loanId}/photos`, {
    method: 'POST',
    headers: json(dev),
    body: '{}',
  });
  check('json to the photo endpoint is refused', jsonToPhotos.status === 415, jsonToPhotos.json);

  // ---- The uploaded file name never appears. ----
  const stored = await raw(`/api/loans/${loanId}`, { headers: { cookie: dev } });
  check('photo records carry no file name', !JSON.stringify(stored.json).includes('exact.jpg'), stored.json.loan.photos);
  check('photo url is server made', stored.json.loan.photos[0].url === `/api/loans/${loanId}/photos/${stored.json.loan.photos[0].id}`);
  const download = await fetch(`${base}${stored.json.loan.photos[0].url}`, { headers: { cookie: dev } });
  check('photo download headers', download.headers.get('content-disposition') === 'inline' && download.headers.get('x-content-type-options') === 'nosniff');

  // ---- Responses carry no contact details or internal ids. ----
  const payload = JSON.stringify(stored.json);
  check('no email in a loan response', !payload.includes('@members.example') && !payload.includes('@commonshed.example'), payload.slice(0, 200));
  check('no phone number in a loan response', !payload.includes('555-01'));
  const laneRead = await raw('/api/items/drill-driver/lanes', { headers: { cookie: hal } });
  check('members see no borrower name in lanes', !JSON.stringify(laneRead.json).includes('borrower'), laneRead.json.lanes[3]);
  const staffLaneRead = await raw('/api/items/drill-driver/lanes', { headers: { cookie: dev } });
  check('staff see the borrower name in lanes', JSON.stringify(staffLaneRead.json).includes('Mina Castellanos'));
  check('lanes carry no contact details', !JSON.stringify(staffLaneRead.json).includes('@members.example'));

  // ---- What is never served. ----
  for (const path of ['/run.json', '/package.json', '/package-lock.json', '/.env', '/src/server/main.ts', '/dist/server/main.js', '/THIRD_PARTY_NOTICES.md', '/tsconfig.json', '/node_modules/pg/package.json']) {
    const answer = await raw(path);
    check(`${path} is not served`, answer.status === 404, answer.status);
  }
  for (const path of ['/assets/../../package.json', '/assets/%2e%2e/%2e%2e/package.json']) {
    const answer = await raw(path);
    check(`${path} does not escape`, answer.status === 404, answer.status);
  }
  check('/catalogue serves the app', (await raw('/catalogue')).status === 200);
  check('/assets/app.js is served', (await raw('/assets/app.js')).status === 200);
  check('/fonts are served', (await raw('/fonts/plex-mono-400.woff2')).status === 200);
  const unknownApi = await raw('/api/does-not-exist', { headers: { cookie: hal } });
  check('an unknown api path answers in the error shape', unknownApi.status === 404 && unknownApi.json.error.code === 'not_found', unknownApi.json);

  // ---- A request still running answers request_in_progress. ----
  const sharedKey = key();
  const racing = await Promise.all([
    raw('/api/loans', {
      method: 'POST',
      headers: { ...json(dev), 'idempotency-key': sharedKey },
      body: JSON.stringify({ member_id: 'mem-tobi', unit_id: 'carpet-cleaner-1', due_date: dueDate }),
    }),
    raw('/api/loans', {
      method: 'POST',
      headers: { ...json(dev), 'idempotency-key': sharedKey },
      body: JSON.stringify({ member_id: 'mem-tobi', unit_id: 'carpet-cleaner-1', due_date: dueDate }),
    }),
  ]);
  const created = racing.filter((answer) => answer.status === 201);
  check('one of two identical keyed requests creates the loan', created.length === 1, racing.map((a) => [a.status, a.json.error?.code]));
  check(
    'the other replays or reports the request in progress',
    racing.every((answer) => answer.status === 201 || answer.json.error.code === 'request_in_progress'),
    racing.map((a) => [a.status, a.json.error?.code]),
  );

  // ---- A failed keyed request leaves the key unused. ----
  const reusedKey = key();
  const invalid = await raw('/api/holds', {
    method: 'POST',
    headers: { ...json(hal), 'idempotency-key': reusedKey },
    body: JSON.stringify({ item_id: 'tile-saw', start_date: '2000-01-01', end_date: '2000-01-02' }),
  });
  check('an invalid keyed request answers validation', invalid.status === 422, invalid.json);
  let start = lanes.from;
  for (let offset = 0; offset < 28; offset += 1) {
    const candidate = shift(lanes.from, offset);
    if (open.has(WEEKDAYS[new Date(`${candidate}T00:00:00Z`).getUTCDay()]) && !closed.has(candidate)) {
      start = candidate;
      break;
    }
  }
  const retried = await raw('/api/holds', {
    method: 'POST',
    headers: { ...json(hal), 'idempotency-key': reusedKey },
    body: JSON.stringify({ item_id: 'hedge-trimmer', start_date: start, end_date: start }),
  });
  check('the same key then succeeds with a valid body', retried.status === 201, retried.json);
  await raw(`/api/holds/${retried.json.hold.id}/cancel`, { method: 'POST', headers: json(hal), body: '{}' });

  // ---- The founder-only ledger. ----
  check('volunteers cannot read the ledger', (await raw('/api/ledger', { headers: { cookie: dev } })).status === 403);
  check('the founder can read the ledger', (await raw('/api/ledger', { headers: { cookie: rosa } })).status === 200);

  console.log(failures === 0 ? '\nAll boundary checks passed.' : `\n${failures} checks failed.`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
