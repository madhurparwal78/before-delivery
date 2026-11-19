import {
  CanvasTexture, DoubleSide, Group, Material, Mesh, MeshLambertMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace,
  type BufferGeometry, type Object3D,
} from "three";
import type { DesignObject } from "../../shared/types";
import { geometryJob, primitiveMesh } from "../geometry";
import type { SolidResult } from "../geometry";
import { creaseGeometry } from "./creaseGeometry";
import { displayColor } from "./palette";
import type { DesignMeshes } from "./types";

const STRIPE_PERIOD_DIVISIONS = 5;
const MIN_STRIPE_PERIOD_MM = 2;

interface Entry {
  signature: string;
  shapeKey: string;
  node: Group;
  /** Bumped by every rebuild so an older worker answer is ignored. */
  version: number;
}

function stripeTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 4;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(120, 130, 148, 0.8)";
    context.fillRect(0, 0, 32, 4);
    context.fillStyle = "rgba(205, 211, 221, 0.28)";
    context.fillRect(32, 0, 32, 4);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function stripePeriod(size: number): number {
  return Math.max(MIN_STRIPE_PERIOD_MM, size / STRIPE_PERIOD_DIVISIONS);
}

function disposeNode(node: Object3D): void {
  node.traverse((child) => {
    if (child instanceof Mesh) (child.geometry as BufferGeometry).dispose();
  });
}

/** Chunky toy meshes for design objects, world coordinates, z up. The host scene supplies the lights (see `addToyLights`). */
export function createDesignMeshes(): DesignMeshes {
  const root = new Group();
  const entries = new Map<string, Entry>();
  const solidMaterials = new Map<string, MeshStandardMaterial>();
  let texture: CanvasTexture | null = null;
  let holeMaterial: MeshLambertMaterial | null = null;
  let opacity = 1;
  let pendingGroups = 0;
  let onSettled: (() => void) | undefined;

  const groupDone = () => {
    pendingGroups -= 1;
    if (pendingGroups === 0) onSettled?.();
  };

  const applyOpacity = (material: Material, base: number) => {
    material.opacity = base * opacity;
    if (material instanceof MeshStandardMaterial) {
      material.transparent = opacity < 1;
      material.depthWrite = opacity >= 1;
    }
  };

  const materialFor = (object: DesignObject, index: number): Material => {
    if (object.mode === "hole") {
      texture ??= stripeTexture();
      if (!holeMaterial) {
        // A hole's cap is often coplanar with a solid's face; the offset draws the stripes over it without depth fighting.
        holeMaterial = new MeshLambertMaterial({
          map: texture, transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
        });
        applyOpacity(holeMaterial, 1);
      }
      return holeMaterial;
    }
    const color = displayColor(object.color, index);
    let material = solidMaterials.get(color);
    if (!material) {
      material = new MeshStandardMaterial({ color, roughness: 0.5, metalness: 0 });
      applyOpacity(material, 1);
      solidMaterials.set(color, material);
    }
    return material;
  };

  const place = (entry: Entry, id: string, geometry: BufferGeometry, material: Material, at: [number, number, number]) => {
    const previous = entry.node.children[0];
    if (previous) {
      disposeNode(previous);
      entry.node.remove(previous);
    }
    const mesh = new Mesh(geometry, material);
    mesh.userData.objectId = id;
    mesh.position.set(...at);
    entry.node.add(mesh);
  };

  const setObjects = (objects: DesignObject[], onUpdate?: () => void, whenSettled?: () => void) => {
    onSettled = whenSettled;
    pendingGroups = 0;
    const keep = new Set(objects.map((object) => object.id));
    for (const [id, entry] of entries) {
      if (keep.has(id)) continue;
      disposeNode(entry.node);
      root.remove(entry.node);
      entries.delete(id);
    }
    objects.forEach((object, index) => {
      const signature = JSON.stringify(object);
      let entry = entries.get(object.id);
      if (entry?.signature === signature) return;
      if (!entry) {
        const node = new Group();
        node.userData.objectId = object.id;
        entry = { signature, shapeKey: "", node, version: 0 };
        entries.set(object.id, entry);
        root.add(node);
      }
      entry.signature = signature;
      entry.version += 1;
      if (object.kind === "group") {
        const settled = entry;
        const version = settled.version;
        entry.shapeKey = "";
        const children = entry.node.children[0];
        if (children) {
          disposeNode(children);
          entry.node.remove(children);
        }
        pendingGroups += 1;
        void geometryJob("resolveObject", object).then((result: SolidResult | null) => {
          if (entries.get(object.id) === settled && settled.version === version && result) {
            const size = Math.max(...result.bounds.max.map((v, axis) => v - (result.bounds.min[axis] ?? 0)));
            place(settled, object.id, creaseGeometry(result, stripePeriod(size)), materialFor(object, index), [0, 0, 0]);
            onUpdate?.();
          }
          groupDone();
        }, groupDone);
        return;
      }
      const shapeKey = `${object.kind}|${object.w}|${object.d}|${object.h}|${object.rotationZ}`;
      const material = materialFor(object, index);
      const mesh = entry.node.children[0];
      if (entry.shapeKey === shapeKey && mesh instanceof Mesh) {
        mesh.material = material;
        mesh.position.set(object.x, object.y, object.z);
        return;
      }
      entry.shapeKey = shapeKey;
      const local = primitiveMesh({ ...object, x: 0, y: 0, z: 0 });
      place(entry, object.id, creaseGeometry(local, stripePeriod(Math.max(object.w, object.d, object.h))), material, [object.x, object.y, object.z]);
    });
    onUpdate?.();
    if (pendingGroups === 0) onSettled?.();
  };

  return {
    root,
    setObjects,
    meshFor: (id) => entries.get(id)?.node,
    setOpacity: (value) => {
      opacity = value;
      solidMaterials.forEach((material) => applyOpacity(material, 1));
      if (holeMaterial) applyOpacity(holeMaterial, 1);
    },
    dispose: () => {
      entries.forEach((entry) => disposeNode(entry.node));
      entries.clear();
      root.clear();
      solidMaterials.forEach((material) => material.dispose());
      solidMaterials.clear();
      holeMaterial?.dispose();
      texture?.dispose();
      holeMaterial = null;
      texture = null;
    },
  };
}
