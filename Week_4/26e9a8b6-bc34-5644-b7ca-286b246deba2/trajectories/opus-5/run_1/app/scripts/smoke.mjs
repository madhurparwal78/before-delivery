/** Development smoke checks against a running server. */
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    process.stdout.write(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}\n`);
  }
}

class Session {
  constructor() {
    this.cookie = null;
  }

  async call(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (body !== undefined && body !== null) {
      if (body instanceof Uint8Array) {
        init.body = body;
        init.headers['content-type'] = headers['content-type'] ?? 'model/gltf-binary';
      } else {
        init.body = JSON.stringify(body);
        init.headers['content-type'] = 'application/json';
      }
    }
    if (this.cookie !== null) init.headers['cookie'] = this.cookie;
    const res = await fetch(`${BASE}${path}`, init);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie !== null) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  async signIn(email, password) {
    const out = await this.call('POST', '/api/session', { email, password });
    if (out.status !== 200) throw new Error(`sign-in failed: ${out.text}`);
    return out.json.user;
  }
}

const anon = new Session();

const health = await anon.call('GET', '/api/health');
check('health ok', health.status === 200 && health.json.status === 'ok', health.json);

const limits = await anon.call('GET', '/api/limits');
check('limits shape', limits.json.model_max_bytes === 20000000 && limits.json.step_text_max === 2000, limits.json);

const world = await anon.call('POST', '/api/grading/world', {});
check('world created', world.status === 201, world.text.slice(0, 300));
if (world.status !== 201) {
  process.stdout.write(`passed ${passed} failed ${failed}\n`);
  process.exit(1);
}
const w = world.json;
check('world people', !!w.author.email && !!w.newcomer.email && w.guides.public.slug.length > 0, w.author);

// --- reading JSON and seeded figures (DP-15..DP-19, seed data)
const publicRead = await anon.call('GET', `/api/guides/${w.guides.public.id}`);
check('public reading 200', publicRead.status === 200, publicRead.status);
const g = publicRead.json;
check('grinder totals', g.total_cost_text === '€21.30' && g.part_count === 9 && g.step_count === 5, {
  total: g.total_cost_text, parts: g.part_count, steps: g.step_count,
});
check('grinder published version 3', g.published_version === 3, g.published_version);
const costs = g.steps.map((s) => s.parts_cost_text);
check('running costs', JSON.stringify(costs) === JSON.stringify(['€0.00', '€0.00', '€0.00', '€18.90', '€21.30']), costs);
const titles = g.steps.map((s) => s.title);
check('step order v3', titles[1] === 'Free the upper burr' && titles[2] === 'Draw out the lower burr', titles);
const explodes = g.steps.map((s) => s.explode);
check('apart amounts', JSON.stringify(explodes) === JSON.stringify([0, 0.25, 0.5, 0.85, 0]), explodes);
check('callout per focus part', g.steps.every((s) => s.callouts.length === s.focus_parts.length), g.steps[2]);

// --- version compare (DP-56)
const cmp13 = await anon.call('GET', `/api/guides/${w.guides.public.id}/versions/compare?older=1&newer=3`);
const c = cmp13.json;
check('compare 1->3 added', c.added.length === 1 && c.added[0].title === 'Refit the chute and close up', c.added);
check('compare 1->3 removed', c.removed.length === 1 && c.removed[0].title === 'Unplug and empty the grinder', c.removed);
check('compare 1->3 moved', c.moved.length === 2 &&
  c.moved.some((m) => m.title === 'Free the upper burr') &&
  c.moved.some((m) => m.title === 'Draw out the lower burr'), c.moved);
check('compare 1->3 changed', c.changed.some((x) => x.title === 'Fit the new burr set' && x.fields.includes('text')), c.changed);
check('compare 1->3 difference', c.cost_difference === 490 && c.cost_difference_text === '+€4.90', c.cost_difference_text);
check('compare 1->3 part changes', c.part_changes.some((p) => p.part === 'Lower burr' && p.field === 'unit_price' && p.from === 1640 && p.to === 1890) &&
  c.part_changes.some((p) => p.part === 'Bean chute' && p.field === 'fitted_at' && p.from === null && p.to === 'Refit the chute and close up'), c.part_changes);

const cmp23 = (await anon.call('GET', `/api/guides/${w.guides.public.id}/versions/compare?older=2&newer=3`)).json;
check('compare 2->3 difference', cmp23.cost_difference_text === '+€2.50', cmp23.cost_difference_text);
check('compare 2->3 moved', cmp23.moved.length === 2 &&
  cmp23.moved.some((m) => m.title === 'Draw out the lower burr' && m.from === 2 && m.to === 3) &&
  cmp23.moved.some((m) => m.title === 'Free the upper burr' && m.from === 3 && m.to === 2), cmp23.moved);
const cmp12 = (await anon.call('GET', `/api/guides/${w.guides.public.id}/versions/compare?older=1&newer=2`)).json;
check('compare 1->2 difference', cmp12.cost_difference_text === '+€2.40', cmp12.cost_difference_text);

// --- private guide hidden (DP-31)
const reader = new Session();
await reader.signIn(w.reader.email, w.reader.password);
for (const [name, path] of [
  ['api', `/api/guides/${w.guides.private.id}`],
  ['versions', `/api/guides/${w.guides.private.id}/versions`],
  ['forks', `/api/guides/${w.guides.private.id}/forks`],
  ['reader page', `/g/${w.guides.private.slug}`],
  ['embed page', `/embed/${w.guides.private.slug}`],
]) {
  const asAnon = await anon.call(path.includes('/forks') ? 'POST' : 'GET', path, path.includes('/forks') ? {} : undefined);
  check(`private 404 anon ${name}`, asAnon.status === 404, asAnon.status);
  const asReader = await reader.call(path.includes('/forks') ? 'POST' : 'GET', path, path.includes('/forks') ? {} : undefined);
  check(`private 404 reader ${name}`, asReader.status === 404, asReader.status);
}

// --- withdrawn (DP-96)
const withdrawnPage = await anon.call('GET', `/g/${w.guides.withdrawn.slug}`);
check('withdrawn 410 page', withdrawnPage.status === 410 && withdrawnPage.text.includes('This guide was withdrawn.'), withdrawnPage.status);
const withdrawnEmbed = await anon.call('GET', `/embed/${w.guides.withdrawn.slug}`);
check('withdrawn 410 embed', withdrawnEmbed.status === 410, withdrawnEmbed.status);
const withdrawnApi = await reader.call('GET', `/api/guides/${w.guides.withdrawn.id}`);
check('withdrawn 410 api', withdrawnApi.status === 410 && withdrawnApi.json.error === 'withdrawn', withdrawnApi.json);

// --- draft hidden from readers
check('draft 404 for reader page', (await reader.call('GET', `/g/${w.guides.draft.slug}`)).status === 404);
check('draft 404 for anon api', (await anon.call('GET', `/api/guides/${w.guides.draft.id}`)).status === 404);

// --- framing headers (DP-93)
const embedHead = await anon.call('GET', `/embed/${w.guides.public.slug}?step=3`);
check('embed csp', embedHead.headers.get('content-security-policy') === 'frame-ancestors *', embedHead.headers.get('content-security-policy'));
check('embed no cookie', embedHead.headers.get('set-cookie') === null);
check('embed x-frame-options absent', embedHead.headers.get('x-frame-options') === null);
const readerHead = await anon.call('GET', `/g/${w.guides.public.slug}`);
check('reader csp', readerHead.headers.get('content-security-policy') === "frame-ancestors 'self'");

// --- deep link settled (DP-26, DP-28)
check('deep link data-step', embedHead.text.includes('data-step="3"'), null);
check('deep link explode', embedHead.text.includes('data-explode="0.500"'), null);
const past = await anon.call('GET', `/g/${w.guides.public.slug}?step=99`);
check('past the end notice', past.text.includes('This guide has 5 steps. Showing step 5.'), null);

// --- working copy and field commits (DP-72, DP-75, DP-12)
const author = new Session();
await author.signIn(w.author.email, w.author.password);
const coauthor = new Session();
await coauthor.signIn(w.coauthor.email, w.coauthor.password);

const working = (await author.call('GET', `/api/guides/${w.guides.draft.id}/working`)).json;
check('working copy', working.steps.length === 5 && working.parts.length === 9, working.steps.length);
check('field revisions start at 0', Object.values(working.field_revisions).every((n) => n === 0), null);
const step1 = working.steps[0];
const commit = await author.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: `step/${step1.id}/text`, value: 'Hold one cone and turn.', based_on: 0,
});
check('commit ok', commit.status === 200 && commit.json.field_revision === 1, commit.json);
const stale = await coauthor.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: `step/${step1.id}/text`, value: 'other', based_on: 0,
});
check('edit conflict', stale.status === 409 && stale.json.error === 'edit_conflict' && stale.json.theirs.value === 'Hold one cone and turn.', stale.json);
const otherField = await coauthor.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: `step/${working.steps[1].id}/title`, value: 'Slide the axle out', based_on: 0,
});
check('different field merges', otherField.status === 200, otherField.json);

const bearing = working.parts.find((p) => p.name === 'Left bearing');
const priced = await author.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: `part/${bearing.id}/unit_price`, value: 450, based_on: 0,
});
check('price commit returns total', priced.json.guide_total === 770 && priced.json.guide_total_text === '£7.70', priced.json);

// --- length limits (DP-07)
const long = 'x'.repeat(2001);
const over = await author.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: `step/${step1.id}/text`, value: long, based_on: 1,
});
check('too_long', over.status === 422 && over.json.error === 'too_long' && over.json.limit === 2000, over.json);
const exact = await author.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: `step/${step1.id}/text`, value: 'y'.repeat(2000), based_on: 1,
});
check('exactly the limit accepted', exact.status === 200, exact.json);
const emoji = await author.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: 'title', value: '😀'.repeat(120), based_on: 0,
});
check('emoji counts as one code point', emoji.status === 200, emoji.json);
const emojiOver = await author.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: 'title', value: '😀'.repeat(121), based_on: 1,
});
check('one more emoji refused', emojiOver.status === 422 && emojiOver.json.error === 'too_long', emojiOver.json);

// --- versions: stale save (DP-75), restore (DP-58)
const saveStale = await author.call('POST', `/api/guides/${w.guides.draft.id}/versions`, { base_version: 0 });
check('version conflict', saveStale.status === 409 && saveStale.json.error === 'version_conflict' && saveStale.json.current === 1, saveStale.json);
check('version conflict names fields', Array.isArray(saveStale.json.fields), saveStale.json.fields);
const saved = await author.call('POST', `/api/guides/${w.guides.draft.id}/versions`, { base_version: 1 });
check('version saved', saved.status === 201 && saved.json.number === 2, saved.json);
const restored = await author.call('POST', `/api/guides/${w.guides.public.id}/versions/1/restore`, {});
check('restore appends', restored.status === 201 && restored.json.number === 4 && restored.json.restored_from === 1, restored.json);
const versionList = (await author.call('GET', `/api/guides/${w.guides.public.id}/versions`)).json;
check('versions newest first', versionList.items[0].number === 4 && versionList.items[0].restored_from === 1, versionList.items.map((v) => v.number));
check('earlier versions unchanged', versionList.items.find((v) => v.number === 3).parts_cost_text === '€21.30', null);

// --- forks (DP-62..DP-68)
const forkOut = await reader.call('POST', `/api/guides/${w.guides.public.id}/forks`, {});
check('fork created', forkOut.status === 201 && forkOut.json.forked_from.version === 3, forkOut.json);
check('fork credit names source', forkOut.json.forked_from.title === w.guides.public.title && forkOut.json.forked_from.author_name === w.author.name, forkOut.json.forked_from);
const forkRead = await reader.call('GET', `/api/guides/${forkOut.json.id}`);
check('fork is draft public', forkRead.json.state === 'draft' && forkRead.json.visibility === 'public', forkRead.json.state);
check('fork title', forkRead.json.title === `${w.guides.public.title} (fork)`, forkRead.json.title);
const sourceAfterFork = (await anon.call('GET', `/api/guides/${w.guides.public.id}`)).json;
check('fork count derived', sourceAfterFork.fork_count === 1, sourceAfterFork.fork_count);
const privateFork = await reader.call('POST', `/api/guides/${w.guides.private.id}/forks`, {});
check('private cannot be forked', privateFork.status === 404, privateFork.status);

// --- likes (DP-89)
const like1 = await reader.call('PUT', `/api/guides/${w.guides.public.id}/like`, {});
const like2 = await reader.call('PUT', `/api/guides/${w.guides.public.id}/like`, {});
check('like counts once', like1.json.like_count === 1 && like2.json.like_count === 1, [like1.json, like2.json]);
const unlike = await reader.call('DELETE', `/api/guides/${w.guides.public.id}/like`);
check('unlike', unlike.json.liked === false && unlike.json.like_count === 0, unlike.json);

// --- unconfirmed account refused (DP-77)
const newcomer = new Session();
await newcomer.signIn(w.newcomer.email, w.newcomer.password);
for (const [name, method, path, body] of [
  ['ask', 'POST', `/api/guides/${w.guides.public.id}/questions`, { step: 1, text: 'hi' }],
  ['like', 'PUT', `/api/guides/${w.guides.public.id}/like`, {}],
  ['fork', 'POST', `/api/guides/${w.guides.public.id}/forks`, {}],
]) {
  const out = await newcomer.call(method, path, body);
  check(`unconfirmed 403 ${name}`, out.status === 403 && out.json.error === 'unconfirmed', out.json);
}

// --- questions (DP-79..DP-81)
const asked = await reader.call('POST', `/api/guides/${w.guides.public.id}/questions`, {
  step: 4, text: '<b>which</b> way? **bold** [a](b)',
});
check('question created', asked.status === 201 && asked.json.step === 4, asked.json);
check('question text literal', asked.json.text === '<b>which</b> way? **bold** [a](b)', asked.json.text);
const badStep = await reader.call('POST', `/api/guides/${w.guides.public.id}/questions`, { step: 99, text: 'x' });
check('bad step 422', badStep.status === 422 && badStep.json.field === 'step', badStep.json);
const answered = await author.call('POST', `/api/questions/${asked.json.id}/answer`, { text: 'Clockwise.' });
check('answer created', answered.status === 201 && answered.json.answer.text === 'Clockwise.', answered.json);
const twice = await author.call('POST', `/api/questions/${asked.json.id}/answer`, { text: 'again' });
check('already answered', twice.status === 409 && twice.json.error === 'already_answered', twice.json);

// --- search (DP-84..DP-87)
const found = await anon.call('GET', `/api/search?q=${encodeURIComponent('burr')}`);
check('search finds grinder', found.json.items.some((i) => i.id === w.guides.public.id), found.json.total);
const tagged = await anon.call('GET', '/api/search?tag=coffee&tag=burrs');
check('search by tags', tagged.json.items.some((i) => i.id === w.guides.public.id), tagged.json.total);
const noPrivate = await anon.call('GET', `/api/search?q=${encodeURIComponent('private notes')}`);
check('search hides private', !noPrivate.json.items.some((i) => i.id === w.guides.private.id), noPrivate.json.items.length);
const noDraft = await anon.call('GET', `/api/search?q=${encodeURIComponent('regrease')}`);
check('search hides draft', !noDraft.json.items.some((i) => i.id === w.guides.draft.id), noDraft.json.items.length);
const noWithdrawn = await anon.call('GET', '/api/search?q=controller');
check('search hides withdrawn', !noWithdrawn.json.items.some((i) => i.id === w.guides.withdrawn.id), noWithdrawn.json.items.length);
const longQuery = await anon.call('GET', `/api/search?q=${'a'.repeat(201)}`);
check('query too long', longQuery.status === 422 && longQuery.json.error === 'query_too_long', longQuery.json);
const exactQuery = await anon.call('GET', `/api/search?q=${'a'.repeat(200)}`);
check('query at the limit', exactQuery.status === 200, exactQuery.status);
const manyTags = await anon.call('GET', `/api/search?${Array.from({ length: 9 }, (_, i) => `tag=t${i}`).join('&')}`);
check('too many tags', manyTags.status === 422 && manyTags.json.error === 'too_many_tags', manyTags.json);
const prefixOnly = await anon.call('GET', '/api/search?q=burr');
const midWord = await anon.call('GET', '/api/search?q=urr');
check('words match word starts only', prefixOnly.json.total > 0 && midWord.json.total === 0, [prefixOnly.json.total, midWord.json.total]);
const regexLiteral = await anon.call('GET', `/api/search?q=${encodeURIComponent('bu(rr')}`);
check('pattern characters literal', regexLiteral.status === 200 && regexLiteral.json.total === 0, regexLiteral.json);
const capped = await anon.call('GET', '/api/search?limit=500');
check('page size capped', capped.json.items.length <= 100, capped.json.items.length);

// --- route checks
check('unknown api path', (await anon.call('GET', '/api/nope')).status === 404);
const unknownPage = await anon.call('GET', '/nope');
check('unknown page path', unknownPage.status === 404 && unknownPage.text.includes('We could not find that page.'));
const wrongMethod = await anon.call('DELETE', '/api/limits');
check('wrong method 405', wrongMethod.status === 405 && wrongMethod.headers.get('allow')?.includes('GET'), [wrongMethod.status, wrongMethod.headers.get('allow')]);
const wrongType = await anon.call('POST', '/api/session', null, { 'content-type': 'text/plain' });
check('wrong content type 415', wrongType.status === 415, wrongType.status);
const deep = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: '['.repeat(40) + ']'.repeat(40),
});
check('too deep 422', deep.status === 422 && (await deep.json()).error === 'too_deep', deep.status);
const big = await fetch(`${BASE}/api/session`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'a'.repeat(1_000_050), password: 'x' }),
});
check('body too large 413', big.status === 413, big.status);

// --- model routes
const modelGet = await anon.call('GET', `/api/models/${g.model_id}.glb`);
check('model readable', modelGet.status === 200 && modelGet.headers.get('content-type') === 'model/gltf-binary', modelGet.status);
const privateRead = (await author.call('GET', `/api/guides/${w.guides.private.id}`)).json;
check('private model hidden', (await anon.call('GET', `/api/models/${privateRead.model_id}.glb`)).status === 404);
const sample = await anon.call('GET', '/samples/bike-hub.glb');
check('sample served', sample.status === 200, sample.status);
check('unknown sample 404', (await anon.call('GET', '/samples/nope.glb')).status === 404);
const still = await anon.call('GET', `/api/guides/${w.guides.public.id}/stills/3`);
check('still drawn', still.status === 200 && still.text.startsWith('<svg'), still.status);

// --- uploads (DP-50)
const glb = new Uint8Array(await (await fetch(`${BASE}/samples/game-controller.glb`)).arrayBuffer());
const upload = await author.call('POST', `/api/guides/${w.guides.draft.id}/model`, glb);
check('upload stored', upload.status === 201 && upload.json.model.state === 'stored' && upload.json.model.bytes === glb.byteLength, upload.json?.model);
check('upload starts unconfirmed scale', upload.json.model.scale_confirmed === false, upload.json?.model);
check('replacement keeps parts and lists unbound', upload.json.parts.length === 19 && upload.json.unbound.length === 9, {
  parts: upload.json.parts?.length, unbound: upload.json.unbound,
});
const notGlb = await author.call('POST', `/api/guides/${w.guides.draft.id}/model`, new TextEncoder().encode('hello there, not a model'));
check('not_glb', notGlb.status === 422 && notGlb.json.error === 'not_glb', notGlb.json);

// --- publish checks (DP-96)
const republish = await author.call('POST', `/api/guides/${w.guides.public.id}/publish`, { version: 3 });
check('publish same version refused', republish.status === 409 && republish.json.error === 'illegal_transition', republish.json);
const withdrawDraft = await author.call('POST', `/api/guides/${w.guides.draft.id}/withdraw`, {});
check('withdraw a draft refused', withdrawDraft.status === 409 && withdrawDraft.json.from === 'draft', withdrawDraft.json);
const afterUpload = await author.call('POST', `/api/guides/${w.guides.draft.id}/versions`, { base_version: 2 });
check('version saved after upload', afterUpload.status === 201, afterUpload.json);
const publishUnbound = await author.call('POST', `/api/guides/${w.guides.draft.id}/publish`, {});
check('publish refused for unbound parts', publishUnbound.status === 422 &&
  publishUnbound.json.error === 'unbound_parts' && Array.isArray(publishUnbound.json.parts), publishUnbound.json);
const publishOldVersion = await author.call('POST', `/api/guides/${w.guides.draft.id}/publish`, { version: 1 });
check('publish a sound version works', publishOldVersion.status === 200 && publishOldVersion.json.published_version === 1, publishOldVersion.json);
const coauthorPublish = await coauthor.call('POST', `/api/guides/${w.guides.draft.id}/publish`, {});
check('co-author cannot publish', coauthorPublish.status === 403 && coauthorPublish.json.error === 'forbidden', coauthorPublish.json);
const coauthorVisibility = await coauthor.call('PATCH', `/api/guides/${w.guides.draft.id}/working`, {
  field: 'visibility', value: 'private', based_on: 0,
});
check('co-author cannot change visibility', coauthorVisibility.status === 403, coauthorVisibility.json);

// --- collections (DP-88)
const collection = (await anon.call('GET', `/api/collections/${w.collection.id}`)).json;
check('collection holds public guide', collection.items.length === 1 && collection.items[0].guide_id === w.guides.public.id, collection.items);

// --- dashboard (DP-67)
const dash = (await author.call('GET', '/api/dashboard')).json;
check('dashboard shelves', Array.isArray(dash.drafts) && Array.isArray(dash.published) && Array.isArray(dash.forks), Object.keys(dash));
check('dashboard questions', dash.questions.length >= 1, dash.questions.length);
const readerDash = (await reader.call('GET', '/api/dashboard')).json;
check('fork on forker dashboard', readerDash.forks.some((f) => f.id === forkOut.json.id), readerDash.forks);

// --- sign-in return path (DP-30)
for (const bad of ['https://evil.test/x', '//evil.test', '/\\evil.test', '/javascript:alert(1)']) {
  const out = await anon.call('GET', `/signin?next=${encodeURIComponent(bad)}`);
  check(`non-local next -> dashboard (${bad})`, out.text.includes('data-next="/dashboard"'), bad);
}
const goodNext = await anon.call('GET', `/signin?next=${encodeURIComponent('/g/x?step=3')}`);
check('local next kept', goodNext.text.includes('/g/x?step=3'), null);

// --- sign-up and confirmation (DP-78)
const fresh = new Session();
const signUp = await fresh.call('POST', '/api/accounts', {
  name: 'Nina Holt', email: `nina-${Date.now()}@example.test`, password: 'workshop-bench-41',
});
check('sign-up 201', signUp.status === 201 && signUp.json.message_sent === true && signUp.json.user.confirmed === false, signUp.json);
const taken = await anon.call('POST', '/api/accounts', {
  name: 'Nina Holt', email: signUp.json.user.email, password: 'workshop-bench-41',
});
check('email taken', taken.status === 409 && taken.json.error === 'email_taken', taken.json);
check('no token in sign-up reply', !signUp.text.includes('token'), null);
const badToken = await anon.call('POST', '/api/account/confirm', { token: 'nope' });
check('bad token 410', badToken.status === 410 && badToken.json.error === 'token_invalid', badToken.json);

const mail = await (await fetch('http://mailpit:8025/api/v1/search?query=' + encodeURIComponent(signUp.json.user.email))).json();
const message = mail.messages?.[0];
check('mail delivered', !!message, mail);
if (message) {
  check('mail sender', message.From.Address === 'no-reply@pennywasher.example' && message.From.Name === 'Pennywasher Works', message.From);
  check('mail subject', message.Subject === 'Confirm your Pennywasher account', message.Subject);
  const body = await (await fetch(`http://mailpit:8025/api/v1/message/${message.ID}`)).json();
  const link = /http:\/\/[^\s]*\/confirm\?token=([A-Za-z0-9_-]+)/.exec(body.Text);
  check('mail carries the confirm link', !!link, body.Text?.slice(0, 200));
  if (link) {
    const confirmed = await fresh.call('POST', '/api/account/confirm', { token: link[1] });
    check('confirm works', confirmed.status === 200 && confirmed.json.confirmed === true, confirmed.json);
    const reuse = await fresh.call('POST', '/api/account/confirm', { token: link[1] });
    check('token spent once', reuse.status === 410, reuse.status);
    const session = await fresh.call('GET', '/api/session');
    check('account now confirmed', session.json.user.confirmed === true, session.json);
    const already = await fresh.call('POST', '/api/account/resend', {});
    check('resend already confirmed', already.status === 409 && already.json.error === 'already_confirmed', already.json);
  }
}

// --- failed sign-in limit (DP-82)
const attacker = new Session();
let limited = null;
for (let i = 0; i < 8; i += 1) {
  const out = await attacker.call('POST', '/api/session', { email: w.reader.email, password: 'wrong-password' });
  if (out.status === 429) { limited = out; break; }
}
check('sign-in limit', limited !== null && limited.json.error === 'rate_limited' && limited.headers.get('retry-after') !== null, limited?.json);

// --- start-of-world seeded guides
const home = await anon.call('GET', '/');
check('home page', home.status === 200 && home.text.includes('TAKE IT') && home.text.includes('APART.'), home.status);
check('home supporting sentence', home.text.includes('Upload the thing you fixed, and readers watch it come apart one step at a time.'), null);
const seeded = await anon.call('GET', '/api/guides/coffee-grinder-fit-new-burrs');
check('seeded grinder', seeded.status === 200 && seeded.json.total_cost_text === '€21.30' && seeded.json.author.name === 'Odile Brandt', seeded.json?.total_cost_text);
const seededHub = await anon.call('GET', '/api/guides/bike-hub-regrease-the-bearings');
check('seeded hub', seededHub.json.total_cost_text === '£6.40' && seededHub.json.step_count === 5, seededHub.json?.total_cost_text);
const seededPad = await anon.call('GET', '/api/guides/game-controller-replace-a-stick');
check('seeded controller', seededPad.json.total_cost_text === '¥1,240' && seededPad.json.step_count === 2, seededPad.json?.total_cost_text);
const odile = new Session();
await odile.signIn('odile@pennywasher.example', 'workshop-bench-41');
check('start account signs in', true);

process.stdout.write(`\npassed ${passed} failed ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
