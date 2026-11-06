// The five fittings, built in code from turned (lathe) and extruded shapes. Units are metres; each model's light
// leaves from its origin and points down -Y.
import * as THREE from "three";
import { poolRadiusMm } from "../../shared/lightpool";
import { FINISH_COLOURS, lightColour, type FittingKind } from "../lib/format";

const METALLIC: Record<string, { metalness: number; roughness: number }> = {
  BR: { metalness: 0.85, roughness: 0.38 },
  BZ: { metalness: 0.7, roughness: 0.5 },
  SN: { metalness: 0.85, roughness: 0.32 },
};

function finishMaterial(finish: string): THREE.MeshStandardMaterial {
  const metal = METALLIC[finish] ?? { metalness: 0.05, roughness: 0.82 };
  return new THREE.MeshStandardMaterial({ color: FINISH_COLOURS[finish] ?? "#888888", side: THREE.DoubleSide, ...metal });
}

function lathe(points: [number, number][], material: THREE.Material, segments = 64): THREE.Mesh {
  return new THREE.Mesh(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments), material);
}

function box(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

/** A rounded-rectangle profile extruded along Z: the track rail and adaptor. */
function extrudedBar(width: number, height: number, length: number, radius: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  shape.moveTo(-w + radius, -h);
  shape.lineTo(w - radius, -h);
  shape.quadraticCurveTo(w, -h, w, -h + radius);
  shape.lineTo(w, h - radius);
  shape.quadraticCurveTo(w, h, w - radius, h);
  shape.lineTo(-w + radius, h);
  shape.quadraticCurveTo(-w, h, -w, h - radius);
  shape.lineTo(-w, -h + radius);
  shape.quadraticCurveTo(-w, -h, -w + radius, -h);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 6 });
  geometry.translate(0, 0, -length / 2);
  return new THREE.Mesh(geometry, material);
}

const DARK = new THREE.MeshStandardMaterial({ color: "#0d0f12", roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
const REFLECTOR = new THREE.MeshStandardMaterial({ color: "#c9c4bb", roughness: 0.18, metalness: 0.95, side: THREE.DoubleSide });

export interface FittingModel {
  group: THREE.Group;
  finish: THREE.MeshStandardMaterial;
  lens: THREE.MeshBasicMaterial;
}

/** Builds a fitting in its finish. The lens glows in the light colour. */
export function buildFitting(kind: FittingKind, finish: string, cct: number): FittingModel {
  const group = new THREE.Group();
  const body = finishMaterial(finish);
  const lens = new THREE.MeshBasicMaterial({ color: lightColour(cct) });
  const lensDisc = (radius: number, y: number) => {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), lens);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = y;
    group.add(disc);
  };
  switch (kind) {
    case "recessed": {
      // Trim flange, deep glare-free reflector, and the housing with heat-sink fins above the ceiling line.
      group.add(lathe([[0.03, 0.004], [0.062, 0], [0.066, 0.006], [0.044, 0.012], [0.036, 0.07], [0.03, 0.07]], body));
      group.add(lathe([[0.022, 0.03], [0.036, 0.012], [0.035, 0.068], [0.024, 0.068]], REFLECTOR));
      group.add(lathe([[0, 0.07], [0.046, 0.07], [0.046, 0.12], [0, 0.12]], DARK, 32));
      for (let i = 0; i < 10; i++) {
        const fin = box(0.004, 0.05, 0.03, DARK);
        const angle = (i / 10) * Math.PI * 2;
        fin.position.set(Math.cos(angle) * 0.055, 0.12, Math.sin(angle) * 0.055);
        fin.rotation.y = -angle;
        group.add(fin);
      }
      lensDisc(0.022, 0.03);
      break;
    }
    case "track": {
      // Track rail, adaptor, stem and a cylindrical head with a cooling-ring band.
      const rail = extrudedBar(0.034, 0.03, 0.9, 0.004, DARK);
      rail.position.y = 0.33;
      group.add(rail);
      const adaptor = extrudedBar(0.05, 0.04, 0.09, 0.006, body);
      adaptor.position.y = 0.295;
      group.add(adaptor);
      group.add(lathe([[0.006, 0.275], [0.006, 0.16]], body, 16));
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.014, 24, 16), body);
      knuckle.position.y = 0.155;
      group.add(knuckle);
      group.add(lathe([[0.034, 0], [0.04, 0.004], [0.04, 0.14], [0.03, 0.15], [0, 0.15]], body));
      for (let i = 0; i < 6; i++) group.add(lathe([[0.0415, 0.06 + i * 0.012], [0.0415, 0.066 + i * 0.012]], DARK, 48));
      group.add(lathe([[0.022, 0.02], [0.034, 0.002], [0.034, 0.03], [0.022, 0.03]], REFLECTOR));
      lensDisc(0.022, 0.02);
      break;
    }
    case "pendant": {
      // Canopy, cord and a spun dome that opens downward.
      group.add(lathe([[0, 0.72], [0.06, 0.72], [0.058, 0.7], [0.012, 0.69], [0, 0.69]], body));
      group.add(lathe([[0.0025, 0.69], [0.0025, 0.16]], DARK, 12));
      group.add(lathe([[0.016, 0.16], [0.016, 0.13], [0.02, 0.125]], body, 32));
      group.add(
        lathe(
          [[0.02, 0.125], [0.06, 0.11], [0.1, 0.075], [0.125, 0.035], [0.135, 0.004], [0.138, 0], [0.13, 0.006], [0.118, 0.034], [0.093, 0.07], [0.05, 0.1], [0.02, 0.112]],
          body,
          96,
        ),
      );
      const diffuser = new THREE.Mesh(
        new THREE.CircleGeometry(0.115, 64),
        new THREE.MeshBasicMaterial({ color: lightColour(cct), transparent: true, opacity: 0.55 }),
      );
      diffuser.rotation.x = Math.PI / 2;
      diffuser.position.y = 0.03;
      group.add(diffuser);
      lensDisc(0.03, 0.09);
      break;
    }
    case "cylinder": {
      // Surface plate and a tall cylinder with a recessed lens.
      group.add(lathe([[0, 0.2], [0.05, 0.2], [0.05, 0.194], [0.04, 0.19]], body));
      group.add(lathe([[0.036, 0.19], [0.036, 0.002], [0.032, 0], [0.026, 0.006], [0.026, 0.02]], body));
      group.add(lathe([[0.016, 0.022], [0.026, 0.006], [0.026, 0.024], [0.016, 0.024]], REFLECTOR));
      lensDisc(0.016, 0.022);
      break;
    }
    case "gimbal": {
      // Square-edged trim, a gimbal ring on two pivots, and a tilted lamp body inside it.
      group.add(lathe([[0.045, 0.006], [0.068, 0], [0.07, 0.008], [0.05, 0.014], [0.048, 0.03]], body));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.004, 12, 64), body);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.022;
      group.add(ring);
      const lamp = new THREE.Group();
      lamp.add(lathe([[0.032, 0], [0.036, 0.004], [0.036, 0.07], [0, 0.074]], body));
      lamp.add(lathe([[0.018, 0.012], [0.03, 0.002], [0.03, 0.014], [0.018, 0.014]], REFLECTOR));
      const lampLens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 32), lens);
      lampLens.rotation.x = Math.PI / 2;
      lampLens.position.y = 0.012;
      lamp.add(lampLens);
      lamp.rotation.z = THREE.MathUtils.degToRad(12);
      lamp.position.y = 0.006;
      group.add(lamp);
      for (const side of [-1, 1]) {
        const pivot = box(0.01, 0.012, 0.01, body);
        pivot.position.set(0.044 * side, 0.03, 0);
        group.add(pivot);
      }
      break;
    }
  }
  return { group, finish: body, lens };
}

const CONE_VERTEX = /* glsl */ `
  varying float vAlong;
  void main() {
    vAlong = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const CONE_FRAGMENT = /* glsl */ `
  uniform vec3 colour;
  uniform float strength;
  varying float vAlong;
  void main() {
    float fade = pow(vAlong, 1.6);
    gl_FragColor = vec4(colour, strength * fade);
  }`;

/** An open cone of light: unit height, base radius 1, apex at the origin. Scale it to height and pool radius. */
export function lightCone(cct: number, strength: number): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.CylinderGeometry(0.02, 1, 1, 64, 1, true);
  geometry.translate(0, -0.5, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: { colour: { value: new THREE.Color(lightColour(cct)) }, strength: { value: strength } },
    vertexShader: CONE_VERTEX,
    fragmentShader: CONE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

const POOL_FRAGMENT = /* glsl */ `
  uniform vec3 colour;
  uniform float tint;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float falloff = smoothstep(1.0, 0.55, r) * 0.75 + smoothstep(0.55, 0.0, r) * 0.45;
    vec3 white = vec3(1.0, 0.97, 0.92);
    vec3 light = mix(white, colour, tint);
    gl_FragColor = vec4(light, falloff * strength);
  }`;

const POOL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** A floor pool of unit radius, flat on the floor; `tint` fades the colour-temperature tint in. */
export function lightPool(cct: number, strength: number): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      colour: { value: new THREE.Color(lightColour(cct)) },
      tint: { value: 1 },
      strength: { value: strength },
    },
    vertexShader: POOL_VERTEX,
    fragmentShader: POOL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(geometry, material);
}

/** Pool radius in metres for a drop of `heightM` metres, from the one light-pool formula. */
export function poolRadiusM(heightM: number, beam: number): number {
  return poolRadiusMm(heightM * 1000, beam) / 1000;
}

/** WebGL 2 context for a canvas, or null when WebGL is unavailable. */
export function webglContext(canvas: HTMLCanvasElement, alpha = false): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", { antialias: true, alpha, powerPreference: "high-performance" });
}
