// The WebGL sky dome: hemisphere, horizon rim, treeline band from the horizon mask, target track tubes,
// the lit Moon and a star field fixed to local sidereal time. Renders on demand; nothing loops while idle.
import * as THREE from '/assets/vendor/three/three.module.js';
import { angleDelta, lerp, tween } from './motion.js';
import { dimAlpha } from './sky-draw.js';

const BINS = 72;
const BIN_WIDTH = 5;
const SURFACE = 1;
const TRACK_RADIUS = 0.985;
const FOCUS_HEIGHT = 0.3;
const CAMERA_DISTANCE = 3.3;
const WIDE_ASPECT = 1.3;
const WIDE_FIT = 0.84;
const STAR_COUNT = 1200;
const BRIGHT_STAR_COUNT = 70;
const RAD = Math.PI / 180;
const TRACK_PALE = new THREE.Color('#d9fbff');
const CYAN = new THREE.Color('#22d3ee');

function direction(altitude, azimuth, radius) {
  const up = altitude * RAD;
  const around = azimuth * RAD;
  return new THREE.Vector3(Math.cos(up) * Math.sin(around), Math.sin(up), -Math.cos(up) * Math.cos(around)).multiplyScalar(radius);
}

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function starField(count, size, seed) {
  const random = seeded(seed);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  for (let star = 0; star < count; star += 1) {
    const pole = random() * 2 - 1;
    const turn = random() * 2 * Math.PI;
    const ring = Math.sqrt(1 - pole * pole);
    positions.set([ring * Math.cos(turn) * 0.995, ring * Math.sin(turn) * 0.995, pole * 0.995], star * 3);
    const level = 0.3 + 0.7 * random() ** 3;
    colours.set([0.78 * level, 0.9 * level, level], star * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false });
  return new THREE.Points(geometry, material);
}

function wireframe() {
  const points = [];
  for (const altitude of [30, 60]) {
    for (let step = 0; step < 96; step += 1) {
      points.push(direction(altitude, (step * 360) / 96, SURFACE), direction(altitude, ((step + 1) * 360) / 96, SURFACE));
    }
  }
  for (const azimuth of [0, 90, 180, 270]) {
    for (let step = 0; step < 24; step += 1) {
      points.push(direction((step * 90) / 24, azimuth, SURFACE), direction(((step + 1) * 90) / 24, azimuth, SURFACE));
    }
  }
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x6f93bd, transparent: true, opacity: 0.28 }));
  return lines;
}

function disposeChildren(group) {
  for (const child of [...group.children]) {
    child.geometry.dispose();
    child.material.dispose();
    group.remove(child);
  }
}

export function createDomeScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  const aboveHorizon = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  scene.add(new THREE.Mesh(new THREE.SphereGeometry(SURFACE, 64, 24, 0, 2 * Math.PI, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1b3a63, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false })));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(SURFACE, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x050a14, transparent: true, opacity: 0.6, depthWrite: false }));
  floor.position.y = -0.001;
  scene.add(floor, wireframe());
  scene.add(new THREE.Mesh(new THREE.TorusGeometry(SURFACE, 0.007, 8, 160).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9fd3e6 })));

  const stars = new THREE.Group();
  stars.matrixAutoUpdate = false;
  for (const [count, size, seed] of [[STAR_COUNT, 1.5, 7], [BRIGHT_STAR_COUNT, 2.6, 19]]) {
    const points = starField(count, size, seed);
    points.material.clippingPlanes = [aboveHorizon];
    stars.add(points);
  }
  scene.add(stars);

  const band = new THREE.Group();
  const tracks = new THREE.Group();
  const targets = new THREE.Group();
  scene.add(band, tracks, targets);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.055, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xdfe6f2, roughness: 1, metalness: 0 }));
  const sunlight = new THREE.DirectionalLight(0xffffff, 3);
  scene.add(moon, sunlight, new THREE.AmbientLight(0x9fb4d0, 0.12));

  let view = { elevation: 35, azimuth: 180, zoom: 1 };
  let mask = null;
  let latitude = null;
  let plan = null;
  let trackKey = '';
  let siderealTime = 0;
  const dots = new Map();
  let slide = null;
  let dim = null;

  function render(next) {
    if (next) view = next;
    const distance = (camera.aspect > WIDE_ASPECT ? WIDE_FIT : 1) * CAMERA_DISTANCE / view.zoom;
    const up = view.elevation * RAD;
    const around = view.azimuth * RAD;
    camera.position.set(distance * Math.cos(up) * Math.sin(around), FOCUS_HEIGHT + distance * Math.sin(up), -distance * Math.cos(up) * Math.cos(around));
    camera.lookAt(0, FOCUS_HEIGHT, 0);
    renderer.render(scene, camera);
  }

  function turnStars() {
    if (latitude === null) return;
    const hour = siderealTime * RAD;
    const phi = latitude * RAD;
    const [sinH, cosH, sinP, cosP] = [Math.sin(hour), Math.cos(hour), Math.sin(phi), Math.cos(phi)];
    stars.matrix.set(
      -sinH, cosH, 0, 0,
      cosP * cosH, cosP * sinH, sinP, 0,
      sinP * cosH, sinP * sinH, -cosP, 0,
      0, 0, 0, 1,
    );
    stars.matrixWorldNeedsUpdate = true;
  }

  function buildBand() {
    disposeChildren(band);
    const positions = [];
    const edge = [];
    for (let bin = 0; bin < BINS; bin += 1) {
      const wobble = 1 + 0.03 * Math.sin(bin * 12.9898 + 4.1);
      const top = Math.min(89, mask[bin] * wobble);
      const [west, east] = [bin * BIN_WIDTH, (bin + 1) * BIN_WIDTH];
      const corners = [direction(-1.5, west, 1.004), direction(-1.5, east, 1.004), direction(top, east, 1.004), direction(top, west, 1.004)];
      positions.push(corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]);
      edge.push(corners[3], corners[2]);
    }
    band.add(new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(positions),
      new THREE.MeshBasicMaterial({ color: 0x02050b, side: THREE.DoubleSide })));
    band.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edge),
      new THREE.LineBasicMaterial({ color: 0x4a6a8f })));
  }

  function buildTracks() {
    disposeChildren(tracks);
    for (const target of plan.targets) {
      const runs = [];
      let run = [];
      for (const sample of target.arc) {
        if (sample.altitude_deg >= 0) run.push(sample);
        else { runs.push(run); run = []; }
      }
      runs.push(run);
      for (const samples of runs.filter((entry) => entry.length >= 2)) {
        const curve = new THREE.CatmullRomCurve3(samples.map((sample) => direction(sample.altitude_deg, sample.azimuth_deg, TRACK_RADIUS)));
        const segments = samples.length * 3;
        const tube = new THREE.TubeGeometry(curve, segments, 0.011, 6, false);
        tracks.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: TRACK_PALE, toneMapped: false })));
        tracks.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, 0.028, 8, false),
          new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending })));
      }
    }
  }

  function syncTracks() {
    if (!plan || !mask) return;
    const key = JSON.stringify([plan.date, plan.min_altitude_deg, plan.targets.map((target) => [target.project_id, target.arc.length, target.arc[target.arc.length >> 1].altitude_deg])]);
    if (key === trackKey) return;
    trackKey = key;
    buildTracks();
  }

  function placeDot(dot) {
    const at = direction(dot.altitude, dot.azimuth, TRACK_RADIUS);
    dot.core.position.copy(at);
    dot.halo.position.copy(at);
    dot.core.material.opacity = dot.alpha;
    dot.halo.material.opacity = 0.25 * dot.alpha;
  }

  function syncDots() {
    const wanted = new Map(plan.targets.map((target) => [target.project_id, target]));
    for (const [projectId, dot] of dots) {
      if (wanted.has(projectId)) continue;
      targets.remove(dot.core, dot.halo);
      dot.core.geometry.dispose();
      dot.halo.geometry.dispose();
      dot.core.material.dispose();
      dot.halo.material.dispose();
      dots.delete(projectId);
    }
    for (const [projectId, target] of wanted) {
      if (dots.has(projectId)) continue;
      const dot = {
        core: new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), new THREE.MeshBasicMaterial({ color: TRACK_PALE, transparent: true })),
        halo: new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
        altitude: target.altitude_deg, azimuth: target.azimuth_deg, alpha: dimAlpha(target.position_status),
      };
      targets.add(dot.core, dot.halo);
      placeDot(dot);
      dots.set(projectId, dot);
    }
  }

  function placeMoon() {
    moon.visible = plan.moon.altitude_deg >= 0;
    moon.position.copy(direction(plan.moon.altitude_deg, plan.moon.azimuth_deg, TRACK_RADIUS));
    sunlight.position.copy(direction(plan.sun.altitude_deg, plan.sun.azimuth_deg, 6));
  }

  return {
    render,
    resize(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    setHorizon(altitudes) {
      mask = altitudes;
      buildBand();
      syncTracks();
    },
    setLatitude(degrees) {
      latitude = degrees;
      turnStars();
    },
    // setPlan(plan, {staged}): staged turns the stars and slides the dots, then dims or brightens them 100 ms later.
    setPlan(next, { staged }) {
      plan = next;
      syncTracks();
      syncDots();
      placeMoon();
      if (slide) slide.cancel();
      if (dim) dim.cancel();
      const wanted = new Map(plan.targets.map((target) => [target.project_id, target]));
      const start = new Map([...dots].map(([projectId, dot]) => [projectId, { altitude: dot.altitude, azimuth: dot.azimuth, alpha: dot.alpha }]));
      const startTime = siderealTime;
      const finish = (progress, alphaProgress) => {
        siderealTime = startTime + angleDelta(startTime, plan.local_sidereal_time_deg) * progress;
        for (const [projectId, dot] of dots) {
          const from = start.get(projectId);
          const target = wanted.get(projectId);
          dot.altitude = lerp(from.altitude, target.altitude_deg, progress);
          dot.azimuth = from.azimuth + angleDelta(from.azimuth, target.azimuth_deg) * progress;
          dot.alpha = lerp(from.alpha, dimAlpha(target.position_status), alphaProgress);
          placeDot(dot);
        }
        turnStars();
        render();
      };
      if (!staged) {
        finish(1, 1);
        return;
      }
      let slid = 0;
      let dimmed = 0;
      slide = tween({ duration: 160, update(progress) { slid = progress; finish(progress, dimmed); } });
      dim = tween({ duration: 160, delay: 100, update(progress) { dimmed = progress; finish(slid, progress); } });
    },
  };
}
