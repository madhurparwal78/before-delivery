// Worked-example verification through the live API: particles, cloth, clips,
// keyframes, easing, tilt and scroll orbit, at the exact published frames.
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

async function post(cookie, path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

async function inspect(cookie, project, scene, layer, params) {
  const query = new URLSearchParams({ scene, ...params });
  if (layer) query.set('layer', layer);
  const res = await fetch(`${BASE}/api/projects/${project}/inspect?${query}`, { headers: { cookie } });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  await fetch(`${BASE}/api/grading/reset`, { method: 'POST', headers: { 'x-grading-key': KEY } });
  const seed = await (
    await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'x-grading-key': KEY } })
  ).json();
  const inesCookie = `hs_session=${seed.people['ines@lumenyard.test'].session}`;
  const logo = seed.projects['Logo forge'];
  const banner = seed.projects['Banner test'];
  const easing = seed.projects['Easing lab'];
  const orbit = seed.projects['Orbit study'];
  const model = seed.projects['Model bay'];

  console.log('\n-- particles (DP-22, DP-23)');
  // Swarm is worked example B: at frame 29 live 17, particle 1 at -0.433, -1.367, 1.006.
  let r = await inspect(inesCookie, logo.id, logo.scenes['Main'], logo.layers['Swarm'], { frame: 29, particle: 1 });
  ok('frame 29: 17 live', r.data.readouts['live-particles'] === 'Live particles 17', r.data.readouts['live-particles']);
  ok('frame 29: particle 1 matches', r.data.readouts.particle === 'Particle 1 at -0.433, -1.367, 1.006', r.data.readouts.particle);

  r = await inspect(inesCookie, logo.id, logo.scenes['Main'], logo.layers['Swarm'], { frame: 30 });
  ok('frame 30: 15 live', r.data.readouts['live-particles'] === 'Live particles 15', r.data.readouts['live-particles']);

  r = await inspect(inesCookie, logo.id, logo.scenes['Main'], logo.layers['Swarm'], { frame: 45, particle: 20 });
  ok(
    'frame 45 (00:00.750): particle 20 matches',
    r.data.readouts.particle === 'Particle 20 at 0.042, -0.222, -0.337',
    r.data.readouts.particle,
  );

  r = await inspect(inesCookie, logo.id, logo.scenes['Main'], logo.layers['Swarm'], { frame: 45, particle: 1 });
  ok(
    'frame 45: particle 1 is not alive',
    r.data.readouts.particle === 'Particle 1 is not alive at 00:00.750.',
    r.data.readouts.particle,
  );

  // Drift is worked example A: at frame 2, particle 1 at -0.065, -0.067, 0.064.
  r = await inspect(inesCookie, logo.id, logo.scenes['Main'], logo.layers['Drift'], { frame: 2, particle: 1 });
  ok('frame 2: Drift particle 1 matches', r.data.readouts.particle === 'Particle 1 at -0.065, -0.067, 0.064', r.data.readouts.particle);

  // Trails: Drift has trail length 8; a particle born at step 0 at frame 5 has
  // 6 positions.
  r = await inspect(inesCookie, logo.id, logo.scenes['Main'], logo.layers['Drift'], { frame: 5, particle: 1 });
  ok('trail points follow the rule', r.data.readouts['trail-points'] === 'Trail points 6', r.data.readouts['trail-points']);

  console.log('\n-- cloth (DP-24)');
  r = await inspect(inesCookie, banner.id, banner.scenes['Main'], banner.layers['Banner'], { frame: 0, point: 'R4 C1' });
  ok('frame 0 R4 C1', r.data.readouts['cloth-point'] === 'Cloth point R4 C1 at -0.150, -0.300, 0.000', r.data.readouts['cloth-point']);
  r = await inspect(inesCookie, banner.id, banner.scenes['Main'], banner.layers['Banner'], { frame: 30, point: 'R4 C1' });
  ok('frame 30 R4 C1', r.data.readouts['cloth-point'] === 'Cloth point R4 C1 at -0.051, -0.285, 0.001', r.data.readouts['cloth-point']);
  r = await inspect(inesCookie, banner.id, banner.scenes['Main'], banner.layers['Banner'], { frame: 30, point: 'R2 C4' });
  ok('frame 30 R2 C4', r.data.readouts['cloth-point'] === 'Cloth point R2 C4 at 0.180, -0.097, -0.001', r.data.readouts['cloth-point']);
  r = await inspect(inesCookie, banner.id, banner.scenes['Main'], banner.layers['Banner'], { frame: 60, point: 'R4 C1' });
  ok('frame 60 R4 C1', r.data.readouts['cloth-point'] === 'Cloth point R4 C1 at -0.114, -0.300, 0.000', r.data.readouts['cloth-point']);

  console.log('\n-- keyframes and easing (DP-28)');
  // Turner: Rotation Y 0 at frame 0 (Ease out) and 90 at frame 60.
  // At frame 30 the value is 61.618.
  r = await inspect(inesCookie, easing.id, easing.scenes['Main'], easing.layers['Turner'], { frame: 30 });
  ok('Ease out at the midpoint reads 61.618', r.data.values['rotation.y'] === 61.618, String(r.data.values['rotation.y']));
  r = await inspect(inesCookie, easing.id, easing.scenes['Main'], easing.layers['Turner'], { frame: 0 });
  ok('before the keyframes the first value applies', r.data.values['rotation.y'] === 0);

  console.log('\n-- scroll orbit (DP-27)');
  // Orbit study has scroll orbit 0..90 and a probe at (1, 2, 0).
  r = await inspect(inesCookie, orbit.id, orbit.scenes['Main'], orbit.layers['Probe'], { frame: 0, scroll: 50 });
  ok('azimuth 45° at scroll 50', r.data.readouts['camera-azimuth'] === 'Camera azimuth 45.000°', r.data.readouts['camera-azimuth']);
  const screen45 = r.data.readouts['screen-point'];
  ok('the probe at azimuth 45 matches', screen45 === '786.09, 218.08 px', screen45);
  r = await inspect(inesCookie, orbit.id, orbit.scenes['Main'], orbit.layers['Probe'], { frame: 0, scroll: 100 });
  const screen90 = r.data.readouts['screen-point'];
  ok('the probe at azimuth 90 matches', screen90 === '720.00, 211.99 px', screen90);

  console.log('\n-- breakpoint inheritance (DP-31)');
  // Halo cube has a tablet override rotation Y 30; mobile inherits tablet.
  const lumen = seed.projects['Lumen hero'];
  r = await inspect(inesCookie, lumen.id, lumen.scenes['Main'], lumen.layers['Halo cube'], { frame: 0, breakpoint: 'desktop' });
  ok('desktop uses the base value', r.data.values['rotation.y'] === 45, String(r.data.values['rotation.y']));
  r = await inspect(inesCookie, lumen.id, lumen.scenes['Main'], lumen.layers['Halo cube'], { frame: 0, breakpoint: 'tablet' });
  ok('tablet uses its override', r.data.values['rotation.y'] === 30, String(r.data.values['rotation.y']));
  ok('tablet names its source', r.data.sources['rotation.y'] === 'Tablet', r.data.sources['rotation.y']);
  r = await inspect(inesCookie, lumen.id, lumen.scenes['Main'], lumen.layers['Halo cube'], { frame: 0, breakpoint: 'mobile' });
  ok('mobile inherits the tablet override', r.data.values['rotation.y'] === 30, String(r.data.values['rotation.y']));

  console.log('\n-- model clips (DP-20)');
  // Model bay's Swing clip Turn is playing, not looping, speed 1: the
  // translation at 0.5 s is (0.5, 0.25, 0) per the worked example.
  r = await inspect(inesCookie, model.id, model.scenes['Main'], model.layers['Swing'], { frame: 30, node: 'Arm' });
  ok('Arm translation at 0.5 s matches', r.data.readouts['node-translation'] === 'Translation 0.500, 0.250, 0.000', r.data.readouts['node-translation']);
  ok('Arm quaternion at 0.5 s matches', r.data.readouts['node-quaternion'] === 'Quaternion 0.0000, 0.1951, 0.0000, 0.9808', r.data.readouts['node-quaternion']);
  r = await inspect(inesCookie, model.id, model.scenes['Main'], model.layers['Swing'], { frame: 90, node: 'Arm' });
  ok('Arm quaternion at 1.5 s matches', r.data.readouts['node-quaternion'] === 'Quaternion 0.0000, 0.5556, 0.0000, 0.8315', r.data.readouts['node-quaternion']);
  r = await inspect(inesCookie, model.id, model.scenes['Main'], model.layers['Swing'], { frame: 90, node: 'Arm' });
  ok('Arm euler at 1.5 s matches', r.data.readouts['node-euler'] === 'Euler 0.000, 67.500, 0.000', r.data.readouts['node-euler']);

  console.log('\n-- reduced motion (DP-25)');
  r = await inspect(inesCookie, easing.id, easing.scenes['Main'], easing.layers['Turner'], { frame: 30, reducedMotion: 1 });
  ok('reduced motion shows the end pose', r.data.values['rotation.y'] === 90, String(r.data.values['rotation.y']));

  console.log('\n-- samples and materials (DP-35, DP-17)');
  const backdrop = seed.projects['Backdrop'];
  const blend = await inspect(inesCookie, backdrop.id, backdrop.scenes['Blend'], undefined, { sampleX: 100, sampleY: 100 });
  ok(
    'the Blend sample matches the worked example',
    blend.data.readouts.sample === '#8F7A66 · rgb(143, 122, 102)',
    blend.data.readouts.sample,
  );
  const grain = await inspect(inesCookie, backdrop.id, backdrop.scenes['Grain'], backdrop.layers['Grain'], { sampleX: 10, sampleY: 20 });
  ok(
    'the Grain sample matches the worked example',
    grain.data.readouts.sample === '#25588B · rgb(37, 88, 139)',
    grain.data.readouts.sample,
  );

  // Glass: Halo cube switched to Glass by an op, then read IOR.
  const glassOp = await post(inesCookie, `/api/projects/${lumen.id}/ops`, {
    opId: 'glass-1',
    sceneId: lumen.scenes['Main'],
    changes: [
      { type: 'updateLayer', layerId: lumen.layers['Halo cube'], set: 'material.kind', value: 'Glass' },
      { type: 'updateLayer', layerId: lumen.layers['Halo cube'], set: 'material.refraction', value: 1 },
    ],
  });
  ok('switching to Glass applies', glassOp.status === 200);
  const glass = await inspect(inesCookie, lumen.id, lumen.scenes['Main'], lumen.layers['Halo cube'], {});
  ok('IOR matches the published formula', glass.data.readouts.ior === 'IOR 1.250', glass.data.readouts.ior);

  console.log('\n-- draw order and triangles drawn (DP-17)');
  const draw = await inspect(inesCookie, lumen.id, lumen.scenes['Main'], lumen.layers['Halo cube'], {});
  ok('triangles reads the primitive count', draw.data.readouts.triangles === 'Triangles 12');
  const bothSides = await post(inesCookie, `/api/projects/${lumen.id}/ops`, {
    opId: 'both-1',
    sceneId: lumen.scenes['Main'],
    changes: [{ type: 'updateLayer', layerId: lumen.layers['Halo cube'], set: 'faces', value: 'both' }],
  });
  ok('both sides applies', bothSides.status === 200);
  const drawn = await inspect(inesCookie, lumen.id, lumen.scenes['Main'], lumen.layers['Halo cube'], {});
  ok('triangles drawn doubles for both sides', drawn.data.readouts['triangles-drawn'] === 'Triangles drawn 24', drawn.data.readouts['triangles-drawn']);

  console.log('\n-- blur and aberration readouts (DP-36)');
  const blurAdd = await post(inesCookie, `/api/projects/${lumen.id}/ops`, {
    opId: 'blur-1',
    sceneId: lumen.scenes['Main'],
    changes: [{ type: 'addLayer', ref: 'blur-ref', layer: { id: '', name: 'Blur', kind: 'Effect', parentId: null, order: 0, visible: true, locked: false, maskAbove: false, blendMode: 'Normal', props: { effect: { kind: 'Blur', enabled: true, blurRadius: 8 } }, overrides: { tablet: {}, mobile: {} }, keyframes: [], events: {}, bindings: {} } }],
  });
  ok('adding a Blur effect works', blurAdd.status === 200, JSON.stringify(blurAdd.data));
  const blurLayerId = blurAdd.data.ids?.['blur-ref'];
  const blur = await inspect(inesCookie, lumen.id, lumen.scenes['Main'], blurLayerId, {});
  ok('the blur readout matches the worked example', blur.data.readouts.blur === 'σ 4.00 · 25 taps', blur.data.readouts.blur);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
