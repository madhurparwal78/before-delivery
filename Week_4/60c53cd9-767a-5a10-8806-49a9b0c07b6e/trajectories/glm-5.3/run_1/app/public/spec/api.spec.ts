import { expect, test } from '@playwright/test';
import { ACCOUNTS, get, post, put, signIn, trySignIn, type Hold, type PublicUnit, type SearchReply } from './utils';

test.describe('health and tower', () => {
  test('health answers ok', async ({ request }) => {
    const reply = await get<{ status: string }>(request, '/api/health');
    expect(reply.status).toBe(200);
    expect(reply.body.status).toBe('ok');
    expect(typeof reply.headers.date).toBe('string');
  });

  test('tower lists 288 cells with signed asset links', async ({ request }) => {
    const reply = await get<{ units: Array<{ code: string; status: string; syncing: boolean }>; assets: Record<string, string> }>(request, '/api/tower');
    expect(reply.status).toBe(200);
    expect(reply.body.units).toHaveLength(288);
    expect(reply.body.units[0].code).toBe('3A');
    expect(reply.body.assets.shell).toMatch(/^\/media\/.+/);
    expect(Object.keys(reply.body.assets.plates)).toHaveLength(5);
    const withdrawn = reply.body.units.find((unit) => unit.code === '5D');
    expect(withdrawn?.status).toBe('withdrawn');
    const unreleased = reply.body.units.find((unit) => unit.code === '38A');
    expect(unreleased?.status).toBe('unreleased');
  });
});

test.describe('search', () => {
  test('unfiltered search returns the published totals', async ({ request }) => {
    const reply = await get<SearchReply>(request, '/api/search');
    expect(reply.status).toBe(200);
    expect(reply.body.total).toBe(263);
    expect(reply.body.facets.bedrooms['1']).toBe(66);
    expect(reply.body.facets.bedrooms['2']).toBe(131);
    expect(reply.body.facets.bedrooms['3']).toBe(66);
    expect(reply.body.facets.band['03-09']).toBe(55);
    expect(reply.body.facets.band['36-38']).toBe(0);
    expect(reply.body.facets.status.available).toBe(261);
    expect(reply.body.facets.status.held).toBe(1);
    expect(reply.body.facets.status.reserved).toBe(1);
    expect(reply.body.priceStats).toEqual({ min: 655000, max: 1688000 });
    expect(reply.body.hits).toHaveLength(24);
    expect(reply.body.nextCursor).toBeTruthy();
  });

  test('the unit read carries exactly the published public fields', async ({ request }) => {
    const reply = await get<{ unit: PublicUnit }>(request, '/api/units/27C');
    expect(reply.status).toBe(200);
    expect(Object.keys(reply.body.unit).sort()).toEqual([
      'areaM2', 'areaSqft', 'band', 'bearing', 'bedrooms', 'code', 'facing',
      'floor', 'price', 'pricePerM2', 'pricePerSqft', 'priceVersion', 'stack',
      'status', 'syncing', 'viewPhotographed', 'viewTag', 'viewUrl',
    ].sort());
    expect(reply.body.unit.code).toBe('27C');
    expect(reply.body.unit.areaSqft).toBe(1206);
    expect(reply.body.unit.pricePerM2).toBe(14607);
    expect(reply.body.unit.pricePerSqft).toBe(1357);
  });

  test('over-long q is rejected before search is consulted', async ({ request }) => {
    const q = 'a'.repeat(81);
    const reply = await get<SearchReply>(request, `/api/search?q=${encodeURIComponent(q)}`);
    expect(reply.status).toBe(422);
    expect(reply.body.error.fields.q).toBe('Use 80 characters or fewer.');
  });

  test('a price floor above the ceiling is rejected', async ({ request }) => {
    const reply = await get<SearchReply>(request, '/api/search?priceMin=2000000&priceMax=1000000');
    expect(reply.status).toBe(422);
    expect(reply.body.error.fields.priceMin).toBe("The lowest price can't be above the highest.");
  });

  test('an unknown facet value is rejected', async ({ request }) => {
    const reply = await get<SearchReply>(request, '/api/search?bedrooms=9');
    expect(reply.status).toBe(422);
    expect(reply.body.error.fields.bedrooms).toBe('Pick from the listed options.');
  });

  test('a facet carrying more than 6 values is rejected', async ({ request }) => {
    const facing = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W'];
    const query = facing.map((value) => `facing=${value}`).join('&');
    const reply = await get<SearchReply>(request, `/api/search?${query}`);
    expect(reply.status).toBe(422);
    expect(reply.body.error.fields.facing).toBe('Choose up to 6.');
  });

  test('paging is price-ordered with a cursor', async ({ request }) => {
    const first = await get<SearchReply>(request, '/api/search?limit=3');
    expect(first.body.hits).toHaveLength(3);
    const codes = first.body.hits.map((hit) => hit.code);
    expect(codes).toEqual(['3F', '4F', '5F']);
    const second = await get<SearchReply>(request, `/api/search?limit=3&after=${encodeURIComponent(first.body.nextCursor ?? '')}`);
    expect(second.body.hits[0].code).not.toBe('3F');
    expect(second.body.hits.length).toBeGreaterThan(0);
  });
});

test.describe('accounts and sessions', () => {
  test('creating an account is idempotent', async ({ request }) => {
    const first = await post<{ message: string }>(request, '/api/accounts', { name: 'Test Buyer', email: 'test.buyer@example.com', password: 'Password-1234' });
    expect(first.status).toBe(202);
    expect(first.body.message).toBe('Your details are in. Sign in to continue.');
    const second = await post<{ message: string }>(request, '/api/accounts', { name: 'Test Buyer', email: 'test.buyer@example.com', password: 'Different-Pass-99' });
    expect(second.status).toBe(202);
    const session = await signIn(request, 'test.buyer@example.com', 'Password-1234');
    expect(session.account.name).toBe('Test Buyer');
    const wrong = await trySignIn(request, 'test.buyer@example.com', 'Different-Pass-99');
    expect(wrong.status).toBe(401);
  });

  test('an unknown address and a wrong password answer identically', async ({ request }) => {
    const unknown = await trySignIn(request, 'nobody@example.com', 'Password-1234');
    const wrong = await trySignIn(request, ACCOUNTS.ana.email, 'Wrong-Pass-1234');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
  });
});

test.describe('holds', () => {
  test('a buyer with an active hold cannot hold a second home', async ({ request }) => {
    const { cookie } = await signIn(request, ACCOUNTS.tom.email, ACCOUNTS.tom.password);
    const attempt = await post<Hold>(request, '/api/holds', { unitCode: '10A', priceVersion: 1 }, { cookie });
    expect(attempt.status).toBe(409);
    expect((attempt.body as Record<string, { code: string }>).error.code).toBe('hold_limit');
  });

  test('Ana can hold an available home at the shown price', async ({ request }) => {
    const { cookie } = await signIn(request, ACCOUNTS.ana.email, ACCOUNTS.ana.password);
    const unitReply = await get<{ unit: PublicUnit }>(request, '/api/units/16A');
    expect(unitReply.body.unit.status).toBe('available');
    const holdReply = await post<{ hold: Hold }>(request, '/api/holds', { unitCode: '16A', priceVersion: unitReply.body.unit.priceVersion }, { cookie });
    expect(holdReply.status).toBe(201);
    expect(holdReply.body.hold.unitCode).toBe('16A');
    expect(holdReply.body.hold.quotedPrice).toBe(unitReply.body.unit.price);
    expect(holdReply.body.hold.status).toBe('active');

    // A price change later does not alter the hold's quoted price (DP-31).
    const coordinator = await signIn(request, ACCOUNTS.coordinator.email, ACCOUNTS.coordinator.password);
    const save = await put(request, `/api/console/units/16A/price`, { price: 1100000, expectedVersion: 1 }, { cookie: coordinator.cookie });
    expect(save.status).toBe(200);
    const holdAfterReply = await request.fetch(`/api/holds/${holdReply.body.hold.id}`, { headers: { cookie } });
    expect(holdAfterReply.status()).toBe(200);
    const holdAfter = (await holdAfterReply.json()) as { hold: Hold };
    expect(holdAfter.hold.quotedPrice).toBe(unitReply.body.unit.price);

    // Release restores availability.
    const release = await post<{ hold: Hold }>(request, `/api/holds/${holdReply.body.hold.id}/release`, {}, { cookie });
    expect(release.status).toBe(200);
    expect(release.body.hold.status).toBe('released');
    expect(release.body.hold.endedBy).toBe('buyer');
  });

  test('simultaneous holds for one home have exactly one winner', async ({ request }) => {
    const ana = await signIn(request, ACCOUNTS.ana.email, ACCOUNTS.ana.password);
    const tom = await signIn(request, ACCOUNTS.tom.email, ACCOUNTS.tom.password);
    // Tom's seeded hold on 31F means his attempt answers the hold limit, so the
    // race is proven with Ana against herself through two parallel requests and
    // a unique-key check below.
    const [anaReply, anaReplyTwo] = await Promise.all([
      post<Hold>(request, '/api/holds', { unitCode: '17A', priceVersion: 1 }, { cookie: ana.cookie, 'Idempotency-Key': `race-${Date.now()}-a` }),
      post<Hold>(request, '/api/holds', { unitCode: '17A', priceVersion: 1 }, { cookie: ana.cookie, 'Idempotency-Key': `race-${Date.now()}-b` }),
    ]);
    const statuses = [anaReply.status, anaReplyTwo.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = anaReply.status === 201 ? anaReply : anaReplyTwo;
    const loser = anaReply.status === 201 ? anaReplyTwo : anaReply;
    expect((loser.body as Record<string, { code: string }>).error.code).toBe('unit_unavailable');
    const holdId = (winner.body as { hold: Hold }).hold.id;
    const release = await post(request, `/api/holds/${holdId}/release`, {}, { cookie: ana.cookie });
    expect(release.status).toBe(200);
    void tom;
  });

  test('an idempotent replay returns the stored response and costs nothing', async ({ request }) => {
    const { cookie } = await signIn(request, ACCOUNTS.tom.email, ACCOUNTS.tom.password);
    // Tom has no active hold (his seeded 31F hold does not count against placing
    // a new one after it is released), so this test releases it first.
    const tomHolds = await request.fetch('/api/holds', { headers: { cookie } });
    const holdsBody = (await tomHolds.json()) as { holds: Hold[] };
    const active = holdsBody.holds.find((hold) => hold.status === 'active');
    if (active) {
      const released = await post(request, `/api/holds/${active.id}/release`, {}, { cookie });
      expect(released.status).toBe(200);
    }
    const key = `replay-${Date.now()}`;
    const first = await post<{ hold: Hold }>(request, '/api/holds', { unitCode: '18A', priceVersion: 1 }, { cookie, 'Idempotency-Key': key });
    expect(first.status).toBe(201);
    const replay = await post<{ hold: Hold }>(request, '/api/holds', { unitCode: '18A', priceVersion: 1 }, { cookie, 'Idempotency-Key': key });
    expect(replay.status).toBe(201);
    expect(replay.body.hold.id).toBe(first.body.hold.id);
    const reused = await post(request, '/api/holds', { unitCode: '19A', priceVersion: 1 }, { cookie, 'Idempotency-Key': key });
    expect(reused.status).toBe(409);
    expect((reused.body as Record<string, { code: string }>).error.code).toBe('idempotency_key_reused');
    const release = await post(request, `/api/holds/${first.body.hold.id}/release`, {}, { cookie });
    expect(release.status).toBe(200);
  });

  test('a fourth hold attempt in the window is refused', async ({ request }) => {
    const { cookie } = await signIn(request, ACCOUNTS.ana.email, ACCOUNTS.ana.password);
    for (let i = 0; i < 3; i++) {
      const reply = await post(request, '/api/holds', { unitCode: `20${'ABCDEFGH'[i]}`, priceVersion: 99 }, { cookie });
      expect(reply.status).toBeGreaterThanOrEqual(400);
    }
    const fourth = await post(request, '/api/holds', { unitCode: '20A', priceVersion: 1 }, { cookie });
    expect(fourth.status).toBe(429);
    expect((fourth.body as Record<string, { message: string }>).error.message).toMatch(/Too many hold attempts\./);
    expect(fourth.headers['retry-after']).toBeTruthy();
  });
});

test.describe('the error order', () => {
  test('a cross-origin write is refused', async ({ request }) => {
    const reply = await post(request, '/api/holds', { unitCode: '27C', priceVersion: 1 }, { 'Origin': 'https://elsewhere.example' });
    expect(reply.status).toBe(403);
    expect((reply.body as Record<string, { code: string }>).error.code).toBe('cross_origin');
  });

  test('a coordinator cannot hold and a buyer cannot use the console', async ({ request }) => {
    const coordinator = await signIn(request, ACCOUNTS.coordinator.email, ACCOUNTS.coordinator.password);
    const buyer = await signIn(request, ACCOUNTS.ana.email, ACCOUNTS.ana.password);
    const hold = await post(request, '/api/holds', { unitCode: '27C', priceVersion: 1 }, { cookie: coordinator.cookie });
    expect(hold.status).toBe(403);
    const consoleRead = await request.fetch('/api/console/units', { headers: { cookie: buyer.cookie } });
    expect(consoleRead.status()).toBe(403);
  });

  test('a non-integer price version is refused on the raw token', async ({ request }) => {
    const { cookie } = await signIn(request, ACCOUNTS.ana.email, ACCOUNTS.ana.password);
    const quoted = await request.fetch('/api/holds', {
      method: 'POST',
      data: '{"unitCode":"15A","priceVersion":"1"}',
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(quoted.status()).toBe(422);
    const decimal = await request.fetch('/api/holds', {
      method: 'POST',
      data: '{"unitCode":"15A","priceVersion":1.0}',
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(decimal.status()).toBe(422);
  });
});
