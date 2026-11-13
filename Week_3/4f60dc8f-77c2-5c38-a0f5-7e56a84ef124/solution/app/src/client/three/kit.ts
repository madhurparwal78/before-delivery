// Procedural primitives, the studio's materials and the cobalt/violet rake lights shared by every scene.
import * as THREE from "three";
import type { Accent, Primitive } from "../api";

export const INK = new THREE.Color(0xf3eee6);
export const EMBER = new THREE.Color(0xff6a1f);
export const COBALT = new THREE.Color(0x2f5bff);
export const VIOLET = new THREE.Color(0x9b3bff);
const CLAY = new THREE.Color(0x8f8b86);
const BODY = new THREE.Color(0x2a2c33);

export function geometryFor(kind: Primitive, size = 1): THREE.BufferGeometry {
  switch (kind) {
    case "box":
      return new THREE.BoxGeometry(size * 0.9, size * 0.6, size * 0.6, 2, 2, 2);
    case "cylinder":
      return new THREE.CylinderGeometry(size * 0.45, size * 0.45, size * 0.5, 48, 1);
    case "sphere":
      return new THREE.SphereGeometry(size * 0.42, 48, 32);
    case "torus":
      return new THREE.TorusGeometry(size * 0.4, size * 0.11, 24, 72);
    case "capsule":
      return new THREE.CapsuleGeometry(size * 0.22, size * 0.5, 8, 24);
  }
}

export function surface(color: THREE.Color = BODY, metalness = 0.55, roughness = 0.38): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

/** A dim neutral fill plus two saturated rake lights; `sweep` (0..1) moves them across the subject. */
export function rakeLights(scene: THREE.Scene, radius = 4): (sweep: number) => void {
  scene.add(new THREE.HemisphereLight(0x9aa0b4, 0x07080b, 0.5));
  const key = new THREE.DirectionalLight(0xf3eee6, 1.1);
  key.position.set(2, 4, 3);
  scene.add(key);
  const cobalt = new THREE.PointLight(COBALT, 22 * radius, radius * 4, 1.6);
  const violet = new THREE.PointLight(VIOLET, 18 * radius, radius * 4, 1.6);
  scene.add(cobalt, violet);
  const place = (sweep: number): void => {
    const a = -0.9 + sweep * 1.8;
    cobalt.position.set(Math.cos(a) * radius, radius * 0.35, Math.sin(a) * radius);
    violet.position.set(-Math.cos(a) * radius, radius * 0.55, -Math.sin(a) * radius * 0.6 + radius * 0.4);
  };
  place(0.5);
  return place;
}

/** How a primitive sits in a stacked subject: its height and offset outward when exploded. */
function stackOf(kinds: Primitive[]): { kind: Primitive; y: number; out: THREE.Vector3 }[] {
  let y = -0.9;
  return kinds.map((kind, index) => {
    const height = kind === "torus" ? 0.25 : kind === "sphere" ? 0.8 : kind === "capsule" ? 0.9 : 0.55;
    const placed = { kind, y: y + height / 2, out: new THREE.Vector3(Math.sin(index * 2.1) * 0.6, index - (kinds.length - 1) / 2, Math.cos(index * 2.1) * 0.6).normalize() };
    y += height * 0.8;
    return placed;
  });
}

type Subject = { group: THREE.Group; parts: THREE.Mesh[]; edges: THREE.LineSegments[]; setMorph: (morph: number) => void; setExplode: (amount: number) => void };

/** A product-like assembly from a primitive list, with a lit finish that can morph to clay with wireframe edges. */
export function buildSubject(kinds: Primitive[], accent: Accent, scale = 1): Subject {
  const group = new THREE.Group();
  const tint = accent === "ember" ? EMBER : accent === "cobalt" ? COBALT : VIOLET;
  const parts: THREE.Mesh[] = [];
  const edges: THREE.LineSegments[] = [];
  const homes: THREE.Vector3[] = [];
  const outs: THREE.Vector3[] = [];
  stackOf(kinds).forEach(({ kind, y, out }, index) => {
    const lit = index % 2 === 0 ? BODY.clone() : BODY.clone().lerp(tint, accent === "ember" ? 0.35 : 0.2);
    const material = surface(lit, 0.6, 0.32);
    material.userData.lit = lit;
    const mesh = new THREE.Mesh(geometryFor(kind, scale), material);
    mesh.position.set(0, y * scale, 0);
    if (kind === "torus") mesh.rotation.x = Math.PI / 2;
    if (kind === "box") mesh.rotation.y = index * 0.4;
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0 }));
    mesh.add(line);
    group.add(mesh);
    parts.push(mesh);
    edges.push(line);
    homes.push(mesh.position.clone());
    outs.push(out);
  });
  const setMorph = (morph: number): void => {
    parts.forEach((mesh, i) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(material.userData.lit as THREE.Color).lerp(CLAY, morph);
      material.metalness = 0.6 * (1 - morph);
      material.roughness = 0.32 + 0.6 * morph;
      (edges[i]?.material as THREE.LineBasicMaterial).opacity = morph * 0.9;
    });
  };
  const setExplode = (amount: number): void => {
    parts.forEach((mesh, i) => mesh.position.copy(homes[i] ?? new THREE.Vector3()).addScaledVector(outs[i] ?? new THREE.Vector3(), amount * scale));
  };
  return { group, parts, edges, setMorph, setExplode };
}

export function camera(fov = 32): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(fov, 1, 0.01, 200);
}
