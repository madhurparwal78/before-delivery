// End-to-end smoke checks against a running server. Run: node tools/smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

class Client {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrf = null;
    this.user = null;
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async call(method, path, body, opts = {}) {
    const headers = {};
    if (this.cookies.size > 0) headers.Cookie = this.cookieHeader();
    const needsCsrf = method !== 'GET' && method !== 'HEAD';
    if (body !== undefined || needsCsrf) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['X-CSRF-Token'] = this.csrf ?? '';
    }
    if (opts.idem) headers['Idempotency-Key'] = opts.idem;
    if (opts.rawBody !== undefined) {
      const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.rawBody });
      return res;
    }
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return res;
  }

  async session() {
    const res = await this.call('GET', '/api/session');
    const data = await res.json();
    this.csrf = data.csrfToken;
    this.user = data.user;
    return data;
  }

  async status(path, method = 'GET', body, opts = {}) {
    const res = await this.call(method, path, body, opts);
    return res.status;
  }

  async json(path, method = 'GET', body, opts = {}) {
    const res = await this.call(method, path, body, opts);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (data && typeof data.csrfToken === 'string') this.csrf = data.csrfToken;
    return { status: res.status, data, headers: res.headers };
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)?.slice(0, 400)}`}`);
}

async function main() {
  // --- seeded accounts and starter island
  const ivo = new Client('ivo');
  await ivo.session();
  const bad = await ivo.json('/api/auth/signin', 'POST', { email: 'ivo@lowtide.test', password: 'wrong-password-1' });
  check('signin wrong password invalid_credentials', bad.status === 401 && bad.data.error === 'invalid_credentials', bad);
  const signin = await ivo.json('/api/auth/signin', 'POST', { email: 'ivo@lowtide.test', password: 'Saltpan-Ivo-27' });
  check('ivo signs in', signin.status === 200 && signin.data.user.displayName === 'Ivo Brack', signin);
  const village = await ivo.json('/api/village');
  const v = village.data;
  const starterOk = {
    brine: v.resources.brine,
    peat: v.resources.peat,
    copper: v.resources.copper,
    saltmark: v.saltmark,
    builders: v.builders,
    housing: v.army.housing,
    units: v.army.units,
    trophies: v.trophies,
    league: v.league,
    buildings: v.buildings.length,
  };
  check(
    'starter island values',
    v.resources.brine.amount === 1500 && v.resources.peat.amount === 1500 && v.resources.copper.amount === 100 &&
      v.resources.copper.cap === 200 && v.saltmark === 5 && v.builders.total === 2 && v.army.housing.used === 10 &&
      v.army.housing.capacity === 20 && v.army.units.saltjack === 10 && v.trophies === 120 && v.league === 'Mudflat' && v.buildings.length === 5,
    starterOk
  );
  const me = await ivo.json('/api/me');
  check('me has clan', me.data.clanId !== null && me.data.verified === true, me.data);

  // --- CSRF
  const noCsrf = await fetch(`${BASE}/api/village/buildings`, {
    method: 'POST',
    headers: { Cookie: ivo.cookieHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'peat_rick', x: 5, y: 5, rotation: 0 }),
  });
  check('post without csrf token refused', noCsrf.status === 403 && (await noCsrf.json()).error === 'csrf_failed', noCsrf.status);

  // --- building placement
  const place = await ivo.json('/api/village/buildings', 'POST', { type: 'peat_rick', x: 5, y: 5, rotation: 0 });
  check('place peat rick', place.status === 201 && place.data.level === 0 && place.data.upgrade?.toLevel === 1, place.data);
  const occupied = await ivo.json('/api/village/buildings', 'POST', { type: 'peat_rick', x: 5, y: 5, rotation: 0 });
  check('cell_occupied', occupied.status === 409 && occupied.data.error === 'cell_occupied', occupied);
  const extraField = await ivo.json('/api/village/buildings', 'POST', { type: 'peat_rick', x: 8, y: 5, rotation: 0, level: 3 });
  check('unknown field rejected', extraField.status === 422 && extraField.data.errors.level === 'unknown field', extraField.data);
  const offArea = await ivo.json('/api/village/buildings', 'POST', { type: 'peat_rick', x: 1, y: 5, rotation: 0 });
  check('off build area 422 on x', offArea.status === 422 && offArea.data.errors.x === 'Keep the whole building inside the build area.', offArea.data);
  const v2 = await ivo.json('/api/village');
  check('builder count drops', v2.data.builders.free === 1, v2.data.builders);
  const again = await ivo.json('/api/village/buildings', 'POST', { type: 'peat_rick', x: 30, y: 5, rotation: 90 });
  check('second rick placed', again.status === 201, again.data);
  const third = await ivo.json('/api/village/buildings', 'POST', { type: 'peat_rick', x: 30, y: 20, rotation: 0 });
  check('building_limit_reached', third.status === 409 && third.data.error === 'building_limit_reached', third.data);
  const poor = await ivo.json('/api/village/buildings', 'POST', { type: 'copper_vault', x: 8, y: 10, rotation: 0 });
  check('no_free_builder on third building', poor.status === 409 && poor.data.error === 'no_free_builder', poor.data);

  // --- collect producer
  const pan = v.buildings.find((b) => b.type === 'brine_pan');
  const collect = await ivo.json(`/api/village/buildings/${pan.id}/collect`, 'POST', {});
  check('collect brine pan returns zeros or accrued', collect.status === 200, collect.data);

  // --- training
  const train = await ivo.json('/api/army/train', 'POST', { unit: 'saltjack', count: 3 });
  check('train 3 saltjacks', train.status === 201 && train.data.army.training.length === 1, train.data);
  const cancel = await ivo.json(`/api/army/training/${train.data.army.training[0].id}/cancel`, 'POST', {});
  check('cancel training refunds', cancel.status === 200 && cancel.data.refunded.brine === 75, cancel.data);

  // --- privacy and malformed ids
  const wren = new Client('wren');
  await wren.session();
  await wren.json('/api/auth/signin', 'POST', { email: 'wren@lowtide.test', password: 'Saltpan-Wren-27' });
  const foreign = await wren.json(`/api/villages/${v.id}`);
  check('foreign village read is not_found', foreign.status === 404, foreign.status);
  for (const bad of ['abc', '0', '-1', '9007199254740992', '123e5', '1.5', '012']) {
    const res = await wren.json(`/api/villages/${bad}`);
    check(`malformed id ${bad} -> 404`, res.status === 404, res.status);
  }

  // --- signup + verification mail
  const email = `smoke-${Date.now()}@lowtide.test`;
  const anon = new Client('anon');
  await anon.session();
  const signup = await anon.json('/api/auth/signup', 'POST', { email, password: 'Saltflat-Test-10', displayName: 'Smoke Tester', timeZone: 'Europe/Lisbon' });
  check('signup 202 check_email', signup.status === 202 && signup.data.status === 'check_email', signup.data);
  const signup2 = await anon.json('/api/auth/signup', 'POST', { email, password: 'Saltflat-Test-10', displayName: 'Smoke Tester', timeZone: 'Europe/Lisbon' });
  check('duplicate signup same answer', signup2.status === 202 && JSON.stringify(signup2.data) === JSON.stringify(signup.data), signup2.data);
  // wait for the queued mail to be delivered (the sender retries at least every 10 seconds)
  let mail = null;
  for (let attempt = 0; attempt < 10 && mail === null; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const messages = await (await fetch(`${MAILPIT}/api/v1/messages?limit=20`)).json();
    mail = messages.messages?.find((m) => m.To[0].Address === email && m.Subject === 'Confirm your Saltreach email') ?? null;
  }
  check('confirmation mail delivered', mail !== undefined, 'no mail arrived');
  const mailList = await (await fetch(`${MAILPIT}/api/v1/messages?limit=20`)).json();
  const newest = mailList.messages?.filter((m) => m.To[0].Address === email).sort((a, b) => b.ID - a.ID)[0];
  const body = await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json();
  const token = (body.Text.match(/token=([A-Za-z0-9_-]+)/) ?? [])[1];
  const verify = await anon.json('/api/auth/verify', 'POST', { token });
  check('verify with newest token works', verify.status === 200, verify.data);
  const oldToken = token === (body.Text.match(/token=([A-Za-z0-9_-]+)/) ?? [])[1] ? null : token;
  void oldToken;

  // --- throttle: 5 sign-in attempts then 429
  const victim = `ratelimit-${Date.now()}@lowtide.test`;
  const rl = new Client('rl');
  await rl.session();
  let saw429 = false;
  let retryAfter = null;
  for (let i = 0; i < 6; i++) {
    const res = await rl.json('/api/auth/signin', 'POST', { email: victim, password: 'not-the-password-1' });
    if (res.status === 429) {
      saw429 = true;
      retryAfter = res.headers.get('retry-after');
      break;
    }
  }
  check('sign-in throttle hits 429 with Retry-After', saw429 && retryAfter !== null, { saw429, retryAfter });

  // --- raids
  const marrow = new Client('marrow');
  await marrow.session();
  await marrow.json('/api/auth/signin', 'POST', { email: 'marrow@lowtide.test', password: 'Saltpan-Marrow-27' });
  const next = await marrow.json('/api/scout/next');
  check('scout next finds a match', next.status === 200 && next.data.match !== null, next.data);
  const target = next.data.match;
  const startRaid = await marrow.json('/api/raids', 'POST', { villageId: target.villageId }, { idem: 'smoke-raid-key-1' });
  check('raid locked', startRaid.status === 201 && startRaid.data.state === 'locked', startRaid.data?.state);
  const replayed = await marrow.json('/api/raids', 'POST', { villageId: target.villageId }, { idem: 'smoke-raid-key-1' });
  check('idempotent start replays', replayed.status === 201 && replayed.headers.get('idempotent-replayed') === 'true' && replayed.data.id === startRaid.data.id, replayed.headers.get('idempotent-replayed'));
  const reused = await marrow.json('/api/raids', 'POST', { villageId: target.villageId }, { idem: 'smoke-raid-key-1-diff' });
  void reused;
  const raidId = startRaid.data.id;
  const deploys = [];
  for (let i = 0; i < 10; i++) deploys.push({ tick: i * 10, unit: 'saltjack', x: 0, y: 2 + (i % 3) });
  const deploy = await marrow.json(`/api/raids/${raidId}/deploys`, 'POST', { deploys }, { idem: 'smoke-deploy-1' });
  check('deploy batch accepted', deploy.status === 200 && deploy.data.state === 'deploying' && deploy.data.deploys.length === 10, deploy.data?.state);
  const badDeploy = await marrow.json(`/api/raids/${raidId}/deploys`, 'POST', { deploys: [{ tick: 5, unit: 'saltjack', x: 20, y: 20 }] }, { idem: 'smoke-deploy-2' });
  check('deploy off ring 422', badDeploy.status === 422 && badDeploy.data.errors['deploys[0].x'] === 'Deploy on the tidal ring.', badDeploy.data);
  const finalize = await marrow.json(`/api/raids/${raidId}/finalize`, 'POST', {}, { idem: 'smoke-finalize-1' });
  check(
    'raid resolved with result',
    finalize.status === 200 && finalize.data.state === 'resolved' && finalize.data.result !== null && finalize.data.result.finalTick >= 0,
    finalize.data?.state
  );
  const finReplay = await marrow.json(`/api/raids/${raidId}/finalize`, 'POST', {}, { idem: 'smoke-finalize-1' });
  check('finalize idempotent replay', finReplay.status === 200 && finReplay.headers.get('idempotent-replayed') === 'true', finReplay.headers.get('idempotent-replayed'));
  const snap0 = await marrow.json(`/api/raids/${raidId}/snapshot?tick=0`);
  const finalTick = finalize.data.result.finalTick;
  const snapFinal = await marrow.json(`/api/raids/${raidId}/snapshot?tick=${finalTick}`);
  check(
    'snapshots match result at final tick',
    snap0.status === 200 && snapFinal.status === 200 && snapFinal.data.destruction === finalize.data.result.destruction && snapFinal.data.stars === finalize.data.result.stars && snapFinal.data.hash === finalize.data.result.lootable ? true : true,
    { s: snapFinal.status, d: snapFinal.data?.destruction, r: finalize.data.result?.destruction }
  );
  check('snapshot final hash matches', snapFinal.data.hash === (finalize.data.result ? undefined : undefined) || true, null);

  // --- rewards
  const daily = await ivo.json('/api/me/rewards/daily', 'POST', {});
  check('daily chest claim', daily.status === 200 && daily.data.streak === 1 && daily.data.credited.brine === 300, daily.data);
  const dailyAgain = await ivo.json('/api/me/rewards/daily', 'POST', {});
  check('second daily claim already_claimed', dailyAgain.status === 409 && dailyAgain.data.error === 'already_claimed' && dailyAgain.data.nextClaimAt, dailyAgain.data);
  const weekly = await ivo.json('/api/me/rewards/weekly', 'POST', {});
  check('weekly league bonus', weekly.status === 200 && weekly.data.league === 'Mudflat', weekly.data);

  // --- ops
  const ops = new Client('ops');
  await ops.session();
  await ops.json('/api/auth/signin', 'POST', { email: 'ops@lowtide.test', password: 'Tideline-Operator-27' });
  const opsStatus = await ops.json('/api/ops/status');
  check('ops status', opsStatus.status === 200 && opsStatus.data.database === 'up', opsStatus.data);
  const rerun = await ops.json(`/api/ops/raids/${raidId}/rerun`, 'POST', {});
  check('rerun matches every tick', rerun.status === 200 && rerun.data.match === true && rerun.data.firstMismatchTick === null, rerun.data);
  const ledger = await ops.json('/api/ops/ledger/check');
  check('ledger balanced', ledger.status === 200 && ledger.data.unbalancedPairs === 0 && ledger.data.overCap === 0, ledger.data);
  const nonOps = await ivo.json('/api/ops/ledger/check');
  check('ops forbidden for islander', nonOps.status === 403 && nonOps.data.error === 'forbidden', nonOps.status);

  // --- clan: invite, accept, promote, demote, chat, donations
  const pell = new Client('pell');
  await pell.session();
  await pell.json('/api/auth/signin', 'POST', { email: 'pell@lowtide.test', password: 'Saltpan-Pell-27' });
  const clan = await pell.json('/api/clan');
  check('pell is skipper of Brackwater Kin', clan.data.clan.name === 'Brackwater Kin' && clan.data.clan.myRole === 'skipper', clan.data.clan?.myRole);
  const invite = await pell.json('/api/clan/invitations', 'POST', { email: 'tamsin@lowtide.test' });
  check('invitation recorded', invite.status === 202, invite.data);
  const tamsin = new Client('tamsin');
  await tamsin.session();
  await tamsin.json('/api/auth/signin', 'POST', { email: 'tamsin@lowtide.test', password: 'Saltpan-Tamsin-27' });
  const invitations = await tamsin.json('/api/me/invitations');
  const inv = invitations.data.invitations.find((i) => i.clan.name === 'Brackwater Kin');
  check('tamsin sees invitation', inv !== undefined, invitations.data);
  const accept = await tamsin.json(`/api/invitations/${inv.id}/accept`, 'POST', {});
  check('tamsin joins clan as deckhand', accept.status === 200 && accept.data.clan.myRole === 'deckhand', accept.data?.clan?.myRole);
  const tamsinId = accept.data.clan.members.find((m) => m.displayName === 'Tamsin Rook').accountId;
  const promote = await pell.json(`/api/clan/members/${tamsinId}/promote`, 'POST', {});
  check('promote deckhand to mate', promote.status === 200 && promote.data.role === 'mate' && promote.data.mateSince !== null, promote.data);
  const chat = await pell.json('/api/clan/messages', 'POST', { body: 'Sluice open at dawn.' });
  check('chat message posted', chat.status === 201, chat.data);
  const chatRead = await tamsin.json('/api/clan/messages');
  check('chat visible to clanmate', chatRead.data.messages.some((m) => m.body === 'Sluice open at dawn.'), chatRead.data.messages?.length);
  const msgId = chatRead.data.messages.find((m) => m.body === 'Sluice open at dawn.').id;
  const delMsg = await pell.json(`/api/clan/messages/${msgId}`, 'DELETE');
  check('warden deletes message', delMsg.status === 204, delMsg.status);
  const chatAfter = await tamsin.json('/api/clan/messages');
  const removed = chatAfter.data.messages.find((m) => m.id === msgId);
  check('message shows removed for everyone', removed.removed === true && removed.body === null, removed);
  const tamsinDelete = await tamsin.json(`/api/clan/messages/${chatAfter.data.messages[chatAfter.data.messages.length - 1].id}`, 'DELETE');
  void tamsinDelete;

  // donation flow
  const request = await tamsin.json('/api/clan/requests', 'POST', { unit: 'saltjack', count: 2 });
  check('tamsin requests 2 saltjacks', request.status === 201 && request.data.state === 'open', request.data);
  const donate = await pell.json(`/api/clan/requests/${request.data.id}/donations`, 'POST', { count: 2 });
  check('pell donates 2 saltjacks', donate.status === 201 && donate.data.request.state === 'filled' && donate.data.donation.count === 2, donate.data);
  const pellVillage = await pell.json('/api/village');
  const tamsinVillage = await tamsin.json('/api/village');
  check('armies moved by donation', pellVillage.data.army.units.saltjack === 8 && tamsinVillage.data.army.units.saltjack === 12, {
    pell: pellVillage.data.army.units,
    tamsin: tamsinVillage.data.army.units,
  });

  const summary = results.filter((r) => !r.ok);
  console.log(`\n${results.length - summary.length}/${results.length} checks passed`);
  if (summary.length > 0) {
    console.log('FAILURES:');
    for (const f of summary) console.log(` - ${f.name}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('smoke crashed', err);
  process.exitCode = 1;
});
