import { BoxGeometry, Mesh, MeshLambertMaterial, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { boundsOfBytes, type Bounds } from "../../shared/gltf";

export interface LoadedModel {
  bounds: Bounds;
  template: Object3D;
}

function boundsBox(bounds: Bounds): Object3D {
  const size = [0, 1, 2].map((a) => bounds.max[a] - bounds.min[a]);
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), new MeshLambertMaterial({ color: 0x9aa0b9 }));
  mesh.position.set(...(([0, 1, 2].map((a) => (bounds.max[a] + bounds.min[a]) / 2) as [number, number, number])));
  return mesh;
}

/** Parses a stored GLB or glTF for display, and measures it with the shared extent rule for colliders. */
export async function loadModel(bytes: Uint8Array): Promise<LoadedModel | null> {
  const bounds = boundsOfBytes(bytes);
  if (!bounds) return null;
  const isGlb = bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
  const data: ArrayBuffer | string = isGlb ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : new TextDecoder().decode(bytes);
  const template = await new Promise<Object3D | null>((resolve) => {
    new GLTFLoader().parse(data, "", (gltf) => resolve(gltf.scene), () => resolve(null));
  });
  return { bounds, template: template ?? boundsBox(bounds) };
}
