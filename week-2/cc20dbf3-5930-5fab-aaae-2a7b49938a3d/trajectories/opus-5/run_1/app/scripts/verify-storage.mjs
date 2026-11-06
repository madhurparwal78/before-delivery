/** Development checks for the photo bucket: server-made keys and one object per record. */
import pg from 'pg';
import { listBucket } from './s3-dev.mjs';

const base = process.env.BASE ?? 'http://127.0.0.1:4173';

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
  }
}

async function signIn(email) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pegboard-2026' }),
  });
  return response.headers.getSetCookie()[0].split(';')[0];
}

async function call(cookie, path, options = {}) {
  const headers = { cookie };
  let body;
  if (options.form !== undefined) body = options.form;
  else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.key !== undefined) headers['idempotency-key'] = options.key;
  const response = await fetch(`${base}${path}`, { method: options.method ?? 'GET', headers, body });
  return { status: response.status, json: await response.json().catch(() => null) };
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
let counter = 0;
const key = () => `storage-${Date.now()}-${(counter += 1)}`;

const main = async () => {
  const dev = await signIn('dev@commonshed.example');
  const library = (await call(dev, '/api/library')).json;
  const lanes = (await call(dev, '/api/items/drill-driver/lanes')).json;
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

  const loan = await call(dev, '/api/loans', {
    method: 'POST',
    key: key(),
    body: { member_id: 'mem-hal', unit_id: 'drill-driver-1', due_date: dueDate },
  });
  check('loan created', loan.status === 201, loan.json);
  const loanId = loan.json.loan.id;

  const upload = async (bytes, filename, type) => {
    const form = new FormData();
    form.append('photo', new Blob([bytes], { type }), filename);
    return call(dev, `/api/loans/${loanId}/photos`, { method: 'POST', form });
  };

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(48, 5)]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(48, 6),
  ]);
  const webp = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x30, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'latin1'),
    Buffer.alloc(32, 7),
  ]);

  const first = await upload(jpeg, '../../escape.jpg', 'image/jpeg');
  check('a jpeg is accepted', first.status === 201 && first.json.photo.content_type === 'image/jpeg', first.json);
  check('a png is accepted', (await upload(png, 'x.bin', 'application/octet-stream')).status === 201);
  check('a webp is accepted', (await upload(webp, 'x.txt', 'text/plain')).status === 201);
  check('html is refused', (await upload(Buffer.from('<html></html>'), 'x.jpg', 'image/jpeg')).json.error.code === 'unsupported_photo');
  check('a pdf is refused', (await upload(Buffer.from('%PDF-1.7'), 'x.png', 'image/png')).json.error.code === 'unsupported_photo');

  const checkoutPhotos = (await call(dev, `/api/loans/${loanId}`)).json.loan.photos;
  check('three checkout photos', checkoutPhotos.length === 3, checkoutPhotos.length);
  check('every checkout photo has the checkout stage', checkoutPhotos.every((photo) => photo.stage === 'checkout'));

  await call(dev, `/api/loans/${loanId}/return`, { method: 'POST', body: {} });
  const afterReturn = await upload(jpeg, 'return.jpg', 'image/jpeg');
  check('a photo after check-in takes the return stage', afterReturn.json.photo?.stage === 'return', afterReturn.json);
  const bothStages = (await call(dev, `/api/loans/${loanId}`)).json.loan.photos;
  check('checkout photos come before return photos', bothStages.map((photo) => photo.stage).join(',') === 'checkout,checkout,checkout,return', bothStages.map((p) => p.stage));

  await call(dev, `/api/loans/${loanId}/inspection`, { method: 'POST', body: { outcome: 'ok', note: '' } });
  const afterInspection = await upload(jpeg, 'late.jpg', 'image/jpeg');
  check('a photo on an inspected loan is refused', afterInspection.json.error?.code === 'invalid_transition', afterInspection.json);

  // Simultaneous uploads never take a stage past four, and refusals leave no object.
  const second = await call(dev, '/api/loans', {
    method: 'POST',
    key: key(),
    body: { member_id: 'mem-mina', unit_id: 'drill-driver-2', due_date: dueDate },
  });
  check('second loan created', second.status === 201, second.json);
  const raced = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6].map(() => {
      const form = new FormData();
      form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'race.jpg');
      return call(dev, `/api/loans/${second.json.loan.id}/photos`, { method: 'POST', form });
    }),
  );
  check('four simultaneous uploads succeed', raced.filter((answer) => answer.status === 201).length === 4, raced.map((a) => [a.status, a.json.error?.code]));
  check('the rest hit the photo limit', raced.filter((answer) => answer.status === 409).every((answer) => answer.json.error.code === 'photo_limit'));

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const records = await pool.query('select id, loan_id, stage, extension from photo');
  await pool.end();
  const expected = new Set(
    records.rows.map((row) => `loans/${row.loan_id}/${row.stage}/${row.id}.${row.extension}`),
  );
  const objects = await listBucket();
  check('one object per photo record', objects.length === expected.size, { objects: objects.length, records: expected.size });
  check('every object key is server made', objects.every((candidate) => expected.has(candidate)), objects.slice(0, 4));
  check('no key carries a device file name', objects.every((candidate) => !/escape|return\.jpg|late\.jpg|x\.bin|x\.txt/.test(candidate)), objects.slice(0, 4));
  check('every key is tied to its loan and stage', objects.every((candidate) => /^loans\/[0-9a-f-]{36}\/(checkout|return)\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(candidate)), objects.slice(0, 4));

  console.log(failures === 0 ? '\nAll storage checks passed.' : `\n${failures} checks failed.`);
  process.exit(failures === 0 ? 0 : 1);
};

await main();
