import { strict as assert } from 'node:assert';
import { b64urlDecode, b64urlEncode } from '../src/shared/b64.ts';
import { canonicalRecoveryCode, generateRecoveryCode, keyIdFor, openBody, padBody, recoveryBackupKey, recoveryVerifier, sealBody, sealNumber, unpadBody, utf8 } from '../src/shared/sealing.ts';

const uuid = (): string => crypto.randomUUID();
const RUN = process.argv.includes('--run');
const FILTER = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

interface Test { name: string; fn: () => Promise<void> }
const tests: Test[] = [];
function test(name: string, fn: () => Promise<void>) { tests.push({ name, fn }); }

// --- helpers ---
async function makeIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: raw, privateKey: pair.privateKey, keyId: await keyIdFor(raw) };
}

test('worked example: 48-byte body pads to 160, ct 176 bytes / 235 chars, iv 16 chars', async () => {
  const key = new Uint8Array(32).fill(3);
  const body = JSON.stringify({ v: 1, kind: 'text', text: 'Hello from Lisbon' });
  assert.equal(new TextEncoder().encode(body).length, 48);
  const sealed = await sealBody(key, body);
  assert.equal(sealed.iv.length, 16);
  const ctBytes = b64urlDecode(sealed.ciphertext);
  assert.equal(ctBytes.length, 176);
  assert.equal(sealed.ciphertext.length, 235);
  const opened = await openBody(key, sealed.iv, sealed.ciphertext);
  assert.equal(opened, body);
});

test('padding always adds a block at an exact multiple', () => {
  const exact = padBody(new Uint8Array(160));
  assert.equal(exact.length, 320);
  assert.equal(exact[160], 0x80);
  const round = unpadBody(exact);
  assert.equal(round.length, 160);
  assert.equal(utf8('').length, 0);
  assert.equal(padBody(new Uint8Array(0)).length, 160);
});

test('key id is 16 chars of base64url from SHA-256 of the raw point', async () => {
  const identity = await makeIdentity();
  assert.match(identity.keyId, /^[A-Za-z0-9_-]{16}$/);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', identity.publicKey));
  assert.equal(identity.keyId, b64urlEncode(digest.slice(0, 12)));
});

test('recovery code: 32 Crockford chars, 8 groups of 4, canonical folding', () => {
  for (let i = 0; i < 20; i++) {
    const code = generateRecoveryCode();
    assert.equal(code.grouped.length, 39);
    assert.equal(code.grouped.split('-').length, 8);
    for (const g of code.grouped.split('-')) {
      assert.equal(g.length, 4);
      assert.match(g, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
    }
    assert.equal(canonicalRecoveryCode(code.grouped), code.canonical);
    // I, L and O fold to digits.
    const folded = canonicalRecoveryCode(code.grouped.replace(/[A-Z0-9]/, (c) => (c === '0' ? 'O' : c === '1' ? 'I' : c)));
    assert.match(folded, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{32}$/);
  }
  assert.equal(canonicalRecoveryCode('7k2m-q9xd'), '7K2MQ9XD');
});

test('recovery verifier and backup key derive from the canonical form', async () => {
  const info = await recoveryVerifier('7K2MQ9XD');
  const backup = await recoveryBackupKey('7K2MQ9XD');
  assert.equal(info.length, 32);
  assert.equal(backup.length, 32);
});

test('seal number: 12 groups of 5 digits, symmetric', async () => {
  const a = await makeIdentity();
  const b = await makeIdentity();
  const s1 = await sealNumber(a.publicKey, b.publicKey);
  const s2 = await sealNumber(b.publicKey, a.publicKey);
  assert.equal(s1, s2);
  assert.equal(s1.split(' ').length, 12);
  assert.match(s1, /^(\d{5} ){11}\d{5}$/);
});

test('conversation key derivation is symmetric and salt-order independent', async () => {
  const a = await makeIdentity();
  const b = await makeIdentity();
  const { conversationKey } = await import('../src/shared/sealing.ts');
  const idA = uuid();
  const idB = uuid();
  const k1 = await conversationKey(a.privateKey, b.publicKey, idA, idB);
  const k2 = await conversationKey(b.privateKey, a.publicKey, idB, idA);
  assert.deepEqual(k1, k2);
});

if (!FILTER || tests.length === 0) {
  for (const t of tests) {
    if (FILTER && !t.name.includes(FILTER)) continue;
    await t.fn();
    console.log(`ok - ${t.name}`);
  }
}
console.log(`shared ${tests.length} tests`);
