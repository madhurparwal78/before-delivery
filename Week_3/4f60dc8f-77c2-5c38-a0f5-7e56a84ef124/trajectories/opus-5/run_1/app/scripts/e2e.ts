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

const api = async (path: string, call: Call = {}): Promise<{ status: number; body: any; headers: Headers }> => {
  const headers: Record<string, string> = { Origin: BASE, ...(call.headers ?? {}) };
  if (call.cookie === 'studio') headers.Cookie = studioCookie;
  else if (call.cookie !== 'none') headers.Cookie = clientCookie;
  if (call.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method: call.method ?? (call.body !== undefined || call.form !== undefined ? 'POST' : 'GET'),
    headers,
    body: call.form ?? (call.body === undefined ? undefined : JSON.stringify(call.body)),
  });
  const setCookie = response.headers.getSetCookie();
  for (const cookie of setCookie) {
    if (cookie.startsWith('gw_session=')) clientCookie = cookie.split(';')[0];
    if (cookie.startsWith('gw_studio=')) studioCookie = cookie.split(';')[0];
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* page responses are HTML */
  }
  return { status: response.status, body, headers: response.headers };
};

const mailpit = async (query: string): Promise<any[]> => {
  const response = await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(query)}&limit=20`);
  if (!response.ok) return [];
  return ((await response.json()) as { messages: any[] }).messages;
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

const main = async (): Promise<void> => {
  const stamp = Date.now();
  console.log('\n== start a project (JPY) ==');
  const start = await api('/api/projects/start', {
    body: {
      brand_name: 'Kasugai Audio',
      contact_name: 'Rin Mori',
      email: `rin+${stamp}@kasugai.test`,
      title: 'KA-1 launch stills',
      currency: 'JPY',
      finance_email: `keiri+${stamp}@kasugai.test`,
      reviewer_email: `review+${stamp}@kasugai.test`,
    },
    cookie: 'none',
  });
  expect('start 201', start.status === 201, start.body);
  const engagement = start.body.engagement;
  expect('engagement quoted', engagement.state === 'quoted');
  expect('currency JPY', engagement.brand.currency === 'JPY');
  expect('exponent 0', engagement.quote.exponent === 0);

  console.log('\n== email already taken ==');
  const taken = await api('/api/projects/start', {
    body: {
      brand_name: 'Dup',
      contact_name: 'Dup',
      email: `rin+${stamp}@kasugai.test`,
      title: 'Dup',
      currency: 'GBP',
      reviewer_email: `other+${stamp}@kasugai.test`,
    },
    cookie: 'none',
  });
  expect('email_taken 409', taken.status === 409 && taken.body.error === 'email_taken', taken.body);

  console.log('\n== quote line + exact money ==');
  const put = await api(`/api/engagements/${engagement.id}/quote/lines/hero_front`, {
    method: 'PUT',
    body: { quantity: 1 },
  });
  expect('put line 200', put.status === 200, put.body);
  expect('line ¥92,438', put.body.lines[0].amount_minor === 92438, put.body.lines[0]);
  expect('vat 18488', put.body.vat_minor === 18488, put.body.vat_minor);
  expect('total 110926', put.body.total_minor === 110926, put.body.total_minor);
  expect(
    'split 44370/33277/33279',
    put.body.milestones.deposit_minor === 44370 &&
      put.body.milestones.look_dev_minor === 33277 &&
      put.body.milestones.final_delivery_minor === 33279,
    put.body.milestones,
  );
  expect('revision 1', put.body.revision === 1, put.body.revision);

  console.log('\n== uploads ==');
  const mmGlb = buildGlb({ min: [0, 0, 0], max: [180, 210, 85] });
  const glbUpload = await upload(`/api/engagements/${engagement.id}/files`, 'ケトル.glb', mmGlb);
  expect('glb 201', glbUpload.status === 201, glbUpload.body);
  const modelId = glbUpload.body.id;

  const pdfUpload = await upload(`/api/engagements/${engagement.id}/files`, '参考資料.pdf', buildPdf());
  expect('pdf 201', pdfUpload.status === 201, pdfUpload.body);

  const mismatch = await upload(`/api/engagements/${engagement.id}/files`, 'fake.glb', buildPdf());
  expect(
    'file_type_mismatch',
    mismatch.status === 422 && mismatch.body.error === 'file_type_mismatch',
    mismatch.body,
  );

  const broken = Buffer.from(buildGlb({ min: [0, 0, 0], max: [1, 1, 1] }));
  broken.writeUInt32LE(99999, 8);
  const malformed = await upload(`/api/engagements/${engagement.id}/files`, 'broken.glb', broken);
  expect('gltf_malformed', malformed.status === 422 && malformed.body.error === 'gltf_malformed', malformed.body);

  const unsupported = await upload(
    `/api/engagements/${engagement.id}/files`,
    'ext.glb',
    buildGlb({
      min: [0, 0, 0],
      max: [1, 1, 1],
      extensionsUsed: ['KHR_materials_variants'],
      extensionsRequired: ['KHR_materials_variants'],
    }),
  );
  expect('unsupported extension refused', unsupported.status === 422, unsupported.body);

  console.log('\n== measurement ==');
  let file: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const read = await api(`/api/engagements/${engagement.id}`);
    file = read.body.files.find((entry: any) => entry.id === modelId);
    if (file?.measurement === 'measured' || file?.measurement === 'failed') break;
    await sleep(500);
  }
  expect('measured', file?.measurement === 'measured', file);
  expect('needs unit confirmation', file?.needs_unit_confirmation === true, file);
  expect('dimensions 180/210/85 m', file?.dimensions_m?.x === 180, file?.dimensions_m);

  const unit = await api(`/api/engagements/${engagement.id}/files/${modelId}/unit`, {
    method: 'PUT',
    body: { unit: 'mm' },
  });
  expect('unit 200', unit.status === 200, unit.body);
  expect('mm dimensions 180', unit.body.dimensions_mm?.x === 180, unit.body.dimensions_mm);

  console.log('\n== quantized glb measures without a question ==');
  const quantized = buildGlb({
    min: [-32767, 0, -32767],
    max: [32767, 32767, 32767],
    componentType: 5122,
    normalized: true,
    nodeScale: [0.09, 0.21, 0.0425],
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
  });
  const quantizedUpload = await upload(`/api/engagements/${engagement.id}/files`, 'quantized.glb', quantized);
  expect('quantized 201', quantizedUpload.status === 201, quantizedUpload.body);
  let quantizedFile: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const read = await api(`/api/engagements/${engagement.id}`);
    quantizedFile = read.body.files.find((entry: any) => entry.id === quantizedUpload.body.id);
    if (quantizedFile?.measurement === 'measured' || quantizedFile?.measurement === 'failed') break;
    await sleep(500);
  }
  expect('quantized measured', quantizedFile?.measurement === 'measured', quantizedFile);
  expect(
    'quantized 0.18 x 0.21 x 0.085',
    Math.abs(quantizedFile?.dimensions_m?.x - 0.18) < 1e-9 &&
      Math.abs(quantizedFile?.dimensions_m?.y - 0.21) < 1e-9 &&
      Math.abs(quantizedFile?.dimensions_m?.z - 0.085) < 1e-9,
    quantizedFile?.dimensions_m,
  );
  expect('quantized needs no unit', quantizedFile?.needs_unit_confirmation === false, quantizedFile);

  console.log('\n== downloads byte for byte ==');
  const download = await fetch(
    `${BASE}/api/engagements/${engagement.id}/files/${pdfUpload.body.id}/content`,
    { headers: { Cookie: clientCookie } },
  );
  const downloaded = Buffer.from(await download.arrayBuffer());
  expect('pdf bytes match', downloaded.equals(buildPdf()));
  expect(
    'content-disposition rfc6266',
    (download.headers.get('content-disposition') ?? '').includes("filename*=UTF-8''%E5%8F%82%E8%80%83%E8%B3%87%E6%96%99.pdf"),
    download.headers.get('content-disposition'),
  );

  console.log('\n== declined deposit ==');
  const declined = await api(`/api/engagements/${engagement.id}/deposit`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card: { number: '4000 0000 0000 0002', expiry: '12/30', cvc: '123', name: 'Rin Mori' } },
  });
  expect('declined 402', declined.status === 402 && declined.body.error === 'card_declined', declined.body);
  const afterDecline = await api(`/api/engagements/${engagement.id}`);
  expect('still quoted', afterDecline.body.state === 'quoted');
  expect('no invoices', afterDecline.body.invoices.length === 0);

  console.log('\n== deposit ==');
  const depositKey = randomUUID();
  const depositBody = {
    card: { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123', name: 'Rin Mori' },
  };
  const deposit = await api(`/api/engagements/${engagement.id}/deposit`, {
    headers: { 'Idempotency-Key': depositKey },
    body: depositBody,
  });
  expect('deposit 201', deposit.status === 201, deposit.body);
  expect('deposit_paid', deposit.body.engagement.state === 'deposit_paid', deposit.body.engagement?.state);
  expect('deposit invoice paid', deposit.body.invoice.status === 'paid', deposit.body.invoice);
  expect('deposit amount 44370', deposit.body.invoice.amount_minor === 44370, deposit.body.invoice);
  expect('fx locked', deposit.body.engagement.quote.fx_locked === true);

  const replay = await api(`/api/engagements/${engagement.id}/deposit`, {
    headers: { 'Idempotency-Key': depositKey },
    body: depositBody,
  });
  expect('replay 201 same', replay.status === 201 && replay.body.invoice.id === deposit.body.invoice.id);

  const conflict = await api(`/api/engagements/${engagement.id}/deposit`, {
    headers: { 'Idempotency-Key': depositKey },
    body: { card: { number: '4242 4242 4242 4242', expiry: '11/30', cvc: '123', name: 'Rin Mori' } },
  });
  expect('idempotency_conflict', conflict.status === 409 && conflict.body.error === 'idempotency_conflict', conflict.body);

  const second = await api(`/api/engagements/${engagement.id}/deposit`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: depositBody,
  });
  expect('second deposit invalid_state', second.status === 409 && second.body.error === 'invalid_state', second.body);

  const locked = await api(`/api/engagements/${engagement.id}/quote/lines/top_down`, {
    method: 'PUT',
    body: { quantity: 1 },
  });
  expect('quote_locked', locked.status === 409 && locked.body.error === 'quote_locked', locked.body);

  await sleep(2500);
  const receipts = await mailpit(`subject:"Deposit receipt"`);
  expect('deposit receipt email', receipts.length > 0);
  if (receipts.length > 0) {
    const detail = await (await fetch(`http://mailpit:8025/api/v1/message/${receipts[0].ID}`)).json() as any;
    expect('receipt has pdf', detail.Attachments?.length === 1, detail.Attachments);
    expect('receipt text whole yen', String(detail.Text).includes('¥110,926'), String(detail.Text).slice(0, 400));
  }

  console.log('\n== studio sign in ==');
  const studio = await api('/api/studio/session', { body: { password: 'rig-founder-2026' }, cookie: 'none' });
  expect('studio 200', studio.status === 200, studio.body);
  const wrong = await api('/api/studio/session', { body: { password: 'nope' }, cookie: 'none' });
  expect('invalid_credentials', wrong.status === 401 && wrong.body.error === 'invalid_credentials');

  console.log('\n== stills and review ==');
  const stillPost = await upload(
    `/api/studio/engagements/${engagement.id}/stills`,
    'hero.png',
    buildPng(),
    { shot_code: 'hero_front', milestone: 'look_dev' },
    'studio',
  );
  expect('still 201', stillPost.status === 201, stillPost.body);

  const sendForReview = await api(`/api/studio/engagements/${engagement.id}/send-for-review`, {
    body: {},
    cookie: 'studio',
  });
  expect('send for review 200', sendForReview.status === 200, sendForReview.body);
  let token = (sendForReview.body.review_url ?? '').split('/review/')[1] ?? '';
  expect('review token', token.length > 20, sendForReview.body.review_url);

  const resend = async (): Promise<void> => {
    const again = await api(`/api/studio/engagements/${engagement.id}/send-for-review`, {
      body: {},
      cookie: 'studio',
    });
    token = (again.body.review_url ?? '').split('/review/')[1] ?? token;
  };

  const reviewRead = await api(`/api/review/${token}`, { cookie: 'none' });
  expect('review 200', reviewRead.status === 200, reviewRead.body);
  expect(
    'review keys only',
    JSON.stringify(Object.keys(reviewRead.body).sort()) ===
      JSON.stringify(
        ['actions_open', 'brand_name', 'milestone', 'reference', 'revision_rounds_included', 'revision_rounds_used', 'state', 'stills'].sort(),
      ),
    Object.keys(reviewRead.body),
  );
  expect('no amounts in review', !JSON.stringify(reviewRead.body).includes('44370'));
  expect('referrer policy', reviewRead.headers.get('referrer-policy') === 'no-referrer');

  const revisionKey = randomUUID();
  const revision = await api(`/api/review/${token}/revisions`, {
    headers: { 'Idempotency-Key': revisionKey },
    body: { note: 'Warmer key light please.' },
    cookie: 'none',
  });
  expect('revision 201', revision.status === 201, revision.body);
  expect('round 1', revision.body.round === 1 && revision.body.change_order === false, revision.body);
  const revisionReplay = await api(`/api/review/${token}/revisions`, {
    headers: { 'Idempotency-Key': revisionKey },
    body: { note: 'Warmer key light please.' },
    cookie: 'none',
  });
  expect('revision replay round 1', revisionReplay.body.round === 1, revisionReplay.body);

  await resend();
  const round2 = await api(`/api/review/${token}/revisions`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { note: 'Second round.' },
    cookie: 'none',
  });
  expect('round 2 no change order', round2.body.round === 2 && round2.body.change_order === false, round2.body);

  await resend();
  const round3 = await api(`/api/review/${token}/revisions`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { note: 'Third round.' },
    cookie: 'none',
  });
  expect('round 3 adds change order', round3.body.round === 3 && round3.body.change_order === true, round3.body);

  await resend();
  const accept = await api(`/api/review/${token}/accept`, { body: {}, cookie: 'none' });
  expect('accept 200', accept.status === 200, accept.body);

  const studioRead = await api(`/api/studio/engagements/${engagement.id}`, { cookie: 'studio' });
  expect('final_review', studioRead.body.state === 'final_review', studioRead.body.state);
  const lookDev = studioRead.body.invoices.find((entry: any) => entry.milestone === 'look_dev');
  expect('look-dev drafted', lookDev?.status === 'draft', lookDev);
  expect('look-dev has change order line', lookDev?.lines?.length === 2, lookDev?.lines);
  expect(
    'change order ¥44,370',
    lookDev?.lines?.[1]?.amount_minor === 44370,
    lookDev?.lines,
  );

  console.log('\n== issue and pay the look-dev invoice ==');
  const issued = await api(`/api/studio/invoices/${lookDev.id}/issue`, { body: {}, cookie: 'studio' });
  expect('issue 200', issued.status === 200 && issued.body.status === 'issued', issued.body);
  const reissue = await api(`/api/studio/invoices/${lookDev.id}/issue`, { body: {}, cookie: 'studio' });
  expect('reissue invalid_state', reissue.status === 409, reissue.body);

  const declinedInvoice = await api(`/api/invoices/${lookDev.id}/payments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card: { number: '4000 0000 0000 0002', expiry: '12/30', cvc: '123', name: 'Rin' } },
  });
  expect('invoice decline 402', declinedInvoice.status === 402, declinedInvoice.body);
  const failedRead = await api(`/api/invoices/${lookDev.id}`);
  expect('payment_failed', failedRead.body.status === 'payment_failed', failedRead.body);
  expect('overdue_at set', failedRead.body.overdue_at !== null, failedRead.body);

  const paid = await api(`/api/invoices/${lookDev.id}/payments`, {
    headers: { 'Idempotency-Key': randomUUID() },
    body: { card: { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123', name: 'Rin' } },
  });
  expect('invoice paid 201', paid.status === 201 && paid.body.invoice.status === 'paid', paid.body);

  console.log('\n== cancel with refund ==');
  const ledgerBefore = await api(`/api/studio/engagements/${engagement.id}`, { cookie: 'studio' });
  const paidTotal = ledgerBefore.body.ledger.reduce((sum: number, entry: any) => sum + entry.amount_minor, 0);
  const refundAmount = lookDev.amount_minor + 100;
  const cancel = await api(`/api/studio/engagements/${engagement.id}/cancel`, {
    body: { refund_minor: refundAmount },
    cookie: 'studio',
  });
  expect('cancel 200', cancel.status === 200, cancel.body);
  expect('cancelled state', cancel.body.engagement.state === 'cancelled_with_refund');
  expect('paid total matches', cancel.body.paid_minor === paidTotal, { paid: cancel.body.paid_minor, paidTotal });
  expect('refunded matches', cancel.body.refunded_minor === refundAmount, cancel.body.refunded_minor);
  expect(
    'retained matches',
    cancel.body.retained_minor === cancel.body.paid_minor - cancel.body.refunded_minor,
  );
  expect('two refund parts', cancel.body.refunds.length === 2, cancel.body.refunds);
  expect(
    'newest payment first',
    cancel.body.refunds[0].amount_minor === lookDev.amount_minor && cancel.body.refunds[1].amount_minor === 100,
    cancel.body.refunds,
  );
  const secondCancel = await api(`/api/studio/engagements/${engagement.id}/cancel`, {
    body: { refund_minor: 1 },
    cookie: 'studio',
  });
  expect('second cancel invalid_state', secondCancel.status === 409, secondCancel.body);

  const deadReview = await api(`/api/review/${token}`, { cookie: 'none' });
  expect('review link dead', deadReview.status === 404, deadReview.body);

  console.log('\n== brand scope ==');
  const otherEngagements = await api('/api/studio/engagements', { cookie: 'studio' });
  const foreign = otherEngagements.body.engagements.find((entry: any) => entry.reference === 'GW-1001');
  const foreignRead = await api(`/api/engagements/${foreign.id}`);
  expect('other brand 404', foreignRead.status === 404, foreignRead.body);

  console.log('\n== sign-in code limit ==');
  const email = `limit+${stamp}@kasugai.test`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await api('/api/session/code', { body: { email }, cookie: 'none' });
    expect(`code request ${attempt} 202`, response.status === 202, response.body);
  }
  const fourth = await api('/api/session/code', { body: { email }, cookie: 'none' });
  expect(
    'fourth 429 with Retry-After',
    fourth.status === 429 && fourth.headers.get('retry-after') !== null,
    { status: fourth.status, retry: fourth.headers.get('retry-after') },
  );

  console.log('\n== sign in with a code ==');
  const knownEmail = `keiri+${stamp}@kasugai.test`;
  await api('/api/session/code', { body: { email: knownEmail }, cookie: 'none' });
  await sleep(2000);
  const codeMails = await mailpit(`to:"${knownEmail}"`);
  expect('code email arrived', codeMails.length > 0, codeMails.length);
  let code = '';
  if (codeMails.length > 0) {
    const detail = (await (await fetch(`http://mailpit:8025/api/v1/message/${codeMails[0].ID}`)).json()) as any;
    code = /(\d{6})/.exec(String(detail.Text))?.[1] ?? '';
  }
  const signIn = await api('/api/session', {
    body: { email: knownEmail, code, next: '/account/engagements/abc' },
    cookie: 'none',
  });
  expect('sign in 200', signIn.status === 200, signIn.body);
  expect('landing next', signIn.body.landing === '/account/engagements/abc', signIn.body.landing);
  const offSite = await api('/api/session', {
    body: { email: knownEmail, code, next: '//evil.test' },
    cookie: 'none',
  });
  expect('used code refused', offSite.status === 401, offSite.body);

  console.log('\n== cross origin and body limits ==');
  const cross = await fetch(`${BASE}/api/session/code`, {
    method: 'POST',
    headers: { Origin: 'http://evil.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x@y.test' }),
  });
  expect('cross_origin 403', cross.status === 403, cross.status);
  const big = await fetch(`${BASE}/api/session/code`, {
    method: 'POST',
    headers: { Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x@y.test', pad: 'x'.repeat(70000) }),
  });
  expect('payload_too_large 413', big.status === 413, big.status);

  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILURES`}`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(` - ${failure}`);
    process.exitCode = 1;
  }
};

await main();
