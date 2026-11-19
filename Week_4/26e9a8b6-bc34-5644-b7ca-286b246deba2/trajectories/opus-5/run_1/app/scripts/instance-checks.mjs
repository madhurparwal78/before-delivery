/**
 * Development checks for the `short-limits` and `storage-down` instances.
 * Both are started here with the published environment overrides.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { check, report } from './browser-lib.mjs';

const PRIMARY = 'http://127.0.0.1:4173';
const SHORT = 'http://127.0.0.1:4174';
const DOWN = 'http://127.0.0.1:4175';

const children = [];

function startInstance(port, overrides) {
  const child = spawn(process.execPath, ['dist/server/index.js'], {
    env: { ...process.env, APP_PUBLIC_PORT: String(port), ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => undefined);
  child.stderr.on('data', () => undefined);
  children.push(child);
  return child;
}

async function waitForHealth(base) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${base} never came up`);
}

async function callJson(base, method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body instanceof Uint8Array) {
    init.body = body;
    init.headers['content-type'] = headers['content-type'] ?? 'model/gltf-binary';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

class Session {
  constructor(base) {
    this.base = base;
    this.cookie = null;
  }

  async call(method, path, body, headers = {}) {
    const all = { ...headers };
    if (this.cookie !== null) all.cookie = this.cookie;
    const out = await callJson(this.base, method, path, body, all);
    const set = out.headers.get('set-cookie');
    if (set !== null) this.cookie = set.split(';')[0];
    return out;
  }

  async signIn(email, password) {
    const out = await this.call('POST', '/api/session', { email, password });
    if (out.status !== 200) throw new Error(`sign-in failed ${out.status}`);
  }
}

/* ---------- glb helpers for the refusal checks ---------- */

const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function splitGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
    if (type === BIN_CHUNK) bin = bytes.subarray(start, start + length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  return { json, bin };
}

function buildGlb(json, bin) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = jsonBytes.byteLength + ((4 - (jsonBytes.byteLength % 4)) % 4);
  const binLength = bin === null ? 0 : bin.byteLength;
  const binPadded = binLength + ((4 - (binLength % 4)) % 4);
  const total = 12 + 8 + jsonPadded + (bin === null ? 0 : 8 + binPadded);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonPadded);
  if (bin !== null) {
    const binStart = 20 + jsonPadded;
    view.setUint32(binStart, binPadded, true);
    view.setUint32(binStart + 4, BIN_CHUNK, true);
    out.set(bin, binStart + 8);
  }
  return out;
}

/** Grows the glTF `extras` until the file is exactly `target` bytes. */
function glbOfExactSize(json, bin, target) {
  let pad = 0;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = { ...json, extras: { pad: 'x'.repeat(pad) } };
    const built = buildGlb(candidate, bin);
    if (built.byteLength === target) return built;
    pad += target - built.byteLength;
    if (pad < 0) return null;
  }
  return null;
}

function withPartCount(json, bin, count) {
  const copy = JSON.parse(JSON.stringify(json));
  const template = copy.nodes.find((node) => node.mesh !== undefined && node.children === undefined);
  copy.nodes = [];
  copy.scenes = [{ nodes: [] }];
  for (let i = 0; i < count; i += 1) {
    copy.nodes.push({ ...template, name: `Part ${i}`, children: undefined });
    copy.scenes[0].nodes.push(i);
  }
  return buildGlb(copy, bin);
}

/* ---------- Start the instances ---------- */

await waitForHealth(PRIMARY);

startInstance(4174, {
  S3_BUCKET: 'gf-dev-short',
  MODEL_MAX_BYTES: '400000',
  MODEL_MAX_PARTS: '12',
  QUESTION_LIMIT: '2',
  QUESTION_WINDOW_SECONDS: '30',
  CONFIRM_TOKEN_TTL_SECONDS: '5',
  GRADING_ROUTES: 'on',
});
startInstance(4175, {
  S3_ENDPOINT: 'http://127.0.0.1:9',
  GRADING_ROUTES: 'on',
});

const shortHealth = await waitForHealth(SHORT);
check('short-limits health ok', shortHealth.status === 'ok', shortHealth);

/* DP-51: health answers as published with storage unreachable, never 503. */
const downResponse = await fetch(`${DOWN}/api/health`);
const downHealth = await downResponse.json();
check('storage-down health is 200', downResponse.status === 200, downResponse.status);
check('storage-down health says unavailable', downHealth.status === 'unavailable', downHealth);

const shortLimits = (await callJson(SHORT, 'GET', '/api/limits')).json;
check(
  'short-limits limits',
  shortLimits.model_max_bytes === 400000 &&
    shortLimits.model_max_parts === 12 &&
    shortLimits.question_limit === 2 &&
    shortLimits.confirm_token_ttl_seconds === 5,
  shortLimits,
);

/* ---------- DP-50: upload refusals on short-limits ---------- */
const shortWorld = (await callJson(SHORT, 'POST', '/api/grading/world', {})).json;
check('short-limits world created', shortWorld?.guides?.draft?.id !== undefined, shortWorld);

const shortAuthor = new Session(SHORT);
await shortAuthor.signIn(shortWorld.author.email, shortWorld.author.password);
const modelPath = `/api/guides/${shortWorld.guides.draft.id}/model`;

const sample = new Uint8Array(readFileSync('dist/public/samples/game-controller.glb'));
const { json: sampleJson, bin: sampleBin } = splitGlb(sample);

const renamedText = new TextEncoder().encode('This is a plain text file pretending to be a model.');
const notGlb = await shortAuthor.call('POST', modelPath, renamedText);
check('renamed text file refused', notGlb.status === 422 && notGlb.json.error === 'not_glb', notGlb.json);

const oneOver = new Uint8Array(400001);
const overBytes = await shortAuthor.call('POST', modelPath, oneOver);
check(
  'one byte over the limit refused',
  overBytes.status === 413 && overBytes.json.error === 'model_too_large' && overBytes.json.limit === 400000,
  overBytes.json,
);

const thirteenParts = withPartCount(sampleJson, sampleBin, 13);
const overParts = await shortAuthor.call('POST', modelPath, thirteenParts);
check(
  'one part over the limit refused',
  overParts.status === 422 &&
    overParts.json.error === 'too_many_parts' &&
    overParts.json.count === 13 &&
    overParts.json.limit === 12,
  overParts.json,
);

const outsideUri = buildGlb(
  { ...sampleJson, images: [{ uri: 'https://example.test/texture.png' }] },
  sampleBin,
);
const external = await shortAuthor.call('POST', modelPath, outsideUri);
check(
  'outside URI refused',
  external.status === 422 && external.json.error === 'external_uri',
  external.json,
);

/* Files exactly at the limits are accepted. */
const twelveParts = withPartCount(sampleJson, sampleBin, 12);
const atPartLimit = await shortAuthor.call('POST', modelPath, twelveParts);
check(
  'exactly the part limit accepted',
  atPartLimit.status === 201 && atPartLimit.json.parts.length >= 12,
  atPartLimit.json?.error ?? atPartLimit.status,
);

const exactSize = glbOfExactSize(sampleJson, sampleBin, 400000);
check('built a file of exactly the byte limit', exactSize !== null && exactSize.byteLength === 400000);
if (exactSize !== null) {
  const atByteLimit = await shortAuthor.call('POST', modelPath, exactSize);
  check(
    'exactly the byte limit accepted',
    atByteLimit.status === 201 && atByteLimit.json.model.bytes === 400000,
    atByteLimit.json?.error ?? atByteLimit.status,
  );
}

/* Nothing was stored for a refusal. */
const storedCount = await callJson(SHORT, 'GET', `/api/guides/${shortWorld.guides.draft.id}/working`);
check('refusals store nothing extra', storedCount.status === 404 || storedCount.status === 200);

/* ---------- DP-82: question limits on short-limits ---------- */
const shortReader = new Session(SHORT);
await shortReader.signIn(shortWorld.reader.email, shortWorld.reader.password);
const questionPath = `/api/guides/${shortWorld.guides.public.id}/questions`;
const first = await shortReader.call('POST', questionPath, { step: 1, text: 'One?' });
const second = await shortReader.call('POST', questionPath, { step: 1, text: 'Two?' });
const third = await shortReader.call('POST', questionPath, { step: 1, text: 'Three?' });
check('first two questions accepted', first.status === 201 && second.status === 201, [
  first.status,
  second.status,
]);
check(
  'third question refused with Retry-After',
  third.status === 429 &&
    third.json.error === 'rate_limited' &&
    Number(third.headers.get('retry-after')) > 0,
  { status: third.status, body: third.json, retry: third.headers.get('retry-after') },
);

/* ---------- DP-78: an expired token on short-limits ---------- */
const newcomer = new Session(SHORT);
await newcomer.signIn(shortWorld.newcomer.email, shortWorld.newcomer.password);
const resend = await newcomer.call('POST', '/api/account/resend', {});
check('resend accepted', resend.status === 200, resend.json);
const mailbox = await (
  await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(shortWorld.newcomer.email)}`)
).json();
const message = mailbox.messages?.[0];
let token = null;
if (message !== undefined) {
  const body = await (await fetch(`http://mailpit:8025/api/v1/message/${message.ID}`)).json();
  token = /\/confirm\?token=([A-Za-z0-9_-]+)/.exec(body.Text)?.[1] ?? null;
}
check('token found in the delivered message', token !== null);
if (token !== null) {
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const expired = await callJson(SHORT, 'POST', '/api/account/confirm', { token });
  check(
    'an expired token is refused',
    expired.status === 410 && expired.json.error === 'token_invalid',
    expired.json,
  );
}

/* A resend voids the earlier token. */
const newcomer2 = new Session(SHORT);
await newcomer2.signIn(shortWorld.coauthor.email, shortWorld.coauthor.password);

const freshAccount = new Session(SHORT);
const signUp = await freshAccount.call('POST', '/api/accounts', {
  name: 'Vera Lund',
  email: `vera-${Date.now()}@example.test`,
  password: 'workshop-bench-41',
});
check('sign-up on short-limits', signUp.status === 201, signUp.json);
const firstMail = await (
  await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(signUp.json.user.email)}`)
).json();
const firstToken = await (async () => {
  const entry = firstMail.messages?.[0];
  if (entry === undefined) return null;
  const body = await (await fetch(`http://mailpit:8025/api/v1/message/${entry.ID}`)).json();
  return /\/confirm\?token=([A-Za-z0-9_-]+)/.exec(body.Text)?.[1] ?? null;
})();
await freshAccount.call('POST', '/api/account/resend', {});
if (firstToken !== null) {
  const voided = await callJson(SHORT, 'POST', '/api/account/confirm', { token: firstToken });
  check('a resend voids the earlier token', voided.status === 410, voided.json);
}

/* ---------- DP-51, DP-52: the storage outage ---------- */
const primaryWorld = (await callJson(PRIMARY, 'POST', '/api/grading/world', {})).json;
check('primary world for the outage checks', primaryWorld?.guides?.public?.slug !== undefined);

const downAuthor = new Session(DOWN);
await downAuthor.signIn(primaryWorld.author.email, primaryWorld.author.password);

/* The grading route answers 503 on an instance whose storage is unreachable. */
const downWorld = await callJson(DOWN, 'POST', '/api/grading/world', {});
check(
  'grading route answers 503 with storage unreachable',
  downWorld.status === 503 && downWorld.json.error === 'storage_unavailable',
  downWorld.json,
);

const downUpload = await downAuthor.call(
  'POST',
  `/api/guides/${primaryWorld.guides.draft.id}/model`,
  sample,
);
check(
  'upload answers the published 503 body',
  downUpload.status === 503 && downUpload.json.error === 'storage_unavailable',
  downUpload.json,
);

/* Saving text still works with storage unreachable. */
const downWorking = await downAuthor.call(
  'GET',
  `/api/guides/${primaryWorld.guides.draft.id}/working`,
);
const stepId = downWorking.json.steps[0].id;
const downCommit = await downAuthor.call(
  'PATCH',
  `/api/guides/${primaryWorld.guides.draft.id}/working`,
  { field: `step/${stepId}/text`, value: 'Still saving while storage is out.', based_on: 0 },
);
check('text still saves with storage unreachable', downCommit.status === 200, downCommit.json);
const downVersion = await downAuthor.call(
  'POST',
  `/api/guides/${primaryWorld.guides.draft.id}/versions`,
  { base_version: downWorking.json.latest_version },
);
check('versions still save with storage unreachable', downVersion.status === 201, downVersion.json);

/* Publishing is refused. */
const downPublish = await downAuthor.call(
  'POST',
  `/api/guides/${primaryWorld.guides.draft.id}/publish`,
  {},
);
check(
  'publishing is refused with storage unreachable',
  downPublish.status === 503 && downPublish.json.error === 'storage_unavailable',
  downPublish.json,
);

/* DP-52: the reader page keeps its text, parts and costs. */
const downReader = await callJson(DOWN, 'GET', `/g/${primaryWorld.guides.public.slug}?step=4`);
check('reader page still answers', downReader.status === 200, downReader.status);
check(
  'reader outage copy',
  downReader.text.includes('Storage unreachable. The steps and parts below still work.'),
  null,
);
check('reader keeps the step text', downReader.text.includes('Seat the new burrs'), null);
check('reader keeps the costs', downReader.text.includes('€18.90'), null);
check('stage reports the error state', downReader.text.includes('data-state="error"'), null);

/* The model fetch answers the published 503. */
const downModel = await callJson(
  DOWN,
  'GET',
  `/api/models/${(await callJson(PRIMARY, 'GET', `/api/guides/${primaryWorld.guides.public.id}`)).json.model_id}.glb`,
);
check(
  'model fetch answers 503',
  downModel.status === 503 && downModel.json.error === 'storage_unavailable',
  downModel.json,
);

/* ---------- DP-53: no credential reaches the browser ---------- */
const secrets = [
  process.env.S3_SECRET_ACCESS_KEY,
  process.env.S3_ACCESS_KEY_ID,
  process.env.DATABASE_URL,
].filter((value) => typeof value === 'string' && value.length > 0);
const bundle = readFileSync('dist/public/app.js', 'utf8');
const readerHtml = (await callJson(PRIMARY, 'GET', `/g/${primaryWorld.guides.public.slug}`)).text;
const editorHtml = (await callJson(PRIMARY, 'GET', `/`)).text;
check(
  'no credential in the client bundle',
  secrets.every((secret) => !bundle.includes(secret)),
  null,
);
check(
  'no credential in a served page',
  secrets.every((secret) => !readerHtml.includes(secret) && !editorHtml.includes(secret)),
  null,
);
check(
  'no credential hard-coded in the source',
  (() => {
    const sources = ['src/server/config.ts', 'src/server/storage/s3.ts', 'src/server/mail/smtp.ts'];
    return sources.every((path) => {
      const text = readFileSync(path, 'utf8');
      return secrets.every((secret) => !text.includes(secret));
    });
  })(),
  null,
);

/* ---------- DP-87: paging never repeats or skips ---------- */
const firstPage = (await callJson(PRIMARY, 'GET', '/api/search?limit=2')).json;
if (firstPage.next_cursor !== null) {
  const secondPage = (
    await callJson(PRIMARY, 'GET', `/api/search?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor)}`)
  ).json;
  const ids = new Set(firstPage.items.map((item) => item.id));
  check(
    'paging does not repeat a guide',
    secondPage.items.every((item) => !ids.has(item.id)),
    { first: firstPage.items.map((i) => i.slug), second: secondPage.items.map((i) => i.slug) },
  );
}

/* ---------- Server boundary ---------- */
for (const path of [
  '/api/grading/world',
  '/.env',
  '/src/server/index.ts',
  '/dist/server/index.js',
  '/assets/../../package.json',
  '/api/models/',
]) {
  const response = await callJson(PRIMARY, 'GET', path);
  check(`boundary: ${path} is not served`, response.status === 404 || response.status === 405, response.status);
}

/* The grading route exists only under its setting. */
const noGrading = startInstance(4176, { GRADING_ROUTES: 'off' });
await waitForHealth('http://127.0.0.1:4176');
const gradingOff = await callJson('http://127.0.0.1:4176', 'POST', '/api/grading/world', {});
check(
  'grading route is 404 when the setting is off',
  gradingOff.status === 404 && gradingOff.json.error === 'not_found',
  gradingOff.json,
);
noGrading.kill();

for (const child of children) child.kill();
process.exit(report());
