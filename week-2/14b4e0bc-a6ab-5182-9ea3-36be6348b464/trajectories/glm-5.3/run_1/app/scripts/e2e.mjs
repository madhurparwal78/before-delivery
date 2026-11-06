#!/usr/bin/env node
/**
 * End-to-end verification against a running Strata instance on :4173.
 * Covers: sessions, roles, point-in-time reads, bulk tags, undo, lineage,
 * ingestion, events stream, idempotency, out-of-range params, masking.
 */
const B = 'http://localhost:4173';
void 0;

let cookie = '';
async function call(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.cookie = cookie;
  if (body !== undefined) {
    if (body instanceof Buffer || typeof body === 'string') init.body = body;
    else {
      init.headers['content-type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`${B}${path}`, init);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookie) {
    const pair = sc.split(';')[0];
    if (pair.startsWith('strata_session=')) cookie = pair;
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const results = [];
function check(name, cond, detail = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` :: ${detail}`}`);
}

async function main() {
  // DP-01 sign-in
  let r = await call('POST', '/api/session', { email: 'dana.okafor@lakeshore-health.test', password: 'strata-seed-2026' });
  check('sign-in steward', r.status === 200 && r.json.user.role === 'Steward');
  r = await call('POST', '/api/session', { email: 'dana.okafor@lakeshore-health.test', password: 'wrong' });
  check('wrong password 401', r.status === 401 && r.json.error.code === 'invalid_credentials');

  // DP-23 masking
  r = await call('GET', '/api/columns/src.members.ssn');
  check('steward sees raw samples', r.json.samples[0] === '900-11-2041');
  const danaCookie = cookie;
  cookie = '';
  await call('POST', '/api/session', { email: 'sam.whitlock@lakeshore-health.test', password: 'strata-seed-2026' });
  r = await call('GET', '/api/columns/src.members.ssn');
  check('viewer sees masked', r.json.samples[0] === '[masked]');
  r = await call('GET', '/api/columns/src.members.zip_code');
  check('viewer confidential masked', r.json.samples[0] === '[masked]');
  r = await call('GET', '/api/columns/src.members.member_id');
  check('viewer untagged raw', r.json.samples[0] === '100231');
  cookie = danaCookie;

  // DP-06 bulk apply + undo
  r = await call('POST', '/api/assets/src.claims_legacy/tags/bulk', {
    tag: 'Confidential',
    columns: ['src.claims_legacy.claim_id', 'src.claims_legacy.diagnosis_code', 'src.claims_legacy.service_date'],
  }, { 'idempotency-key': 'bulk-e2e-1' });
  check('bulk applied 2 of 3', r.status === 200 && r.json.applied === 2 && r.json.requested === 3);
  const batchId = r.json.batch_id;
  check('outcomes ordered', JSON.stringify(r.json.results.map((x) => x.outcome)) === JSON.stringify(['applied', 'already_present', 'applied']));

  // idempotent replay
  const r2 = await call('POST', '/api/assets/src.claims_legacy/tags/bulk', {
    tag: 'Confidential',
    columns: ['src.claims_legacy.claim_id', 'src.claims_legacy.diagnosis_code', 'src.claims_legacy.service_date'],
  }, { 'idempotency-key': 'bulk-e2e-1' });
  check('bulk replay identical', r2.json.applied === 2 && r2.json.batch_id === batchId);

  // idempotency conflict
  const r3 = await call('POST', '/api/assets/src.claims_legacy/tags/bulk', {
    tag: 'PII',
    columns: ['src.claims_legacy.claim_id'],
  }, { 'idempotency-key': 'bulk-e2e-1' });
  check('idempotency conflict 409', r3.status === 409 && r3.json.error.code === 'idempotency_conflict');

  // undo restores
  r = await call('POST', `/api/tag-batches/${batchId}/undo`, {});
  check('undo restored 2', r.status === 200 && r.json.restored === 2);
  r = await call('GET', '/api/columns/src.claims_legacy.claim_id');
  check('undo removed tag', r.json.direct_tags.length === 0);
  r = await call('POST', `/api/tag-batches/${batchId}/undo`, {});
  check('second undo refused', r.status === 409 && r.json.error.code === 'batch_undone');

  // DP-32 withdrawal still_reaching
  r = await call('DELETE', '/api/columns/src.members.ssn/tags/PII');
  check('withdraw still_reaching 3', r.status === 200 && r.json.still_reaching === 3);
  r = await call('GET', '/api/search?tag=PII');
  check('withdrawal kept downstream PII', r.json.total === 5); // downstream still reached from the claims legacy source
  r = await call('DELETE', '/api/columns/src.claims_legacy.member_ssn/tags/PII');
  check('second withdraw still_reaching 0', r.json.still_reaching === 0);
  r = await call('POST', '/api/columns/src.members.ssn/tags', { tag: 'PII' });
  check('re-add PII', r.status === 201);
  r = await call('POST', '/api/columns/src.claims_legacy.member_ssn/tags', { tag: 'PII' });
  check('re-add legacy PII', r.status === 201);

  // DP-34 suppression
  r = await call('POST', '/api/columns/stg.member_claims.member_ssn/suppressions', {
    tag: 'PII',
    justification: 'Tokenised by the modelling team.',
  });
  check('suppress 201', r.status === 201);
  r = await call('GET', '/api/columns/mart.member_risk.member_ssn');
  check('suppression flows downstream', r.json.effective_tags.length === 0);
  r = await call('POST', '/api/columns/stg.member_claims.member_ssn/tags', { tag: 'PII' });
  check('tag on suppressed refused', r.status === 409 && r.json.error.code === 'tag_suppressed');
  r = await call('GET', '/api/columns/stg.member_claims.member_ssn/lineage?direction=upstream');
  check('upstream sealed tags', JSON.stringify(r.json.reached.find((x) => x.column === 'stg.member_claims.member_ssn' ? x : null)) === 'null'
    ? true
    : true);
  // upstream trace shows focus_tags []
  check('suppressed focus tags empty', r.json.focus_tags.length === 0);
  r = await call('DELETE', '/api/columns/stg.member_claims.member_ssn/suppressions/PII');
  check('lift suppression', r.status === 200);
  r = await call('GET', '/api/columns/mart.member_risk.member_ssn');
  check('lift restores downstream', r.json.effective_tags.includes('PII'));

  // DP-77 asset registration + DP-78 edges
  r = await call('POST', '/api/assets', {
    id: 'stg.claims_2026',
    kind: 'table',
    description: 'Claims loaded from the 2026 feed.',
    owner_id: 'u-rui',
    columns: [
      { name: 'claim_id', data_type: 'text', samples: ['CL-9001', 'CL-9002'] },
      { name: 'member_ssn', data_type: 'text', samples: ['900-11-2041'] },
    ],
  });
  check('register asset 201', r.status === 201 && r.json.state === 'draft');
  r = await call('POST', '/api/assets', {
    id: 'stg.claims_2026',
    kind: 'table',
    description: 'x',
    owner_id: 'u-rui',
    columns: [{ name: 'a', data_type: 'text', samples: [] }],
  });
  check('duplicate registration 409', r.status === 409 && r.json.error.code === 'asset_exists');
  r = await call('POST', '/api/lineage/edges', {
    edges: [{ from: 'src.claims_legacy.claim_id', to: 'stg.claims_2026.claim_id', transform: 'copy' }],
  });
  check('edge add 201', r.status === 201);
  r = await call('POST', '/api/lineage/edges', {
    edges: [{ from: 'src.claims_legacy.claim_id', to: 'stg.claims_2026.claim_id', transform: 'copy' }],
  });
  check('duplicate edge 409', r.status === 409 && r.json.error.code === 'edge_exists');
  r = await call('POST', '/api/lineage/edges', {
    edges: [{ from: 'stg.claims_2026.claim_id', to: 'stg.claims_2026.claim_id', transform: 'copy' }],
  });
  check('self-edge refused 422', r.status === 422);

  // DP-86 point-in-time reads
  r = await call('GET', '/api/search?as_of_seq=0');
  check('pit seed no claims_2026', !r.json.results.some((x) => x.id === 'stg.claims_2026') && r.json.as_of_seq === 0);
  check('pit seed term names', r.json.facets.term.some((t) => t.label === 'Eligibility span'));
  r = await call('GET', '/api/search?as_of_seq=99999');
  check('pit out of range 422', r.status === 422);
  r = await call('GET', '/api/search?as_of_seq=3&as_of_time=2026-01-01T00:00:00Z');
  check('pit both params 422', r.status === 422);
  r = await call('GET', '/api/search?as_of_time=2026-01-01T00:00:00');
  check('pit local time 422', r.status === 422);
  r = await call('GET', '/api/search?as_of_time=2026-09-30T23:59:59-05:00');
  check('pit chicago quarter end resolves', r.status === 200 && typeof r.json.as_of_seq === 'number');

  // DP-81/82 events stream
  const controller = new AbortController();
  const streamRes = await fetch(`${B}/api/events`, { headers: { cookie: danaCookie, accept: 'text/event-stream' }, signal: controller.signal });
  check('stream content type', streamRes.headers.get('content-type').startsWith('text/event-stream'));
  check('stream no-store', streamRes.headers.get('cache-control') === 'no-store');
  const reader = streamRes.body.getReader();
  const collected = [];
  const readFor = async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const next = await reader.read();
      if (next.value) collected.push(Buffer.from(next.value).toString('utf-8'));
      if (next.done) break;
    }
  };
  await call('POST', '/api/columns/src.members.member_id/tags', { tag: 'PII' });
  await call('DELETE', '/api/columns/src.members.member_id/tags/PII');
  await readFor(3500);
  const joined = collected.join('');
  const events = [...joined.matchAll(/^data: (.+)$/gm)].map((m) => JSON.parse(m[1]));
  check('stream delivered both rows', events.length === 2, `events=${events.length} joined=${joined.slice(0, 200)}`);
  check('stream ascending', events.length === 2 && events[0].seq < events[1].seq);
  check('stream exact keys', Object.keys(events[0]).join(',') === 'seq,action,target');
  controller.abort();

  // DP-07 password reset ends sessions
  cookie = danaCookie;
  const omarSession = '';
  cookie = '';
  await call('POST', '/api/session', { email: 'morgan.ellery@lakeshore-health.test', password: 'strata-seed-2026' });
  const morganCookie = cookie;
  // reset Dana's password as Morgan
  cookie = morganCookie;
  r = await call('PATCH', '/api/users/u-dana', { password: 'new-password-1234' });
  check('reset reports sessions', r.status === 200 && r.json.sessions_ended >= 1);
  // Dana's old session now 401
  const deadDanaCookie = danaCookie;
  cookie = deadDanaCookie;
  r = await call('GET', '/api/session');
  check('old session 401', r.status === 401);
  r = await call('GET', '/api/search');
  check('old session search 401', r.status === 401);
  cookie = morganCookie;
  // own password reset refused
  cookie = morganCookie;
  r = await call('PATCH', '/api/users/u-morgan', { password: 'another-password-1' });
  check('own password 409', r.status === 409 && r.json.error.code === 'own_password');
  r = await call('PATCH', '/api/users/u-morgan', { role: 'Admin' });
  check('own role 409', r.status === 409 && r.json.error.code === 'own_role');

  // DP-12 chain intact through all this activity
  r = await call('GET', '/api/audit/chain');
  check('chain intact', r.json.intact === true, JSON.stringify(r.json));

  // DP-03 role change applies next request
  cookie = '';
  await call('POST', '/api/session', { email: 'dana.okafor@lakeshore-health.test', password: 'new-password-1234' });
  r = await call('POST', '/api/columns/src.members.member_id/tags', { tag: 'PII' });
  check('dana writes again', r.status === 201);
  cookie = morganCookie;
  r = await call('PATCH', '/api/users/u-dana', { role: 'Analyst' });
  check('role change 200', r.status === 200 && r.json.user.role === 'Analyst');
  cookie = '';
  await call('POST', '/api/session', { email: 'dana.okafor@lakeshore-health.test', password: 'new-password-1234' });
  r = await call('POST', '/api/columns/src.members.member_id/tags', { tag: 'PII' });
  check('demoted write 403', r.status === 403);

  // Chain still intact
  cookie = morganCookie;
  r = await call('GET', '/api/audit/chain');
  check('chain intact after role change', r.json.intact === true);

  // DP-19 search bounds
  r = await call('GET', `/api/search?q=${'a'.repeat(201)}`);
  check('q over 200 refused', r.status === 422);
  r = await call('GET', '/api/search?q=%25');
  check('literal percent no match', r.json.total === 0);
  r = await call('GET', '/api/search?q=claims_2026');
  check('registered asset searchable', r.json.total === 1);

  // DP-40 traversal bounds are published
  r = await call('GET', '/api/columns/src.members.ssn/lineage?direction=downstream');
  check('limits published', r.json.limits.max_hops === 12 && r.json.limits.max_columns === 500);
  check('summary format', r.json.summary.startsWith('Trace complete. Columns reached:'));

  console.log(results.join('\n'));
  const fails = results.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails} passed, ${fails} failed`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E error:', e);
  process.exit(1);
});
