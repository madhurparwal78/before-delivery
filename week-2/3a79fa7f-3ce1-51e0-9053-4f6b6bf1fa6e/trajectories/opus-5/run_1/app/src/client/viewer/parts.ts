import * as THREE from 'three';
import { hexOf } from './colours.js';

function material(colour: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: hexOf(colour), roughness: 0.55, metalness: 0.15 });
}

function mesh(geometry: THREE.BufferGeometry, colour: string): THREE.Mesh {
  const node = new THREE.Mesh(geometry, material(colour));
  node.castShadow = false;
  return node;
}

export function boardPackageShape(finish: string, size: string): THREE.Object3D {
  const lengthBySize: Record<string, number> = {
    "4'3": 1.3, "4'8": 1.42, "4'9": 1.45, "5'2": 1.57, "5'4": 1.63, "5'8": 1.73,
  };
  const length = lengthBySize[size] ?? 1.5;
  const group = new THREE.Group();
  const hull = mesh(new THREE.BoxGeometry(length, 0.11, 0.5), finish);
  hull.position.y = 0;
  const nose = mesh(new THREE.ConeGeometry(0.2, 0.3, 4), finish);
  nose.rotation.z = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.set(length / 2 + 0.13, 0, 0);
  nose.scale.set(1, 1, 0.62);
  const deck = mesh(new THREE.BoxGeometry(length * 0.62, 0.02, 0.36), 'graphite');
  deck.position.set(length * 0.14, 0.063, 0);
  group.add(hull, nose, deck);
  return group;
}

/** The clear window in the deck through which the battery block is seen. */
export function deckWindow(): THREE.Object3D {
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.014, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xdfeef0, transparent: true, opacity: 0.3, roughness: 0.08 }),
  );
  glass.position.set(-0.18, 0.13, 0);
  return glass;
}

export function wingShape(sku: string, colour: string): THREE.Object3D {
  const group = new THREE.Group();
  const spec: Record<string, { span: number; chord: number; thickness: number; sweep: number }> = {
    'WNG-B170': { span: 0.86, chord: 0.3, thickness: 0.05, sweep: 0 },
    'WNG-Q150': { span: 0.78, chord: 0.24, thickness: 0.035, sweep: 0.3 },
    'WNG-Q180': { span: 1.02, chord: 0.26, thickness: 0.04, sweep: 0.12 },
    'WNG-Q120': { span: 0.6, chord: 0.2, thickness: 0.03, sweep: 0.45 },
  };
  const shape = spec[sku] ?? spec['WNG-Q150']!;
  const front = mesh(new THREE.BoxGeometry(shape.chord, shape.thickness, shape.span), colour);
  front.rotation.y = shape.sweep;
  const tail = mesh(new THREE.BoxGeometry(shape.chord * 0.45, shape.thickness * 0.7, shape.span * 0.42), colour);
  tail.position.x = -0.42;
  const fuselage = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 12), colour);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.position.x = -0.2;
  group.add(front, tail, fuselage);
  return group;
}

export function mastShape(sku: string, colour: string, mastM: number): THREE.Object3D {
  const group = new THREE.Group();
  const body =
    sku === 'MST-AL28'
      ? mesh(new THREE.CylinderGeometry(0.035, 0.035, mastM, 16), colour)
      : mesh(new THREE.BoxGeometry(0.1, mastM, 0.022), colour);
  body.position.y = -mastM / 2;
  const plate = mesh(new THREE.BoxGeometry(0.2, 0.025, 0.14), colour);
  group.add(body, plate);
  return group;
}

export function propulsionShape(sku: string, colour: string): THREE.Object3D {
  const group = new THREE.Group();
  const radius = sku === 'PRP-68' ? 0.075 : 0.06;
  const pod = mesh(new THREE.CylinderGeometry(radius, radius, 0.3, 18), colour);
  pod.rotation.z = Math.PI / 2;
  group.add(pod);
  const blades = sku === 'PRP-68' ? 3 : 2;
  for (let i = 0; i < blades; i += 1) {
    const blade = mesh(new THREE.BoxGeometry(0.02, radius * 2.2, 0.05), colour);
    blade.position.x = -0.18;
    blade.rotation.x = (i * 2 * Math.PI) / blades;
    group.add(blade);
  }
  return group;
}

export function batteryShape(sku: string, colour: string): THREE.Object3D {
  const lengths: Record<string, number> = { 'BAT-18': 0.4, 'BAT-22': 0.48, 'BAT-10': 0.28 };
  const length = lengths[sku] ?? 0.4;
  const group = new THREE.Group();
  const block = mesh(new THREE.BoxGeometry(length, 0.07, 0.24), colour);
  group.add(block);
  const bars = new THREE.Group();
  bars.name = 'charge-bars';
  for (let i = 0; i < 4; i += 1) {
    const bar = mesh(new THREE.BoxGeometry(length * 0.17, 0.012, 0.05), 'light grey');
    bar.position.set(-length / 2 + length * 0.14 + i * length * 0.23, 0.042, 0.06);
    bar.name = `charge-bar-${i}`;
    bars.add(bar);
  }
  group.add(bars);
  return group;
}

export function setChargeBars(battery: THREE.Object3D, bars: number): void {
  const group = battery.getObjectByName('charge-bars');
  if (!group) return;
  group.children.forEach((child, index) => {
    const bar = child as THREE.Mesh;
    (bar.material as THREE.MeshStandardMaterial).color.setHex(index < bars ? hexOf('green') : hexOf('light grey'));
  });
}

export function controllerShape(sku: string, colour: string): THREE.Object3D {
  const group = new THREE.Group();
  const grip = mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.17, 14), colour);
  grip.rotation.z = 0.25;
  group.add(grip);
  if (sku === 'CTL-ELT') {
    const ring = mesh(new THREE.TorusGeometry(0.05, 0.009, 8, 20), 'teal');
    ring.position.y = 0.07;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  } else {
    const trigger = mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), colour);
    trigger.position.set(0.045, 0.03, 0);
    group.add(trigger);
  }
  return group;
}

export function setOpacity(node: THREE.Object3D, opacity: number): void {
  node.traverse((child) => {
    const candidate = child as THREE.Mesh;
    if (!candidate.isMesh) return;
    const mat = candidate.material as THREE.MeshStandardMaterial;
    mat.transparent = opacity < 1;
    mat.opacity = opacity;
    mat.depthWrite = opacity >= 1;
  });
}
