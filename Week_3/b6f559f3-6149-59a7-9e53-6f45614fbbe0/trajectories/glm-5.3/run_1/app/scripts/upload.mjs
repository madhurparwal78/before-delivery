// Upload behaviours: images, SVGs, models, and every published refusal.
// Run with: node scripts/upload.mjs
const BASE = 'http://127.0.0.1:4173';
const KEY = process.env.GRADING_KEY ?? 'hs-grading-key-5e1c9a7d';

let failures = 0;
let checks = 0;
function ok(name, cond, extra = '') {
  checks += 1;
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

async function reset() {
  await fetch(`${BASE}/api/grading/reset`, { method: 'POST', headers: { 'x-grading-key': KEY } });
  const seed = await (
    await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'x-grading-key': KEY } })
  ).json();
  return seed;
}

async function upload(cookie, projectId, kind, bytes, fileName, mime) {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', new Blob([bytes], { type: mime }), fileName);
  const res = await fetch(`${BASE}/api/projects/${projectId}/assets`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  return { status: res.status, data: await res.json() };
}

// A 1×1 valid PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

function svgOnePath() {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path d="M0 0 L200 0 L200 100 L0 100 Z"/></svg>', 'utf8');
}

function gltfBox() {
  // A minimal glTF 2.0 with an embedded buffer.
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const pos = Buffer.from(positions.buffer);
  const idx = Buffer.from(indices.buffer);
  const pad = (b) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]));
  const bin = Buffer.concat([pad(pos), pad(idx)]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: idx.length },
    ],
    buffers: [{ uri: `data:application/octet-stream;base64,${bin.toString('base64')}`, byteLength: bin.length }],
  };
  return Buffer.from(JSON.stringify(json), 'utf8');
}

async function main() {
  const seed = await reset();
  const lumen = seed.projects['Lumen hero'];
  const inesCookie = `hs_session=${seed.people['ines@lumenyard.test'].session}`;

  console.log('\n-- image uploads (DP-18)');
  const img = await upload(inesCookie, lumen.id, 'image', PNG, 'dot.png', 'image/png');
  ok('a PNG uploads confirmed', img.status === 201 && img.data.asset.status === 'confirmed', JSON.stringify(img.data));
  ok('the asset records its dimensions', img.data.asset.width === 1 && img.data.asset.height === 1);
  const original = await fetch(`${BASE}/api/assets/${img.data.asset.id}/original`, { headers: { cookie: inesCookie } });
  const originalBytes = Buffer.from(await original.arrayBuffer());
  ok('the original bytes download unchanged', original.status === 200 && originalBytes.equals(PNG));

  const gif = await upload(inesCookie, lumen.id, 'image', Buffer.from('GIF89a....'), 'x.gif', 'image/gif');
  ok('a non-PNG/JPEG/WebP image is refused', gif.status === 422 && gif.data.errors.file === 'Only PNG, JPEG and WebP images are supported.', JSON.stringify(gif.data));

  const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 1)]);
  const tooBig = await upload(inesCookie, lumen.id, 'image', big, 'big.png', 'image/png');
  ok('an oversized image is refused with its size', tooBig.status === 422 && tooBig.data.errors.file === 'This image is 1.0 MB; the limit is 1.0 MB.', JSON.stringify(tooBig.data));

  console.log('\n-- SVG uploads (DP-16)');
  const svg = await upload(inesCookie, lumen.id, 'svg', svgOnePath(), 'shape.svg', 'image/svg+xml');
  ok('a one-path straight-line SVG uploads', svg.status === 201 && svg.data.asset.status === 'confirmed', JSON.stringify(svg.data));

  const notSvg = await upload(inesCookie, lumen.id, 'svg', Buffer.from('hello'), 'x.svg', 'image/svg+xml');
  ok('a non-SVG is refused', notSvg.status === 422 && notSvg.data.errors.file === 'This file is not an SVG.');

  const twoPaths = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1 Z"/><path d="M2 2 L3 3 Z"/></svg>',
    'utf8',
  );
  const two = await upload(inesCookie, lumen.id, 'svg', twoPaths, 'two.svg', 'image/svg+xml');
  ok('a two-path SVG is refused with the count', two.status === 422 && two.data.errors.file === 'This SVG has 2 paths. Extrusion needs exactly one path.', JSON.stringify(two.data));

  const curved = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 C 10 10 20 20 30 30 Z"/></svg>',
    'utf8',
  );
  const curves = await upload(inesCookie, lumen.id, 'svg', curved, 'c.svg', 'image/svg+xml');
  ok('a curved path is refused', curves.status === 422 && curves.data.errors.file === 'Only straight-line path commands (M, L, H, V, Z) are supported.', JSON.stringify(curves.data));

  console.log('\n-- model uploads (DP-19)');
  const model = await upload(inesCookie, lumen.id, 'model', gltfBox(), 'box.gltf', 'model/gltf+json');
  ok('a subset glTF uploads and lists clips', model.status === 201 && Array.isArray(model.data.asset.clips), JSON.stringify(model.data));

  const notGltf = await upload(inesCookie, lumen.id, 'model', Buffer.from('not json'), 'x.gltf', 'model/gltf+json');
  ok('an unparseable file is refused', notGltf.status === 422 && notGltf.data.errors.file === 'This file is not a valid glTF or GLB file.', JSON.stringify(notGltf.data));

  const v1 = Buffer.from(JSON.stringify({ asset: { version: '1.0' }, nodes: [] }), 'utf8');
  const old = await upload(inesCookie, lumen.id, 'model', v1, 'x.gltf', 'model/gltf+json');
  ok('a glTF 1.0 file is refused', old.status === 422 && old.data.errors.file === 'Only glTF 2.0 files are supported.', JSON.stringify(old.data));

  const compressed = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'], nodes: [] }),
    'utf8',
  );
  const draco = await upload(inesCookie, lumen.id, 'model', compressed, 'x.gltf', 'model/gltf+json');
  ok('a compressed mesh is refused naming the extension', draco.status === 422 && draco.data.errors.file === 'Compressed meshes (KHR_draco_mesh_compression) are not supported.', JSON.stringify(draco.data));

  const external = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, nodes: [], buffers: [{ uri: 'data.bin' }] }),
    'utf8',
  );
  const ext = await upload(inesCookie, lumen.id, 'model', external, 'x.gltf', 'model/gltf+json');
  ok('an external buffer is refused', ext.status === 422 && ext.data.errors.file === 'External buffer URIs are not supported: embed buffers in the file.', JSON.stringify(ext.data));

  const matrix = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, nodes: [{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }),
    'utf8',
  );
  const mat = await upload(inesCookie, lumen.id, 'model', matrix, 'x.gltf', 'model/gltf+json');
  ok('a node matrix is refused', mat.status === 422 && mat.data.errors.file === 'Node matrices are not supported; use translation, rotation and scale.', JSON.stringify(mat.data));

  const cubicspline = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, nodes: [], animations: [{ channels: [], samplers: [{ input: 0, output: 0, interpolation: 'CUBICSPLINE' }] }] }),
    'utf8',
  );
  const cubic = await upload(inesCookie, lumen.id, 'model', cubicspline, 'x.gltf', 'model/gltf+json');
  ok('CUBICSPLINE is refused', cubic.status === 422 && cubic.data.errors.file === 'Animation interpolation CUBICSPLINE is not supported; use LINEAR or STEP.', JSON.stringify(cubic.data));

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
