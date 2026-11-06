// Exercises the Stillhour API against a running server, Postgres and Mailpit.
const BASE = process.env.CHECK_BASE ?? 'http://127.0.0.1:4173';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
    console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
  }
}

const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

async function api(method, path, options = {}) {
  const headers = { ...options.headers };
  if (options.body !== undefined) headers['content-type'] = headers['content-type'] ?? 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    redirect: 'manual',
  });
  const text = await response.text();
  let json;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json, headers: response.headers, text };
}

const cookieOf = (response) => {
  const raw = response.headers.getSetCookie?.() ?? [];
  const found = raw.find((line) => line.startsWith('stillhour_session='));
  return found ? found.split(';')[0] : undefined;
};

const mail = {
  async clear() {
    await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
  },
  async list() {
    const response = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
    const body = await response.json();
    return body.messages ?? [];
  },
  async to(address) {
    const all = await this.list();
    return all.filter((message) => message.To.some((recipient) => recipient.Address === address));
  },
  async text(id) {
    const response = await fetch(`${MAILPIT}/api/v1/message/${id}`);
    const body = await response.json();
    return body.Text ?? '';
  },
  async tokenFor(address) {
    const [message] = await this.to(address);
    if (!message) return null;
    const text = await this.text(message.ID);
    return /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;
  },
};

const unique = () => Math.random().toString(36).slice(2, 10);
const keyFor = (label) => `${label}-${unique()}-key`;

const plan = (overrides = {}) => ({
  email: `mira-${unique()}@example.com`,
  bedtime: '23:00',
  time_zone: 'Asia/Tokyo',
  rituals: [
    { id: 'dim-lamps', minutes: 10 },
    { id: 'breathe', minutes: 5 },
  ],
  note: 'A quiet hour.',
  ...overrides,
});

const setClock = (iso) => api('PUT', '/api/test/clock', { body: { now: iso } });
const clearClock = () => api('DELETE', '/api/test/clock');

async function savePlanFor(body, key = keyFor('save')) {
  return api('POST', '/api/plans', { body, headers: { 'Idempotency-Key': key } });
}

/** Saves and confirms an hour, answering its session cookie. */
async function keeper(overrides = {}) {
  const body = plan(overrides);
  await mail.clear();
  const saved = await savePlanFor(body);
  if (saved.status !== 202) throw new Error(`save failed ${saved.status} ${saved.text}`);
  const token = await mail.tokenFor(body.email);
  const verified = await api('POST', '/api/session/verify', { body: { token } });
  if (verified.status !== 200) throw new Error(`verify failed ${verified.status} ${verified.text}`);
  return { email: body.email, cookie: cookieOf(verified), body };
}

async function health() {
  const response = await api('GET', '/api/health');
  eq('health answers ok', [response.status, response.json], [200, { status: 'ok' }]);
  const type = response.headers.get('content-type');
  check('health is json', type?.includes('application/json'), type);
}

async function boundary() {
  const notFound = await api('GET', '/api/nothing');
  eq('unknown api path', [notFound.status, notFound.json.error.code], [404, 'not_found']);

  const wrongMethod = await api('GET', '/api/plans');
  eq('wrong method', [wrongMethod.status, wrongMethod.json.error.code], [405, 'method_not_allowed']);
  const shareWrite = await api('POST', '/api/share/anything', { body: {} });
  eq('share write', [shareWrite.status, shareWrite.json.error.code], [405, 'method_not_allowed']);

  const cross = await api('POST', '/api/plans', {
    body: plan(),
    headers: { Origin: 'https://elsewhere.example', 'Idempotency-Key': keyFor('cross') },
  });
  eq('cross origin write', [cross.status, cross.json.error.code], [403, 'cross_origin']);

  const sameOrigin = await api('POST', '/api/session/request', {
    body: { email: `origin-${unique()}@example.com` },
    headers: { Origin: BASE.replace('127.0.0.1', '127.0.0.1') },
  });
  eq('same origin write', sameOrigin.status, 202);

  const media = await api('POST', '/api/plans', {
    raw: 'hello',
    headers: { 'content-type': 'text/plain', 'Idempotency-Key': keyFor('media') },
  });
  eq('unsupported media type', [media.status, media.json.error.code], [415, 'unsupported_media_type']);

  const charset = await api('POST', '/api/session/request', {
    raw: JSON.stringify({ email: `charset-${unique()}@example.com` }),
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  eq('charset parameter allowed', charset.status, 202);

  const big = JSON.stringify({ email: 'a@b.co', note: 'x'.repeat(17_000) });
  const large = await api('POST', '/api/plans', {
    raw: big,
    headers: { 'content-type': 'application/json', 'Idempotency-Key': keyFor('large') },
  });
  eq('oversized body', [large.status, large.json.error.code], [413, 'too_large']);

  const exact = { email: 'mira@example.com', bedtime: '23:00', time_zone: 'UTC', rituals: [{ id: 'breathe', minutes: 5 }] };
  let note = '';
  let raw = JSON.stringify({ ...exact, note });
  while (raw.length < 16_384) {
    note += 'x';
    raw = JSON.stringify({ ...exact, note });
  }
  const sized = await api('POST', '/api/plans', {
    raw,
    headers: { 'content-type': 'application/json', 'Idempotency-Key': keyFor('sized') },
  });
  check('16,384 bytes is allowed', sized.status === 422 || sized.status === 202, { status: sized.status, size: raw.length });

  const broken = await api('POST', '/api/plans', {
    raw: '{"email":',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': keyFor('broken') },
  });
  eq('malformed json', [broken.status, broken.json.error.code], [400, 'invalid_json']);

  const noKey = await api('POST', '/api/plans', { body: plan() });
  eq('missing idempotency key', [noKey.status, noKey.json.error.code], [400, 'idempotency_key_required']);
  const shortKey = await api('POST', '/api/plans', { body: plan(), headers: { 'Idempotency-Key': 'short' } });
  eq('short idempotency key', [shortKey.status, shortKey.json.error.code], [400, 'idempotency_key_required']);
  const longKey = await api('POST', '/api/plans', { body: plan(), headers: { 'Idempotency-Key': 'k'.repeat(65) } });
  eq('long idempotency key', [longKey.status, longKey.json.error.code], [400, 'idempotency_key_required']);

  eq('error message shape', noKey.json.error.message, 'Send an Idempotency-Key header of 8 to 64 characters.');
  check('no fields on non-422', noKey.json.error.fields === undefined, noKey.json.error);
}

async function planRules() {
  const bad = await savePlanFor({
    email: 'not-an-address',
    bedtime: '23:07',
    time_zone: '+02:00',
    rituals: [{ id: 'dim-lamps', minutes: 7 }],
    note: 'x'.repeat(281),
    version: 2,
  });
  eq('invalid plan status', bad.status, 422);
  eq('invalid plan code', bad.json.error.code, 'invalid');
  eq('email message', bad.json.error.fields.email, 'Enter an email address, like name@example.com.');
  eq('bedtime message', bad.json.error.fields.bedtime, 'Choose a bedtime on a five-minute step, like 22:30.');
  eq('time zone message', bad.json.error.fields.time_zone, 'Choose a time zone from the list.');
  eq(
    'rituals message',
    bad.json.error.fields.rituals,
    'Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total.',
  );
  eq('note message', bad.json.error.fields.note, 'Keep your note to 280 characters.');
  eq('extra field message', bad.json.error.fields.version, 'This field is not accepted.');

  const missing = await savePlanFor({ email: 'mira@example.com' });
  eq('missing required fields', Object.keys(missing.json.error.fields ?? {}).sort(), ['bedtime', 'rituals', 'time_zone']);

  const remindersOnPost = await savePlanFor(plan({ reminders: 'on' }));
  eq('reminders refused on save', remindersOnPost.json.error.fields.reminders, 'This field is not accepted.');

  const nulls = await savePlanFor({ email: null, bedtime: null, time_zone: null, rituals: null, note: null });
  eq('null values fail their own rule', Object.keys(nulls.json.error.fields).sort(), [
    'bedtime',
    'email',
    'note',
    'rituals',
    'time_zone',
  ]);

  const duplicates = await savePlanFor(plan({ rituals: [{ id: 'breathe', minutes: 5 }, { id: 'breathe', minutes: 5 }] }));
  eq('repeated ritual refused', duplicates.status, 422);
  const unknownRitual = await savePlanFor(plan({ rituals: [{ id: 'tea', minutes: 5 }] }));
  eq('unknown ritual refused', unknownRitual.status, 422);
  const extraKey = await savePlanFor(plan({ rituals: [{ id: 'breathe', minutes: 5, title: 'Breathe' }] }));
  eq('extra ritual key refused', extraKey.status, 422);
  const sevenRituals = await savePlanFor(
    plan({
      rituals: [
        { id: 'dim-lamps', minutes: 5 },
        { id: 'warm-shower', minutes: 5 },
        { id: 'paper-not-pixels', minutes: 5 },
        { id: 'tomorrow-list', minutes: 5 },
        { id: 'slow-stretch', minutes: 5 },
        { id: 'breathe', minutes: 5 },
        { id: 'breathe', minutes: 5 },
      ],
    }),
  );
  eq('seven rituals refused', sevenRituals.status, 422);
  const over = await savePlanFor(
    plan({
      rituals: [
        { id: 'dim-lamps', minutes: 30 },
        { id: 'warm-shower', minutes: 30 },
        { id: 'breathe', minutes: 5 },
      ],
    }),
  );
  eq('over sixty minutes refused', over.status, 422);
  const exactlySixty = plan({
    email: `sixty-${unique()}@example.com`,
    rituals: [
      { id: 'dim-lamps', minutes: 30 },
      { id: 'warm-shower', minutes: 30 },
    ],
  });
  const sixty = await savePlanFor(exactlySixty);
  eq('exactly sixty minutes allowed', sixty.status, 202);

  const emojiNote = '👨‍👩‍👧‍👦🇯🇵é'.repeat(1) + 'x'.repeat(277);
  const emoji = await savePlanFor(plan({ email: `emoji-${unique()}@example.com`, note: emojiNote }));
  eq('reader-counted note of 280 accepted', emoji.status, 202);
  const emojiLong = await savePlanFor(plan({ note: emojiNote + 'y' }));
  eq('reader-counted note of 281 refused', emojiLong.status, 422);

  const utc = await savePlanFor(plan({ email: `utc-${unique()}@example.com`, time_zone: 'UTC' }));
  eq('UTC accepted', utc.status, 202);
}

async function idempotency() {
  await mail.clear();
  const body = plan({ email: `idem-${unique()}@example.com` });
  const key = keyFor('idem');
  const first = await savePlanFor(body, key);
  const second = await savePlanFor(body, key);
  eq('replay status', [first.status, second.status], [202, 202]);
  eq('replay body', first.json, second.json);
  const letters = await mail.to(body.email);
  eq('one confirmation email for a replay', letters.length, 1);

  const reordered = { note: body.note, rituals: body.rituals, time_zone: body.time_zone, bedtime: body.bedtime, email: body.email };
  const sameByValue = await savePlanFor(reordered, key);
  eq('key order does not matter', [sameByValue.status, sameByValue.json], [202, first.json]);

  const conflict = await savePlanFor({ ...body, bedtime: '22:30' }, key);
  eq('different body under one key', [conflict.status, conflict.json.error.code], [409, 'idempotency_conflict']);

  const invalidKey = keyFor('invalid');
  const refused = await savePlanFor({ ...body, bedtime: 'nope' }, invalidKey);
  eq('refused save is not remembered', refused.status, 422);
  const retried = await savePlanFor(body, invalidKey);
  eq('only 202 answers are remembered', retried.status, 202);

  const parallelKey = keyFor('parallel');
  const parallelBody = plan({ email: `parallel-${unique()}@example.com` });
  await mail.clear();
  const answers = await Promise.all([
    savePlanFor(parallelBody, parallelKey),
    savePlanFor(parallelBody, parallelKey),
    savePlanFor(parallelBody, parallelKey),
  ]);
  eq('concurrent saves all answer 202', answers.map((answer) => answer.status), [202, 202, 202]);
  const parallelLetters = await mail.to(parallelBody.email);
  eq('concurrent saves send one email', parallelLetters.length, 1);
}

async function links() {
  await mail.clear();
  const body = plan({ email: `link-${unique()}@example.com` });
  await savePlanFor(body);
  const token = await mail.tokenFor(body.email);
  check('confirmation email carries a token', typeof token === 'string' && token.length > 20, token);
  const [message] = await mail.to(body.email);
  const text = await mail.text(message.ID);
  check('confirmation email says the lifetime', text.includes('This link works once, for 15 minutes.'));
  check('confirmation email shows the bedtime', text.includes('23:00'));
  check('confirmation email shows the time zone', text.includes('Asia/Tokyo'));
  eq('confirmation subject', message.Subject, 'Confirm your Stillhour');
  eq('confirmation from', message.From.Address, 'goodnight@stillhour.example');

  const unknown = await api('POST', '/api/session/verify', { body: { token: 'nothing-like-a-token' } });
  eq('unknown link', [unknown.status, unknown.json.error.code], [404, 'link_unknown']);
  const noToken = await api('POST', '/api/session/verify', { body: {} });
  eq('missing token', [noToken.status, noToken.json.error.fields.token], [422, 'Paste the full link from your email.']);

  const verified = await api('POST', '/api/session/verify', { body: { token } });
  eq('confirmation verifies', [verified.status, verified.json.signed_in, verified.json.confirmed], [200, true, true]);
  eq('verify answers the address', verified.json.email, body.email);
  const cookie = cookieOf(verified);
  check('session cookie is set', cookie?.startsWith('stillhour_session='), cookie);
  const raw = verified.headers.getSetCookie().find((line) => line.startsWith('stillhour_session='));
  check('cookie is HttpOnly', /HttpOnly/i.test(raw), raw);
  check('cookie is SameSite=Lax', /SameSite=Lax/i.test(raw), raw);
  check('cookie lives 30 days', /Max-Age=2592000/.test(raw), raw);
  check('cookie covers the site', /Path=\/(;|$)/.test(raw), raw);

  const reused = await api('POST', '/api/session/verify', { body: { token } });
  eq('used link', [reused.status, reused.json.error.code], [410, 'link_used']);

  await mail.clear();
  const expiring = plan({ email: `expiry-${unique()}@example.com` });
  await savePlanFor(expiring);
  const expiringToken = await mail.tokenFor(expiring.email);
  const base = new Date();
  await setClock(new Date(base.getTime() + 14 * 60_000).toISOString());
  const stillAlive = await api('POST', '/api/session/verify', { body: { token: expiringToken } });
  eq('link works before fifteen minutes', stillAlive.status, 200);

  await mail.clear();
  const expired = plan({ email: `expired-${unique()}@example.com` });
  await savePlanFor(expired);
  const expiredToken = await mail.tokenFor(expired.email);
  await setClock(new Date(base.getTime() + 14 * 60_000 + 15 * 60_000).toISOString());
  const gone = await api('POST', '/api/session/verify', { body: { token: expiredToken } });
  eq('link expires after fifteen minutes', [gone.status, gone.json.error.code], [410, 'link_expired']);

  await mail.clear();
  const both = plan({ email: `both-${unique()}@example.com` });
  await savePlanFor(both);
  const bothToken = await mail.tokenFor(both.email);
  await api('POST', '/api/session/verify', { body: { token: bothToken } });
  await setClock(new Date(base.getTime() + 60 * 60_000).toISOString());
  const usedBeatsExpired = await api('POST', '/api/session/verify', { body: { token: bothToken } });
  eq('used beats expired', [usedBeatsExpired.status, usedBeatsExpired.json.error.code], [410, 'link_used']);
  await clearClock();
}

async function sessionRequests() {
  await mail.clear();
  const stranger = `stranger-${unique()}@example.com`;
  const unknownAddress = await api('POST', '/api/session/request', { body: { email: stranger } });
  eq('unknown address answers link_sent', [unknownAddress.status, unknownAddress.json], [202, { status: 'link_sent' }]);
  eq('unknown address gets no email', (await mail.to(stranger)).length, 0);

  const known = await keeper();
  await mail.clear();
  const knownAddress = await api('POST', '/api/session/request', { body: { email: known.email.toUpperCase() } });
  eq('known address answers the same', [knownAddress.status, knownAddress.json], [202, { status: 'link_sent' }]);
  const letters = await mail.to(known.email);
  eq('known address gets one sign-in email', letters.length, 1);
  eq('sign-in subject', letters[0].Subject, 'Your Stillhour sign-in link');

  const signInToken = await mail.tokenFor(known.email);
  const signedIn = await api('POST', '/api/session/verify', { body: { token: signInToken } });
  eq('sign-in token signs in', [signedIn.status, signedIn.json.signed_in, signedIn.json.confirmed], [200, true, true]);

  const badEmail = await api('POST', '/api/session/request', { body: { email: 'bad' } });
  eq('sign-in email rule', [badEmail.status, badEmail.json.error.fields.email], [422, 'Enter an email address, like name@example.com.']);

  const ended = await api('POST', '/api/session/end', {});
  eq('sign out without a session', ended.status, 204);
}

async function mine() {
  const signedOut = await api('GET', '/api/me/plan');
  eq('signed out read', [signedOut.status, signedOut.json.error.code], [401, 'signed_out']);
  eq('signed out message', signedOut.json.error.message, 'Sign in to manage your hour.');

  const me = await keeper();
  const read = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  eq('read my hour', read.status, 200);
  const hour = read.json.plan;
  eq('plan bedtime', hour.bedtime, '23:00');
  eq('plan start', hour.starts_at_local, '22:00');
  eq('plan total', hour.total_minutes, 15);
  eq('plan version', hour.version, 1);
  eq('plan reminders', hour.reminders, 'on');
  eq('plan share', hour.share_url, null);
  eq('plan rituals keep their order', hour.rituals.map((ritual) => ritual.id), ['dim-lamps', 'breathe']);
  eq('plan ritual titles', hour.rituals[0].title, 'Dim the lamps');
  check('plan has a next reminder', typeof hour.next_reminder_at === 'string', hour.next_reminder_at);
  eq('plan keys', Object.keys(hour).sort(), [
    'bedtime',
    'email',
    'id',
    'next_reminder_at',
    'note',
    'reminders',
    'rituals',
    'share_url',
    'starts_at_local',
    'time_zone',
    'total_minutes',
    'version',
  ]);

  const noMatch = await api('PATCH', '/api/me/plan', { body: { bedtime: '22:30' }, headers: { cookie: me.cookie } });
  eq('edit without If-Match', [noMatch.status, noMatch.json.error.code], [428, 'version_required']);

  const stale = await api('PATCH', '/api/me/plan', {
    body: { bedtime: '22:30' },
    headers: { cookie: me.cookie, 'If-Match': '0' },
  });
  eq('stale edit', [stale.status, stale.json.error.code], [409, 'version_conflict']);
  eq('stale edit returns the current hour', stale.json.error.current.version, 1);

  const notANumber = await api('PATCH', '/api/me/plan', {
    body: { bedtime: '22:30' },
    headers: { cookie: me.cookie, 'If-Match': 'latest' },
  });
  eq('unparsable If-Match counts as a mismatch', [notANumber.status, notANumber.json.error.code], [409, 'version_conflict']);

  const quoted = await api('PATCH', '/api/me/plan', {
    body: { note: 'Quoted version' },
    headers: { cookie: me.cookie, 'If-Match': '"1"' },
  });
  eq('quoted If-Match is accepted', [quoted.status, quoted.json.plan.version], [200, 2]);

  const refusedField = await api('PATCH', '/api/me/plan', {
    body: { email: 'someone@example.com' },
    headers: { cookie: me.cookie, 'If-Match': '2' },
  });
  eq('email refused on edit', [refusedField.status, refusedField.json.error.fields.email], [422, 'This field is not accepted.']);
  const unchanged = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  eq('a refused edit changes nothing', unchanged.json.plan.version, 2);

  const emptyEdit = await api('PATCH', '/api/me/plan', { body: {}, headers: { cookie: me.cookie, 'If-Match': '2' } });
  eq('empty edit', [emptyEdit.status, emptyEdit.json.error.code], [422, 'invalid']);
  check('empty edit carries no fields', emptyEdit.json.error.fields === undefined, emptyEdit.json.error);

  const edited = await api('PATCH', '/api/me/plan', {
    body: { bedtime: '22:30', rituals: [{ id: 'warm-shower', minutes: 15 }] },
    headers: { cookie: me.cookie, 'If-Match': '2' },
  });
  eq('edit saves', [edited.status, edited.json.plan.version, edited.json.plan.bedtime], [200, 3, '22:30']);
  eq('edit replaces the ritual list', edited.json.plan.rituals.length, 1);
  eq('edit keeps the note', edited.json.plan.note, 'Quoted version');
  eq('edit recalculates the start', edited.json.plan.starts_at_local, '21:30');

  const sameValues = await api('PATCH', '/api/me/plan', {
    body: { bedtime: '22:30' },
    headers: { cookie: me.cookie, 'If-Match': '3' },
  });
  eq('an unchanged edit still raises the version', sameValues.json.plan.version, 4);

  const concurrent = await Promise.all([
    api('PATCH', '/api/me/plan', { body: { note: 'one' }, headers: { cookie: me.cookie, 'If-Match': '4' } }),
    api('PATCH', '/api/me/plan', { body: { note: 'two' }, headers: { cookie: me.cookie, 'If-Match': '4' } }),
  ]);
  const statuses = concurrent.map((answer) => answer.status).sort();
  eq('one concurrent edit wins', statuses, [200, 409]);
  const loser = concurrent.find((answer) => answer.status === 409);
  check('the loser sees the winner', loser.json.error.current.version === 5, loser.json.error);

  const midnight = await keeper({ bedtime: '00:30', time_zone: 'Europe/London' });
  const wrapped = await api('GET', '/api/me/plan', { headers: { cookie: midnight.cookie } });
  eq('a bedtime past midnight starts the day before', wrapped.json.plan.starts_at_local, '23:30');
}

async function shares() {
  const me = await keeper();
  const created = await api('POST', '/api/me/share', { headers: { cookie: me.cookie } });
  eq('share created', created.status, 201);
  const url = created.json.share.url;
  check('share url shape', /^\/p\/[A-Za-z0-9_-]{22,}$/.test(url), url);
  check('share has a created time', typeof created.json.share.created_at === 'string', created.json.share);

  const token = url.slice('/p/'.length);
  const shared = await api('GET', `/api/share/${token}`);
  eq('shared hour', shared.status, 200);
  eq('shared keys', Object.keys(shared.json.plan).sort(), ['bedtime', 'rituals', 'time_zone', 'total_minutes']);
  eq('shared total', shared.json.plan.total_minutes, 15);
  check('shared hour hides the address', !shared.text.includes(me.email), shared.text);
  check('shared hour hides the note', !shared.text.includes('A quiet hour.'), shared.text);

  const onPlan = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  eq('share appears on the hour', onPlan.json.plan.share_url, url);

  const replaced = await api('POST', '/api/me/share', { headers: { cookie: me.cookie } });
  const newToken = replaced.json.share.url.slice('/p/'.length);
  check('a new link is different', newToken !== token, newToken);
  eq('the old link dies', (await api('GET', `/api/share/${token}`)).status, 404);
  eq('the new link works', (await api('GET', `/api/share/${newToken}`)).status, 200);

  const paused = await api('PATCH', '/api/me/plan', {
    body: { reminders: 'paused' },
    headers: { cookie: me.cookie, 'If-Match': String(onPlan.json.plan.version) },
  });
  eq('pausing keeps the share alive', (await api('GET', `/api/share/${newToken}`)).status, 200);
  eq('a paused hour has no next reminder', paused.json.plan.next_reminder_at, null);

  const off = await api('DELETE', '/api/me/share', { headers: { cookie: me.cookie } });
  eq('sharing turned off', off.status, 204);
  eq('the turned-off link answers not found', (await api('GET', `/api/share/${newToken}`)).status, 404);
  const offAgain = await api('DELETE', '/api/me/share', { headers: { cookie: me.cookie } });
  eq('turning sharing off again', offAgain.status, 204);

  const strangerShare = await api('POST', '/api/me/share', {});
  eq('sharing needs a session', strangerShare.status, 401);
}

async function liveCount() {
  const before = (await api('GET', '/api/tonight')).json.keeping;
  const me = await keeper();
  const afterConfirm = (await api('GET', '/api/tonight')).json.keeping;
  eq('confirming raises the count', afterConfirm, before + 1);

  const read = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  await api('PATCH', '/api/me/plan', {
    body: { reminders: 'paused' },
    headers: { cookie: me.cookie, 'If-Match': String(read.json.plan.version) },
  });
  eq('pausing lowers the count', (await api('GET', '/api/tonight')).json.keeping, before);

  await api('PATCH', '/api/me/plan', {
    body: { reminders: 'on' },
    headers: { cookie: me.cookie, 'If-Match': String(read.json.plan.version + 1) },
  });
  eq('resuming raises the count', (await api('GET', '/api/tonight')).json.keeping, before + 1);

  await api('DELETE', '/api/me', { headers: { cookie: me.cookie } });
  eq('deleting lowers the count', (await api('GET', '/api/tonight')).json.keeping, before);
}

async function deletion() {
  const me = await keeper();
  const share = await api('POST', '/api/me/share', { headers: { cookie: me.cookie } });
  const token = share.json.share.url.slice('/p/'.length);
  await mail.clear();
  await api('POST', '/api/session/request', { body: { email: me.email } });
  const signInToken = await mail.tokenFor(me.email);

  const removed = await api('DELETE', '/api/me', { headers: { cookie: me.cookie } });
  eq('delete everything', removed.status, 204);
  const cleared = removed.headers.getSetCookie().find((line) => line.startsWith('stillhour_session='));
  check('deleting clears the cookie', /Max-Age=0/.test(cleared), cleared);

  eq('the session is gone', (await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } })).status, 401);
  eq('the share is gone', (await api('GET', `/api/share/${token}`)).status, 404);
  const oldLink = await api('POST', '/api/session/verify', { body: { token: signInToken } });
  eq('old links answer not found', [oldLink.status, oldLink.json.error.code], [404, 'link_unknown']);

  await mail.clear();
  await api('POST', '/api/session/request', { body: { email: me.email } });
  eq('a deleted address gets no sign-in email', (await mail.to(me.email)).length, 0);
}

async function rateLimits() {
  const email = `limit-${unique()}@example.com`;
  const statuses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const answer = await savePlanFor(plan({ email, note: `try ${attempt}` }));
    statuses.push(answer.status);
    if (answer.status === 429) {
      eq('rate limited code', answer.json.error.code, 'rate_limited');
      const retry = Number(answer.headers.get('retry-after'));
      check('Retry-After is seconds', Number.isInteger(retry) && retry > 0 && retry <= 3600, retry);
    }
  }
  eq('three saves then a refusal', statuses, [202, 202, 202, 429]);

  const linkEmail = `links-${unique()}@example.com`;
  const linkStatuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const answer = await api('POST', '/api/session/request', { body: { email: linkEmail } });
    linkStatuses.push(answer.status);
  }
  eq('five sign-in requests then a refusal', linkStatuses, [202, 202, 202, 202, 202, 429]);

  const other = `other-${unique()}@example.com`;
  eq('another address is unaffected', (await api('POST', '/api/session/request', { body: { email: other } })).status, 202);
}

async function reminders() {
  // Bedtime 23:00 in Asia/Tokyo starts at 22:00 Tokyo time, which is 13:00 UTC.
  await clearClock();
  const night = '2026-11-05';
  await setClock(`${night}T00:00:00Z`);
  const me = await keeper({ bedtime: '23:00', time_zone: 'Asia/Tokyo' });
  const read = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  eq('next reminder is tonight at 13:00 UTC', read.json.plan.next_reminder_at, `${night}T13:00:00.000Z`);

  await mail.clear();
  await setClock(`${night}T12:59:00Z`);
  eq('nothing arrives early', (await mail.to(me.email)).length, 0);

  await setClock(`${night}T13:00:00Z`);
  const letters = await mail.to(me.email);
  eq('one reminder at the local start', letters.length, 1);
  eq('reminder subject', letters[0].Subject, 'Your Stillhour starts at 22:00');
  const text = await mail.text(letters[0].ID);
  check('reminder shows the bedtime', text.includes('23:00'), text);
  check('reminder links to manage', text.includes('/manage'), text);
  check('reminder never carries the note', !text.includes('A quiet hour.'), text);

  await setClock(`${night}T13:30:00Z`);
  eq('no second reminder that night', (await mail.to(me.email)).length, 1);
  const after = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  eq('the next reminder moves to tomorrow', after.json.plan.next_reminder_at, '2026-11-06T13:00:00.000Z');

  await mail.clear();
  await setClock('2026-11-06T15:00:00Z');
  eq('a reminder more than an hour late is skipped', (await mail.to(me.email)).length, 0);

  await mail.clear();
  await setClock('2026-11-07T14:00:00Z');
  eq('a reminder exactly an hour late still arrives', (await mail.to(me.email)).length, 1);

  // A paused hour gets nothing.
  const current = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  await api('PATCH', '/api/me/plan', {
    body: { reminders: 'paused' },
    headers: { cookie: me.cookie, 'If-Match': String(current.json.plan.version) },
  });
  await mail.clear();
  await setClock('2026-11-08T13:00:00Z');
  eq('a paused hour gets no reminder', (await mail.to(me.email)).length, 0);

  const paused = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  await api('PATCH', '/api/me/plan', {
    body: { reminders: 'on' },
    headers: { cookie: me.cookie, 'If-Match': String(paused.json.plan.version) },
  });
  const resumed = await api('GET', '/api/me/plan', { headers: { cookie: me.cookie } });
  eq('resuming starts with the next night', resumed.json.plan.next_reminder_at, '2026-11-09T13:00:00.000Z');
}

async function clockChanges() {
  // 14 March 2027: New York springs forward, so 02:30 local does not exist.
  await setClock('2027-03-13T12:00:00Z');
  const spring = await keeper({ bedtime: '03:30', time_zone: 'America/New_York' });
  await mail.clear();
  await setClock('2027-03-14T07:00:00Z');
  const springLetters = await mail.to(spring.email);
  eq('one reminder on the spring-forward night', springLetters.length, 1);
  eq('the subject uses the first valid local minute', springLetters[0].Subject, 'Your Stillhour starts at 03:00');

  // 1 November 2026: New York falls back, so 01:30 local happens twice.
  await setClock('2026-10-31T12:00:00Z');
  const autumn = await keeper({ bedtime: '02:30', time_zone: 'America/New_York' });
  const before = await api('GET', '/api/me/plan', { headers: { cookie: autumn.cookie } });
  eq('the first occurrence is due', before.json.plan.next_reminder_at, '2026-11-01T05:30:00.000Z');
  await mail.clear();
  await setClock('2026-11-01T05:30:00Z');
  eq('one reminder at the first occurrence', (await mail.to(autumn.email)).length, 1);
  await setClock('2026-11-01T06:30:00Z');
  eq('none at the second occurrence', (await mail.to(autumn.email)).length, 1);
  await clearClock();
}

async function testClock() {
  const answer = await setClock('2026-12-24T18:00:00+02:00');
  eq('the clock answers the same instant in UTC', [answer.status, answer.json.now], [200, '2026-12-24T16:00:00.000Z']);
  const bad = await api('PUT', '/api/test/clock', { body: { now: 'tonight' } });
  eq('the clock refuses a loose time', [bad.status, bad.json.error.fields.now], [422, 'Send an ISO 8601 date and time with a time zone.']);
  const naive = await api('PUT', '/api/test/clock', { body: { now: '2026-12-24T18:00:00' } });
  eq('the clock needs a time zone', naive.status, 422);
  eq('the clock clears', (await clearClock()).status, 204);
}

async function run() {
  await clearClock();
  for (const [name, work] of Object.entries({
    health,
    boundary,
    planRules,
    idempotency,
    links,
    sessionRequests,
    mine,
    shares,
    liveCount,
    deletion,
    rateLimits,
    reminders,
    clockChanges,
    testClock,
  })) {
    process.stdout.write(`\n== ${name}\n`);
    await work();
  }
  await clearClock();
  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log(failures.map((line) => ` - ${line}`).join('\n'));
    process.exitCode = 1;
  }
}

await run();
