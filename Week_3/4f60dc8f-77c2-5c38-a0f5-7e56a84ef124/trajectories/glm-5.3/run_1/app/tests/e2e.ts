import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4173';
const MAILPIT = 'http://mailpit:8025';
let cookie = '';
let studioCookie = '';
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`ok   ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let json: unknown = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json: json as Record<string, never> | null, headers: r.headers };
}

async function studio(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (studioCookie) headers.Cookie = studioCookie;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie');
  if (sc) studioCookie = sc.split(';')[0];
  let json: unknown = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json: json as Record<string, never> | null };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ---- journey 1: start, quote, upload, measure, deposit ----
const stamp = Date.now();
const start = await call('POST', '/api/projects/start', {
  brand_name: 'Ridgeway Cycles', contact_name: 'Nia Ridge', email: `nia${stamp}@ridge.test`,
  title: 'E7 crank arm', currency: 'EUR',
  finance_email: `fin${stamp}@ridge.test`, reviewer_email: `rev${stamp}@ridge.test`,
});
check('start a project (EUR)', start.status === 201, (start.json as never as { engagement?: { reference: string } }).engagement?.reference);
const engagement = (start.json as never as { engagement: { id: string; reference: string } }).engagement;
const engId = engagement.id;

// quote lines
await call('PUT', `/api/engagements/${engId}/quote/lines/hero_front`, { quantity: 1 });
const quoteAfterOne = await call('GET', `/api/engagements/${engId}`);
const quote = (quoteAfterOne.json as never as { quote: { total_minor: number; milestones: { deposit_minor: number } } }).quote;
// EUR: hero 45000 pence * 1.1650 = 52425; vat 10485; total 62910; deposit floor(25164) look-dev floor(18873) final 18873
check('EUR conversion + VAT + split', quote.total_minor === 62910, `total ${quote.total_minor} expect 62910`);
check('milestone split', quote.milestones.deposit_minor === 25164, `deposit ${quote.milestones.deposit_minor} expect 25164`);

// upload the quantized GLB
const glb = readFileSync('/tmp/product.glb');
const form = new FormData();
form.append('file', new Blob([glb]), 'crank.glb');
const up = await fetch(`${BASE}/api/engagements/${engId}/files`, { method: 'POST', headers: { Cookie: cookie }, body: form });
check('upload GLB', up.status === 201, `status ${up.status}`);

// wait for measurement
let model: { id: string; measurement: string | null; dimensions_m: unknown } | null = null;
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1500));
  const fresh = await call('GET', `/api/engagements/${engId}`);
  const files = (fresh.json as never as { files: { id: string; kind: string; measurement: string | null; dimensions_m: unknown }[] }).files;
  model = files.find(f => f.kind === 'model') ?? null;
  if (model && (model.measurement === 'measured' || model.measurement === 'failed')) break;
}
check('model measured', model?.measurement === 'measured', JSON.stringify(model?.dimensions_m));

// upload a millimetre-scaled GLB to trigger the unit dialog
const mmGlb = makeGlb({ x: 180, y: 210, z: 85 });
const formMm = new FormData();
formMm.append('file', new Blob([mmGlb]), 'crank_mm.glb');
const upMm = await fetch(`${BASE}/api/engagements/${engId}/files`, { method: 'POST', headers: { Cookie: cookie }, body: formMm });
const mmFile = await upMm.json() as { id: string; measurement: string | null };
check('second GLB accepted', upMm.status === 201);
let mmModel: { id: string; measurement: string | null; needs_unit_confirmation: boolean } | null = null;
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1500));
  const fresh = await call('GET', `/api/engagements/${engId}`);
  const files = (fresh.json as never as { files: { id: string; kind: string; status: string; measurement: string | null; needs_unit_confirmation: boolean }[] }).files;
  const models = files.filter(f => f.kind === 'model' && f.status === 'received');
  mmModel = models[models.length - 1] ?? null;
  if (mmModel && (mmModel.measurement === 'measured' || mmModel.measurement === 'failed')) break;
}
check('mm model measured and needs unit', mmModel?.measurement === 'measured' && mmModel?.needs_unit_confirmation === true);

// deposit refused with unit_unconfirmed
const depositNoUnit = await call('POST', `/api/engagements/${engId}/deposit`, {
  card: { number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123', name: 'Nia' },
}, { 'Idempotency-Key': `no-unit-${stamp}` });
check('deposit refused with unit_unconfirmed', depositNoUnit.status === 409 && (depositNoUnit.json as never as { error: string }).error === 'unit_unconfirmed');

// choose millimetres
const unit = await call('PUT', `/api/engagements/${engId}/files/${mmModel?.id ?? ''}/unit`, { unit: 'mm' });
check('unit decision', unit.status === 200, JSON.stringify((unit.json as never as { dimensions_mm?: unknown })?.dimensions_mm));

// declined card
const declined = await call('POST', `/api/engagements/${engId}/deposit`, {
  card: { number: '4000 0000 0000 0002', expiry: '12/28', cvc: '123', name: 'Nia' },
}, { 'Idempotency-Key': `declined-${stamp}` });
check('declined deposit answers 402', declined.status === 402, (declined.json as never as { error?: string })?.error);
const afterDecline = await call('GET', `/api/engagements/${engId}`);
check('engagement still quoted after decline', (afterDecline.json as never as { state: string }).state === 'quoted');

// approving card
const deposit = await call('POST', `/api/engagements/${engId}/deposit`, {
  card: { number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123', name: 'Nia' },
}, { 'Idempotency-Key': `deposit-${stamp}` });
check('deposit paid', deposit.status === 201, `state ${(deposit.json as never as { engagement?: { state: string } }).engagement?.state}`);

// ledger consistency
const paidEng = await call('GET', `/api/engagements/${engId}`);
const paid = paidEng.json as never as {
  state: string;
  ledger: { kind: string; amount_minor: number }[];
  invoices: { milestone: string; status: string; number: string }[];
  quote: { milestones: { deposit_minor: number } };
};
check('one deposit ledger entry', paid.ledger.filter(l => l.kind === 'deposit').length === 1);
check('deposit invoice issued and paid', paid.invoices.some(i => i.milestone === 'deposit' && i.status === 'paid' && i.number !== null));

// ---- journey 2: look-dev review with revisions ----
const studioIn = await studio('POST', '/api/studio/session', { password: 'rig-founder-2026' });
check('studio sign-in', studioIn.status === 200);
const detail = await studio('GET', `/api/studio/engagements/${engId}`);
const shotCodes = (detail.json as never as { quote: { lines: { shot_code: string }[] } }).quote.lines.map(l => l.shot_code);
for (const code of shotCodes) {
  const still = await studio('POST', `/api/studio/engagements/${engId}/stills`, { shot_code: code, milestone: 'look_dev', data: PNG.toString('base64') });
  check(`still for ${code}`, still.status === 201);
}
const sent = await studio('POST', `/api/studio/engagements/${engId}/send-for-review`, {});
check('send for review', sent.status === 200, (sent.json as never as { engagement?: { state: string } }).engagement?.state);
const token = (sent.json as never as { review_url: string }).review_url.split('/').pop();

// reviewer reads and revises twice (included), third adds change order
const review = await call('GET', `/api/review/${token}`);
check('review link opens', review.status === 200, `rounds ${(review.json as never as { revision_rounds_used: number }).revision_rounds_used}`);
const round1 = await call('POST', `/api/review/${token}/revisions`, { note: 'Brighter.' }, { 'Idempotency-Key': 'r1' });
check('round 1 included', round1.status === 201 && (round1.json as never as { round: number; change_order: boolean }).round === 1 && (round1.json as never as { change_order: boolean }).change_order === false);
await studio('POST', `/api/studio/engagements/${engId}/stills`, { shot_code: shotCodes[0], milestone: 'look_dev', data: PNG.toString('base64') });
const sent2 = await studio('POST', `/api/studio/engagements/${engId}/send-for-review`, {});
const token2 = (sent2.json as never as { review_url: string }).review_url.split('/').pop();
const round2 = await call('POST', `/api/review/${token2}/revisions`, { note: 'Warmer.' }, { 'Idempotency-Key': 'r2' });
check('round 2 included', round2.status === 201 && (round2.json as never as { round: number }).round === 2);
await studio('POST', `/api/studio/engagements/${engId}/stills`, { shot_code: shotCodes[0], milestone: 'look_dev', data: PNG.toString('base64') });
const sent3 = await studio('POST', `/api/studio/engagements/${engId}/send-for-review`, {});
const token3 = (sent3.json as never as { review_url: string }).review_url.split('/').pop();
const round3 = await call('POST', `/api/review/${token3}/revisions`, { note: 'One more.' }, { 'Idempotency-Key': 'r3' });
check('round 3 adds change order', round3.status === 201 && (round3.json as never as { change_order: boolean }).change_order === true, `round ${(round3.json as never as { round: number }).round}`);

// accept
await studio('POST', `/api/studio/engagements/${engId}/stills`, { shot_code: shotCodes[0], milestone: 'look_dev', data: PNG.toString('base64') });
const sent4 = await studio('POST', `/api/studio/engagements/${engId}/send-for-review`, {});
const token4 = (sent4.json as never as { review_url: string }).review_url.split('/').pop();
const accept = await call('POST', `/api/review/${token4}/accept`, {});
check('accept moves to final_review', accept.status === 200, (accept.json as never as { state?: string }).state);

// look-dev invoice drafted with change-order line
const detail2 = await studio('GET', `/api/studio/engagements/${engId}`);
const invoices = (detail2.json as never as { invoices: { id: string; milestone: string; status: string; amount_minor: number; lines: { description: string }[] }[] }).invoices;
const lookDev = invoices.find(i => i.milestone === 'look_dev');
check('look-dev invoice drafted', lookDev?.status === 'draft', `amount ${lookDev?.amount_minor}`);
check('change order line present', lookDev?.lines.some(l => l.description.startsWith('Change order')) ?? false, lookDev?.lines.find(l => l.description.startsWith('Change order'))?.description);

// issue the invoice
const issue = await studio('POST', `/api/studio/invoices/${lookDev?.id ?? ''}/issue`, {});
check('issue invoice', issue.status === 200, `number ${(issue.json as never as { number?: string }).number}`);

// ---- journey 3: payment failed, overdue, retry ----
const decline2 = await call('POST', `/api/invoices/${lookDev?.id ?? ''}/payments`, {
  card: { number: '4000 0000 0000 0002', expiry: '12/28', cvc: '123', name: 'Nia' },
}, { 'Idempotency-Key': `decl-pay-${stamp}` });
check('declined milestone payment', decline2.status === 402);
const failedInvoice = await call('GET', `/api/invoices/${lookDev?.id ?? ''}`);
const failed = failedInvoice.json as never as { status: string; overdue_at: string | null; failed_attempts: number };
check('invoice payment_failed', failed.status === 'payment_failed', `attempts ${failed.failed_attempts}`);
check('overdue_at set', failed.overdue_at !== null);

// pay with the approving card
const payOk = await call('POST', `/api/invoices/${lookDev?.id ?? ''}/payments`, {
  card: { number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123', name: 'Nia' },
}, { 'Idempotency-Key': `pay-${stamp}` });
check('milestone payment succeeds', payOk.status === 201, `status ${(payOk.json as never as { invoice?: { status: string } }).invoice?.status}`);

// ---- journey 4: final delivery ----
for (const code of shotCodes) {
  await studio('POST', `/api/studio/engagements/${engId}/stills`, { shot_code: code, milestone: 'final_delivery', data: PNG.toString('base64') });
}
const finalsSent = await studio('POST', `/api/studio/engagements/${engId}/send-for-review`, {});
check('finals sent', finalsSent.status === 200);
const finalToken = (finalsSent.json as never as { review_url: string }).review_url.split('/').pop();
const acceptFinal = await call('POST', `/api/review/${finalToken}/accept`, {});
check('accept final delivery', acceptFinal.status === 200, (acceptFinal.json as never as { state?: string }).state);

// total check: deposit + look-dev + final invoices sum to quote total + change orders
const detail3 = await studio('GET', `/api/studio/engagements/${engId}`);
const finalEng = detail3.json as never as {
  state: string;
  quote: { total_minor: number; milestones: { deposit_minor: number; look_dev_minor: number; final_delivery_minor: number } };
  invoices: { milestone: string; amount_minor: number; status: string }[];
  ledger: { kind: string; amount_minor: number }[];
};
const finalInvoice = finalEng.invoices.find(i => i.milestone === 'final_delivery');
check('final-delivery invoice drafted', finalInvoice?.status === 'draft');
const invoiceSum = finalEng.invoices.reduce((sum, i) => sum + i.amount_minor, 0);
const changeOrders = finalEng.invoices.filter(i => i.milestone === 'look_dev')[0];
check('invoices sum to quote total + change orders', invoiceSum === finalEng.quote.total_minor + (changeOrders ? changeOrders.amount_minor - finalEng.quote.milestones.look_dev_minor : 0), `sum ${invoiceSum}`);

// ---- journey 5: cancellation with refund ----
// Use a separate engagement for cancellation
const start2 = await call('POST', '/api/projects/start', {
  brand_name: 'Cancel Test', contact_name: 'C T', email: `ct${stamp}@ct.test`, title: 'CT', currency: 'GBP',
});
const eng2 = (start2.json as never as { engagement: { id: string; reference: string } }).engagement;
await call('PUT', `/api/engagements/${eng2.id}/quote/lines/hero_front`, { quantity: 1 });
const glbForm2 = new FormData();
glbForm2.append('file', new Blob([glb]), 'm.glb');
await fetch(`${BASE}/api/engagements/${eng2.id}/files`, { method: 'POST', headers: { Cookie: cookie }, body: glbForm2 });
await new Promise(r => setTimeout(r, 4000));
const dep2 = await call('POST', `/api/engagements/${eng2.id}/deposit`, {
  card: { number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123', name: 'C' },
}, { 'Idempotency-Key': `dep2-${stamp}` });
check('second deposit', dep2.status === 201);
const paidEng2 = await call('GET', `/api/engagements/${eng2.id}`);
void paidEng2;

// refund half the deposit
const cancel = await studio('POST', `/api/studio/engagements/${eng2.id}/cancel`, { refund_minor: 10800 });
check('cancel with refund', cancel.status === 200, `refunded ${(cancel.json as never as { refunded_minor?: number }).refunded_minor}`);
const cancelled = await studio('GET', `/api/studio/engagements/${eng2.id}`);
check('state cancelled_with_refund', (cancelled.json as never as { state: string }).state === 'cancelled_with_refund');
check('deposit invoice stays paid', (cancelled.json as never as { invoices: { milestone: string; status: string }[] }).invoices.some(i => i.milestone === 'deposit' && i.status === 'paid'));

// refund on a quoted engagement answers invalid_state (state precedence over validation)
const start3 = await call('POST', '/api/projects/start', {
  brand_name: 'C3', contact_name: 'C', email: `c3${stamp}@c3.test`, title: 'C3', currency: 'GBP',
});
const eng3 = (start3.json as never as { engagement: { id: string } }).engagement;
const badRefund = await studio('POST', `/api/studio/engagements/${eng3.id}/cancel`, { refund_minor: 100 });
check('refund on quoted answers invalid_state', badRefund.status === 409 && (badRefund.json as never as { error: string }).error === 'invalid_state');

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);

function makeGlb(dims: { x: number; y: number; z: number }): Buffer {
  // A simple float accessor box in metres of the given dimensions.
  const half = { x: dims.x / 2, y: dims.y / 2, z: dims.z / 2 };
  const min = [-half.x, -half.y, -half.z];
  const max = [half.x, half.y, half.z];
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ componentType: 5126, count: 8, type: 'VEC3', min, max }],
    buffers: [{ byteLength: 96 }],
  };
  const json = JSON.stringify(gltf);
  const padding = (4 - json.length % 4) % 4;
  const jsonBytes = Buffer.concat([Buffer.from(json), Buffer.alloc(padding, 0x20)]);
  const bin = Buffer.alloc(96);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'latin1');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBytes.length, 12);
  out.write('JSON', 16, 'latin1');
  jsonBytes.copy(out, 20);
  const binStart = 20 + jsonBytes.length;
  out.writeUInt32LE(bin.length, binStart);
  out.write('BIN\u0000', binStart + 4, 'latin1');
  bin.copy(out, binStart + 8);
  return out;
}
