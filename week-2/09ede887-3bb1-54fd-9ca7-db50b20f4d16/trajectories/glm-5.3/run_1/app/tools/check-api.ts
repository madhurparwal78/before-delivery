/**
 * End-to-end API checks against a running server. Covers both versions'
 * shapes, the error precedence, filters, search, auth, throttle, calendar,
 * rosters, the contest and the frozen-v1 rules.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';

let fails = 0;
let checks = 0;
function check(label: string, got: unknown, want: unknown): void {
  checks++;
  const g = JSON.stringify(got) ?? 'undefined';
  const w = JSON.stringify(want) ?? 'undefined';
  const ok = g === w;
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', label, '=>', g.slice(0, 200), ok ? '' : 'want ' + w.slice(0, 200));
}

interface Res {
  status: number;
  body: string;
  headers: Record<string, string>;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; key?: string; contentType?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.key) headers['idempotency-key'] = options.key;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const body = await res.text();
  const headerMap: Record<string, string> = {};
  res.headers.forEach((v, k) => (headerMap[k] = v));
  return { status: res.status, body, headers: headerMap };
}

async function main(): Promise<void> {
  // Health and contract.
  check('health', (await call('GET', '/api/health')).body, '{"status":"ok"}');
  const contract = JSON.parse((await call('GET', '/api/_contract')).body);
  check('contract keys', Object.keys(contract), ['v1', 'v2']);
  check('contract digest length', contract.v1.length, 64);

  // Sessions: published counts and order.
  const all = JSON.parse((await call('GET', '/api/v2/sessions')).body);
  check('all sessions', all.length, 18);
  const day1 = JSON.parse((await call('GET', '/api/v2/sessions?day=1')).body);
  check('day 1', day1.length, 12);
  const day2 = JSON.parse((await call('GET', '/api/v2/sessions?day=2')).body);
  check('day 2', day2.length, 6);
  check('day 2 AST instant', day2[0].start_instant, '2026-11-01T15:00:00Z');
  check('session key order', Object.keys(all[0]), [
    'id', 'day', 'date', 'start_local', 'end_local', 'start_instant', 'end_instant', 'title',
    'speakers', 'stage', 'stage_name', 'location', 'format', 'format_label', 'description',
    'seats', 'waitlist_count', 'reserved_by_me', 'saved_by_me', 'waitlist_position', 'my_hold',
  ]);
  check('v1 session key order', Object.keys(JSON.parse((await call('GET', '/api/v1/sessions')).body)[0]), [
    'id', 'day', 'date', 'starts_at', 'ends_at', 'starts_at_utc', 'ends_at_utc', 'title',
    'speakers', 'stage', 'stage_name', 'location', 'format', 'format_label', 'description',
    'capacity', 'seats_left', 'waitlist_count', 'reserved_by_me', 'saved_by_me', 'waitlist_position',
  ]);
  // The alias answers byte for byte as /api/v1.
  const v1a = await call('GET', '/api/v1/sessions');
  const alias = await call('GET', '/api/sessions');
  check('alias equals v1', alias.body, v1a.body);
  check('v1 deprecation', v1a.headers['deprecation'], 'true');
  check('v1 sunset', v1a.headers['sunset'], 'Sat, 31 Oct 2026 16:00:00 GMT');
  check('v2 no deprecation', (await call('GET', '/api/v2/sessions')).headers['deprecation'], undefined);

  // Filters.
  const wf = await call('GET', '/api/v2/sessions?day=1&stage=ai-builder-lab&format=workshop');
  check('workshop filter', JSON.parse(wf.body).map((s: { id: string }) => s.id), [
    'd1-clone-your-writing-voice', 'd1-zero-to-funded', 'd1-never-forgets',
  ]);
  check('bad day filter', (await call('GET', '/api/v2/sessions?day=3')).status, 400);
  check('bad stage filter', (await call('GET', '/api/v2/sessions?stage=nope')).status, 400);
  check('unknown filter body', JSON.parse((await call('GET', '/api/v2/sessions?day=3')).body).error.code, 'invalid_filter');
  check('v1 filter error shape', Object.keys(JSON.parse((await call('GET', '/api/sessions?day=3')).body)), ['error', 'message']);

  // Search (v2 only).
  const search = JSON.parse((await call('GET', '/api/v2/sessions?q=agent')).body);
  check('search agent', search.map((s: { id: string }) => s.id), [
    'd1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet',
  ]);
  check('search malformed', JSON.parse((await call('GET', '/api/v2/sessions?q=agent OR')).body).map((s: { id: string }) => s.id), [
    'd1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet',
  ]);
  check('search worst case W1', JSON.parse((await call('GET', '/api/v2/sessions?q=' + encodeURIComponent('('.repeat(1000) + 'a' + ')'.repeat(1000)))).body).length, 18);
  check('v1 ignores q', JSON.parse((await call('GET', '/api/sessions?q=agent')).body).length, 18);
  const longQ = 'x'.repeat(2049);
  check('q too long', (await call('GET', '/api/v2/sessions?q=' + longQ)).status, 422);
  const exactQ = await call('GET', '/api/v2/sessions?q=' + 'x'.repeat(2048));
  check('q exactly 2048 ok', exactQ.status, 200);

  // Stages and speakers.
  const stages = JSON.parse((await call('GET', '/api/v2/stages')).body);
  check('stages order', stages.map((s: { slug: string }) => s.slug), [
    'summit-stage', 'signal-stage', 'ai-builder-lab', 'the-arena',
  ]);
  const speakers = JSON.parse((await call('GET', '/api/v2/speakers')).body);
  check('speaker count', speakers.length, 19);
  check('speaker order', speakers[0].slug, 'ines-okafor');
  check('mara sessions', speakers.find((s: { slug: string }) => s.slug === 'mara-velasquez').sessions, [
    'd1-campus-to-protocol', 'd1-never-forgets',
  ]);
  check('mara bio html', speakers.find((s: { slug: string }) => s.slug === 'mara-velasquez').bio_html,
    'Leads agent memory research at <em>Tidewater Labs</em>. Notes: <a href="https://example.com/mara">https://example.com/mara</a>');
  check('ravi bio html', speakers.find((s: { slug: string }) => s.slug === 'ravi-menon').bio_html,
    'Writes <strong>every day</strong>; ships on Fridays.');
  check('v1 speaker keys', Object.keys(JSON.parse((await call('GET', '/api/speakers')).body)[0]), ['name', 'company', 'sessions']);

  // Calendar.
  const ics = await call('GET', '/api/v2/agenda.ics?day=1&stage=ai-builder-lab&format=workshop');
  check('calendar content type', ics.headers['content-type'], 'text/calendar; charset=utf-8');
  check('calendar disposition', ics.headers['content-disposition'], 'attachment; filename="keel-outpost-agenda.ics"');
  check('calendar events', (ics.body.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  check('calendar day2 DTSTART', (await call('GET', '/api/v2/agenda.ics?day=2')).body.includes('DTSTART:20261101T150000Z'), true);
  check('calendar CRLF', (await call('GET', '/api/v2/agenda.ics?day=1')).body.endsWith('\r\n'), true);
  check('calendar PRODID', (await call('GET', '/api/v2/agenda.ics?day=1')).body.includes('PRODID:-//Keel Outpost//Agenda//EN'), true);
  check('calendar location escaped', (await call('GET', '/api/v2/agenda.ics?day=1&format=workshop')).body.includes('LOCATION:AI Builder Lab\\, Harbour Quay Hall\\, Port Ashby'), true);
  check('empty calendar', (await call('GET', '/api/v2/agenda.ics?stage=ai-builder-lab&q=zzz')).status, 404);
  check('empty calendar code', JSON.parse((await call('GET', '/api/v2/agenda.ics?stage=ai-builder-lab&q=zzz')).body).error.code, 'no_sessions');

  // Unknown paths and methods.
  check('unknown api path', (await call('GET', '/api/v2/nope')).status, 404);
  check('trailing slash', (await call('GET', '/api/v2/sessions/')).status, 404);
  check('/api itself', (await call('GET', '/api')).status, 404);
  check('unpublished version', (await call('GET', '/api/v3/sessions')).status, 404);
  check('v1 v2-only route', (await call('GET', '/api/me/holds')).status, 404);
  check('case change', (await call('GET', '/api/Sessions')).status, 404);
  check('method not allowed', (await call('OPTIONS', '/api/v2/sessions')).status, 405);
  check('allow header', (await call('OPTIONS', '/api/v2/sessions')).headers['allow'], 'GET, HEAD');
  check('PATCH on sessions', (await call('PATCH', '/api/v2/sessions')).status, 405);
  check('HEAD on sessions', (await call('HEAD', '/api/v2/sessions')).status, 200);
  check('unknown api error shape', JSON.parse((await call('GET', '/api/v2/nope')).body).error.code, 'not_found');
  check('unknown page', (await fetch(`${BASE}/nope`, { method: 'GET' })).status, 404);

  // Body handling.
  check('oversized body', (await call('POST', '/api/v2/auth/login', { body: 'x'.repeat(10241), contentType: 'application/json' })).status, 413);
  check('wrong content type', (await call('POST', '/api/v2/auth/login', { body: '{"email":"a@b.c","password":"x"}', contentType: 'text/plain' })).status, 415);
  check('malformed json', (await call('POST', '/api/v2/auth/login', { body: '{bad', contentType: 'application/json' })).status, 400);
  check('body exactly 10240 ok', (await call('POST', '/api/v2/auth/login', { body: '{"email":"a@b.c","password":"' + 'x'.repeat(10200) + '"}', contentType: 'application/json' })).status, 401);

  // Auth: signup, login, logout.
  const suffix = String(Math.floor(Math.random() * 1e9));
  const email = `new-${suffix}@example.com`;
  const badSignup = await call('POST', '/api/v2/auth/signup', { body: { name: '', email: 'bad', password: 'x', role: 'organiser' } });
  check('signup validation', badSignup.status, 422);
  check('signup fields', Object.keys(JSON.parse(badSignup.body).error.fields), ['name', 'email', 'password']);
  const signup = await call('POST', '/api/v2/auth/signup', { body: { name: 'Test Person', email, password: 'password123', role: 'organiser' } });
  check('signup 201', signup.status, 201);
  const signupBody = JSON.parse(signup.body);
  check('signup ignores role', signupBody.account.role, 'attendee');
  check('auth keys', Object.keys(signupBody), ['token', 'account']);
  const dup = await call('POST', '/api/v2/auth/signup', { body: { name: 'Test Person', email, password: 'password123' } });
  check('email taken', dup.status, 409);
  check('email taken code', JSON.parse(dup.body).error.code, 'email_taken');
  const token = signupBody.token;

  // Reserved counts unchanged by a refused signup.
  const me = await call('GET', '/api/v2/me', { token });
  check('me', JSON.parse(me.body).email, email);
  check('unauthenticated me', (await call('GET', '/api/v2/me')).status, 401);
  check('unauthenticated code', JSON.parse((await call('GET', '/api/v2/me')).body).error.code, 'unauthenticated');

  // Login: no account disclosure.
  const unknown = await call('POST', '/api/v2/auth/login', { body: { email: `nobody-${suffix}@example.com`, password: 'password123' } });
  const wrongpw = await call('POST', '/api/v2/auth/login', { body: { email, password: 'wrongpassword' } });
  check('login unknown 401', unknown.status, 401);
  check('login wrong 401', wrongpw.status, 401);
  check('no account disclosure', unknown.body === wrongpw.body, true);
  check('same header names', Object.keys(unknown.headers).sort(), Object.keys(wrongpw.headers).sort());
  const good = await call('POST', '/api/v2/auth/login', { body: { email, password: 'password123' } });
  check('login ok', good.status, 200);
  const secondToken = JSON.parse(good.body).token;

  // Throttle.
  let last: Res | null = null;
  for (let i = 0; i < 5; i++) {
    last = await call('POST', '/api/v2/auth/login', { body: { email, password: 'wrongpassword' } });
  }
  check('throttle kicks in', last!.status, 429);
  check('throttle code', JSON.parse(last!.body).error.code, 'rate_limited');
  check('retry after', parseInt(last!.headers['retry-after'] ?? '0', 10) >= 1, true);
  const unknownEmail = `nobody-${suffix}@example.com`;
  for (let i = 0; i < 5; i++) {
    await call('POST', '/api/v2/auth/login', { body: { email: unknownEmail, password: 'password123' } });
  }
  const throttledUnknown = await call('POST', '/api/v2/auth/login', { body: { email: unknownEmail, password: 'password123' } });
  check('throttle unknown same', throttledUnknown.status, 429);
  const throttledKnown = await call('POST', '/api/v2/auth/login', { body: { email, password: 'wrongpassword' } });
  check('throttle same body', throttledUnknown.body, throttledKnown.body);
  check('throttle same retry-after', throttledUnknown.headers['retry-after'], throttledKnown.headers['retry-after']);

  // Booking through the API.
  const reserveRes = await call('POST', '/api/v2/sessions/d1-zero-to-funded/reservation', { token });
  check('reserve 201', reserveRes.status, 201);
  const reserveBody = JSON.parse(reserveRes.body);
  check('reservation_created keys', Object.keys(reserveBody), ['reservation', 'seats']);
  check('reservation keys', Object.keys(reserveBody.reservation), ['id', 'session_id', 'created_at']);
  check('reserve unauthenticated', (await call('POST', '/api/v2/sessions/d1-zero-to-funded/reservation')).status, 401);
  {
    const org = await call('POST', '/api/v2/auth/login', { body: { email: 'organiser@example.com', password: 'deku-demo-pw-2026' } });
    check('reserve forbidden for organiser', (await call('POST', '/api/v2/sessions/d1-zero-to-funded/reservation', { token: JSON.parse(org.body).token })).status, 403);
  }

  // Idempotency through the API.
  const key = `key-${suffix}`;
  const first = await call('POST', '/api/v2/sessions/d1-never-forgets/reservation', { token, key });
  const replay = await call('POST', '/api/v2/sessions/d1-never-forgets/reservation', { token, key });
  check('idempotent replay', replay.body, first.body);
  check('replay status', replay.status, 201);
  const reuseOtherVersion = await call('POST', '/api/sessions/d1-never-forgets/reservation', { token, key });
  check('reuse across versions', reuseOtherVersion.status, 422);
  check('reuse code', JSON.parse(reuseOtherVersion.body).error, 'idempotency_key_reused');
  const malformedKey = await call('POST', '/api/v2/sessions/d1-never-forgets/reservation', { token, key: 'x'.repeat(256) });
  check('malformed key', malformedKey.status, 400);

  // Waitlist through the API: first fill the session, then join.
  const rowan = await call('POST', '/api/v2/auth/login', { body: { email: 'attendee2@example.com', password: 'deku-demo-pw-2026' } });
  const rowanToken = JSON.parse(rowan.body).token;
  const fill = await call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/reservation', { token: rowanToken });
  check('Rowan fills the last seat', fill.status, 201);
  const joinRes = await call('POST', '/api/v2/sessions/d1-clone-your-writing-voice/waitlist', { token: secondToken });
  check('join 201', joinRes.status, 201);
  check('waitlist_joined keys', Object.keys(JSON.parse(joinRes.body)), ['waitlist']);
  check('waitlist keys', Object.keys(JSON.parse(joinRes.body).waitlist), ['session_id', 'position', 'created_at']);
  check('position 1', JSON.parse(joinRes.body).waitlist.position, 1);

  // My agenda.
  const myAgendaRes = await call('GET', '/api/v2/me/agenda', { token });
  check('my agenda keys', Object.keys(JSON.parse(myAgendaRes.body)), ['reserved', 'held', 'waitlisted', 'saved']);
  check('my agenda reserved', JSON.parse(myAgendaRes.body).reserved.length, 2);
  {
    const org = await call('POST', '/api/v2/auth/login', { body: { email: 'organiser@example.com', password: 'deku-demo-pw-2026' } });
    check('my agenda organiser forbidden', (await call('GET', '/api/v2/me/agenda', { token: JSON.parse(org.body).token })).status, 403);
  }

  // Holds through the API (v2 only).
  const hold = await call('GET', '/api/v2/me/holds', { token: secondToken });
  check('holds empty', hold.body, '[]');
  check('v1 has no holds', (await call('GET', '/api/me/holds')).status, 404);

  // Cancel.
  const cancelRes = await call('DELETE', '/api/v2/sessions/d1-zero-to-funded/reservation', { token });
  check('cancel 200', cancelRes.status, 200);
  check('cancelled keys', Object.keys(JSON.parse(cancelRes.body)), ['seats']);
  const cancelAgain = await call('DELETE', '/api/v2/sessions/d1-zero-to-funded/reservation', { token });
  check('cancel again', cancelAgain.status, 409);
  check('no reservation code', JSON.parse(cancelAgain.body).error.code, 'no_reservation');

  // Saving.
  check('save', (await call('PUT', '/api/v2/sessions/d1-book-signing/save', { token })).status, 200);
  check('save body', (await call('PUT', '/api/v2/sessions/d1-book-signing/save', { token })).body, '{"saved":true}');
  check('unsave body', (await call('DELETE', '/api/v2/sessions/d1-book-signing/save', { token })).body, '{"saved":false}');

  // Record: guessing.
  const record = JSON.parse((await call('GET', '/api/v2/record')).body);
  check('record keys', Object.keys(record), ['status', 'closes_at', 'guess_count', 'my_guess', 'final_figure', 'revealed_at', 'leaderboard']);
  check('record open', record.status, 'open');
  const guessBad = await call('POST', '/api/v2/record/guesses', { token, body: { value: 0 } });
  check('guess validation', guessBad.status, 422);
  const guess = await call('POST', '/api/v2/record/guesses', { token, body: { value: 6000000 } });
  check('guess 201', guess.status, 201);
  check('guess keys', Object.keys(JSON.parse(guess.body)), ['guess']);
  const guessAgain = await call('POST', '/api/v2/record/guesses', { token, body: { value: 5 } });
  check('already guessed', guessAgain.status, 409);
  check('already guessed code', JSON.parse(guessAgain.body).error.code, 'already_guessed');
  check('guesses unauthenticated', (await call('POST', '/api/v2/record/guesses', { body: { value: 5 } })).status, 401);
  const afterGuess = JSON.parse((await call('GET', '/api/v2/record', { token })).body);
  check('my guess shown', afterGuess.my_guess.value, 6000000);
  const anonRecord = JSON.parse((await call('GET', '/api/v2/record')).body);
  check('anonymous sees no guess', anonRecord.my_guess, null);
  check('guess count', anonRecord.guess_count, 1);

  // Organiser: login as the seeded organiser.
  const orgLogin = await call('POST', '/api/v2/auth/login', { body: { email: 'organiser@example.com', password: 'deku-demo-pw-2026' } });
  const orgToken = JSON.parse(orgLogin.body).token;
  globalThis.__orgToken = orgToken;
  check('organiser login', orgLogin.status, 200);
  check('organiser sessions', (await call('GET', '/api/v2/organiser/sessions', { token: orgToken })).status, 200);
  const orgRows = JSON.parse((await call('GET', '/api/v2/organiser/sessions', { token: orgToken })).body);
  check('organiser row keys', Object.keys(orgRows[0]), ['id', 'title', 'day', 'start_local', 'end_local', 'seats', 'waitlisted']);
  check('organiser row count', orgRows.length, 7);
  check('organiser forbidden for attendee', (await call('GET', '/api/v2/organiser/sessions', { token })).status, 403);
  check('organiser unauthenticated', (await call('GET', '/api/v2/organiser/sessions')).status, 401);
  check('v1 organiser keys', Object.keys(JSON.parse((await call('GET', '/api/organiser/sessions', { token: orgToken })).body)[0]), [
    'id', 'title', 'day', 'starts_at', 'ends_at', 'capacity', 'reserved', 'seats_left', 'waitlisted',
  ]);

  // Roster.
  const roster = await call('GET', '/api/v2/organiser/sessions/d1-clone-your-writing-voice/roster?limit=1', { token: orgToken });
  check('roster page', JSON.parse(roster.body).length, 1);
  check('roster link', roster.headers['link'] !== undefined, true);
  const nextPage = roster.headers['link'].match(/<([^>]+)>/)[1];
  const page2 = await call('GET', nextPage.replace('/api/v2', '/api/v2'), { token: orgToken });
  check('roster second page', page2.status, 200);
  const csv = await call('GET', '/api/v2/organiser/sessions/d1-clone-your-writing-voice/roster.csv', { token: orgToken });
  check('csv content type', csv.headers['content-type'], 'text/csv; charset=utf-8');
  check('csv header', csv.body.startsWith('name,email,reserved_at\r\n'), true);
  check('csv not reservable', (await call('GET', '/api/v2/organiser/sessions/d1-book-signing/roster.csv', { token: orgToken })).status, 409);
  check('roster cursor bad', (await call('GET', '/api/v2/organiser/sessions/d1-clone-your-writing-voice/roster?cursor=zzz', { token: orgToken })).status, 422);
  const limitBad = await call('GET', '/api/v2/organiser/sessions/d1-clone-your-writing-voice/roster?limit=0', { token: orgToken });
  check('roster limit bad', limitBad.status, 422);

  // Capacity.
  const cap = await call('PATCH', '/api/v2/organiser/sessions/d1-clone-your-writing-voice', { token: orgToken, body: { capacity: 3 } });
  check('capacity saved', cap.status, 200);
  check('capacity seats', JSON.parse(cap.body).seats.capacity, 3);
  const capLow = await call('PATCH', '/api/v2/organiser/sessions/d1-clone-your-writing-voice', { token: orgToken, body: { capacity: 1 } });
  check('below reserved', capLow.status, 409);
  check('below reserved extra', JSON.parse(capLow.body).error.reserved, 3);
  const capBad = await call('PATCH', '/api/v2/organiser/sessions/d1-clone-your-writing-voice', { token: orgToken, body: { capacity: 0 } });
  check('capacity validation', capBad.status, 422);
  check('capacity bad field', JSON.parse(capBad.body).error.fields.capacity, 'Enter a whole number from 1 to 500.');

  // Bio editing (v2 only).
  const bio = await call('PUT', '/api/v2/organiser/speakers/ravi-menon/bio', { token: orgToken, body: { bio: 'Writes **every day** and `ships` on Fridays. See <https://example.com/ravi>' } });
  check('bio saved', bio.status, 200);
  check('bio rendered', JSON.parse(bio.body).bio_html, 'Writes <strong>every day</strong> and <code>ships</code> on Fridays. See <a href="https://example.com/ravi">https://example.com/ravi</a>');
  check('bio attendee forbidden', (await call('PUT', '/api/v2/organiser/speakers/ravi-menon/bio', { token, body: { bio: 'x' } })).status, 403);
  check('bio v1 not published', (await call('PUT', '/api/organiser/speakers/ravi-menon/bio', { token: orgToken, body: { bio: 'x' } })).status, 404);
  const bioLong = 'x'.repeat(2001);
  check('bio too long', (await call('PUT', '/api/v2/organiser/speakers/ravi-menon/bio', { token: orgToken, body: { bio: bioLong } })).status, 422);
  check('bio exactly 2000', (await call('PUT', '/api/v2/organiser/speakers/ravi-menon/bio', { token: orgToken, body: { bio: 'x'.repeat(2000) } })).status, 200);
  check('bio unknown speaker', (await call('PUT', '/api/v2/organiser/speakers/nobody/bio', { token: orgToken, body: { bio: 'x' } })).status, 404);
  // Restore the seeded bio.
  await call('PUT', '/api/v2/organiser/speakers/ravi-menon/bio', { token: orgToken, body: { bio: 'Writes **every day**; ships on Fridays.' } });

  // Reveal.
  const reveal = await call('POST', '/api/v2/organiser/record/reveal', { token: orgToken, body: { final_figure: 6000000 } });
  check('reveal 200', reveal.status, 200);
  check('reveal keys', Object.keys(JSON.parse(reveal.body)), ['status', 'final_figure', 'revealed_at', 'leaderboard']);
  const revealAgain = await call('POST', '/api/v2/organiser/record/reveal', { token: orgToken, body: { final_figure: 5 } });
  check('already revealed', revealAgain.status, 409);
  const revealed = JSON.parse((await call('GET', '/api/v2/record')).body);
  check('revealed status', revealed.status, 'revealed');
  check('leaderboard', revealed.leaderboard[0].display_name, 'Test P.');

  // Logout invalidates the token.
  const logout = await call('POST', '/api/v2/auth/logout', { token });
  check('logout', logout.body, '{"signed_out":true}');
  check('token refused after logout', (await call('GET', '/api/v2/me', { token })).status, 401);

  console.log(checks + ' checks, ' + (fails === 0 ? 'ALL OK' : `${fails} FAILURES`));
}

function organiserToken(): string {
  return (globalThis as { __orgToken?: string }).__orgToken ?? '';
}

main().catch((err) => {
  console.error('ERROR', err);
  process.exitCode = 1;
});
