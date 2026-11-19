const BASE = process.env.PW_BASE_URL ?? 'http://127.0.0.1:4173';
let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name}: ${detail ?? ''}`); }
}
for (const name of ['coffee-grinder', 'bike-hub', 'game-controller']) {
  const response = await fetch(`${BASE}/samples/${name}.glb`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  check(`${name}.glb 200 model/gltf-binary`, response.status === 200 && response.headers.get('content-type') === 'model/gltf-binary');
  check(`${name}.glb under 200000 bytes`, bytes.length < 200000, `${bytes.length}`);
  check(`${name}.glb magic glTF`, bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46);
}
const missing = await fetch(`${BASE}/samples/nope.glb`);
check('missing sample 404', missing.status === 404 && (await missing.json()).error === 'not_found');
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
