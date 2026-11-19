export type ShapeKind = 'box' | 'cylinder' | 'sphere' | 'group';
export type ShapeMode = 'solid' | 'hole';

export interface ShapeBase {
  id: string;
  kind: ShapeKind;
  mode: ShapeMode;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotationZ: number;
  color: string;
}

export interface Primitive extends ShapeBase {
  kind: 'box' | 'cylinder' | 'sphere';
  children: [];
}

export interface GroupObject extends ShapeBase {
  kind: 'group';
  children: ShapeObject[];
}

export type ShapeObject = Primitive | GroupObject;

export interface Workplane {
  origin: [number, number, number];
  normal: [number, number, number];
}

export interface Scene3D {
  kind: '3d';
  objects: ShapeObject[];
  workplane: Workplane;
}

export type ComponentType = 'battery' | 'led' | 'resistor' | 'switch';

export interface CircuitComponent {
  label: string;
  type: ComponentType;
  volts?: number;
  ohms?: number;
  closed?: boolean;
  broken?: boolean;
}

export interface CircuitWire {
  from: string;
  to: string;
}

export interface CircuitSnapshot {
  kind: 'circuit';
  components: CircuitComponent[];
  wires: CircuitWire[];
}

export type BlockName = 'addBox' | 'addCylinder' | 'addSphere' | 'moveX' | 'moveY' | 'moveZ' | 'makeHole' | 'repeat';

export interface BlockMove {
  block: 'moveX' | 'moveY' | 'moveZ';
  mm: number;
}

export interface BlockAdd {
  block: 'addBox' | 'addCylinder' | 'addSphere';
}

export interface BlockHole {
  block: 'makeHole';
}

export interface BlockRepeat {
  block: 'repeat';
  count: number;
  body: ProgramBlock[];
}

export type ProgramBlock = BlockMove | BlockAdd | BlockHole | BlockRepeat;

export interface BlocksSnapshot {
  kind: 'blocks';
  program: ProgramBlock[];
  objects: ShapeObject[];
}

export type ProjectSnapshot = Scene3D | CircuitSnapshot | BlocksSnapshot;

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface GroupResult {
  objects: ShapeObject[];
  group: GroupObject;
}

export const SOLID_COLORS = ['#4caf50', '#9c27b0', '#ff9800', '#2196f3'] as const;
