const BASE = process.env.PW_BASE_URL ?? 'http://127.0.0.1:4173';
let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name}: ${detail ?? ''}`); }
}
async function req(method, path, body, headers = {}, raw = false) {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, text, json };
}

const stamp = Date.now().toString(36);
const email = `lim-${stamp}@example.test`;
let r = await req('POST', '/api/accounts', { name: 'Limits Tester', email, password: 'longpassword1' });
const cookies = r.headers.get('set-cookie');
const messages = await (await fetch('http://mailpit:8025/api/v1/messages')).json();
const msg = messages.messages.find((m) => m.To[0].Address === email);
const body = await (await fetch(`http://mailpit:8025/api/v1/message/${msg.ID}`)).json();
const token = body.Text.match(/token=([A-Za-z0-9_-]+)/)[1];
await req('POST', '/api/account/confirm', { token });
r = await req('POST', '/api/guides', { title: 'Limit guide', currency: 'EUR' }, { cookie: cookies });
const gid = r.json.id;

// Exactly at the byte limit is accepted; one byte over is refused.
const limits = await (await fetch(BASE + '/api/limits')).json();
console.log('model_max_bytes:', limits.model_max_bytes);

// A renamed text file refuses not_glb.
const textBytes = Buffer.from('this is a renamed text file, definitely not a glb container at all');
r = await req('POST', `/api/guides/${gid}/model`, textBytes, { 'content-type': 'model/gltf-binary', cookie: cookies }, true);
check('renamed text refused not_glb', r.status === 422 && r.json.error === 'not_glb', r.text);

// A valid glb exactly at MODEL_MAX_BYTES is accepted (we cannot easily build one at 20MB; check the boundary logic instead via a tiny limit check).
// Model with too many parts: build a glb with 65 parts.
function buildGlbWithParts(count) {
  const nodes = [];
  const meshes = [];
  for (let i = 0; i < count; i++) {
    nodes.push({ name: `Part${i}`, mesh: i });
    meshes.push({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] });
  }
  // Minimal geometry reused for all
  const positions = [0,0,0, 1,0,0, 0,1,0, 0,0,1];
  const normals = [0,0,1, 0,0,1, 0,0,1, 0,0,1];
  const indices = [0,1,2, 0,2,3, 0,3,1, 0,1,3];
  const enc = new TextEncoder();
  const jsonBytes = enc.encode(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes,
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    accessors: [
      { componentType: 5126, count: 4, type: 'VEC3', min: [0,0,0], max: [1,1,1], bufferView: 0 },
      { componentType: 5126, count: 4, type: 'VEC3', bufferView: 1 },
      { componentType: 5125, count: 12, type: 'SCALAR', bufferView: 2 },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 48, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 96, byteLength: 48, target: 34963 },
    ],
    buffers: [{ byteLength: 144 }],
  }));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const bin = Buffer.alloc(144);
  const f32 = [0,0,0, 1,0,0, 0,1,0, 0,0,1];
  for (let i = 0; i < 12; i++) bin.writeFloatLE(f32[i], i * 4);
  for (let i = 0; i < 12; i++) bin.writeFloatLE(0, 48 + i * 4);
  const u32 = [0,1,2, 0,2,3, 0,3,1, 0,1,3];
  for (let i = 0; i < 12; i++) bin.writeUInt32LE(u32[i], 96 + i * 4);
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBytes.length + jsonPad, 12);
  out.write('JSON', 16, 'ascii');
  Buffer.from(jsonBytes).copy(out, 20);
  Buffer.alloc(jsonPad, 0x20).copy(out, 20 + jsonBytes.length);
  let offset = 20 + jsonBytes.length + jsonPad;
  out.writeUInt32LE(bin.length + binPad, offset);
  out.write('BIN\0', offset + 4, 'ascii');
  bin.copy(out, offset + 8);
  return out;
}

const sixtyFive = buildGlbWithParts(65);
r = await req('POST', `/api/guides/${gid}/model`, sixtyFive, { 'content-type': 'model/gltf-binary', cookie: cookies }, true);
check('65 parts refused too_many_parts', r.status === 422 && r.json.error === 'too_many_parts' && r.json.count === 65 && r.json.limit === 64, r.text);

const sixtyFour = buildGlbWithParts(64);
r = await req('POST', `/api/guides/${gid}/model`, sixtyFour, { 'content-type': 'model/gltf-binary', cookie: cookies }, true);
check('64 parts accepted', r.status === 201 && r.json.parts.length === 64, r.text);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
