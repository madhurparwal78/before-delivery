import type { LayerDoc, LayerKind, Material, OutputBus, Vec3 } from "./types.ts";

export const BUS_LABELS: Record<OutputBus, string> = { main: "Main", side: "Side screens", led: "LED strip" };

export const KINDS_WITH_BUSES: readonly LayerKind[] = ["cube", "sphere", "plane", "torus", "tube", "model", "shader"];
export const KINDS_WITH_MATERIAL: readonly LayerKind[] = ["cube", "sphere", "plane", "torus", "tube", "model"];

export const KIND_LABELS: Record<LayerKind, string> = {
  group: "Group",
  cube: "Cube",
  sphere: "Sphere",
  plane: "Plane",
  torus: "Torus",
  tube: "Tube",
  camera: "Camera",
  light: "Light",
  model: "Model",
  shader: "Shader layer",
};

interface PropertySpec {
  label: string;
  min: number;
  max: number;
}

const axis = (name: string, min: number, max: number): [string, PropertySpec][] =>
  (["x", "y", "z"] as const).map((a) => [`${name.toLowerCase()}.${a}`, { label: `${name} ${a.toUpperCase()}`, min, max }]);

export const KEYABLE_PROPERTIES: Record<string, PropertySpec> = Object.fromEntries([
  ...axis("Position", -10_000, 10_000),
  ...axis("Rotation", -10_000, 10_000),
  ...axis("Scale", 0.001, 1000),
  ["props.fov", { label: "Field of view", min: 10, max: 120 }],
  ["props.near", { label: "Near plane", min: 0.01, max: 10 }],
  ["props.far", { label: "Far plane", min: 0, max: 10_000 }],
  ["props.twist", { label: "Twist", min: -10, max: 10 }],
  ["props.radius", { label: "Radius", min: 0.1, max: 100 }],
  ["props.intensity", { label: "Intensity", min: 0, max: 10 }],
  ["material.tint_alpha", { label: "Tint alpha", min: 0, max: 1 }],
]);

export const TINT_RANGE = { min: 0, max: 1 };

export function isKeyable(path: string): boolean {
  return path in KEYABLE_PROPERTIES;
}

export function propertyLabel(path: string): string {
  return KEYABLE_PROPERTIES[path]?.label ?? path;
}

export function rangeMessage(label: string, min: number, max: number): string {
  return `${label} must be from ${min} to ${max}`;
}

function defaultProps(kind: LayerKind): Record<string, number> {
  switch (kind) {
    case "tube":
      return { twist: 0, radius: 1 };
    case "camera":
      return { fov: 50, near: 0.1, far: 200 };
    case "light":
      return { intensity: 1 };
    default:
      return {};
  }
}

function defaultMaterial(kind: LayerKind): Material | null {
  return KINDS_WITH_MATERIAL.includes(kind)
    ? { tint: [1, 1, 1], tint_alpha: 1, albedo_texture_id: null, emissive_texture_id: null }
    : null;
}

function defaultBuses(kind: LayerKind): OutputBus[] {
  return KINDS_WITH_BUSES.includes(kind) ? ["main"] : [];
}

interface NewLayerInit {
  id: string;
  parent_id: string | null;
  index: number;
  name: string;
  kind: LayerKind;
  position?: Vec3;
  scale?: Vec3;
  props?: Record<string, number>;
}

export function createLayer(init: NewLayerInit): LayerDoc {
  return {
    id: init.id,
    parent_id: init.parent_id,
    index: init.index,
    name: init.name,
    kind: init.kind,
    version: 1,
    visible: true,
    position: init.position ?? [0, 0, 0],
    rotation: [0, 0, 0],
    scale: init.scale ?? [1, 1, 1],
    props: { ...defaultProps(init.kind), ...init.props },
    material: defaultMaterial(init.kind),
    model_asset_id: null,
    output_buses: defaultBuses(init.kind),
    shader_version: init.kind === "shader" ? 1 : null,
  };
}

export function readLayerValue(layer: LayerDoc, path: string): number | undefined {
  const [head, tail] = path.split(".");
  if (head === "props" && tail !== undefined) return layer.props[tail];
  if (head === "material") return layer.material?.tint_alpha;
  if (tail !== "x" && tail !== "y" && tail !== "z") return undefined;
  const slot = tail === "x" ? 0 : tail === "y" ? 1 : 2;
  if (head === "position") return layer.position[slot];
  if (head === "rotation") return layer.rotation[slot];
  if (head === "scale") return layer.scale[slot];
  return undefined;
}

export function childrenOf(layers: readonly LayerDoc[], parentId: string | null): LayerDoc[] {
  return layers.filter((layer) => layer.parent_id === parentId).sort((a, b) => a.index - b.index);
}

export function treeOrder(layers: readonly LayerDoc[]): LayerDoc[] {
  const out: LayerDoc[] = [];
  const walk = (parentId: string | null): void => {
    for (const layer of childrenOf(layers, parentId)) {
      out.push(layer);
      walk(layer.id);
    }
  };
  walk(null);
  return out;
}

export function descendantsOf(layers: readonly LayerDoc[], id: string): LayerDoc[] {
  const found: LayerDoc[] = [];
  const walk = (parentId: string): void => {
    for (const child of layers.filter((layer) => layer.parent_id === parentId)) {
      found.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return found;
}
