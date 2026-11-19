export type Vec3 = [number, number, number];

export interface Account {
  id: string;
  email: string;
  display_name: string;
}

export type Role = "owner" | "editor" | "viewer";

export const LAYER_KINDS = ["group", "cube", "sphere", "plane", "torus", "tube", "camera", "light", "model", "shader"] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export const OUTPUT_BUSES = ["main", "side", "led"] as const;
export type OutputBus = (typeof OUTPUT_BUSES)[number];

export interface Material {
  tint: Vec3;
  tint_alpha: number;
  albedo_texture_id: string | null;
  emissive_texture_id: string | null;
}

export interface LayerDoc {
  id: string;
  parent_id: string | null;
  index: number;
  name: string;
  kind: LayerKind;
  version: number;
  visible: boolean;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  props: Record<string, number>;
  material: Material | null;
  model_asset_id: string | null;
  output_buses: OutputBus[];
  shader_version: number | null;
}

export interface KeyDoc {
  layer_id: string;
  property: string;
  tick: number;
  value: number;
}

export interface ScriptDoc {
  id: string;
  name: string;
  version: number;
  source: string;
  asset_ids: string[];
}

export interface GraphNode {
  node_id: string;
  type: string;
  params: Record<string, unknown>;
  x: number;
  y: number;
}

interface WireEnd {
  node_id: string;
  port: string;
}

export interface GraphWire {
  wire_id: string;
  from: WireEnd;
  to: WireEnd;
}

export interface GraphDoc {
  version: number;
  nodes: GraphNode[];
  wires: GraphWire[];
}

interface SetMeta {
  id: string;
  name: string;
  bpm: number;
  head: number;
  settings_version: number;
  graph_version: number;
  active_camera_id: string | null;
  show_token: string;
  role: Role;
}

export interface SetDocument {
  set: SetMeta;
  layers: LayerDoc[];
  keys: KeyDoc[];
  graph: GraphDoc;
  scripts: ScriptDoc[];
}

export const OP_TYPES = [
  "layer.add",
  "layer.set",
  "layer.reparent",
  "layer.remove",
  "shader.save",
  "shader.restore",
  "key.set",
  "key.remove",
  "set.update",
  "graph.node.add",
  "graph.node.update",
  "graph.node.remove",
  "graph.wire.add",
  "graph.wire.remove",
  "script.add",
  "script.save",
  "script.remove",
] as const;
export type OpType = (typeof OP_TYPES)[number];

export interface OpInput {
  type: OpType;
  target: string;
  payload: Record<string, unknown>;
}

export interface Person {
  user_id: string;
  display_name: string;
}

export interface OpDocument {
  seq: number;
  client_op_id: string;
  actor: Person;
  target: string;
  type: OpType;
  payload: Record<string, unknown>;
  committed_at: string;
}

export interface CommitResult {
  seq: number;
  target: string;
  version: number;
  replayed: boolean;
}

export type AssetKind = "model" | "texture";
export type AssetStatus = "uploading" | "ready" | "upload failed";

export interface Dependents {
  count: number;
  layers: { id: string; name: string }[];
  materials: { layer_id: string; name: string }[];
  scripts: { id: string; name: string }[];
}

export interface AssetDoc {
  id: string;
  name: string;
  kind: AssetKind;
  size: number;
  sha256: string;
  status: AssetStatus;
  created_at: string;
  dependents: Dependents;
}

export type ShowStatus = "storing" | "published" | "store failed";

export interface ShowVersionDoc {
  number: number;
  status: ShowStatus;
  live: boolean;
  sha256: string;
  size: number;
  published_at: string;
  published_by: Person;
  note: string;
}

export interface ShowListing {
  show_url: string;
  live_number: number | null;
  versions: ShowVersionDoc[];
}

export interface MemberDoc {
  user_id: string;
  display_name: string;
  email: string;
  role: Role;
}

export interface PresenceMember {
  user_id: string;
  display_name: string;
  colour: string;
  selection: string | null;
}

export interface LockDoc {
  layer_id: string;
  holder: Person;
  expires_at: string;
}

type LockReason = "granted" | "renewed" | "released" | "expired";

export interface LockEvent {
  layer_id: string;
  holder: Person | null;
  expires_at: string | null;
  reason: LockReason;
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: Person;
  action: string;
  target: string;
  summary: string;
}

export interface ServiceStatus {
  storage: "ok" | "unreachable";
  collab: "ok" | "unreachable";
  checked_at: string;
}

export interface SetListing {
  id: string;
  name: string;
  role: Role;
  bpm: number;
  head: number;
  live_number: number | null;
}

export interface ShowInfo {
  set_name: string;
  bpm: number;
  version: { number: number; sha256: string; size: number; published_at: string };
}

export interface ShowBundle {
  format: "afterglass-show/1";
  set: { name: string; bpm: number; active_camera_id: string | null };
  layers: LayerDoc[];
  keys: KeyDoc[];
  graph: GraphDoc;
  shaders: { layer_id: string; version: number; source: string }[];
  scripts: ScriptDoc[];
  assets: { id: string; name: string; kind: AssetKind; size: number; sha256: string }[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    current_version?: number;
    current?: unknown;
    changed_by?: Person;
    holder?: Person;
    expires_at?: string;
    dependents?: Dependents;
    show_versions?: number[];
    asset?: AssetDoc;
    show_version?: ShowVersionDoc;
  };
}
