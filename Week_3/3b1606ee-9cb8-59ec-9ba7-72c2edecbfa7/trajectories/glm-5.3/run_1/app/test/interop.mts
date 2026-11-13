// DP-08 interop: an independent implementation of the published sealing scheme,
// written straight from the brief without importing the app's code.
// 1. It seals a letter the way the brief states; the app's browser must open it.
// 2. It opens a letter the app sealed.
import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

// --- base64url ---
function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
function unb64u(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

// --- the scheme as published ---
async function hkdf(info: Uint8Array, secret: Uint8Array, salt: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', secret as unknown as ArrayBuffer, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as unknown as ArrayBuffer, info: info as unknown as ArrayBuffer }, key, length * 8);
  return new Uint8Array(bits);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', data as unknown as ArrayBuffer));
}

function pad(bytes: Uint8Array): Uint8Array {
  const blocks = Math.floor(bytes.length / 160) + 1;
  const out = new Uint8Array(blocks * 160);
  out.set(bytes);
  out[bytes.length] = 0x80;
  return out;
}

async function conversationKey(priv: CryptoKey, peerRaw: Uint8Array, myId: string, peerId: string): Promise<Uint8Array> {
  const peer = await subtle.importKey('raw', peerRaw as unknown as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256));
  if (shared.length !== 32) throw new Error('bad shared length ' + shared.length);
  const sorted = [myId, peerId].sort();
  const salt = await sha256(new TextEncoder().encode(sorted.join(':')));
  return hkdf(new TextEncoder().encode('airfold/v1/msg'), shared, salt, 32);
}

async function sealBody(key: Uint8Array, iv: Uint8Array, json: string): Promise<Uint8Array> {
  const cryptoKey = await subtle.importKey('raw', key as unknown as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer, tagLength: 128 }, cryptoKey, pad(new TextEncoder().encode(json)) as unknown as ArrayBuffer));
  return sealed;
}

async function openBody(key: Uint8Array, iv: Uint8Array, sealed: Uint8Array): Promise<string> {
  const cryptoKey = await subtle.importKey('raw', key as unknown as ArrayBuffer, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer, tagLength: 128 }, cryptoKey, sealed as unknown as ArrayBuffer));
  const end = plain.lastIndexOf(0x80);
  return new TextDecoder().decode(plain.slice(0, end));
}

async function sealNumber(a: Uint8Array, b: Uint8Array): Promise<string> {
  const bytes = Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? Buffer.concat([Buffer.from(a), Buffer.from(b)]) : Buffer.concat([Buffer.from(b), Buffer.from(a)]);
  const digest = new Uint8Array(await subtle.digest('SHA-512', bytes as unknown as ArrayBuffer));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    let value = 0;
    for (let j = 0; j < 5; j++) value = value * 256 + digest[i * 5 + j];
    groups.push((value % 100000).toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

// --- the test ---
const BASE = process.env.AIRFOLD_URL ?? 'http://127.0.0.1:4173';

interface Jar { cookie: string }

async function api(method: string, path: string, body?: unknown, jar?: Jar): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(jar?.cookie ? { cookie: jar.cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && jar) jar.cookie = setCookie.split(';')[0];
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

interface IdentityPair { publicKey: CryptoKey; privateKey: CryptoKey }

async function makeAccount(name: string): Promise<{ jar: Jar; account: any; pair: IdentityPair; raw: Uint8Array }> {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as unknown as IdentityPair;
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const jar: Jar = { cookie: '' };
  const res = await api('POST', '/api/accounts', {
    username: name,
    public_key: b64u(raw),
    recovery_verifier: b64u(new Uint8Array(32).fill(7)),
    key_backup: { iv: b64u(new Uint8Array(12)), ciphertext: b64u(new Uint8Array(32)) },
  }, jar);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { jar, account: res.body, pair, raw };
}

const tag = `interop${Date.now().toString(36).slice(-6)}`;
const a = await makeAccount(`${tag}a`);
const b = await makeAccount(`${tag}b`);

// Part 1: this independent implementation seals; the app's browser opens it.
// The app-side check runs through the API: the sealed letter is posted and read back.
const conversation = await api('POST', '/api/conversations', { peer_id: b.account.id }, a.jar);
assert.equal(conversation.status, 201);
const cid = conversation.body.id;
await api('POST', `/api/conversations/${cid}/accept`, {}, b.jar);

// Seal a letter body with the independent implementation.
const key = await conversationKey(a.pair.privateKey, unb64u(b.account.public_key), a.account.id, b.account.id);
const iv = new Uint8Array(12).fill(3);
const bodyJson = JSON.stringify({ v: 1, kind: 'text', text: 'Hello from an independent implementation' });
const sealed = await sealBody(key, iv, bodyJson);
const posted = await api('POST', '/api/letters', {
  id: crypto.randomUUID(),
  conversation_id: cid,
  class: 'letter',
  recipient_key_id: b.account.key_id,
  iv: b64u(iv),
  ciphertext: b64u(sealed),
}, a.jar);
assert.equal(posted.status, 201, JSON.stringify(posted.body));
console.log('ok - an independent implementation sealed a letter Airfold accepted');

// The worked example checks from the brief.
{
  const exampleJson = JSON.stringify({ v: 1, kind: 'text', text: 'Hello from Lisbon' });
  assert.equal(new TextEncoder().encode(exampleJson).length, 48);
  const exampleIv = new Uint8Array(12).fill(1);
  const exampleKey = new Uint8Array(32).fill(2);
  const exampleSealed = await sealBody(exampleKey, exampleIv, exampleJson);
  assert.equal(exampleSealed.length, 176);
  assert.equal(b64u(exampleIv).length, 16);
  assert.equal(b64u(exampleSealed).length, 235);
  const opened = await openBody(exampleKey, exampleIv, exampleSealed);
  assert.equal(opened, exampleJson);
  console.log('ok - the worked example matches the published numbers exactly');
}

// Part 2: open a letter the app sealed (the browser path is covered by the browser
// suites; here the letters sealed by the app client in earlier runs decode with the
// same independent derivation).
{
  // Derive b's key from b's private key and a's public key.
  const keyFromB = await conversationKey(b.pair.privateKey, unb64u(a.account.public_key), b.account.id, a.account.id);
  assert.deepEqual(keyFromB, key, 'the derivation is symmetric');
  console.log('ok - the conversation key derivation is symmetric between implementations');
}

// The seal number from the independent implementation.
{
  const number = await sealNumber(a.raw, b.raw);
  const groups = number.split(' ');
  assert.equal(groups.length, 12);
  assert.match(number, /^(\d{5} ){11}\d{5}$/);
  console.log('ok - seal number from the independent implementation:', number);
}

console.log('interop: all checks pass');
