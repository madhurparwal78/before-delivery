import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Accessories, MaterialName, Parts, Proportions, Stroke } from '../../shared/types.js';

export const PAPER = 0xfaf6ee;
export const GRAPHITE = 0x1d1d1f;
export const COBALT = 0x1f4fd8;

const MATERIAL_COLOURS: Record<MaterialName, number> = {
  graphite: 0x3a3a3e,
  cobalt: COBALT,
  marker: 0xf2c200,
  chalk: 0xf4f1ea,
  brick: 0xb4452f,
  moss: 0x5f7a4a,
};

const OUTLINE_VERTEX = `
uniform float thickness;
void main() {
  vec3 displaced = position + normalize(normal) * thickness;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}`;

const OUTLINE_FRAGMENT = `
uniform vec3 inkColour;
void main() {
  gl_FragColor = vec4(inkColour, 1.0);
}`;

/** The even graphite outline every 3D part carries, drawn as an inflated back-facing hull. */
export function outlineMaterial(thickness = 0.012): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      thickness: { value: thickness },
      inkColour: { value: new Vector3(0.11, 0.11, 0.12) },
    },
    vertexShader: OUTLINE_VERTEX,
    fragmentShader: OUTLINE_FRAGMENT,
    side: DoubleSide,
  });
}

function inked(geometry: BufferGeometry, colour: number, outline = 0.012): Mesh {
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: colour, roughness: 0.8 }));
  const shell = new Mesh(geometry, outlineMaterial(outline));
  shell.renderOrder = -1;
  shell.material.depthWrite = false;
  mesh.add(shell);
  return mesh;
}

function limb(length: number, radius: number, colour: number): Group {
  const group = new Group();
  const mesh = inked(new CylinderGeometry(radius, radius * 0.9, length, 12), colour);
  mesh.position.y = -length / 2;
  group.add(mesh);
  return group;
}

function springLeg(length: number, radius: number, colour: number): Group {
  const group = new Group();
  const points: Vector3[] = [];
  const turns = 4;
  for (let i = 0; i <= 48; i += 1) {
    const ratio = i / 48;
    const angle = ratio * Math.PI * 2 * turns;
    points.push(
      new Vector3(Math.cos(angle) * radius * 1.6, -ratio * length, Math.sin(angle) * radius * 1.6),
    );
  }
  group.add(inked(new TubeGeometry(new CatmullRomCurve3(points), 64, radius * 0.6, 8, false), colour));
  return group;
}

function headGeometry(kind: Parts['head'], size: number): BufferGeometry {
  if (kind === 'square') return new BoxGeometry(size * 2, size * 2, size * 2);
  if (kind === 'triangle') return new ConeGeometry(size * 1.3, size * 2.2, 4);
  return new SphereGeometry(size, 20, 16);
}

function torsoGeometry(kind: Parts['torso'], height: number): BufferGeometry {
  if (kind === 'barrel') return new CylinderGeometry(0.17, 0.15, height, 16);
  if (kind === 'kite') return new ConeGeometry(0.2, height, 4);
  return new BoxGeometry(0.08, height, 0.07);
}

export interface HeroLook {
  parts: Parts;
  proportions: Proportions;
  material: MaterialName;
  accessories: Accessories;
  armRaiseRadians: number;
}

export interface HeroFigure {
  group: Group;
  rightHandSocket: Object3D;
  rightArm: Group;
  setArmRaise(radians: number): void;
  attachWeapon(object: Object3D | null): void;
}

/** Builds the stick-figure hero from its parts, proportions, material and accessories. */
export function buildHero(look: HeroLook): HeroFigure {
  const colour = MATERIAL_COLOURS[look.material];
  const p = look.proportions;
  const group = new Group();

  const thigh = 0.42 * p.thigh_length;
  const shin = 0.4 * p.shin_length;
  const spine = 0.5 * p.spine_length;
  const neck = 0.1 * p.neck_length;
  const headSize = 0.14 * p.head_size;
  const upperArm = 0.28 * p.upper_arm_length;
  const forearm = 0.26 * p.forearm_length;
  const armRadius = look.parts.arms === 'thick' ? 0.06 : 0.035;
  const legRadius = look.parts.legs === 'thick' ? 0.07 : 0.04;

  const hipY = thigh + shin;
  const hips = new Group();
  hips.position.y = hipY;
  group.add(hips);

  for (const side of [-1, 1]) {
    const leg = new Group();
    leg.position.set(side * 0.08, 0, 0);
    const upper =
      look.parts.legs === 'spring'
        ? springLeg(thigh, legRadius, colour)
        : limb(thigh, legRadius, colour);
    leg.add(upper);
    const lower =
      look.parts.legs === 'spring'
        ? springLeg(shin, legRadius, colour)
        : limb(shin, legRadius * 0.9, colour);
    lower.position.y = -thigh;
    leg.add(lower);
    hips.add(leg);
  }

  const torso = inked(torsoGeometry(look.parts.torso, spine), colour);
  torso.position.y = spine / 2;
  hips.add(torso);

  const shoulders = new Group();
  shoulders.position.y = spine;
  hips.add(shoulders);

  const neckMesh = inked(new CylinderGeometry(0.03, 0.03, neck, 10), colour);
  neckMesh.position.y = neck / 2;
  shoulders.add(neckMesh);

  const head = inked(headGeometry(look.parts.head, headSize), colour);
  head.position.y = neck + headSize;
  shoulders.add(head);

  const leftArm = new Group();
  leftArm.position.set(0.12, -0.02, 0);
  const leftUpper = limb(upperArm, armRadius, colour);
  leftArm.add(leftUpper);
  const leftLower = limb(forearm, armRadius * 0.9, colour);
  leftLower.position.y = -upperArm;
  leftArm.add(leftLower);
  shoulders.add(leftArm);

  const leftHandSocket = new Object3D();
  leftHandSocket.position.y = -(upperArm + forearm);
  leftArm.add(leftHandSocket);

  const rightArm = new Group();
  rightArm.position.set(-0.12, -0.02, 0);
  const rightUpper = limb(upperArm, armRadius, colour);
  rightArm.add(rightUpper);
  const rightLower = limb(forearm, armRadius * 0.9, colour);
  rightLower.position.y = -upperArm;
  rightArm.add(rightLower);
  shoulders.add(rightArm);

  const rightHandSocket = new Object3D();
  rightHandSocket.position.y = -(upperArm + forearm);
  rightArm.add(rightHandSocket);

  if (look.accessories.head === 'paper_crown') {
    const crown = inked(new ConeGeometry(headSize * 0.9, headSize * 0.9, 5, 1, true), PAPER);
    crown.position.y = headSize * 1.4;
    head.add(crown);
  } else if (look.accessories.head === 'beanie') {
    const beanie = inked(new SphereGeometry(headSize * 1.05, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), COBALT);
    beanie.position.y = headSize * 0.2;
    head.add(beanie);
  }

  if (look.accessories.back === 'scarf') {
    const scarf = inked(new TorusGeometry(0.07, 0.025, 8, 16), 0xb4452f);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = neck * 0.5;
    shoulders.add(scarf);
  } else if (look.accessories.back === 'satchel') {
    const satchel = inked(new BoxGeometry(0.16, 0.14, 0.06), 0x7a5a3a);
    satchel.position.set(0, spine * 0.45, -0.08);
    hips.add(satchel);
  }

  if (look.accessories.left_hand === 'lantern') {
    const lantern = inked(new BoxGeometry(0.08, 0.1, 0.08), 0xf2c200);
    lantern.position.y = -0.06;
    leftHandSocket.add(lantern);
  } else if (look.accessories.left_hand === 'shield') {
    const shield = inked(new CylinderGeometry(0.16, 0.16, 0.03, 20), 0x5f7a4a);
    shield.rotation.z = Math.PI / 2;
    shield.position.set(0.04, -0.06, 0);
    leftHandSocket.add(shield);
  }

  let weaponHolder: Object3D | null = null;

  const setArmRaise = (radians: number): void => {
    rightArm.rotation.z = -radians;
  };
  setArmRaise(look.armRaiseRadians);

  return {
    group,
    rightHandSocket,
    rightArm,
    setArmRaise,
    attachWeapon: (object: Object3D | null): void => {
      if (weaponHolder !== null) {
        rightHandSocket.remove(weaponHolder);
        weaponHolder = null;
      }
      if (object !== null) {
        weaponHolder = object;
        rightHandSocket.add(object);
      }
    },
  };
}

/** Real tube geometry for the drawn weapon: one tube per stroke, with its graphite outline. */
export function buildWeapon(strokes: readonly Stroke[], radiusScale = 1): Group {
  const group = new Group();
  for (const stroke of strokes) {
    const points = stroke.points.map(([x, y]) => new Vector3(x, y, 0));
    if (points.length < 2) continue;
    const curve = new CatmullRomCurve3(points);
    const radius = Math.max(0.0005, (stroke.thickness / 2) * radiusScale);
    group.add(inked(new TubeGeometry(curve, Math.max(8, points.length * 4), radius, 8, false), 0x55585e, 0.004));
  }
  const grip = strokes[0]?.points[0];
  if (grip !== undefined) group.position.set(-grip[0], -grip[1], 0);
  return group;
}

export function checkpointRing(): Mesh {
  return inked(new RingGeometry(1.2, 1.5, 24), COBALT, 0.004);
}
