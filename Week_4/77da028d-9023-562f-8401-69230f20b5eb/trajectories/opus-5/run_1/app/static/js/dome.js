/* The 3D sky dome: the hemisphere, the treeline band built from the 72-bin
   horizon mask, target track tubes, the lit Moon and a sidereal star field. */

import * as THREE from '/vendor/three.module.js';
import { reducedMotion } from './dom.js';

export const RESET_VIEW = { elevation: 35, azimuth: 180, zoom: 1.0 };
const LIMITS = { elevation: [5, 85], zoom: [0.6, 2.0] };
const DOME_RADIUS = 10;
const STAR_COUNT = 900;

export function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (probe.getContext('webgl2') || probe.getContext('webgl')),
    );
  } catch (_) {
    return false;
  }
}

function clamp(value, [low, high]) {
  return Math.min(high, Math.max(low, value));
}

function direction(altitudeDeg, azimuthDeg, radius) {
  const altitude = (altitudeDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const horizontal = Math.cos(altitude) * radius;
  return new THREE.Vector3(
    horizontal * Math.sin(azimuth),
    Math.sin(altitude) * radius,
    -horizontal * Math.cos(azimuth),
  );
}

export class SkyDome {
  constructor(canvas) {
    this.canvas = canvas;
    this.view = { ...RESET_VIEW };
    this.target = { ...RESET_VIEW };
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05080f');
    this.camera = new THREE.PerspectiveCamera(46, 1.6, 0.1, 200);
    this.scene.add(new THREE.AmbientLight('#20314d', 2.1));
    this.sunLight = new THREE.DirectionalLight('#ffffff', 2.6);
    this.scene.add(this.sunLight);
    this.groups = {};
    this.#buildStaticParts();
    this.resize();
  }

  #buildStaticParts() {
    const hemisphere = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: '#0c1830',
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.45,
      }),
    );
    this.scene.add(hemisphere);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(DOME_RADIUS, 0.045, 8, 160),
      new THREE.MeshBasicMaterial({ color: '#4fe3f2' }),
    );
    rim.rotation.x = Math.PI / 2;
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(DOME_RADIUS, 96),
      new THREE.MeshBasicMaterial({ color: '#070d18' }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);

    for (const name of ['treeline', 'tracks', 'moon', 'stars']) {
      this.groups[name] = new THREE.Group();
      this.scene.add(this.groups[name]);
    }
  }

  #clearGroup(name) {
    const group = this.groups[name];
    while (group.children.length) {
      const child = group.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  /** A dark band rising from the rim that follows the 72 mask bins exactly. */
  setHorizonMask(mask) {
    this.#clearGroup('treeline');
    const material = new THREE.MeshBasicMaterial({
      color: '#081020',
      side: THREE.DoubleSide,
    });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: '#3d8aa6' });
    const positions = [];
    const edge = [];
    for (let bin = 0; bin < mask.length; bin += 1) {
      const from = (bin * 5 * Math.PI) / 180;
      const to = ((bin + 1) * 5 * Math.PI) / 180;
      const height = (mask[bin] / 90) * DOME_RADIUS * 0.92;
      const radius = DOME_RADIUS * 0.995;
      const a = [radius * Math.sin(from), 0, -radius * Math.cos(from)];
      const b = [radius * Math.sin(to), 0, -radius * Math.cos(to)];
      positions.push(
        a[0], a[1], a[2], b[0], b[1], b[2], b[0], height, b[2],
        a[0], a[1], a[2], b[0], height, b[2], a[0], height, a[2],
      );
      edge.push(a[0], height, a[2], b[0], height, b[2]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeVertexNormals();
    this.groups.treeline.add(new THREE.Mesh(geometry, material));
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(edge, 3),
    );
    this.groups.treeline.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
  }

  /** Glowing tubes for each target's night track, plus a dot at the minute. */
  setTargets(targets, mask) {
    this.#clearGroup('tracks');
    for (const target of targets) {
      for (const run of this.#trackRuns(target.arc, mask)) {
        const curve = new THREE.CatmullRomCurve3(
          run.samples.map((sample) =>
            direction(sample.altitude_deg, sample.azimuth_deg, DOME_RADIUS * 0.97),
          ),
        );
        this.groups.tracks.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(
              curve,
              Math.max(16, run.samples.length * 2),
              run.clear ? 0.065 : 0.04,
              7,
              false,
            ),
            new THREE.MeshBasicMaterial({
              color: run.clear ? '#dff4ff' : '#8fb4cc',
              transparent: true,
              opacity: run.clear ? 0.92 : 0.3,
            }),
          ),
        );
      }
      if (target.altitude_deg <= 0) continue;
      const clear = target.position_status === 'clear';
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(clear ? 0.22 : 0.16, 18, 12),
        new THREE.MeshBasicMaterial({
          color: clear ? '#eaf6ff' : '#5c7694',
          transparent: true,
          opacity: clear ? 1 : 0.4,
        }),
      );
      dot.position.copy(
        direction(target.altitude_deg, target.azimuth_deg, DOME_RADIUS * 0.97),
      );
      this.groups.tracks.add(dot);
    }
  }

  /** Splits a night track into runs above and behind the painted treeline. */
  #trackRuns(arc, mask) {
    const runs = [];
    let current = null;
    for (const sample of arc) {
      if (sample.altitude_deg <= 0) {
        current = null;
        continue;
      }
      const bin = Math.floor((((sample.azimuth_deg % 360) + 360) % 360) / 5);
      const clear = sample.altitude_deg >= mask[bin];
      if (!current || current.clear !== clear) {
        const previous = current;
        current = { clear, samples: [] };
        if (previous && previous.samples.length) {
          current.samples.push(previous.samples[previous.samples.length - 1]);
        }
        runs.push(current);
      }
      current.samples.push(sample);
    }
    return runs.filter((run) => run.samples.length > 1);
  }

  /** A sphere lit from the server's Sun direction, so the lit fraction matches. */
  setMoon(moon, sun) {
    this.#clearGroup('moon');
    if (moon.altitude_deg < -8) return;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 32, 24),
      new THREE.MeshStandardMaterial({
        color: '#e8eef8',
        roughness: 1,
        metalness: 0,
      }),
    );
    sphere.position.copy(
      direction(moon.altitude_deg, moon.azimuth_deg, DOME_RADIUS * 0.9),
    );
    this.groups.moon.add(sphere);
    const sunDirection = direction(sun.altitude_deg, sun.azimuth_deg, 40);
    this.sunLight.position.copy(sunDirection);
    this.sunLight.target = sphere;
  }

  /** Fine points fixed to the local sidereal time. */
  setStars(siderealDeg, latitude) {
    this.#clearGroup('stars');
    const positions = [];
    let seed = 20261103;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const latitudeRad = (latitude * Math.PI) / 180;
    for (let index = 0; index < STAR_COUNT; index += 1) {
      const rightAscension = random() * 360;
      const declination = Math.asin(random() * 2 - 1) * (180 / Math.PI);
      const hourAngle = ((siderealDeg - rightAscension) * Math.PI) / 180;
      const declinationRad = (declination * Math.PI) / 180;
      const altitude = Math.asin(
        Math.sin(declinationRad) * Math.sin(latitudeRad) +
          Math.cos(declinationRad) * Math.cos(latitudeRad) * Math.cos(hourAngle),
      );
      if (altitude <= 0.02) continue;
      const north =
        Math.sin(declinationRad) * Math.cos(latitudeRad) -
        Math.cos(declinationRad) * Math.sin(latitudeRad) * Math.cos(hourAngle);
      const east = -Math.cos(declinationRad) * Math.sin(hourAngle);
      const azimuth = Math.atan2(east, north) * (180 / Math.PI);
      const spot = direction(
        (altitude * 180) / Math.PI,
        azimuth,
        DOME_RADIUS * 0.985,
      );
      positions.push(spot.x, spot.y, spot.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.groups.stars.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: '#cfe2f7',
          size: 0.075,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.85,
        }),
      ),
    );
  }

  resize() {
    const width = this.canvas.clientWidth || 480;
    const height = Math.round(width * 0.6);
    this.canvas.style.height = `${height}px`;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  orbit(deltaElevation, deltaAzimuth) {
    this.target.elevation = clamp(
      this.target.elevation + deltaElevation,
      LIMITS.elevation,
    );
    this.target.azimuth = (this.target.azimuth + deltaAzimuth + 360) % 360;
    this.#settle();
  }

  changeZoom(delta) {
    this.target.zoom = clamp(
      Math.round((this.target.zoom + delta) * 100) / 100,
      LIMITS.zoom,
    );
    this.#settle();
  }

  resetView() {
    this.target = { ...RESET_VIEW };
    this.#settle();
  }

  #settle() {
    if (reducedMotion()) {
      this.view = { ...this.target };
      this.draw();
      this.#notify();
      return;
    }
    if (this.easing) return;
    const started = performance.now();
    const from = { ...this.view };
    const step = (now) => {
      const progress = Math.min(1, (now - started) / 160);
      const eased = 1 - (1 - progress) * (1 - progress);
      let turn = ((this.target.azimuth - from.azimuth + 540) % 360) - 180;
      this.view = {
        elevation: from.elevation + (this.target.elevation - from.elevation) * eased,
        azimuth: (from.azimuth + turn * eased + 360) % 360,
        zoom: from.zoom + (this.target.zoom - from.zoom) * eased,
      };
      this.draw();
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        this.easing = false;
        this.view = { ...this.target };
        this.draw();
        this.#notify();
      }
    };
    this.easing = true;
    requestAnimationFrame(step);
  }

  #notify() {
    if (this.onSettled) this.onSettled(this.cameraReading());
  }

  cameraReading() {
    return {
      elevation: Math.round(this.target.elevation),
      azimuth: Math.round(this.target.azimuth) % 360,
      zoom: this.target.zoom,
    };
  }

  draw() {
    const elevation = (this.view.elevation * Math.PI) / 180;
    const azimuth = (this.view.azimuth * Math.PI) / 180;
    const distance = 26 / this.view.zoom;
    this.camera.position.set(
      distance * Math.cos(elevation) * Math.sin(azimuth),
      distance * Math.sin(elevation),
      -distance * Math.cos(elevation) * Math.cos(azimuth),
    );
    this.camera.lookAt(0, DOME_RADIUS * 0.22, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
