import { spawn } from 'node:child_process';
import { PNG } from '/app/node_modules/pngjs/lib/png.js';

let failures = 0;
const log = (label, ok, extra) => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function png(width, height, seed) {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    image.data[i * 4] = (i * seed) % 255;
    image.data[i * 4 + 1] = (i * 19) % 255;
    image.data[i * 4 + 2] = (i * 37) % 255;
    image.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(image);
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = null;
  }

  async call(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (this.cookie) init.headers.cookie = this.cookie;
    const response = await fetch(`${this.base}${path}`, init);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  }
}

async function start(port, overrides) {
  const child = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: '/app',
    env: { ...process.env, APP_PUBLIC_PORT: String(port), ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = await response.json();
      if (response.status === 200 && body.status === 'ok') return child;
    } catch {
      /* still booting */
    }
  }
  return child;
}

async function draftWithImage(client, title) {
  const programs = await client.call('GET', '/api/programs');
  const open = programs.body.programs.find((program) => program.entriesOpen);
  const category = open.categories[0];
  const created = await client.call('POST', '/api/entries', {
    categoryId: category.id,
    title,
    summary: 'An outage rehearsal.',
    siteUrl: 'https://outage.example',
    credits: '',
  });
  const form = new FormData();
  form.append('file', new Blob([png(700, 700, 5)], { type: 'image/png' }), 'a.png');
  const upload = await client.call('POST', `/api/entries/${created.body.entry.id}/assets`, form);
  return { entry: created.body.entry, upload };
}

async function main() {
  console.log('healthy instance prepares a draft');
  const healthy = new Client('http://127.0.0.1:4173');
  await healthy.call('POST', '/api/session', {
    email: 'team@parallaxpine.example',
    password: 'parallax-pass-26',
  });
  const { entry } = await draftWithImage(healthy, 'Outage Rehearsal');

  console.log('Kill Bill unreachable');
  const deadBilling = await start(4201, { KILLBILL_URL: 'http://127.0.0.1:9' });
  const billingClient = new Client('http://127.0.0.1:4201');
  const health = await billingClient.call('GET', '/api/health');
  log('starts with dead billing', health.status === 200 && health.body.status === 'ok', health.body);
  await billingClient.call('POST', '/api/session', {
    email: 'team@parallaxpine.example',
    password: 'parallax-pass-26',
  });
  const paused = await billingClient.call(
    'POST',
    `/api/entries/${entry.id}/submit`,
    {},
    { 'idempotency-key': 'outage-key-1' },
  );
  log(
    'payments paused 503',
    paused.status === 503 &&
      paused.body.error === 'payments_paused' &&
      paused.body.message === 'Payments are paused. Your draft is saved — try again shortly.',
    paused.body,
  );
  const stillDraft = await healthy.call('GET', `/api/entries/${entry.id}`);
  log(
    'draft unchanged with images',
    stillDraft.body.entry.state === 'draft' && stillDraft.body.entry.assets.length === 1,
    stillDraft.body.entry.state,
  );
  deadBilling.kill();

  console.log('same key retried on the healthy instance');
  const retried = await healthy.call(
    'POST',
    `/api/entries/${entry.id}/submit`,
    {},
    { 'idempotency-key': 'outage-key-1' },
  );
  log('retry submits', retried.status === 201 && retried.body.entry.state === 'submitted', retried.body);

  console.log('MinIO unreachable');
  const deadStorage = await start(4202, { S3_ENDPOINT: 'http://127.0.0.1:9' });
  const storageClient = new Client('http://127.0.0.1:4202');
  const storageHealth = await storageClient.call('GET', '/api/health');
  log('starts with dead storage', storageHealth.status === 200, storageHealth.body);
  await storageClient.call('POST', '/api/session', {
    email: 'team@parallaxpine.example',
    password: 'parallax-pass-26',
  });
  const programs = await storageClient.call('GET', '/api/programs');
  const open = programs.body.programs.find((program) => program.entriesOpen);
  const draft = await storageClient.call('POST', '/api/entries', {
    categoryId: open.categories[0].id,
    title: 'Storage Rehearsal',
    summary: 'No storage today.',
    siteUrl: 'https://storage.example',
    credits: '',
  });
  const form = new FormData();
  form.append('file', new Blob([png(700, 700, 9)], { type: 'image/png' }), 'b.png');
  const upload = await storageClient.call('POST', `/api/entries/${draft.body.entry.id}/assets`, form);
  log(
    'upload 503 storage',
    upload.status === 503 &&
      upload.body.error === 'storage_unavailable' &&
      upload.body.message === 'Image storage is unavailable. Your draft is saved — try the upload again shortly.',
    upload.body,
  );
  deadStorage.kill();

  console.log('Mailpit unreachable');
  const deadMail = await start(4203, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '9' });
  const mailClient = new Client('http://127.0.0.1:4203');
  log('starts with dead mail', (await mailClient.call('GET', '/api/health')).status === 200);
  await mailClient.call('POST', '/api/session', {
    email: 'desk@monoharbour.example',
    password: 'monoharbour-pass-26',
  });
  const mailDraft = await draftWithImage(mailClient, 'Mail Rehearsal');
  const mailFail = await mailClient.call(
    'POST',
    `/api/entries/${mailDraft.entry.id}/submit`,
    {},
    { 'idempotency-key': 'outage-key-2' },
  );
  log(
    'mail unavailable 503',
    mailFail.status === 503 && mailFail.body.error === 'mail_unavailable',
    mailFail.body,
  );
  const afterMail = await healthy.call('GET', '/api/programs');
  log('healthy instance still answers', afterMail.status === 200);
  deadMail.kill();

  console.log('retry after the mail outage, on a healthy instance');
  const mailOwner = new Client('http://127.0.0.1:4173');
  await mailOwner.call('POST', '/api/session', {
    email: 'desk@monoharbour.example',
    password: 'monoharbour-pass-26',
  });
  const retryMail = await mailOwner.call(
    'POST',
    `/api/entries/${mailDraft.entry.id}/submit`,
    {},
    { 'idempotency-key': 'outage-key-2' },
  );
  log('mail retry submits', retryMail.status === 201, retryMail.body);

  console.log('Postgres unreachable at boot');
  const deadDb = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: '/app',
    env: {
      ...process.env,
      APP_PUBLIC_PORT: '4204',
      DATABASE_URL: 'postgresql://gf_app:gf-app-dev-2b7d41@127.0.0.1:9/gf_dev',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  deadDb.stdout.on('data', () => {});
  deadDb.stderr.on('data', () => {});
  await sleep(4000);
  const dbHealth = await fetch('http://127.0.0.1:4204/api/health');
  const dbBody = await dbHealth.json();
  log('health 503 starting', dbHealth.status === 503 && dbBody.status === 'starting', dbBody);
  deadDb.kill();

  console.log(failures === 0 ? '\nOUTAGE CHECKS PASSED' : `\n${failures} OUTAGE CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
