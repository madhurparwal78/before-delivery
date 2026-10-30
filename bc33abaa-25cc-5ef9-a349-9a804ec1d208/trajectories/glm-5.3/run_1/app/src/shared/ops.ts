import type { Graph, Layer, Node, OverrideField, State, Override, CameraView, Transition } from "./graph-types";

export interface OpIn {
  type: string;
  payload: Record<string, unknown>;
}

export interface ApplyOk {
  ok: true;
  inverse: { type: string; payload: Record<string, unknown> };
  lockNodeIds: string[];
}

export interface ApplyErr {
  ok: false;
  field: string;
  message: string;
}

export type ApplyResult = ApplyOk | ApplyErr;

const ID_RE = /^[a-z0-9_-]{1,40}$/;

function fail(field: string, message: string): ApplyErr {
  return { ok: false, field, message };
}

function isVec(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number" && Number.isFinite(c));
}

function validName(name: unknown): boolean {
  return typeof name === "string" && name.length >= 1 && name.length <= 80;
}

function vecInRange(v: unknown, min: number, max: number): v is [number, number, number] {
  return isVec(v) && v.every((c) => c >= min && c <= max);
}

const FIELD_RANGE: Record<"position" | "rotation" | "scale", [number, number]> = {
  position: [-1000, 1000],
  rotation: [-360, 360],
  scale: [0.001, 1000],
};

function validOverrideValue(field: OverrideField, value: unknown): boolean {
  if (field === "visible") return typeof value === "boolean";
  const [min, max] = FIELD_RANGE[field];
  return vecInRange(value, min, max);
}

function checkLayer(layer: unknown): layer is Layer {
  if (typeof layer !== "object" || layer === null) return false;
  const l = layer as Record<string, unknown>;
  return (
    typeof l.id === "string" &&
    ID_RE.test(l.id) &&
    (l.type === "base" || l.type === "clearcoat" || l.type === "sheen" || l.type === "emission") &&
    vecInRange(l.color, 0, 1) &&
    typeof l.roughness === "number" &&
    l.roughness >= 0 &&
    l.roughness <= 1 &&
    typeof l.metalness === "number" &&
    l.metalness >= 0 &&
    l.metalness <= 1
  );
}

function copyLayer(l: Layer): Layer {
  return { ...l, color: [l.color[0], l.color[1], l.color[2]] };
}

function copyVec(v: [number, number, number]): [number, number, number] {
  return [v[0], v[1], v[2]];
}

export function lockableNodes(op: OpIn, graph: Graph): string[] {
  const p = op.payload;
  const exists = (id: unknown): boolean => typeof id === "string" && graph.nodes.some((n) => n.id === id);
  switch (op.type) {
    case "node.add": {
      const node = p.node as Partial<Node> | undefined;
      return node && typeof node.id === "string" && !exists(node.id) ? [node.id] : [];
    }
    case "node.remove":
    case "node.rename":
    case "node.reparent":
    case "transform.set":
    case "material.layer.add":
    case "material.layer.set":
    case "material.layer.remove":
      return exists(p.id) ? [p.id as string] : [];
    case "state.override.set":
      return exists(p.nodeId) ? [p.nodeId as string] : [];
    default:
      return [];
  }
}

export function applyOp(graph: Graph, op: OpIn, assetIds: Set<string>): ApplyResult {
  const p = op.payload;
  const findNode = (id: string | undefined): Node | undefined => (id ? graph.nodes.find((n) => n.id === id) : undefined);
  const findState = (id: string | undefined): State | undefined => (id ? graph.states.find((s) => s.id === id) : undefined);

  switch (op.type) {
    case "node.add": {
      const n = p.node as Partial<Node> | undefined;
      if (typeof n !== "object" || n === null) return fail("payload.node", "Node is required");
      if (typeof n.id !== "string" || !ID_RE.test(n.id)) return fail("payload.node.id", "ID is invalid");
      if (findNode(n.id)) return fail("payload.node.id", "ID already exists");
      if (!validName(n.name)) return fail("payload.node.name", "Name is invalid");
      if (n.kind !== "group" && n.kind !== "mesh" && n.kind !== "camera" && n.kind !== "light") {
        return fail("payload.node.kind", "Kind is invalid");
      }
      if (n.kind === "mesh" && n.primitive !== "box" && n.primitive !== "sphere" && n.primitive !== "cylinder" && n.primitive !== "plane") {
        return fail("payload.node.primitive", "Primitive is invalid");
      }
      if (n.parentId !== null && n.parentId !== undefined) {
        if (typeof n.parentId !== "string" || !findNode(n.parentId)) return fail("payload.node.parentId", "Parent does not exist");
      }
      if (n.assetId != null) {
        if (typeof n.assetId !== "string" || !assetIds.has(n.assetId)) return fail("payload.node.assetId", "Asset does not exist");
      }
      const position = n.position ?? [0, 0, 0];
      const rotation = n.rotation ?? [0, 0, 0];
      const scale = n.scale ?? [1, 1, 1];
      if (!vecInRange(position, -1000, 1000)) return fail("payload.node.position", "Position is invalid");
      if (!vecInRange(rotation, -360, 360)) return fail("payload.node.rotation", "Rotation is invalid");
      if (!vecInRange(scale, 0.001, 1000)) return fail("payload.node.scale", "Scale is invalid");
      if (n.visible !== undefined && typeof n.visible !== "boolean") return fail("payload.node.visible", "Visible is invalid");
      const layersRaw = n.materialLayers ?? [];
      if (!Array.isArray(layersRaw) || layersRaw.length > 8) return fail("payload.node.materialLayers", "At most 8 layers per node");
      for (const l of layersRaw) {
        if (!checkLayer(l)) return fail("payload.node.materialLayers", "Layer is invalid");
      }
      const overridesRaw = p.overrides ?? [];
      if (!Array.isArray(overridesRaw)) return fail("payload.overrides", "Overrides are invalid");
      const validOverrides: { stateId: string; field: OverrideField; value: unknown }[] = [];
      for (const o of overridesRaw) {
        const entry = o as { stateId?: unknown; field?: unknown; value?: unknown };
        const st = findState(typeof entry.stateId === "string" ? entry.stateId : undefined);
        if (!st || st.id === "rest") return fail("payload.overrides.stateId", "State does not exist");
        if (entry.field !== "position" && entry.field !== "rotation" && entry.field !== "scale" && entry.field !== "visible") {
          return fail("payload.overrides.field", "Field is invalid");
        }
        if (!validOverrideValue(entry.field, entry.value)) return fail("payload.overrides.value", "Value is invalid");
        validOverrides.push({ stateId: st.id, field: entry.field, value: entry.value });
      }
      const node: Node = {
        id: n.id,
        name: n.name as string,
        kind: n.kind,
        parentId: typeof n.parentId === "string" ? n.parentId : null,
        primitive: n.kind === "mesh" ? (n.primitive as Node["primitive"]) : null,
        assetId: typeof n.assetId === "string" ? n.assetId : null,
        position: copyVec(position),
        rotation: copyVec(rotation),
        scale: copyVec(scale),
        materialLayers: (layersRaw as Layer[]).map(copyLayer),
        visible: n.visible !== false,
      };
      graph.nodes.push(node);
      for (const o of validOverrides) {
        const st = findState(o.stateId)!;
        st.overrides.push({ nodeId: node.id, field: o.field, value: isVec(o.value) ? [o.value[0], o.value[1], o.value[2]] : o.value });
      }
      return { ok: true, lockNodeIds: [node.id], inverse: { type: "node.remove", payload: { id: node.id } } };
    }
    case "node.remove": {
      const id = p.id;
      if (typeof id !== "string" || !ID_RE.test(id)) return fail("payload.id", "ID is invalid");
      const node = findNode(id);
      if (!node) return fail("payload.id", "Node does not exist");
      if (node.parentId === null) return fail("payload.id", "The root cannot be removed");
      if (graph.nodes.some((n) => n.parentId === id)) return fail("payload.id", "Node has children");
      const removedOverrides: { stateId: string; field: OverrideField; value: unknown }[] = [];
      for (const st of graph.states) {
        const kept: Override[] = [];
        for (const o of st.overrides) {
          if (o.nodeId === id) removedOverrides.push({ stateId: st.id, field: o.field, value: o.value });
          else kept.push(o);
        }
        st.overrides = kept;
      }
      graph.nodes = graph.nodes.filter((n) => n.id !== id);
      return {
        ok: true,
        lockNodeIds: [id],
        inverse: {
          type: "node.add",
          payload: {
            node: { ...node, position: copyVec(node.position), rotation: copyVec(node.rotation), scale: copyVec(node.scale), materialLayers: node.materialLayers.map(copyLayer) },
            overrides: removedOverrides,
          },
        },
      };
    }
    case "node.rename": {
      const id = p.id;
      if (typeof id !== "string") return fail("payload.id", "ID is required");
      const node = findNode(id);
      if (!node) return fail("payload.id", "Node does not exist");
      if (!validName(p.name)) return fail("payload.name", "Name is invalid");
      const old = node.name;
      node.name = p.name as string;
      return { ok: true, lockNodeIds: [id], inverse: { type: "node.rename", payload: { id, name: old } } };
    }
    case "node.reparent": {
      const id = p.id;
      if (typeof id !== "string") return fail("payload.id", "ID is required");
      const node = findNode(id);
      if (!node) return fail("payload.id", "Node does not exist");
      if (node.parentId === null) return fail("payload.id", "The root cannot be reparented");
      if (typeof p.parentId !== "string") return fail("payload.parentId", "Parent is required");
      if (p.parentId === id) return fail("payload.parentId", "A node cannot be its own parent");
      let cursor: string | null = p.parentId;
      while (cursor) {
        if (cursor === id) return fail("payload.parentId", "Cycles are not allowed");
        cursor = findNode(cursor)?.parentId ?? null;
      }
      if (!findNode(p.parentId)) return fail("payload.parentId", "Parent does not exist");
      const old = node.parentId;
      node.parentId = p.parentId;
      return { ok: true, lockNodeIds: [id], inverse: { type: "node.reparent", payload: { id, parentId: old } } };
    }
    case "transform.set": {
      const id = p.id;
      if (typeof id !== "string") return fail("payload.id", "ID is required");
      const node = findNode(id);
      if (!node) return fail("payload.id", "Node does not exist");
      if (p.position === undefined && p.rotation === undefined && p.scale === undefined) {
        return fail("payload", "At least one field is required");
      }
      const old = { position: copyVec(node.position), rotation: copyVec(node.rotation), scale: copyVec(node.scale) };
      if (p.position !== undefined) {
        if (!vecInRange(p.position, -1000, 1000)) return fail("payload.position", "Position must be between -1000 and 1000");
        node.position = copyVec(p.position);
      }
      if (p.rotation !== undefined) {
        if (!vecInRange(p.rotation, -360, 360)) return fail("payload.rotation", "Rotation must be between -360 and 360");
        node.rotation = copyVec(p.rotation);
      }
      if (p.scale !== undefined) {
        if (!vecInRange(p.scale, 0.001, 1000)) return fail("payload.scale", "Scale must be between 0.001 and 1000");
        node.scale = copyVec(p.scale);
      }
      const inversePayload: Record<string, unknown> = { id };
      if (p.position !== undefined) inversePayload.position = old.position;
      if (p.rotation !== undefined) inversePayload.rotation = old.rotation;
      if (p.scale !== undefined) inversePayload.scale = old.scale;
      return { ok: true, lockNodeIds: [id], inverse: { type: "transform.set", payload: inversePayload } };
    }
    case "material.layer.add": {
      const id = p.id;
      if (typeof id !== "string") return fail("payload.id", "ID is required");
      const node = findNode(id);
      if (!node) return fail("payload.id", "Node does not exist");
      if (node.materialLayers.length >= 8) return fail("payload", "At most 8 layers per node");
      if (!checkLayer(p.layer)) return fail("payload.layer", "Layer is invalid");
      const layer = p.layer as Layer;
      if (node.materialLayers.some((l) => l.id === layer.id)) return fail("payload.layer.id", "Layer ID already exists");
      const index =
        typeof p.index === "number" && Number.isInteger(p.index) && p.index >= 0 && p.index <= node.materialLayers.length
          ? p.index
          : node.materialLayers.length;
      node.materialLayers.splice(index, 0, copyLayer(layer));
      return { ok: true, lockNodeIds: [id], inverse: { type: "material.layer.remove", payload: { id, layerId: layer.id } } };
    }
    case "material.layer.set": {
      const id = p.id;
      if (typeof id !== "string") return fail("payload.id", "ID is required");
      const node = findNode(id);
      if (!node) return fail("payload.id", "Node does not exist");
      const layer = node.materialLayers.find((l) => l.id === p.layerId);
      if (!layer) return fail("payload.layerId", "Layer does not exist");
      if (p.color === undefined && p.roughness === undefined && p.metalness === undefined) {
        return fail("payload", "At least one field is required");
      }
      const old = { color: copyVec(layer.color), roughness: layer.roughness, metalness: layer.metalness };
      const inversePayload: Record<string, unknown> = { id, layerId: layer.id };
      if (p.color !== undefined) {
        if (!vecInRange(p.color, 0, 1)) return fail("payload.color", "Color is invalid");
        layer.color = copyVec(p.color);
        inversePayload.color = old.color;
      }
      if (p.roughness !== undefined) {
        if (typeof p.roughness !== "number" || p.roughness < 0 || p.roughness > 1) return fail("payload.roughness", "Roughness must be between 0 and 1");
        layer.roughness = p.roughness;
        inversePayload.roughness = old.roughness;
      }
      if (p.metalness !== undefined) {
        if (typeof p.metalness !== "number" || p.metalness < 0 || p.metalness > 1) return fail("payload.metalness", "Metalness must be between 0 and 1");
        layer.metalness = p.metalness;
        inversePayload.metalness = old.metalness;
      }
      return { ok: true, lockNodeIds: [id], inverse: { type: "material.layer.set", payload: inversePayload } };
    }
    case "material.layer.remove": {
      const id = p.id;
      if (typeof id !== "string") return fail("payload.id", "ID is required");
      const node = findNode(id);
      if (!node) return fail("payload.id", "Node does not exist");
      const idx = node.materialLayers.findIndex((l) => l.id === p.layerId);
      if (idx < 0) return fail("payload.layerId", "Layer does not exist");
      const layer = node.materialLayers[idx]!;
      node.materialLayers.splice(idx, 1);
      return {
        ok: true,
        lockNodeIds: [id],
        inverse: { type: "material.layer.add", payload: { id, layer: copyLayer(layer), index: idx } },
      };
    }
    case "state.add": {
      const s = p.state as { id?: unknown; name?: unknown } | undefined;
      if (typeof s !== "object" || s === null) return fail("payload.state", "State is required");
      if (typeof s.id !== "string" || !ID_RE.test(s.id)) return fail("payload.state.id", "ID is invalid");
      if (s.id === "rest" || findState(s.id)) return fail("payload.state.id", "ID already exists");
      if (!validName(s.name)) return fail("payload.state.name", "Name is invalid");
      graph.states.push({ id: s.id, name: s.name as string, overrides: [] });
      return { ok: true, lockNodeIds: [], inverse: { type: "state.remove", payload: { id: s.id } } };
    }
    case "state.remove": {
      const id = p.id;
      if (typeof id !== "string") return fail("payload.id", "ID is required");
      const st = findState(id);
      if (!st || st.id === "rest") return fail("payload.id", "State does not exist");
      if (graph.states.some((s) => s.overrides.some((o) => o.nodeId === id))) return fail("payload.id", "State has overrides");
      if (graph.transitions.some((t) => t.from === id || t.to === id)) return fail("payload.id", "State is used by a transition");
      graph.states = graph.states.filter((s) => s.id !== id);
      return { ok: true, lockNodeIds: [], inverse: { type: "state.add", payload: { state: { id, name: st.name } } } };
    }
    case "state.override.set": {
      if (typeof p.stateId !== "string") return fail("payload.stateId", "State is required");
      const st = findState(p.stateId);
      if (!st || st.id === "rest") return fail("payload.stateId", "State does not exist");
      if (typeof p.nodeId !== "string") return fail("payload.nodeId", "Node is required");
      const node = findNode(p.nodeId);
      if (!node) return fail("payload.nodeId", "Node does not exist");
      const field = p.field;
      if (field !== "position" && field !== "rotation" && field !== "scale" && field !== "visible") return fail("payload.field", "Field is invalid");
      const existingIdx = st.overrides.findIndex((o) => o.nodeId === p.nodeId && o.field === field);
      const oldValue = existingIdx >= 0 ? st.overrides[existingIdx]!.value : null;
      if (p.value === null) {
        if (existingIdx >= 0) st.overrides.splice(existingIdx, 1);
      } else {
        if (!validOverrideValue(field, p.value)) return fail("payload.value", "Value is invalid");
        const value = isVec(p.value) ? [p.value[0], p.value[1], p.value[2]] : p.value;
        if (existingIdx >= 0) st.overrides[existingIdx]!.value = value;
        else st.overrides.push({ nodeId: p.nodeId, field, value });
      }
      return {
        ok: true,
        lockNodeIds: [p.nodeId],
        inverse: { type: "state.override.set", payload: { stateId: st.id, nodeId: p.nodeId, field, value: oldValue } },
      };
    }
    case "transition.set": {
      if (typeof p.from !== "string" || !findState(p.from)) return fail("payload.from", "State does not exist");
      if (typeof p.to !== "string" || !findState(p.to)) return fail("payload.to", "State does not exist");
      if (p.from === p.to) return fail("payload.to", "States must differ");
      const trigger = p.trigger;
      if (trigger !== "hover" && trigger !== "click" && trigger !== "scroll") return fail("payload.trigger", "Trigger is invalid");
      const idx = graph.transitions.findIndex((t) => t.from === p.from && t.trigger === trigger);
      const old = idx >= 0 ? graph.transitions[idx] : null;
      const inversePayload: Record<string, unknown> = old
        ? { from: p.from, to: old.to, trigger, durationMs: old.durationMs }
        : { from: p.from, to: "", trigger, durationMs: null };
      if (p.durationMs === null) {
        if (idx >= 0) graph.transitions.splice(idx, 1);
        return { ok: true, lockNodeIds: [], inverse: { type: "transition.set", payload: inversePayload } };
      }
      if (typeof p.durationMs !== "number" || !Number.isInteger(p.durationMs) || p.durationMs < 0 || p.durationMs > 2000) {
        return fail("payload.durationMs", "Duration must be between 0 and 2000");
      }
      const t: Transition = { from: p.from, to: p.to, trigger, durationMs: p.durationMs };
      if (idx >= 0) graph.transitions[idx] = t;
      else graph.transitions.push(t);
      return { ok: true, lockNodeIds: [], inverse: { type: "transition.set", payload: inversePayload } };
    }
    case "camera.view.set": {
      if (!validName(p.name)) return fail("payload.name", "Name is invalid");
      const viewName = p.name as string;
      const idx = graph.cameraViews.findIndex((c) => c.name === viewName);
      const old = idx >= 0 ? graph.cameraViews[idx] : null;
      const inversePayload: Record<string, unknown> = old
        ? { name: old.name, position: copyVec(old.position), target: copyVec(old.target), fov: old.fov }
        : { name: viewName, position: null };
      if (p.position === null) {
        if (idx >= 0) graph.cameraViews.splice(idx, 1);
        return { ok: true, lockNodeIds: [], inverse: { type: "camera.view.set", payload: inversePayload } };
      }
      if (!vecInRange(p.position, -1000, 1000)) return fail("payload.position", "Position is invalid");
      if (!vecInRange(p.target, -1000, 1000)) return fail("payload.target", "Target is invalid");
      if (typeof p.fov !== "number" || p.fov < 10 || p.fov > 120) return fail("payload.fov", "FOV must be between 10 and 120");
      const view: CameraView = { name: viewName, position: copyVec(p.position), target: copyVec(p.target), fov: p.fov };
      if (idx >= 0) graph.cameraViews[idx] = view;
      else graph.cameraViews.push(view);
      return { ok: true, lockNodeIds: [], inverse: { type: "camera.view.set", payload: inversePayload } };
    }
    default:
      return fail("type", "Unknown operation");
  }
}
