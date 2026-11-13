import { PNG } from 'pngjs';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173';
let failures = 0;

function check(label, condition, extra) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`);
  }
}

class Session {
  constructor() {
    this.cookie = null;
  }

  async call(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (this.cookie) init.headers.cookie = this.cookie;
    const response = await fetch(`${BASE}${path}`, init);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, body: json, headers: response.headers };
  }

  signIn(email, password) {
    return this.call('POST', '/api/session', { email, password });
  }
}

function png(width, height) {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    image.data[i * 4] = (i * 7) % 255;
    image.data[i * 4 + 1] = (i * 13) % 255;
    image.data[i * 4 + 2] = (i * 29) % 255;
    image.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function upload(session, entryId, bytes, name, type) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return session.call('POST', `/api/entries/${entryId}/assets`, form);
}

async function killbill(path) {
  const response = await fetch(`${process.env.KILLBILL_URL}/1.0/kb${path}`, {
    headers: {
      authorization: 'Basic ' + Buffer.from(`${process.env.KILLBILL_USERNAME}:${process.env.KILLBILL_PASSWORD}`).toString('base64'),
      'x-killbill-apikey': process.env.KILLBILL_API_KEY,
      'x-killbill-apisecret': process.env.KILLBILL_API_SECRET,
      accept: 'application/json',
    },
  });
  return response.json();
}

async function mailpit(query) {
  const response = await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(query)}`);
  return response.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('health + boundary');
  const anon = new Session();
  check('health ok', (await anon.call('GET', '/api/health')).status === 200);
  check('unknown api 404', (await anon.call('GET', '/api/nope')).status === 404);
  const unauth = await anon.call('GET', '/api/entries');
  check('unauthenticated 401', unauth.status === 401 && unauth.body.error === 'unauthenticated', unauth.body);
  const crossOrigin = await anon.call('POST', '/api/session', { email: 'x', password: 'y' }, { origin: 'http://evil.example' });
  check('cross-origin write 403', crossOrigin.status === 403 && crossOrigin.body.error === 'forbidden', crossOrigin.body);
  const big = await anon.call('POST', '/api/session', { email: 'x'.repeat(70000) });
  check('oversized json 413', big.status === 413 && big.body.error === 'payload_too_large', big.body);
  const wrongType = await fetch(`${BASE}/api/session`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' });
  check('wrong content type 415', wrongType.status === 415);

  console.log('sign in');
  const director = new Session();
  check('director signs in', (await director.signIn('director@cutline.example', 'director-pass-26')).status === 200);
  const studio = new Session();
  const studioIn = await studio.signIn('studio@halftone.example', 'halftone-pass-26');
  check('studio signs in', studioIn.status === 200 && studioIn.body.user.studioName === 'Halftone Works', studioIn.body);
  const bad = await new Session().signIn('studio@halftone.example', 'nope');
  check('bad password 401', bad.status === 401 && bad.body.error === 'invalid_credentials', bad.body);

  console.log('programs');
  const programs = await anon.call('GET', '/api/programs');
  const open = programs.body.programs.find((p) => p.entriesOpen);
  check('open program exists', open !== undefined && open.name === 'Cutline Open Call', open && open.name);
  check('deadline label format', /^23:59 Asia\/Kolkata, \d{1,2} \w{3} \d{4}$/.test(open.deadlineLabel), open.deadlineLabel);
  check('deadlineAt offset', open.deadlineAt.endsWith('+05:30') && open.deadlineAt.includes('T00:00:00'), open.deadlineAt);
  check('current tier early bird', open.currentTier === 'early_bird' && open.currentFeeCents === 4500);

  const portfolio = open.categories.find((c) => c.name === 'Portfolio');

  console.log('entry draft + images + pay');
  const created = await studio.call('POST', '/api/entries', {
    categoryId: portfolio.id,
    title: 'Flat Horizon',
    summary: 'A quiet portfolio for a quiet studio.',
    siteUrl: 'https://flathorizon.example',
    credits: 'Dario Feld',
  });
  check('draft created', created.status === 201 && created.body.entry.state === 'draft', created.body);
  const entryId = created.body.entry.id;

  const tooSmall = await upload(studio, entryId, png(320, 320), 'small.png', 'image/png');
  check('small image 422', tooSmall.status === 422 && tooSmall.body.errors.file.includes('640'), tooSmall.body);
  const notImage = await upload(studio, entryId, Buffer.from('<svg></svg>'), 'x.svg', 'image/svg+xml');
  check('svg 415', notImage.status === 415 && notImage.body.error === 'unsupported_type', notImage.body);
  const broken = await upload(studio, entryId, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60)]), 'b.png', 'image/png');
  check('broken png 422', broken.status === 422 && broken.body.errors.file.includes('readable'), broken.body);

  for (let i = 0; i < 3; i += 1) {
    const added = await upload(studio, entryId, png(800, 640 + i), `shot${i}.png`, 'image/png');
    check(`image ${i + 1} accepted`, added.status === 201 && added.body.asset.width === 800, added.body);
  }

  const noKey = await studio.call('POST', `/api/entries/${entryId}/submit`, {});
  check('submit without key 422', noKey.status === 422 && 'idempotencyKey' in noKey.body.errors, noKey.body);

  const key = 'smoke-key-1';
  const submitted = await studio.call('POST', `/api/entries/${entryId}/submit`, {}, { 'idempotency-key': key });
  check('submitted 201', submitted.status === 201 && submitted.body.entry.state === 'submitted', submitted.body);
  check('fee tier early bird', submitted.body.receipt.tier === 'early_bird' && submitted.body.receipt.amountCents === 4500, submitted.body.receipt);
  const replay = await studio.call('POST', `/api/entries/${entryId}/submit`, {}, { 'idempotency-key': key });
  check('replay returns stored 201', replay.status === 201 && replay.body.receipt.invoiceId === submitted.body.receipt.invoiceId);

  const other = await studio.call('POST', '/api/entries', {
    categoryId: portfolio.id,
    title: 'Second Draft',
    summary: 'Another case study.',
    siteUrl: 'https://second.example',
    credits: '',
  });
  const reuse = await studio.call('POST', `/api/entries/${other.body.entry.id}/submit`, {}, { 'idempotency-key': key });
  check('key reuse 409', reuse.status === 409 && reuse.body.error === 'idempotency_key_reused', reuse.body);
  await studio.call('DELETE', `/api/entries/${other.body.entry.id}`);

  await sleep(1500);
  const receipts = await mailpit(`to:studio@halftone.example subject:"Cutline receipt"`);
  check('receipt email delivered', receipts.messages_count >= 1, receipts.messages_count);

  console.log('privacy');
  const rival = new Session();
  await rival.signIn('hello@fieldnote.example', 'fieldnote-pass-26');
  const peek = await rival.call('GET', `/api/entries/${entryId}`);
  check('rival sees 404', peek.status === 404, peek.body);
  const invoicePeek = await rival.call('GET', `/api/invoices/${submitted.body.receipt.invoiceId}`);
  check('rival invoice 404', invoicePeek.status === 404);
  const ownInvoice = await studio.call('GET', `/api/invoices/${submitted.body.receipt.invoiceId}`);
  check('own invoice paid', ownInvoice.status === 200 && ownInvoice.body.invoice.status === 'paid', ownInvoice.body);

  console.log('withdraw + refund');
  const withdrawEntry = await studio.call('POST', '/api/entries', {
    categoryId: portfolio.id,
    title: 'Changed Plans',
    summary: 'This one goes away.',
    siteUrl: 'https://changed.example',
    credits: '',
  });
  const wid = withdrawEntry.body.entry.id;
  await upload(studio, wid, png(700, 700), 'w.png', 'image/png');
  const wsub = await studio.call('POST', `/api/entries/${wid}/submit`, {}, { 'idempotency-key': 'smoke-key-2' });
  check('withdraw entry submitted', wsub.status === 201, wsub.status);
  const withdrawn = await studio.call('POST', `/api/entries/${wid}/withdraw`, {});
  check('withdrawn with refund', withdrawn.status === 200 && withdrawn.body.refund.amountCents === 4500, withdrawn.body);
  const again = await studio.call('POST', `/api/entries/${wid}/withdraw`, {});
  check('second withdraw 409', again.status === 409 && again.body.error === 'invalid_transition', again.body);
  await sleep(2500);
  const refundMail = await mailpit('subject:"Cutline refund"');
  check('refund email delivered', refundMail.messages_count >= 1, refundMail.messages_count);

  const afterRefund = await studio.call('POST', '/api/entries', {
    categoryId: portfolio.id,
    title: 'After The Refund',
    summary: 'A fresh entry once the refund landed.',
    siteUrl: 'https://afterrefund.example',
    credits: '',
  });
  await upload(studio, afterRefund.body.entry.id, png(700, 700), 'r.png', 'image/png');
  const afterRefundSubmit = await studio.call(
    'POST',
    `/api/entries/${afterRefund.body.entry.id}/submit`,
    {},
    { 'idempotency-key': 'smoke-key-3' },
  );
  check('submit works after a refund', afterRefundSubmit.status === 201, afterRefundSubmit.body);
  const billing = await killbill(`/accounts?externalKey=cutline-studio-${studioIn.body.user.studioId}&accountWithBalance=true`);
  check('kill bill balance is zero', billing.accountBalance === 0, billing.accountBalance);
  const purchase = await killbill(`/payments?externalKey=cutline-entry-${entryId}&withPluginInfo=false`);
  check(
    'payment external key and purchase',
    purchase.transactions.length === 1 &&
      purchase.transactions[0].transactionType === 'PURCHASE' &&
      purchase.transactions[0].status === 'SUCCESS',
    purchase.transactions,
  );

  console.log('role guards');
  const jurorSession = new Session();
  await jurorSession.signIn('teo@jury.example', 'juror-pass-26');
  const jurorProgram = await jurorSession.call('POST', '/api/programs', { name: 'Nope', year: 2026 });
  check('juror cannot create program', jurorProgram.status === 403 && jurorProgram.body.error === 'forbidden', jurorProgram.body);
  const studioScreen = await studio.call('POST', `/api/entries/${entryId}/screen`, { decision: 'pass' });
  check('studio cannot screen', studioScreen.status === 403, studioScreen.body);

  console.log('judging');
  const move = await director.call('PATCH', `/api/programs/${open.id}`, { deadlineDate: '2024-01-10', earlyBirdDate: '2024-01-01' });
  check('deadline moved', move.status === 200 && move.body.program.entriesOpen === false, move.body.program && move.body.program.entriesOpen);

  const catEntries = await director.call('GET', `/api/categories/${portfolio.id}/entries`);
  check('director sees studio details', catEntries.body.entries.every((e) => 'studioName' in e), catEntries.body.entries[0]);
  const screenable = catEntries.body.entries.filter((e) => e.state === 'submitted');
  for (const entry of screenable) {
    const passed = await director.call('POST', `/api/entries/${entry.id}/screen`, { decision: 'pass' });
    check(`screened entry ${entry.entryNumber}`, passed.status === 200 && passed.body.entry.state === 'screened', passed.body);
  }

  const summary = await director.call('GET', `/api/programs/${open.id}/summary`);
  const portfolioSummary = summary.body.categories.find((c) => c.name === 'Portfolio');
  const roundOne = portfolioSummary.rounds.find((r) => r.name === 'Round 1');
  check('round 1 scheduled', roundOne.state === 'scheduled');

  const emptyOpen = await director.call('POST', `/api/rounds/${roundOne.id}/open`, { ballotDeadline: '2030-01-01' });
  check('open without panel 409', emptyOpen.status === 409 && emptyOpen.body.error === 'panel_empty', emptyOpen.body);

  const jurors = await director.call('GET', '/api/jurors');
  const ines = jurors.body.jurors.find((j) => j.name === 'Ines Varga');
  const teo = jurors.body.jurors.find((j) => j.name === 'Teo Brandt');
  const priya = jurors.body.jurors.find((j) => j.name === 'Priya Raman');
  const addIres = await director.call('POST', `/api/rounds/${roundOne.id}/jurors`, { jurorId: ines.id });
  const inesRow = addIres.body.panel.find((p) => p.jurorId === ines.id);
  check('home studio excluded', inesRow.assigned === 0, addIres.body.panel);
  await director.call('POST', `/api/rounds/${roundOne.id}/jurors`, { jurorId: teo.id });
  const addPriya = await director.call('POST', `/api/rounds/${roundOne.id}/jurors`, { jurorId: priya.id });
  const priyaRow = addPriya.body.panel.find((p) => p.jurorId === priya.id);
  check('priya assigned all screened', priyaRow.assigned === screenable.length, addPriya.body.panel);

  const opened = await director.call('POST', `/api/rounds/${roundOne.id}/open`, { ballotDeadline: '2030-01-01' });
  check('round opened', opened.status === 200 && opened.body.round.state === 'open', opened.body);
  check('ballot deadline label', /^23:59 Asia\/Kolkata, 1 Jan 2030$/.test(opened.body.round.ballotDeadlineLabel), opened.body.round.ballotDeadlineLabel);

  await sleep(2500);
  const invites = await mailpit('subject:"Cutline jury invitation"');
  check('invitations delivered', invites.messages_count >= 2, invites.messages_count);

  const ballot = await jurorSession.call('GET', `/api/rounds/${roundOne.id}/ballot`);
  check('blind ballot', ballot.status === 200 && ballot.body.entries.every((e) => !('studioName' in e)), ballot.body.entries[0]);
  check('ballot has images', ballot.body.entries[0].images.length > 0);

  for (const entry of ballot.body.entries) {
    const saved = await jurorSession.call('PUT', `/api/rounds/${roundOne.id}/scores/${entry.entryId}`, {
      craft: 8,
      clarity: 7,
      idea: 9,
      story: 6,
    });
    check(`scored entry ${entry.entryNumber}`, saved.status === 200, saved.body);
  }
  const badScores = await jurorSession.call('PUT', `/api/rounds/${roundOne.id}/scores/${ballot.body.entries[0].entryId}`, {
    craft: 11, clarity: 7, idea: 9, story: 6,
  });
  check('score out of range 422', badScores.status === 422 && 'craft' in badScores.body.errors, badScores.body);

  const finalBallot = await jurorSession.call('POST', `/api/rounds/${roundOne.id}/ballot/submit`, {});
  check('ballot submitted', finalBallot.status === 200 && finalBallot.body.counted === ballot.body.entries.length, finalBallot.body);
  const lateScore = await jurorSession.call('PUT', `/api/rounds/${roundOne.id}/scores/${ballot.body.entries[0].entryId}`, {
    craft: 5, clarity: 5, idea: 5, story: 5,
  });
  check('locked after submit', lateScore.status === 409 && lateScore.body.error === 'ballot_submitted', lateScore.body);

  const provisional = await director.call('GET', `/api/rounds/${roundOne.id}/standings`);
  check('provisional standings', provisional.body.provisional === true && provisional.body.rows.length > 0, provisional.body);

  const closed = await director.call('POST', `/api/rounds/${roundOne.id}/close`, {});
  check('round closed', closed.status === 200 && closed.body.round.state === 'closed', closed.body.round);
  check('stored scores', closed.body.standings.rows.every((r) => r.score !== null), closed.body.standings.rows);

  const confirmed = await director.call('POST', `/api/rounds/${roundOne.id}/confirm`, {});
  check('standings confirmed', confirmed.status === 200 && confirmed.body.outcomes.length > 0, confirmed.body);

  const finalRound = portfolioSummary.rounds.find((r) => r.name === 'Final round');
  await director.call('POST', `/api/rounds/${finalRound.id}/jurors`, { jurorId: teo.id });
  await director.call('POST', `/api/rounds/${finalRound.id}/jurors`, { jurorId: priya.id });
  const finalOpen = await director.call('POST', `/api/rounds/${finalRound.id}/open`, { ballotDeadline: '2030-02-01' });
  check('final round opened', finalOpen.status === 200, finalOpen.body);

  const finalBallotView = await jurorSession.call('GET', `/api/rounds/${finalRound.id}/ballot`);
  for (const entry of finalBallotView.body.entries) {
    await jurorSession.call('PUT', `/api/rounds/${finalRound.id}/scores/${entry.entryId}`, {
      craft: 6 + (entry.entryNumber % 4), clarity: 7, idea: 5 + (entry.entryNumber % 3), story: 8,
    });
  }
  await jurorSession.call('POST', `/api/rounds/${finalRound.id}/ballot/submit`, {});
  const finalClosed = await director.call('POST', `/api/rounds/${finalRound.id}/close`, {});
  check('final closed', finalClosed.status === 200, finalClosed.body.round);
  const finalConfirmed = await director.call('POST', `/api/rounds/${finalRound.id}/confirm`, {});
  check('winner declared', finalConfirmed.body.outcomes.some((o) => o.state === 'winner'), finalConfirmed.body.outcomes);

  console.log('publish + embargo');
  const soon = new Date(Date.now() + 4000).toISOString().replace('Z', '+00:00');
  const published = await director.call('POST', `/api/categories/${portfolio.id}/publish`, { embargoAt: soon });
  check('published', published.status === 200 && published.body.category.state === 'published', published.body);
  const boardBefore = await anon.call('GET', `/api/public/leaderboard?programId=${open.id}`);
  const catBefore = boardBefore.body.categories.find((c) => c.id === portfolio.id);
  check('embargoed before reveal', catBefore.state === 'embargoed' && catBefore.rows.length === 0, catBefore);
  const studioBefore = await studio.call('GET', `/api/entries/${entryId}`);
  check('studio masked before embargo', studioBefore.body.entry.state === 'final_round' && studioBefore.body.entry.score === null, studioBefore.body.entry);

  await sleep(7000);
  const boardAfter = await anon.call('GET', `/api/public/leaderboard?programId=${open.id}`);
  const catAfter = boardAfter.body.categories.find((c) => c.id === portfolio.id);
  check('revealed after embargo', catAfter.state === 'revealed' && catAfter.rows.length > 0, catAfter.state);
  const studioAfter = await studio.call('GET', `/api/entries/${entryId}`);
  check('studio sees result', studioAfter.body.entry.state === 'published' && studioAfter.body.entry.score !== null, studioAfter.body.entry);
  const results = await mailpit('subject:"Cutline results"');
  check('results emails delivered', results.messages_count >= 1, results.messages_count);

  const auditTrail = await director.call('GET', '/api/audit');
  check('audit has events', auditTrail.body.events.length > 5 && auditTrail.body.events[0].action === 'category.publish', auditTrail.body.events[0]);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
