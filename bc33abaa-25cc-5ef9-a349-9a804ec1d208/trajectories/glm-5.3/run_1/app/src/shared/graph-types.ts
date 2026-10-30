export type NodeKind = "group" | "mesh" | "camera" | "light";
export type Primitive = "box" | "sphere" | "cylinder" | "plane";
export type LayerType = "base" | "clearcoat" | "sheen" | "emission";
export type OverrideField = "position" | "rotation" | "scale" | "visible";
export type Trigger = "hover" | "click" | "scroll";

export interface Layer {
  id: string;
  type: LayerType;
  color: [number, number, number];
  roughness: number;
  metalness: number;
}

export interface Override {
  nodeId: string;
  field: OverrideField;
  value: unknown;
}

export interface Node {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;
  primitive: Primitive | null;
  assetId: string | null;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  materialLayers: Layer[];
  visible: boolean;
}

export interface State {
  id: string;
  name: string;
  overrides: Override[];
}

export interface Transition {
  from: string;
  to: string;
  trigger: Trigger;
  durationMs: number;
}

export interface CameraView {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface Graph {
  nodes: Node[];
  states: State[];
  transitions: Transition[];
  cameraViews: CameraView[];
}
