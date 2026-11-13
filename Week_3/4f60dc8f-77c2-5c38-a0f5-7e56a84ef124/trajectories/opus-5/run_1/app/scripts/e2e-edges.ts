import { randomUUID } from 'node:crypto';
import { buildGlb, buildPdf, buildPng } from './glb-fixture.js';

const BASE = 'http://127.0.0.1:4173';
let clientCookie = '';
let studioCookie = '';

const failures: string[] = [];
const expect = (label: string, condition: boolean, detail?: unknown): void => {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures.push(label);
  console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail));
};

type Call = {
  method?: string;
  body?: unknown;
  cookie?: 'client' | 'studio' | 'none';
  headers?: Record<string, string>;
  form?: FormData;
};

const api = async (
  path: string,
  call: Call = {},
): Promise<{ status: number; body: any; headers: Headers }> => {
  const headers: Record<string, string> = { Origin: BASE, ...(call.headers ?? {}) };
  if (call.cookie === 'studio') headers.Cookie = studioCookie;
  else if (call.cookie !== 'none') headers.Cookie = clientCookie;
  if (call.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method: call.method ?? (call.body !== undefined || call.form !== undefined ? 'POST' : 'GET'),
    headers,
    body: call.form ?? (call.body === undefined ? undefined : JSON.stringify(call.body)),
  });
  for (const cookie of response.headers.getSetCookie()) {
    if (cookie.startsWith('gw_session=')) clientCookie = cookie.split(';')[0];
    if (cookie.startsWith('gw_studio=')) studioCookie = cookie.split(';')[0];
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* HTML pages */
  }
  return { status: response.status, body, headers: response.headers };
};

const upload = async (
  path: string,
  filename: string,
  bytes: Buffer,
  extra: Record<string, string> = {},
  cookie: 'client' | 'studio' = 'client',
) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  form.append('file', new Blob([new Uint8Array(bytes)]), filename);
  return api(path, { form, method: 'POST', cookie });
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const mailpitCount = async (query: string): Promise<number> => {
  const response = await fetch(
    `http://mailpit:8025/api/v1/search?query=${encodeURIComponent(query)}&limit=50`,
  );
  if (!response.ok) return 0;
  return ((await response.json()) as { messages: unknown[] }).messages.length;
};

const queueDepth = async (name: string): Promise<number> => {
  const response = await fetch(`http://rabbitmq:15672/api/queues/%2F/${name}`, {
    headers: { Authorization: `Basic ${Buffer.from('gfkit:gfkit-dev').toString('base64')}` },
  });
  if (!response.ok) return -1;
  return ((await response.json()) as { messages: number }).messages;
};

const main = async (): Promise<void> => {
  const stamp = Date.now();

  console.log('\n== server boundary ==');
  for (const path of [
    '/run.json',
    '/package.json',
    '/package-lock.json',
    '/src/server/index.ts',
    '/.env',
    '/dist/server/index.js',
    '/.git/config',
    '/AGENTS.md',
  ]) {
    const result = await api(path, { cookie: 'none' });
    expect(`${path} is not served`, result.status === 404, result.status);
  }
  const health = await api('/api/studio/health', { cookie: 'none' });
  expect('studio health needs a session', health.status === 401, health.body);

  console.log('\n== studio sign in ==');
  await api('/api/studio/session', { body: { password: 'rig-founder-2026' }, cookie: 'none' });

  console.log('\n== scheduled rates ==');
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const scheduled = await api('/api/studio/fx-rates', {
    body: { currency: 'USD', rate: '1.5000', effective_at: future },
    cookie: 'studio',
  });
  expect('scheduled rate 201', scheduled.status === 201, scheduled.body);
  const past = await api('/api/studio/fx-rates', {
    body: { currency: 'USD', rate: '1.4000', effective_at: new Date(Date.now() - 60_000).toISOString() },
    cookie: 'studio',
  });
  expect(
    'past effective_at refused',
    past.status === 422 && past.body.fields?.effective_at !== undefined,
    past.body,
  );
  const rates = await api('/api/studio/fx-rates', { cookie: 'studio' });
  expect(
    'scheduled listed',
    rates.body.scheduled.some((rate: any) => rate.rate === '1.5000'),
    rates.body.scheduled,
  );
  expect(
    'current USD still 1.2725',
    rates.body.rates.find((rate: any) => rate.currency === 'USD')?.rate === '1.2725',
    rates.body.rates,
  );

  console.log('\n== renamed shot keeps unaccepted quotes current ==');
  const renamed = await api('/api/studio/services/top_down', {
    body: { title: 'Top-down plan', list_price_pence: 39000 },
    method: 'PATCH',
    cookie: 'studio',
  });
  expect('service patched', renamed.status === 200, renamed.body);

  console.log('\n== start a GBP engagement ==');
  const start = await api('/api/projects/start', {
    body: {
      brand_name: 'Fenwick Lamps',
      contact_name: 'Pia Fenwick',
      email: `pia+${stamp}@fenwick.test`,
      title: 'Lamp range stills',
      currency: 'GBP',
      finance_email: `ap+${stamp}@fenwick.test`,
      reviewer_email: `review+${stamp}@fenwick.test`,
    },
    cookie: 'none',
  });
  const engagement = start.body.engagement;
  expect('GBP engagement', engagement.brand.currency === 'GBP', start.body);

  const withRenamed = await api(`/api/engagements/${engagement.id}/quote/lines/top_down`, {
    method: 'PUT',
    body: { quantity: 1 },
  });
  expect(
    'renamed title and price on unaccepted quote',
    withRenamed.body.lines[0].title === 'Top-down plan' &&
      withRenamed.body.lines[0].unit_price_gbp_minor === 39000,
    withRenamed.body.lines[0],
  );
  expect('GBP fx line rate', withRenamed.body.fx_rate === '1.0000', withRenamed.body.fx_rate);
  expect(
    'GBP money',
    withRenamed.body.subtotal_minor === 39000 &&
      withRenamed.body.vat_minor === 7800 &&
      withRenamed.body.total_minor === 46800,
    withRenamed.body,
  );

  console.log('\n== dead-letter after two measurement failures ==');
  const unmeasurable = await upload(
    `/api/engagements/${engagement.id}/files`,
    'broken-index.glb',
    buildGlb({ min: [0, 0, 0], max: [0.2, 0.2, 0.2], breakAccessorIndex: true }),
  );
  expect('accepted at upload', unmeasurable.status === 201, unmeasurable.body);
  let failedFile: any = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const read = await api(`/api/engagements/${engagement.id}`);
    failedFile = read.body.files.find((file: any) => file.id === unmeasurable.body.id);
    if (failedFile?.measurement === 'failed') break;
    await sleep(500);
  }
  expect('measurement failed', failedFile?.measurement === 'failed', failedFile);
  await sleep(7000);
  expect('dead queue holds it', (await queueDepth('intake.measure.dead')) >= 1, await queueDepth('intake.measure.dead'));
  expect('measure queue drained', (await queueDepth('intake.measure')) === 0, await queueDepth('intake.measure'));

  const missingModel = await api(`/api/engagements/${engagement.id}/deposit`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card: { number: '4242424242424242', expiry: '12/30', cvc: '123', name: 'Pia' } },
  });
  expect(
    'failed model is not a usable model',
    missingModel.status === 409 && missingModel.body.error === 'model_missing',
    missingModel.body,
  );

  console.log('\n== a good model, then superseding it ==');
  const good = await upload(
    `/api/engagements/${engagement.id}/files`,
    'lamp.glb',
    buildGlb({ min: [-0.1, 0, -0.1], max: [0.1, 0.3, 0.1] }),
  );
  let model: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const read = await api(`/api/engagements/${engagement.id}`);
    model = read.body.files.find((file: any) => file.id === good.body.id);
    if (model?.measurement === 'measured') break;
    await sleep(500);
  }
  expect('measured in range', model?.measurement === 'measured', model);
  expect('unit as_exported', model?.unit === 'as_exported', model);
  expect('no question asked', model?.needs_unit_confirmation === false, model);

  const replacement = await upload(
    `/api/engagements/${engagement.id}/files`,
    'lamp-v2.glb',
    buildGlb({ min: [-0.1, 0, -0.1], max: [0.1, 0.4, 0.1] }),
  );
  await sleep(2500);
  const afterReplace = await api(`/api/engagements/${engagement.id}`);
  const old = afterReplace.body.files.find((file: any) => file.id === good.body.id);
  expect('previous model superseded', old?.status === 'superseded', old);
  expect(
    'new model is current',
    afterReplace.body.files.find((file: any) => file.id === replacement.body.id)?.status ===
      'received',
  );

  console.log('\n== concurrent deposits ==');
  const card = { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123', name: 'Pia' };
  const deposits = await Promise.all([
    api(`/api/engagements/${engagement.id}/deposit`, {
      headers: { 'Idempotency-Key': randomUUID() },
      body: { card },
    }),
    api(`/api/engagements/${engagement.id}/deposit`, {
      headers: { 'Idempotency-Key': randomUUID() },
      body: { card },
    }),
    api(`/api/engagements/${engagement.id}/deposit`, {
      headers: { 'Idempotency-Key': randomUUID() },
      body: { card },
    }),
  ]);
  const created = deposits.filter((result) => result.status === 201);
  expect('exactly one deposit succeeds', created.length === 1, deposits.map((r) => r.status));
  expect(
    'others answer invalid_state',
    deposits.filter((result) => result.body.error === 'invalid_state').length === 2,
    deposits.map((r) => r.body.error),
  );
  const ledger = await api(`/api/engagements/${engagement.id}`);
  expect('one deposit ledger entry', ledger.body.ledger.length === 1, ledger.body.ledger);
  expect('deposit £187.20', ledger.body.ledger[0].amount_minor === 18720, ledger.body.ledger[0]);

  console.log('\n== locked title survives a later rename ==');
  await api('/api/studio/services/top_down', {
    body: { title: 'Top-down', list_price_pence: 38000 },
    method: 'PATCH',
    cookie: 'studio',
  });
  const locked = await api(`/api/engagements/${engagement.id}`);
  expect(
    'locked title and price kept',
    locked.body.quote.lines[0].title === 'Top-down plan' &&
      locked.body.quote.lines[0].unit_price_gbp_minor === 39000,
    locked.body.quote.lines[0],
  );

  console.log('\n== one issue per invoice ==');
  await upload(
    `/api/studio/engagements/${engagement.id}/stills`,
    'still.png',
    buildPng(),
    { shot_code: 'top_down', milestone: 'look_dev' },
    'studio',
  );
  const sent = await api(`/api/studio/engagements/${engagement.id}/send-for-review`, {
    body: {},
    cookie: 'studio',
  });
  const token = (sent.body.review_url ?? '').split('/review/')[1] ?? '';
  await api(`/api/review/${token}/accept`, { body: {}, cookie: 'none' });
  const studioRead = await api(`/api/studio/engagements/${engagement.id}`, { cookie: 'studio' });
  const lookDev = studioRead.body.invoices.find((entry: any) => entry.milestone === 'look_dev');
  expect('look-dev drafted', lookDev?.status === 'draft', lookDev);

  const issues = await Promise.all([
    api(`/api/studio/invoices/${lookDev.id}/issue`, { body: {}, cookie: 'studio' }),
    api(`/api/studio/invoices/${lookDev.id}/issue`, { body: {}, cookie: 'studio' }),
    api(`/api/studio/invoices/${lookDev.id}/issue`, { body: {}, cookie: 'studio' }),
  ]);
  expect(
    'one issue wins',
    issues.filter((result) => result.status === 200).length === 1,
    issues.map((r) => r.status),
  );
  await sleep(4000);
  const issuedInvoice = (await api(`/api/invoices/${lookDev.id}`)).body;
  expect('issued once', issuedInvoice.status === 'issued', issuedInvoice);
  expect(
    'one invoice email',
    (await mailpitCount(`subject:"Invoice ${issuedInvoice.number} issued"`)) === 1,
  );

  console.log('\n== declined milestone payment then overdue ==');
  const declineOne = await api(`/api/invoices/${lookDev.id}/payments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card: { number: '4000000000000002', expiry: '12/30', cvc: '123', name: 'Pia' } },
  });
  expect('declined 402', declineOne.status === 402, declineOne.body);
  const failedRead = (await api(`/api/invoices/${lookDev.id}`)).body;
  expect('payment_failed with overdue_at', failedRead.status === 'payment_failed' && failedRead.overdue_at !== null, failedRead);
  expect('failed_attempts 1', failedRead.failed_attempts === 1, failedRead);
  const declineTwo = await api(`/api/invoices/${lookDev.id}/payments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card: { number: '4000000000000002', expiry: '12/30', cvc: '123', name: 'Pia' } },
  });
  expect('second decline 402', declineTwo.status === 402, declineTwo.body);
  await sleep(3000);
  expect(
    'one payment-failed notice per attempt',
    (await mailpitCount(`subject:"Payment failed for invoice ${issuedInvoice.number}"`)) === 2,
  );

  console.log('\n== recovery before overdue ==');
  const recovered = await api(`/api/invoices/${lookDev.id}/payments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card: { number: '4242424242424242', expiry: '12/30', cvc: '123', name: 'Pia' } },
  });
  expect('paid after retry', recovered.status === 201 && recovered.body.invoice.status === 'paid', recovered.body);
  await sleep(3000);
  expect(
    'one receipt email',
    (await mailpitCount(`subject:"Receipt for invoice ${issuedInvoice.number}"`)) === 1,
  );

  console.log('\n== ledger matches Kill Bill ==');
  const finalRead = await api(`/api/studio/engagements/${engagement.id}`, { cookie: 'studio' });
  const net = finalRead.body.ledger.reduce(
    (total: number, entry: any) => (entry.kind === 'refund' ? total - entry.amount_minor : total + entry.amount_minor),
    0,
  );
  expect('net paid is deposit plus look-dev', net === 18720 + lookDev.amount_minor, { net, lookDev: lookDev.amount_minor });

  console.log('\n== concurrent cancellations ==');
  const cancels = await Promise.all([
    api(`/api/studio/engagements/${engagement.id}/cancel`, { body: { refund_minor: 500 }, cookie: 'studio' }),
    api(`/api/studio/engagements/${engagement.id}/cancel`, { body: { refund_minor: 500 }, cookie: 'studio' }),
  ]);
  expect(
    'one cancel wins',
    cancels.filter((result) => result.status === 200).length === 1,
    cancels.map((r) => r.status),
  );
  const winner = cancels.find((result) => result.status === 200);
  expect('refund of 500', winner?.body.refunded_minor === 500, winner?.body);
  expect('retained is the rest', winner?.body.retained_minor === winner?.body.paid_minor - 500);
  await sleep(3000);
  expect('one refund email', (await mailpitCount(`subject:"Refund of"`)) >= 1);
  const deadToken = await api(`/api/review/${token}`, { cookie: 'none' });
  expect('review link dead after cancel', deadToken.status === 404);

  console.log('\n== finals require a paid look-dev invoice ==');
  const otherStart = await api('/api/projects/start', {
    body: {
      brand_name: 'Marrow Optics',
      contact_name: 'Ivo Marrow',
      email: `ivo+${stamp}@marrow.test`,
      title: 'Lens stills',
      currency: 'USD',
      reviewer_email: `review+${stamp}@marrow.test`,
    },
    cookie: 'none',
  });
  const other = otherStart.body.engagement;
  await api(`/api/engagements/${other.id}/quote/lines/hero_front`, { method: 'PUT', body: { quantity: 1 } });
  const usdQuote = (await api(`/api/engagements/${other.id}`)).body.quote;
  expect(
    'USD worked example',
    usdQuote.subtotal_minor === 57263 &&
      usdQuote.vat_minor === 11453 &&
      usdQuote.total_minor === 68716 &&
      usdQuote.milestones.deposit_minor === 27486 &&
      usdQuote.milestones.look_dev_minor === 20614 &&
      usdQuote.milestones.final_delivery_minor === 20616,
    usdQuote,
  );
  await upload(`/api/engagements/${other.id}/files`, 'lens.glb', buildGlb({ min: [0, 0, 0], max: [0.1, 0.1, 0.1] }));
  await upload(`/api/engagements/${other.id}/files`, 'refs.pdf', buildPdf());
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const read = await api(`/api/engagements/${other.id}`);
    if (read.body.files.some((file: any) => file.measurement === 'measured')) break;
    await sleep(500);
  }
  await api(`/api/engagements/${other.id}/deposit`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card },
  });
  await upload(
    `/api/studio/engagements/${other.id}/stills`,
    'look.png',
    buildPng(),
    { shot_code: 'hero_front', milestone: 'look_dev' },
    'studio',
  );
  const otherSent = await api(`/api/studio/engagements/${other.id}/send-for-review`, {
    body: {},
    cookie: 'studio',
  });
  const otherToken = (otherSent.body.review_url ?? '').split('/review/')[1] ?? '';
  await api(`/api/review/${otherToken}/accept`, { body: {}, cookie: 'none' });
  await upload(
    `/api/studio/engagements/${other.id}/stills`,
    'final.png',
    buildPng(),
    { shot_code: 'hero_front', milestone: 'final_delivery' },
    'studio',
  );
  const tooEarly = await api(`/api/studio/engagements/${other.id}/send-for-review`, {
    body: {},
    cookie: 'studio',
  });
  expect(
    'look_dev_unpaid guard',
    tooEarly.status === 409 && tooEarly.body.error === 'look_dev_unpaid',
    tooEarly.body,
  );
  const reviewerEarly = await api(`/api/review/${otherToken}/accept`, { body: {}, cookie: 'none' });
  expect(
    'finals_not_ready for the reviewer',
    reviewerEarly.status === 409 && reviewerEarly.body.error === 'finals_not_ready',
    reviewerEarly.body,
  );

  const otherStudio = await api(`/api/studio/engagements/${other.id}`, { cookie: 'studio' });
  const otherLookDev = otherStudio.body.invoices.find((entry: any) => entry.milestone === 'look_dev');
  await api(`/api/studio/invoices/${otherLookDev.id}/issue`, { body: {}, cookie: 'studio' });
  await api(`/api/invoices/${otherLookDev.id}/payments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card },
  });
  const finalsOut = await api(`/api/studio/engagements/${other.id}/send-for-review`, {
    body: {},
    cookie: 'studio',
  });
  expect('finals sent', finalsOut.status === 200, finalsOut.body);
  const finalToken = (finalsOut.body.review_url ?? '').split('/review/')[1] ?? '';
  const delivered = await api(`/api/review/${finalToken}/accept`, { body: {}, cookie: 'none' });
  expect('delivered', delivered.status === 200 && delivered.body.state === 'delivered', delivered.body);

  const deliveredStudio = await api(`/api/studio/engagements/${other.id}`, { cookie: 'studio' });
  const finalInvoice = deliveredStudio.body.invoices.find(
    (entry: any) => entry.milestone === 'final_delivery',
  );
  await api(`/api/studio/invoices/${finalInvoice.id}/issue`, { body: {}, cookie: 'studio' });
  const invoicesTotal = (await api(`/api/studio/engagements/${other.id}`, { cookie: 'studio' })).body
    .invoices.reduce((total: number, entry: any) => total + entry.amount_minor, 0);
  expect(
    'invoices add up to the quote total',
    invoicesTotal === usdQuote.total_minor,
    { invoicesTotal, total: usdQuote.total_minor },
  );

  console.log('\n== revoke and regenerate ==');
  const regenerated = await api(`/api/studio/engagements/${engagement.id}/review-link`, {
    body: {},
    cookie: 'studio',
  });
  expect(
    'regenerate refused once cancelled',
    regenerated.status === 409 && regenerated.body.error === 'invalid_state',
    regenerated.body,
  );
  expect(
    'delivered link stays readable',
    (await api(`/api/review/${finalToken}`, { cookie: 'none' })).status === 200,
  );
  const readable = await api(`/api/review/${finalToken}`, { cookie: 'none' });
  expect('actions closed once delivered', readable.body.actions_open === false, readable.body);
  await api(`/api/studio/engagements/${other.id}/review-link`, { method: 'DELETE', cookie: 'studio' });
  expect('revoked token dead', (await api(`/api/review/${finalToken}`, { cookie: 'none' })).status === 404);
  const revokeAgain = await api(`/api/studio/engagements/${other.id}/review-link`, {
    method: 'DELETE',
    cookie: 'studio',
  });
  expect('revoke with no link is 204', revokeAgain.status === 204, revokeAgain.status);

  console.log('\n== ntfy pushes ==');
  const pushes = await fetch('http://ntfy/gloamwork-studio/json?poll=1&since=all', {
    headers: { Authorization: `Basic ${Buffer.from('app:gfkit-dev').toString('base64')}` },
  });
  const pushText = await pushes.text();
  expect('deposit push', pushText.includes('Deposit paid'), pushText.slice(0, 200));

  console.log(`\n${failures.length === 0 ? 'ALL EDGE CHECKS PASSED' : `${failures.length} FAILURES`}`);
  for (const failure of failures) console.log(` - ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
};

await main();
