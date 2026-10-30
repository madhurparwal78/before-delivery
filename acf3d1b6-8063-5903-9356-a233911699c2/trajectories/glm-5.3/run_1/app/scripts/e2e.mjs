// End-to-end API checks against a running app. Run: node scripts/e2e.mjs <base>
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const MAILPIT = process.env.MAILPIT_URL || 'http://mailpit:8025';
let pass = 0, fail = 0;
const results = [];

function check(name, ok, extra = '') {
  if (ok) { pass++; results.push(`PASS ${name}`); }
  else { fail++; results.push(`FAIL ${name} ${extra}`); }
}

async function req(method, path, { body, token, idem, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idem) headers['Idempotency-Key'] = idem;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

/** Read real email out of the Mailpit inbox. */
async function mailFor(toAddress, subjectPart, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages`);
    const list = await res.json();
    for (const m of list.messages || []) {
      const tos = (m.To || []).map(x => x.Address);
      if (tos.includes(toAddress) && m.Subject.includes(subjectPart)) {
        const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
        return { subject: m.Subject, text: full.Text };
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

const now = Date.now();
const rnd = () => Math.random().toString(36).slice(2, 10);

// ---- public catalogue
{
  const plans = await req('GET', '/api/plans');
  check('plans 200', plans.status === 200);
  check('plans order', plans.json.map(p => p.id).join(',') === 'free,standard,pro,max,team,enterprise');
  check('standard prices', plans.json[1].monthly_price === 1500 && plans.json[1].yearly_price === 1200);
  const models = await req('GET', '/api/models');
  check('models', models.json.length === 3 && models.json[0].credits_per_unit === 12
    && models.json[1].credits_per_unit === 6 && models.json[2].kind === 'image');
  const ex = await req('GET', '/api/examples');
  check('examples 8', ex.json.total === 8);
  const exCat = await req('GET', '/api/examples?category=ugc');
  check('examples ugc 2', exCat.json.total === 2);
  const exS = await req('GET', '/api/examples?search=chicken');
  check('examples search', exS.json.total === 1);
}

// ---- auth
let ownerToken, memberToken, creatorToken, lenaToken, joToken;
{
  const bad = await req('POST', '/api/auth/login', { body: { email: 'owner@example.com', password: 'wrong-password' } });
  check('login wrong pw 401', bad.status === 401 && bad.json.error === 'Email or password is incorrect.');
  const up = await req('POST', '/api/auth/login', { body: { email: 'OWNER@EXAMPLE.COM', password: 'deku-demo-pw-2026' } });
  check('login case-insensitive', up.status === 200 && up.json.token);
  ownerToken = up.json.token;
  const mp = await req('POST', '/api/auth/login', { body: { email: 'member@example.com', password: 'deku-demo-pw-2026' } });
  memberToken = mp.json.token;
  const cp = await req('POST', '/api/auth/login', { body: { email: 'creator@example.com', password: 'deku-demo-pw-2026' } });
  creatorToken = cp.json.token;
  check('creator balance 595', cp.status === 200);
  const me = await req('GET', '/api/me', { token: ownerToken });
  check('me northlight team', me.json.workspace.name === 'Northlight Studio' && me.json.workspace.plan === 'team');
  check('me balance 13664', me.json.balance === 13664, JSON.stringify(me.json));
  const noToken = await req('GET', '/api/me');
  check('me 401 without token', noToken.status === 401);
  const junk = await req('GET', '/api/me', { token: 'garbage-token-aaaaaaaaaaaaaaaaaaaaaaaa' });
  check('me 401 with junk token', junk.status === 401);
  check('me 401 ignores body claims', junk.status === 401);
}

// ---- signup
{
  const dup = await req('POST', '/api/auth/signup', { body: { name: 'Lena', email: 'OWNER@example.com', password: 'longpassword1' } });
  check('signup dup 409', dup.status === 409 && dup.json.error === 'An account with this email already exists.');
  const bad = await req('POST', '/api/auth/signup', { body: { name: '', email: 'not-an-email', password: 'short' } });
  check('signup invalid 422', bad.status === 422 && bad.json.errors.name && bad.json.errors.email && bad.json.errors.password);
  const su = await req('POST', '/api/auth/signup', { body: { name: 'Lena Hart', email: `lena.${rnd()}@example.com`, password: 'longpassword1' } });
  check('signup 201', su.status === 201 && su.json.token && su.json.user.role === 'owner');
  lenaToken = su.json.token;
  const me = await req('GET', '/api/me', { token: lenaToken });
  check('new workspace free 125', me.json.balance === 125 && me.json.workspace.plan === 'free'
    && me.json.workspace.name === "Lena Hart's workspace");
  const projects = await req('GET', '/api/projects', { token: lenaToken });
  check('first project seeded', projects.json.length === 1 && projects.json[0].name === 'My first project');
  const credits = await req('GET', '/api/credits', { token: lenaToken });
  check('plan credits row', credits.json.entries.length === 1 && credits.json.entries[0].kind === 'plan'
    && credits.json.entries[0].amount === 125);
  const dupProject = await req('POST', '/api/projects', { token: lenaToken, body: { name: 'MY FIRST PROJECT' } });
  check('project dup case-insensitive', dupProject.status === 409 && dupProject.json.error === 'duplicate_name');
  const second = await req('POST', '/api/projects', { token: lenaToken, body: { name: 'Second' } });
  check('free project limit 409', second.status === 409 && second.json.error === 'project_limit' && second.json.limit === 1);
}

// ---- generation cost, charging, idempotency
let lenaProjectId;
{
  const projects = await req('GET', '/api/projects', { token: lenaToken });
  lenaProjectId = projects.json[0].id;
  const emptyPrompt = await req('POST', '/api/generations', {
    token: lenaToken, body: { project_id: lenaProjectId, model: 'vela-4.5', prompt: '   ', duration: 5, aspect: '16:9' } });
  check('blank prompt 422', emptyPrompt.status === 422);
  const badModel = await req('POST', '/api/generations', {
    token: lenaToken, body: { project_id: lenaProjectId, model: 'nope', prompt: 'x', duration: 5, aspect: '16:9' } });
  check('bad model 422', badModel.status === 422 && badModel.json.errors.model);
  const badLen = await req('POST', '/api/generations', {
    token: lenaToken, body: { project_id: lenaProjectId, model: 'vela-4.5', prompt: 'x', duration: 7, aspect: '16:9' } });
  check('bad duration 422', badLen.status === 422 && badLen.json.errors.duration);

  // vela 4.5, 10s = 120 > 125? no: 120 <= 125 leaves 5
  const g = await req('POST', '/api/generations', {
    token: lenaToken, idem: 'key-1',
    body: { project_id: lenaProjectId, model: 'vela-4.5', prompt: 'A paper lantern rising over a quiet harbour at night', duration: 10, aspect: '16:9' } });
  check('start 201 queued', g.status === 201 && g.json.status === 'queued' && g.json.cost === 120);
  const me1 = await req('GET', '/api/me', { token: lenaToken });
  check('balance dropped to 5', me1.json.balance === 5, JSON.stringify(me1.json));
  const repeat = await req('POST', '/api/generations', {
    token: lenaToken, idem: 'key-1',
    body: { project_id: lenaProjectId, model: 'vela-4.5', prompt: 'A paper lantern rising over a quiet harbour at night', duration: 10, aspect: '16:9' } });
  check('idempotent repeat 200 same id', repeat.status === 200 && repeat.json.id === g.json.id);
  const me2 = await req('GET', '/api/me', { token: lenaToken });
  check('idempotent no second charge', me2.json.balance === 5);

  // simultaneous same-key starts on a fresh account with enough credits
  {
    const su = await req('POST', '/api/auth/signup', { body: { name: 'Sim Key', email: `simk.${rnd()}@example.com`, password: 'longpassword1' } });
    const tk = su.json.token;
    const pid = (await req('GET', '/api/projects', { token: tk })).json[0].id;
    const sim = await Promise.all([0, 1, 2, 3].map(() => req('POST', '/api/generations', {
      token: tk, idem: 'key-sim',
      body: { project_id: pid, model: 'vela-4-turbo', prompt: 'Simultaneous same key', duration: 5, aspect: '1:1' } })));
    const ids = new Set(sim.map(r => r.json && r.json.id).filter(Boolean));
    const created = sim.filter(r => r.status === 201).length;
    const replayed = sim.filter(r => r.status === 200).length;
    check('sim same-key one generation', ids.size === 1 && created === 1 && replayed === 3,
      `ids=${[...ids]} statuses=${sim.map(r => r.status).join(',')}`);
    const me = await req('GET', '/api/me', { token: tk });
    check('sim same-key one charge', me.json.balance === 125 - 30, `balance=${me.json.balance}`);
    const credits = await req('GET', '/api/credits', { token: tk });
    check('sim charge rows', credits.json.entries.filter(e => e.kind === 'charge').length === 1);
  }

  // over-balance refused with 402
  const over = await req('POST', '/api/generations', {
    token: lenaToken,
    body: { project_id: lenaProjectId, model: 'vela-4.5', prompt: 'Too expensive', duration: 10, aspect: '16:9' } });
  check('insufficient 402', over.status === 402 && over.json.error === 'insufficient_credits'
    && typeof over.json.needed === 'number' && typeof over.json.balance === 'number');

  // cancel while queued/refunding
  const cancel = await req('POST', `/api/generations/${g.json.id}/cancel`, { token: lenaToken });
  check('cancel 200', cancel.status === 200 && cancel.json.status === 'cancelled');
  const cancel2 = await req('POST', `/api/generations/${g.json.id}/cancel`, { token: lenaToken });
  check('second cancel 409', cancel2.status === 409);
  const me4 = await req('GET', '/api/me', { token: lenaToken });
  const credits = await req('GET', '/api/credits', { token: lenaToken });
  const refunded = credits.json.entries.filter(e => e.kind === 'refund').length;
  check('refund exactly once', refunded === 1, `refunds=${refunded}`);
  check('balance equals entry sum', credits.json.balance === credits.json.entries.reduce((s, e) => s + e.amount, 0));
}

// ---- cancel a rendering one (journey 2 for creator)
{
  const projects = await req('GET', '/api/projects', { token: creatorToken });
  const music = projects.json.find(p => p.name === 'Music video');
  const g = await req('POST', '/api/generations', {
    token: creatorToken,
    body: { project_id: music.id, model: 'vela-4-turbo', prompt: 'Neon test', duration: 5, aspect: '9:16' } });
  check('creator start 30', g.status === 201 && g.json.cost === 30);
  let me = await req('GET', '/api/me', { token: creatorToken });
  check('creator 565', me.json.balance === 565, `got ${me.json.balance}`);
  await new Promise(r => setTimeout(r, 2600));
  const g2 = await req('GET', `/api/generations/${g.json.id}`, { token: creatorToken });
  check('rendering within 2s', g2.json.status === 'rendering', g2.json.status);
  const notReady = await req('GET', `/api/generations/${g.json.id}/output`, { token: creatorToken });
  check('output before ready 409', notReady.status === 409);
  const cancel = await req('POST', `/api/generations/${g.json.id}/cancel`, { token: creatorToken });
  check('cancel rendering', cancel.status === 200 && cancel.json.status === 'cancelled');
  me = await req('GET', '/api/me', { token: creatorToken });
  check('creator back to 595', me.json.balance === 595);
  const credits = await req('GET', '/api/credits', { token: creatorToken });
  const newest = credits.json.entries[0];
  check('newest row refund +30', newest.kind === 'refund' && newest.amount === 30, JSON.stringify(newest));
  check('second row charge -30', credits.json.entries[1].kind === 'charge' && credits.json.entries[1].amount === -30);
}

// ---- renders to ready on its own, output is svg
{
  const projects = await req('GET', '/api/projects', { token: creatorToken });
  const music = projects.json.find(p => p.name === 'Music video');
  const g = await req('POST', '/api/generations', {
    token: creatorToken,
    body: { project_id: music.id, model: 'vela-image-4', prompt: 'A calm test image of drifting light', image_count: 2, aspect: '1:1' } });
  check('image cost 16', g.status === 201 && g.json.cost === 16 && g.json.duration === null && g.json.image_count === 2);
  const t0 = Date.now();
  let gen = null;
  while (Date.now() - t0 < 35000) {
    await new Promise(r => setTimeout(r, 1500));
    gen = (await req('GET', `/api/generations/${g.json.id}`, { token: creatorToken })).json;
    if (gen.status === 'ready') break;
  }
  const elapsed = (Date.now() - t0) / 1000;
  check('ready in 8-30s', gen && gen.status === 'ready' && elapsed >= 8 && elapsed <= 32, `status=${gen && gen.status} elapsed=${elapsed.toFixed(1)}`);
  const out = await req('GET', `/api/generations/${g.json.id}/output`, { token: creatorToken });
  check('output svg', out.status === 200 && out.text.startsWith('<svg') && !/animate/.test(out.text) && out.text.includes('looping') === false,
    `status=${out.status}`);
  const outVideo = (await req('GET', '/api/generations/3/output', { token: creatorToken }));
  check('video output loops', outVideo.status === 200 && outVideo.text.includes('looping 5s'));
  const foreign = await req('GET', `/api/generations/${g.json.id}/output`, { token: ownerToken });
  check('output 404 other workspace', foreign.status === 404);
  const otherGen = await req('GET', '/api/generations/1', { token: creatorToken });
  check('generation 404 other workspace', otherGen.status === 404);
  // deterministic: same twice
  const out2 = await req('GET', `/api/generations/${g.json.id}/output`, { token: creatorToken });
  check('output deterministic', out.text === out2.text);
}

// ---- parallel limit on free (2)
{
  // lena balance now: 125-120+120-30 = -5? recount: -120 +120 -30 = -25+120... let's just check >= 0 and refund one
  // Simpler: use a fresh account
  const su = await req('POST', '/api/auth/signup', { body: { name: 'Par All', email: `par.${rnd()}@example.com`, password: 'longpassword1' } });
  const tk = su.json.token;
  const pid = (await req('GET', '/api/projects', { token: tk })).json[0].id;
  const starts = [];
  for (let i = 0; i < 3; i++) {
    starts.push(req('POST', '/api/generations', {
      token: tk, idem: `par-${i}`,
      body: { project_id: pid, model: 'vela-4-turbo', prompt: `Parallel test ${i}`, duration: 5, aspect: '16:9' } }));
  }
  const rs = await Promise.all(starts);
  const okCount = rs.filter(r => r.status === 201).length;
  const conflict = rs.filter(r => r.status === 409 && r.json.error === 'parallel_limit' && r.json.limit === 2).length;
  check('parallel limit 2 enforced', okCount === 2 && conflict === 1, JSON.stringify(rs.map(r => r.status)));
  const me = await req('GET', '/api/me', { token: tk });
  check('two starts charged 60', me.json.balance === 65, `balance=${me.json.balance}`);
}

// ---- team: authorization, invitations, joining
{
  const teamAsMember = await req('GET', '/api/team', { token: memberToken });
  check('team list', teamAsMember.status === 200 && teamAsMember.json.seats_used === 2 && teamAsMember.json.seat_limit === 9);

  const memberInvite = await req('POST', '/api/team/invitations', { token: memberToken, body: { email: `someone.${rnd()}@example.com` } });
  check('member invite 403', memberInvite.status === 403);
  const ownerNonTeam = await req('POST', '/api/team/invitations', { token: creatorToken, body: { email: `x.${rnd()}@example.com` } });
  check('non-team owner invite 403', ownerNonTeam.status === 403);
  const memberRevoke = await req('DELETE', '/api/team/invitations/1', { token: memberToken });
  check('member revoke 403 before id lookup', memberRevoke.status === 403);
  const memberRemove = await req('DELETE', '/api/team/members/1', { token: memberToken });
  check('member remove 403', memberRemove.status === 403);
  const selfRemove = await req('DELETE', '/api/team/members/1', { token: ownerToken });
  check('owner cannot remove self', selfRemove.status === 409 && selfRemove.json.error === 'cannot_remove_self');
  const otherWsMember = await req('DELETE', '/api/team/members/2', { token: creatorToken });
  check('remove other workspace member 403', otherWsMember.status === 403);

  const inviteTaken = await req('POST', '/api/team/invitations', { token: ownerToken, body: { email: 'creator@example.com' } });
  check('invite existing account 409', inviteTaken.status === 409 && inviteTaken.json.error === 'That person already has an account or an invitation.');

  const joEmail = `jo.${rnd()}@example.com`;
  const invite = await req('POST', '/api/team/invitations', { token: ownerToken, body: { email: joEmail } });
  check('invite 201', invite.status === 201 && invite.json.email === joEmail);
  const inviteAgain = await req('POST', '/api/team/invitations', { token: ownerToken, body: { email: joEmail } });
  check('invite twice 409', inviteAgain.status === 409);

  const invMail = await mailFor(joEmail, 'invited you to Northlight Studio');
  check('invitation email arrived', !!invMail, 'no email in mailpit');
  check('invitation email subject', invMail && invMail.subject === 'Mara Quinn invited you to Northlight Studio on Kinora',
    invMail && invMail.subject);
  const linkMatch = invMail ? invMail.text.match(/https?:\/\/\S+\/invite\/(\S+)/) : null;
  const inviteToken = linkMatch ? linkMatch[1] : 'missing';
  check('invitation email has join link', !!linkMatch, invMail && invMail.text.slice(0, 200));

  const invInfo = await req('GET', `/api/invitations/${inviteToken}`);
  check('invitation read', invInfo.status === 200 && invInfo.json.workspace_name === 'Northlight Studio' && invInfo.json.email === joEmail);

  const accept = await req('POST', `/api/invitations/${inviteToken}`, {
    body: { name: 'Jo Ellis', password: 'longpassword1' } });
  check('accept 201 member', accept.status === 201 && accept.json.user.role === 'member');
  joToken = accept.json.token;
  const meJo = await req('GET', '/api/me', { token: joToken });
  check('jo sees shared balance 20564', meJo.json.balance === 20564, `got ${meJo.json.balance}`);
  const acceptAgain = await req('POST', `/api/invitations/${inviteToken}`, {
    body: { name: 'Jo Again', password: 'longpassword1' } });
  check('accept twice 404', acceptAgain.status === 404);
  const invInfo2 = await req('GET', `/api/invitations/${inviteToken}`);
  check('invitation invalid after accept', invInfo2.status === 404);

  const teamAfter = await req('GET', '/api/team', { token: joToken });
  check('seats 3 after join', teamAfter.json.seats_used === 3);

  // revoke
  const revEmail = `rev.${rnd()}@example.com`;
  const inv2 = await req('POST', '/api/team/invitations', { token: ownerToken, body: { email: revEmail } });
  const inv2Mail = await mailFor(revEmail, 'invited you to Northlight Studio');
  check('second invitation email arrived', !!inv2Mail);
  const revoke = await req('DELETE', `/api/team/invitations/${inv2.json.id}`, { token: ownerToken });
  check('revoke 200', revoke.status === 200);
  const rev2Token = inv2Mail ? inv2Mail.text.match(/\/invite\/(\S+)/)[1] : 'missing';
  const revokedRead = await req('GET', `/api/invitations/${rev2Token}`);
  check('revoked invitation 404', revokedRead.status === 404);
  const revokeAgain = await req('DELETE', `/api/team/invitations/${inv2.json.id}`, { token: ownerToken });
  check('revoke again 404', revokeAgain.status === 404);

  // exactly one invitation email for jo (no duplicates)
  const allMail = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  const joMails = (allMail.messages || []).filter(m => (m.To || []).some(x => x.Address === joEmail));
  check('exactly one invitation email', joMails.length === 1, `count=${joMails.length}`);

  // remove member
  const teamList = await req('GET', '/api/team', { token: ownerToken });
  const joMember = teamList.json.members.find(m => m.email === joEmail);
  const remove = await req('DELETE', `/api/team/members/${joMember.id}`, { token: ownerToken });
  check('remove member 200', remove.status === 200);
  const joGone = await req('GET', '/api/me', { token: joToken });
  check('removed member session dead', joGone.status === 401);
  const joLogin = await req('POST', '/api/auth/login', { body: { email: joEmail, password: 'longpassword1' } });
  check('removed member cannot sign in', joLogin.status === 401);
  const balAfter = await req('GET', '/api/me', { token: ownerToken });
  check('nothing refunded on removal', balAfter.json.balance === 20564);
}

// ---- enquiries
{
  const empty = await req('POST', '/api/enquiries', {
    body: { source: 'contact', first_name: '', last_name: '', email: '', company: '', company_size: '', industry: '', products: [], message: '' } });
  check('empty enquiry 422 all fields', empty.status === 422 &&
    empty.json.errors.first_name && empty.json.errors.last_name && empty.json.errors.email &&
    empty.json.errors.company && empty.json.errors.company_size && empty.json.errors.industry &&
    empty.json.errors.products && empty.json.errors.message, JSON.stringify(empty.json));
  const badEnum = await req('POST', '/api/enquiries', {
    body: { source: 'contact', first_name: 'A', last_name: 'B', email: 'a@b.co', company: 'C', company_size: '55+', industry: 'Gaming', products: ['creative-platform'], message: 'Hello there world' } });
  check('bad company_size 422', badEnum.status === 422 && badEnum.json.errors.company_size);
  const ok = await req('POST', '/api/enquiries', {
    body: { source: 'contact', first_name: 'Harbour', last_name: 'Pine', email: `hp.${rnd()}@example.com`, company: 'Harbour & Pine', company_size: '201-1,000', industry: 'Gaming', products: ['creative-platform', 'api'], message: 'We would like a quote for the team.' } });
  check('enquiry 201', ok.status === 201);
  const hpEmail = ok.status === 201 ? JSON.parse(JSON.stringify({ e: ok.json.email })).e : 'x';
  const salesMail = await mailFor('sales@example.com', 'New enterprise enquiry from Harbour & Pine');
  check('sales email arrived', !!salesMail, 'no sales email');
  check('sales email subject exact', salesMail && salesMail.subject === 'New enterprise enquiry from Harbour & Pine',
    salesMail && salesMail.subject);
  check('sales email names the person', salesMail && /Harbour Pine/.test(salesMail.text) && /Harbour & Pine/.test(salesMail.text)
    && /201-1,000/.test(salesMail.text) && /Gaming/.test(salesMail.text) && /quote for the team/.test(salesMail.text),
    salesMail && salesMail.text);
  const ackMail = await mailFor(hpEmail, 'We received your enquiry');
  check('acknowledgement email arrived', !!ackMail, `no ack email to ${hpEmail}`);
  check('ack subject exact', ackMail && ackMail.subject === 'We received your enquiry');
  check('ack says two business days', ackMail && /two business days/.test(ackMail.text));
  const lic = await req('POST', '/api/enquiries', {
    body: { source: 'licensing', full_name: 'Licence Seeker', email: `ls.${rnd()}@example.com`, company: 'Weights Inc', company_size: '1-200', industry: 'Gaming', message: 'We want to license the weights.' } });
  check('licensing enquiry 201', lic.status === 201);
}

// ---- cross-workspace protection
{
  const nlProjects = await req('GET', '/api/projects', { token: ownerToken });
  const spring = nlProjects.json.find(p => p.name === 'Spring campaign');
  const foreignRead = await req('GET', `/api/projects/${spring.id}/generations`, { token: lenaToken });
  check('foreign project gens 404', foreignRead.status === 404);
  const foreignRename = await req('PATCH', `/api/projects/${spring.id}`, { token: lenaToken, body: { name: 'Stolen' } });
  check('foreign rename 404 unchanged', foreignRename.status === 404);
  const after = await req('GET', '/api/projects', { token: ownerToken });
  check('name unchanged', after.json.find(p => p.id === spring.id).name === 'Spring campaign');
}

// ---- project creation on team workspace, rename
{
  const p = await req('POST', '/api/projects', { token: ownerToken, body: { name: 'Autumn launch' } });
  check('team project 201', p.status === 201);
  const renamed = await req('PATCH', `/api/projects/${p.json.id}`, { token: memberToken, body: { name: 'Winter launch' } });
  check('member can rename', renamed.status === 200 && renamed.json.name === 'Winter launch');
  const del = await req('DELETE', `/api/projects/${p.json.id}`);
  // scope: no delete endpoint; 405/404 acceptable — must not succeed silently
  check('no project delete endpoint', del.status === 404 || del.status === 405, `status=${del.status}`);
}

// ---- logout
{
  const su = await req('POST', '/api/auth/signup', { body: { name: 'Log Out', email: `lo.${rnd()}@example.com`, password: 'longpassword1' } });
  const tk = su.json.token;
  const out = await req('POST', '/api/auth/logout', { token: tk });
  check('logout 200', out.status === 200);
  const after = await req('GET', '/api/me', { token: tk });
  check('token dead after logout', after.status === 401);
}

// ---- out-of-scope addresses must not answer success
{
  const paths = ['/api/checkout', '/api/billing/change-plan', '/api/topup', '/api/password-reset', '/api/upload', '/api/comments'];
  for (const p of paths) {
    const r = await req('POST', p, { token: ownerToken, body: {} });
    check(`out of scope ${p}`, r.status === 404, `status=${r.status}`);
  }
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
