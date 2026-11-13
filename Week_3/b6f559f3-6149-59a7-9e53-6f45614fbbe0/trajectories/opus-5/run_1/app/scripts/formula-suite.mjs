const BASE = 'http://localhost:4173';
const KEY = process.env.GRADING_KEY;

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ label, ok });
  if (!ok) console.log(`FAIL ${label} ${extra}`);
};

async function call(method, path, { body, session, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (session) init.headers.cookie = `hs_session=${session}`;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text.length ? JSON.parse(text) : null };
}

const grading = (path) => call('POST', `/api/grading/${path}`, { headers: { 'X-Grading-Key': KEY } });

await grading('reset');
const seed = (await grading('seed')).body;
const ines = seed.people['ines@lumenyard.test'].session;
const backdrop = seed.projects.Backdrop;
const blend = backdrop.scenes.Blend;
let opCounter = 0;

async function ops(projectId, sceneId, changes) {
  opCounter += 1;
  return call('POST', `/api/projects/${projectId}/ops`, {
    session: ines,
    body: { opId: `formula-${opCounter}`, sceneId, changes },
  });
}

async function inspect(projectId, query) {
  const params = new URLSearchParams(query);
  return call('GET', `/api/projects/${projectId}/inspect?${params}`, { session: ines });
}

// DP-35 blend modes at the pixel centre
const modes = {
  Normal: '#8F7A66 · rgb(143, 122, 102)',
  Multiply: '#2D4956 · rgb(45, 73, 86)',
  Screen: '#9597A9 · rgb(149, 151, 169)',
  Overlay: '#456A7C · rgb(69, 106, 124)',
  Darken: '#336666 · rgb(51, 102, 102)',
  Lighten: '#8F7A99 · rgb(143, 122, 153)',
};
for (const [mode, expected] of Object.entries(modes)) {
  await ops(backdrop.id, blend, [
    { type: 'updateLayer', layerId: backdrop.layers.Wash, set: { blendMode: mode } },
  ]);
  const out = await inspect(backdrop.id, { scene: blend, sampleX: '100', sampleY: '100' });
  check(`blend ${mode}`, out.body.readouts.sample === expected, out.body.readouts?.sample);
}
await ops(backdrop.id, blend, [
  { type: 'updateLayer', layerId: backdrop.layers.Wash, set: { blendMode: 'Normal' } },
]);

// DP-35 mask
await ops(backdrop.id, blend, [
  { type: 'updateLayer', layerId: backdrop.layers.Veil, set: { visible: true, opacity: 50 } },
  { type: 'updateLayer', layerId: backdrop.layers.Veil, set: { maskAbove: true } },
]);
const masked = await inspect(backdrop.id, { scene: blend, sampleX: '100', sampleY: '100' });
check('mask limits the layer above', masked.body.readouts.sample === '#617080 · rgb(97, 112, 128)', masked.body.readouts?.sample);
const outsideMask = await inspect(backdrop.id, { scene: blend, sampleX: '900', sampleY: '100' });
check(
  'outside the mask nothing draws',
  outsideMask.body.readouts.sample === '#336699 · rgb(51, 102, 153)',
  outsideMask.body.readouts?.sample,
);
await ops(backdrop.id, blend, [
  { type: 'updateLayer', layerId: backdrop.layers.Veil, set: { visible: false } },
  { type: 'updateLayer', layerId: backdrop.layers.Veil, set: { maskAbove: false } },
]);

// DP-36 gradient worked values
const ramp = backdrop.scenes.Ramp;
await ops(backdrop.id, ramp, [
  {
    type: 'updateLayer',
    layerId: backdrop.layers.Spectrum,
    set: {
      'gradient.stops': [
        { color: '#FF0000', position: 0 },
        { color: '#0000FF', position: 100 },
      ],
    },
  },
]);
const twoStop = await inspect(backdrop.id, { scene: ramp, sampleX: '359', sampleY: '100' });
check('two-stop gradient', twoStop.body.readouts.sample === '#BF0040 · rgb(191, 0, 64)', twoStop.body.readouts?.sample);

// DP-36 per-pixel effects
const grainScene = backdrop.scenes.Grain;
const grainSample = await inspect(backdrop.id, { scene: grainScene, sampleX: '10', sampleY: '20' });
check('grain', grainSample.body.readouts.sample === '#25588B · rgb(37, 88, 139)', grainSample.body.readouts?.sample);
await ops(backdrop.id, grainScene, [
  { type: 'updateLayer', layerId: backdrop.layers.Grain, set: { enabled: false } },
]);
const disabled = await inspect(backdrop.id, { scene: grainScene, sampleX: '10', sampleY: '20' });
check(
  'disabled effect passes pixels through',
  disabled.body.readouts.sample === '#336699 · rgb(51, 102, 153)',
  disabled.body.readouts?.sample,
);
await ops(backdrop.id, grainScene, [
  { type: 'updateLayer', layerId: backdrop.layers.Grain, set: { enabled: true } },
  { type: 'updateLayer', layerId: backdrop.layers.Grain, set: { 'effect.kind': 'Glow' } },
  { type: 'updateLayer', layerId: backdrop.layers.Grain, set: { 'effect.glowStrength': 2 } },
  { type: 'updateLayer', layerId: backdrop.layers.Grain, set: { 'effect.glowThreshold': 0.1 } },
]);
const glow = await inspect(backdrop.id, { scene: grainScene, sampleX: '10', sampleY: '20' });
const glowExpected = (() => {
  const channels = [51, 102, 153].map((value) => value / 255);
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const factor = 1 + 2 * Math.max(0, luminance - 0.1);
  const out = channels.map((value) => Math.floor(Math.min(1, value * factor) * 255 + 0.5));
  const hex = out.map((value) => value.toString(16).padStart(2, '0').toUpperCase()).join('');
  return `#${hex} · rgb(${out[0]}, ${out[1]}, ${out[2]})`;
})();
check('glow', glow.body.readouts.sample === glowExpected, `${glow.body.readouts?.sample} vs ${glowExpected}`);

// Blur and aberration readouts
await ops(backdrop.id, grainScene, [
  { type: 'updateLayer', layerId: backdrop.layers.Grain, set: { 'effect.kind': 'Blur' } },
  { type: 'updateLayer', layerId: backdrop.layers.Grain, set: { 'effect.blurRadius': 8 } },
]);
const blur = await inspect(backdrop.id, {
  scene: grainScene,
  layer: backdrop.layers.Grain,
});
check('blur readout', blur.body.readouts.blur === 'σ 4.00 · 25 taps', blur.body.readouts?.blur);
await ops(backdrop.id, grainScene, [
  { type: 'updateLayer', layerId: backdrop.layers.Grain, set: { 'effect.kind': 'Chromatic aberration' } },
]);
const aberration = await inspect(backdrop.id, {
  scene: grainScene,
  layer: backdrop.layers.Grain,
});
check(
  'aberration readout',
  aberration.body.readouts.aberration === 'R +4 px · B -4 px',
  aberration.body.readouts?.aberration,
);

// Pixelate reads the cell centre
const pixelateOps = await ops(backdrop.id, blend, [
  {
    type: 'addLayer',
    ref: 'dot',
    layer: {
      kind: 'Rectangle',
      name: 'Dot',
      props: { x: 0, y: 0, width: 4, height: 4, fill: '#FFFFFF', opacity: 100 },
    },
  },
  {
    type: 'addLayer',
    ref: 'pix',
    layer: { kind: 'Effect', name: 'Pixelate', props: { effect: { kind: 'Pixelate', pixelCell: 8 } } },
  },
]);
const pixelateId = pixelateOps.body.ids.pix;
const insideDot = await inspect(backdrop.id, { scene: blend, sampleX: '2', sampleY: '2' });
check(
  'pixelate reads the cell centre, not the dot',
  insideDot.body.readouts.sample === '#8F7A66 · rgb(143, 122, 102)',
  insideDot.body.readouts?.sample,
);
await ops(backdrop.id, blend, [
  { type: 'updateLayer', layerId: pixelateId, set: { enabled: false } },
]);
const withoutPixelate = await inspect(backdrop.id, { scene: blend, sampleX: '2', sampleY: '2' });
check(
  'without pixelate the dot shows',
  withoutPixelate.body.readouts.sample === '#FFFFFF · rgb(255, 255, 255)',
  withoutPixelate.body.readouts?.sample,
);

// DP-17 materials and draw order
const hero = seed.projects['Lumen hero'];
const heroScene = hero.scenes.Main;
await ops(hero.id, heroScene, [
  { type: 'updateLayer', layerId: hero.layers['Halo cube'], set: { 'material.kind': 'Glass' } },
  { type: 'updateLayer', layerId: hero.layers['Halo cube'], set: { 'material.refraction': 1 } },
]);
const glass = await inspect(hero.id, { scene: heroScene, layer: hero.layers['Halo cube'] });
check('IOR readout', glass.body.readouts.ior === 'IOR 1.250', glass.body.readouts?.ior);
const glassLate = await inspect(hero.id, {
  scene: heroScene,
  layer: hero.layers['Halo cube'],
  frame: '60',
});
check(
  'glass defaults applied',
  glassLate.body.values['material.color'] === '#B7A4FF' &&
    glassLate.body.values['material.opacity'] === 0.35,
  JSON.stringify([glassLate.body.values['material.color'], glassLate.body.values['material.opacity']]),
);
await ops(hero.id, heroScene, [
  { type: 'updateLayer', layerId: hero.layers['Halo cube'], set: { 'material.refraction': 2 } },
]);
const ior2 = await inspect(hero.id, { scene: heroScene, layer: hero.layers['Halo cube'] });
check('IOR at full refraction', ior2.body.readouts.ior === 'IOR 1.500', ior2.body.readouts?.ior);

await ops(hero.id, heroScene, [
  { type: 'updateLayer', layerId: hero.layers['Halo cube'], set: { faces: 'both' } },
]);
const bothSides = await inspect(hero.id, { scene: heroScene, layer: hero.layers['Halo cube'] });
check(
  'triangles drawn doubled',
  bothSides.body.readouts['triangles-drawn'] === 'Triangles drawn 24',
  bothSides.body.readouts?.['triangles-drawn'],
);
check(
  'both sides draw order',
  bothSides.body.drawOrder[0] === 'Halo cube · back faces' &&
    bothSides.body.drawOrder[1] === 'Halo cube · front faces',
  JSON.stringify(bothSides.body.drawOrder),
);
await ops(hero.id, heroScene, [
  { type: 'updateLayer', layerId: hero.layers['Halo cube'], set: { faces: 'front' } },
  { type: 'updateLayer', layerId: hero.layers['Halo cube'], set: { depthTest: false } },
]);
const depthOff = await inspect(hero.id, { scene: heroScene, layer: hero.layers['Halo cube'] });
check(
  'depth off draws on top',
  depthOff.body.drawOrder[depthOff.body.drawOrder.length - 1] === 'Halo cube · depth off · on top',
  JSON.stringify(depthOff.body.drawOrder),
);

// DP-16 SVG extrusion numbers
const svgForm = new FormData();
svgForm.set('kind', 'svg');
svgForm.set(
  'file',
  new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L200 0 L200 100 L0 100 Z"/></svg>'], {
    type: 'image/svg+xml',
  }),
  'square.svg',
);
const svgUpload = await fetch(`${BASE}/api/projects/${seed.projects['Logo forge'].id}/assets`, {
  method: 'POST',
  headers: { cookie: `hs_session=${ines}` },
  body: svgForm,
});
const svgAsset = (await svgUpload.json()).asset;
const logo = seed.projects['Logo forge'];
const added = await ops(logo.id, logo.scenes.Main, [
  {
    type: 'addLayer',
    ref: 'plate',
    layer: {
      kind: 'Extrusion',
      name: 'Plate',
      props: { source: 'svg', svgAssetId: svgAsset.id, depth: 0.2, bevelSize: 0 },
    },
  },
]);
const plateId = added.body.ids.plate;
const plate = await inspect(logo.id, { scene: logo.scenes.Main, layer: plateId, vertex: 'Outline 1' });
check('svg bounds', plate.body.readouts.bounds === 'Bounds 2.000 × 1.000 × 0.200', plate.body.readouts?.bounds);
check('svg triangles', plate.body.readouts.triangles === 'Triangles 12', plate.body.readouts?.triangles);
check(
  'svg outline vertex',
  plate.body.readouts['vertex-world'] === '-1.000, 0.500, 0.100',
  plate.body.readouts?.['vertex-world'],
);

// Text extrusion counts
const wordmark = logo.layers.Wordmark;
await ops(logo.id, logo.scenes.Main, [
  { type: 'updateLayer', layerId: wordmark, set: { bevelSize: 0 } },
]);
const noBevel = await inspect(logo.id, { scene: logo.scenes.Main, layer: wordmark });
check('text triangles without bevel', noBevel.body.readouts.triangles === 'Triangles 480', noBevel.body.readouts?.triangles);
check(
  'text bounds without bevel',
  noBevel.body.readouts.bounds === 'Bounds 2.700 × 1.000 × 0.200',
  noBevel.body.readouts?.bounds,
);
await ops(logo.id, logo.scenes.Main, [
  { type: 'updateLayer', layerId: wordmark, set: { bevelSize: 0.02 } },
  { type: 'updateLayer', layerId: wordmark, set: { bevelSegments: 2 } },
]);
const twoSegments = await inspect(logo.id, { scene: logo.scenes.Main, layer: wordmark });
check(
  'text triangles with two bevel segments',
  twoSegments.body.readouts.triangles === 'Triangles 1760',
  twoSegments.body.readouts?.triangles,
);

// DP-14 Not visible
await ops(hero.id, heroScene, [
  { type: 'updateLayer', layerId: hero.layers['Halo cube'], set: { 'position.z': 100 } },
]);
const behind = await inspect(hero.id, { scene: heroScene, layer: hero.layers['Halo cube'] });
check('not visible', behind.body.readouts['screen-point'] === 'Not visible', behind.body.readouts?.['screen-point']);

// DP-28 easing presets through keyframes
const easing = seed.projects['Easing lab'];
const blank = easing.layers.Blank;
const easingExpectations = {
  linear: 50,
  ease: 80.2,
  'ease-in': 31.5,
  'ease-out': 68.5,
  'ease-in-out': 50,
  glide: 96.1,
  anticipate: -8.7,
  elastic: 101.6,
  bouncy: 76.6,
};
for (const [name, expected] of Object.entries(easingExpectations)) {
  await ops(easing.id, easing.scenes.Main, [
    {
      type: 'setKeyframe',
      layerId: blank,
      property: 'rotation.y',
      frame: 0,
      value: 0,
      easing: name,
    },
  ]);
  await ops(easing.id, easing.scenes.Main, [
    { type: 'setKeyframe', layerId: blank, property: 'rotation.y', frame: 60, value: 100, easing: 'linear' },
  ]);
  const out = await inspect(easing.id, { scene: easing.scenes.Main, layer: blank, frame: '30' });
  const value = out.body.values['rotation.y'];
  check(`easing ${name}`, Math.abs(value - expected) < 0.05, `${value} vs ${expected}`);
}

// DP-31 override then clear
await ops(hero.id, heroScene, [
  {
    type: 'updateLayer',
    layerId: hero.layers.Sparks,
    set: { rate: 10 },
    breakpoint: 'mobile',
  },
]);
const mobileRate = await inspect(hero.id, {
  scene: heroScene,
  layer: hero.layers.Sparks,
  breakpoint: 'mobile',
});
check('mobile override', mobileRate.body.values.rate === 10 && mobileRate.body.sources.rate === 'Mobile');
await ops(hero.id, heroScene, [
  { type: 'clearOverride', layerId: hero.layers.Sparks, breakpoint: 'mobile', path: 'rate' },
]);
const clearedRate = await inspect(hero.id, {
  scene: heroScene,
  layer: hero.layers.Sparks,
  breakpoint: 'mobile',
});
check(
  'override cleared',
  clearedRate.body.values.rate === 60 && clearedRate.body.sources.rate === 'Desktop',
  JSON.stringify([clearedRate.body.values.rate, clearedRate.body.sources.rate]),
);

// DP-25 reduced motion still states
const banner = seed.projects['Banner test'];
const reducedCloth = await inspect(banner.id, {
  scene: banner.scenes.Main,
  layer: banner.layers.Banner,
  frame: '60',
  point: 'R4 C1',
  reducedMotion: '1',
});
check(
  'reduced motion shows frame 0 cloth',
  reducedCloth.body.readouts['cloth-point'] === 'Cloth point R4 C1 at -0.150, -0.300, 0.000',
  reducedCloth.body.readouts?.['cloth-point'],
);
const reducedOrbit = await inspect(seed.projects['Orbit study'].id, {
  scene: seed.projects['Orbit study'].scenes.Main,
  layer: seed.projects['Orbit study'].layers.Probe,
  scroll: '0',
  reducedMotion: '1',
});
check(
  'reduced motion shows the end angle',
  reducedOrbit.body.readouts['camera-azimuth'] === 'Camera azimuth 90.000°',
  reducedOrbit.body.readouts?.['camera-azimuth'],
);
const reducedTilt = await inspect(seed.projects['Orbit study'].id, {
  scene: seed.projects['Orbit study'].scenes.Main,
  layer: seed.projects['Orbit study'].layers.Probe,
  reducedMotion: '1',
});
check(
  'tilt rests under reduced motion',
  reducedTilt.body.readouts['tilt-x'] === 'Tilt X 0.000' &&
    reducedTilt.body.readouts['tilt-y'] === 'Tilt Y 0.000',
  JSON.stringify([reducedTilt.body.readouts?.['tilt-x'], reducedTilt.body.readouts?.['tilt-y']]),
);

// DP-20 clip sampling rules
const bay = seed.projects['Model bay'];
const swing = bay.layers.Swing;
await ops(bay.id, bay.scenes.Main, [
  {
    type: 'updateLayer',
    layerId: swing,
    set: {
      clips: [
        { name: 'Turn', play: true, loop: true, speed: 1.5, offsetMs: 0 },
        { name: 'Hop', play: false, loop: false, speed: 1, offsetMs: 0 },
      ],
    },
  },
]);
const looped = await inspect(bay.id, { scene: bay.scenes.Main, layer: swing, frame: '156', node: 'Arm' });
check(
  'looping clip time',
  looped.body.readouts['clip-time:Turn'] === 'Turn 1.900 s',
  looped.body.readouts?.['clip-time:Turn'],
);
check(
  'looping quaternion',
  looped.body.readouts['node-quaternion'] === 'Quaternion 0.0000, 0.6788, 0.0000, 0.7343',
  looped.body.readouts?.['node-quaternion'],
);
await ops(bay.id, bay.scenes.Main, [
  {
    type: 'updateLayer',
    layerId: swing,
    set: {
      clips: [
        { name: 'Turn', play: true, loop: false, speed: 1.5, offsetMs: 0 },
        { name: 'Hop', play: true, loop: false, speed: 1, offsetMs: 0 },
      ],
    },
  },
]);
const clamped = await inspect(bay.id, { scene: bay.scenes.Main, layer: swing, frame: '156', node: 'Arm' });
check(
  'non-looping clip clamps',
  clamped.body.readouts['clip-time:Turn'] === 'Turn 2.000 s',
  clamped.body.readouts?.['clip-time:Turn'],
);
const step = await inspect(bay.id, { scene: bay.scenes.Main, layer: swing, frame: '20', node: 'Foot' });
check(
  'STEP holds the earlier key',
  step.body.readouts['node-translation'] === 'Translation 0.000, 0.000, 0.000',
  step.body.readouts?.['node-translation'],
);
const stepAfter = await inspect(bay.id, { scene: bay.scenes.Main, layer: swing, frame: '45', node: 'Foot' });
check(
  'STEP after the second key',
  stepAfter.body.readouts['node-translation'] === 'Translation 0.000, 1.000, 0.000',
  stepAfter.body.readouts?.['node-translation'],
);

// DP-23 trail points
const drift = seed.projects['Logo forge'].layers.Drift;
const trail = await inspect(logo.id, {
  scene: logo.scenes.Main,
  layer: drift,
  frame: '4',
  particle: '1',
});
check('trail points', trail.body.readouts['trail-points'] === 'Trail points 5', trail.body.readouts?.['trail-points']);
const trailLater = await inspect(logo.id, {
  scene: logo.scenes.Main,
  layer: drift,
  frame: '40',
  particle: '1',
});
check(
  'trail capped at the trail length',
  trailLater.body.readouts['trail-points'] === 'Trail points 8',
  trailLater.body.readouts?.['trail-points'],
);

const failed = results.filter((entry) => !entry.ok).length;
console.log(`${results.length - failed}/${results.length} formula checks passed`);
