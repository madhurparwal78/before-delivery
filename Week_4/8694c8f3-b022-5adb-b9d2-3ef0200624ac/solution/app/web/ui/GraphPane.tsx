import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { BUILT_IN_NODES, LFO_RATE_RANGE, LFO_SHAPES, portsOf } from "../../shared/graph.ts";
import { KEYABLE_PROPERTIES, propertyLabel, readLayerValue } from "../../shared/layers.ts";
import type { GraphNode } from "../../shared/types.ts";
import { uuid } from "../ids.ts";
import type { EditorStore } from "../store/editor.ts";
import { Modal } from "./Modal.tsx";
import { ScrubField } from "./ScrubField.tsx";

const NODE_W = 124;
const HEAD_H = 24;
const PORT_H = 17;

const portY = (node: GraphNode, side: "in" | "out", port: string): number => {
  const ports = portsOf(node);
  const list = side === "in" ? ports.inputs : ports.outputs;
  return node.y + HEAD_H + 6 + Math.max(0, list.indexOf(port)) * PORT_H + PORT_H / 2;
};

interface Linking {
  nodeId: string;
  port: string;
  sx: number;
  sy: number;
  x: number;
  y: number;
}

export function GraphPane({ store }: { store: EditorStore }) {
  const { graph } = store.doc;
  const [menu, setMenu] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<GraphNode | null>(null);
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [selectedWire, setSelectedWire] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const plugins = store.scripts.nodeTypes();
  const at = (node: GraphNode): GraphNode => (moving?.id === node.node_id ? { ...node, x: moving.x, y: moving.y } : node);
  const nodes = graph.nodes.map(at);

  const addNode = (type: string, params: Record<string, unknown>): void => {
    const slot = graph.nodes.length;
    store.commit({
      type: "graph.node.add", target: "graph",
      payload: { node_id: uuid(), type, params, x: 40 + (slot % 4) * 150, y: 30 + Math.floor(slot / 4) * 100 },
    });
    setMenu(false);
  };

  const onNodeKey = (event: KeyboardEvent<HTMLButtonElement>, node: GraphNode): void => {
    if (event.key === "Enter" || event.key.toLowerCase() === "c") {
      event.preventDefault();
      setConnecting(node);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      store.commit({ type: "graph.node.remove", target: "graph", payload: { node_id: node.node_id } });
    }
  };

  const local = (event: PointerEvent): [number, number] => {
    const box = surface.current?.getBoundingClientRect();
    return [event.clientX - (box?.left ?? 0) + (surface.current?.scrollLeft ?? 0), event.clientY - (box?.top ?? 0) + (surface.current?.scrollTop ?? 0)];
  };

  const onNodeDown = (event: PointerEvent<HTMLDivElement>, node: GraphNode): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".port-dot")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: node.node_id, startX: event.clientX, startY: event.clientY, originX: node.x, originY: node.y, moved: false };
  };

  const onNodeMove = (event: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setMoving({ id: d.id, x: Math.max(0, Math.round(d.originX + dx)), y: Math.max(0, Math.round(d.originY + dy)) });
  };

  const onNodeUp = (event: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setSelected(d.id);
    if (d.moved && moving) {
      store.commit({ type: "graph.node.update", target: "graph", payload: { node_id: d.id, x: moving.x, y: moving.y } });
    }
    setMoving(null);
  };

  const finishLink = (event: PointerEvent): void => {
    const link = linking;
    setLinking(null);
    if (!link) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-in-port]");
    if (!hit) return;
    const [toNode, toPort] = [hit.dataset["node"], hit.dataset["inPort"]];
    if (toNode && toPort) {
      store.commit({
        type: "graph.wire.add", target: "graph",
        payload: { wire_id: uuid(), from: { node_id: link.nodeId, port: link.port }, to: { node_id: toNode, port: toPort } },
      });
    }
  };

  const extent = nodes.reduce<[number, number]>((acc, node) => [Math.max(acc[0], node.x + NODE_W + 40), Math.max(acc[1], node.y + 120)], [640, 240]);
  const focusNode = nodes.find((node) => node.node_id === selected);
  return (
    <div className="graph-pane">
      <div className="pane-bar">
        <div className="menu-wrap">
          <button type="button" className="btn" aria-haspopup="menu" aria-expanded={menu} disabled={!store.canEdit} onClick={() => setMenu((open) => !open)}>
            <Plus size={12} aria-hidden="true" />
            Add node
          </button>
          {menu ? (
            <div role="menu" aria-label="Node types" className="menu popover">
              {BUILT_IN_NODES.map((type) => (
                <button key={type} type="button" role="menuitem" className="menu-item" onClick={() => addNode(type, {})}>{type}</button>
              ))}
              {plugins.map((plugin) => (
                <button key={plugin.typeName} type="button" role="menuitem" className="menu-item" onClick={() => addNode(plugin.typeName, { inputs: plugin.inputs, outputs: plugin.outputs })}>
                  {plugin.typeName}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <span className="muted">Tab to a node, then press Enter or C to connect a wire.</span>
      </div>
      <div className="graph-surface" ref={surface}>
        <div className="graph-canvas" style={{ width: extent[0], height: extent[1] }}>
          <svg className="wires" width={extent[0]} height={extent[1]} aria-hidden="false">
            {graph.wires.map((wire) => {
              const from = nodes.find((node) => node.node_id === wire.from.node_id);
              const to = nodes.find((node) => node.node_id === wire.to.node_id);
              if (!from || !to) return null;
              const [x1, y1, x2, y2] = [from.x + NODE_W, portY(from, "out", wire.from.port), to.x, portY(to, "in", wire.to.port)];
              const bend = Math.max(30, Math.abs(x2 - x1) / 2);
              return (
                <path
                  key={wire.wire_id}
                  d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`}
                  className={wire.wire_id === selectedWire ? "wire selected" : "wire"}
                  role="button"
                  tabIndex={0}
                  aria-label={`Wire from ${from.type} ${wire.from.port} to ${to.type} ${wire.to.port}`}
                  onClick={() => setSelectedWire(wire.wire_id)}
                  onKeyDown={(event) => {
                    if ((event.key === "Delete" || event.key === "Backspace") && store.canEdit) {
                      event.preventDefault();
                      store.commit({ type: "graph.wire.remove", target: "graph", payload: { wire_id: wire.wire_id } });
                    }
                  }}
                />
              );
            })}
            {linking ? <path d={`M${linking.sx},${linking.sy} L${linking.x},${linking.y}`} className="wire" /> : null}
          </svg>
          {nodes.map((node) => {
            const ports = portsOf(node);
            return (
              <div
                key={node.node_id}
                className={node.node_id === selected ? "node selected" : "node"}
                style={{ left: node.x, top: node.y, width: NODE_W }}
                onClick={() => setSelected(node.node_id)}
                onPointerDown={(event) => onNodeDown(event, node)}
                onPointerMove={onNodeMove}
                onPointerUp={onNodeUp}
              >
                <button type="button" className="node-title" aria-label={`${node.type} node`} onKeyDown={(event) => onNodeKey(event, node)}>
                  {node.type}
                </button>
                <span className="node-ports">
                  <span className="node-in">
                    {ports.inputs.map((port) => (
                      <span key={port} className="port" data-node={node.node_id} data-in-port={port}>
                        <span className="port-dot" />
                        {port}
                      </span>
                    ))}
                  </span>
                  <span className="node-out">
                    {ports.outputs.map((port) => (
                      <span
                        key={port}
                        className="port"
                        onPointerDown={(event) => {
                          if (!store.canEdit) return;
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          const [x, y] = local(event);
                          setLinking({ nodeId: node.node_id, port, sx: x, sy: y, x, y });
                        }}
                        onPointerMove={(event) => {
                          const [x, y] = local(event);
                          setLinking((current) => (current ? { ...current, x, y } : current));
                        }}
                        onPointerUp={finishLink}
                      >
                        {port}
                        <span className="port-dot" />
                      </span>
                    ))}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {focusNode ? <NodeSettings store={store} node={focusNode} /> : null}
      {connecting ? <ConnectDialog store={store} from={connecting} onClose={() => setConnecting(null)} /> : null}
    </div>
  );
}

function NodeSettings({ store, node }: { store: EditorStore; node: GraphNode }) {
  const update = (params: Record<string, unknown>): void => {
    store.commit({ type: "graph.node.update", target: "graph", payload: { node_id: node.node_id, params } });
  };
  const number = (key: string, fallback: number): number => (typeof node.params[key] === "number" ? node.params[key] : fallback);
  if (node.type === "LFO") {
    return (
      <div className="node-settings">
        <label className="setting">Shape
          <select className="select" aria-label="LFO shape" value={String(node.params["shape"] ?? "sine")} disabled={!store.canEdit} onChange={(event) => update({ shape: event.target.value })}>
            {LFO_SHAPES.map((shape) => <option key={shape} value={shape}>{shape}</option>)}
          </select>
        </label>
        <div className="setting">Rate (beats)
          <ScrubField label="Rate (beats)" value={number("rate_beats", 1)} min={LFO_RATE_RANGE.min} max={LFO_RATE_RANGE.max} disabled={!store.canEdit} onCommit={(value) => update({ rate_beats: value })} />
        </div>
      </div>
    );
  }
  if (node.type === "Remap") {
    return (
      <div className="node-settings">
        {([["in_min", "In min", 0], ["in_max", "In max", 1], ["out_min", "Out min", 0], ["out_max", "Out max", 1]] as const).map(([key, label, fallback]) => (
          <div className="setting" key={key}>{label}
            <ScrubField label={label} value={number(key, fallback)} min={-10_000} max={10_000} disabled={!store.canEdit} onCommit={(value) => update({ [key]: value })} />
          </div>
        ))}
      </div>
    );
  }
  if (node.type === "Layer property") {
    const layerId = typeof node.params["layer_id"] === "string" ? node.params["layer_id"] : "";
    const layer = store.doc.layers.find((candidate) => candidate.id === layerId);
    const choices = layer ? Object.keys(KEYABLE_PROPERTIES).filter((path) => readLayerValue(layer, path) !== undefined) : [];
    return (
      <div className="node-settings">
        <label className="setting">Layer
          <select className="select" aria-label="Target layer" value={layerId} disabled={!store.canEdit} onChange={(event) => update({ layer_id: event.target.value || null, property: null })}>
            <option value="">None</option>
            {store.doc.layers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
        <label className="setting">Property
          <select className="select" aria-label="Target property" value={typeof node.params["property"] === "string" ? node.params["property"] : ""} disabled={!store.canEdit || !layer} onChange={(event) => update({ property: event.target.value || null })}>
            <option value="">None</option>
            {choices.map((path) => <option key={path} value={path}>{propertyLabel(path)}</option>)}
          </select>
        </label>
      </div>
    );
  }
  return null;
}

function ConnectDialog({ store, from, onClose }: { store: EditorStore; from: GraphNode; onClose: () => void }) {
  const outputs = portsOf(from).outputs;
  const targets = store.doc.graph.nodes
    .filter((node) => node.node_id !== from.node_id)
    .flatMap((node) => portsOf(node).inputs.map((port) => ({ key: `${node.node_id}\u0000${port}`, node, port })));
  const [out, setOut] = useState(0);
  const [into, setInto] = useState(targets.length > 0 ? 0 : -1);
  const [problem, setProblem] = useState("");
  const move = (event: KeyboardEvent<HTMLDivElement>, count: number, current: number, set: (next: number) => void): void => {
    if (event.key === "ArrowDown") set(Math.min(count - 1, current + 1));
    else if (event.key === "ArrowUp") set(Math.max(0, current - 1));
    else if (event.key === "Enter") {
      connect();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const connect = (): void => {
    const port = outputs[out];
    const target = targets[into];
    if (!port || !target) return;
    const outcome = store.commit({
      type: "graph.wire.add", target: "graph",
      payload: { wire_id: uuid(), from: { node_id: from.node_id, port }, to: { node_id: target.node.node_id, port: target.port } },
    });
    if (outcome.ok) onClose();
    else setProblem(Object.values(outcome.fields)[0] ?? "That wire cannot be made");
  };
  return (
    <Modal title="Connect wire" onClose={onClose}>
      {(titleId) => (
        <>
          <h2 id={titleId} className="modal-title small">Connect wire</h2>
          <div className="port-lists">
            <div>
              <div className="muted">From {from.type}</div>
              <div role="listbox" aria-label="From port" className="choices" tabIndex={0} data-autofocus aria-activedescendant={`from-${out}`} onKeyDown={(event) => move(event, outputs.length, out, setOut)}>
                {outputs.map((port, index) => (
                  <div key={port} id={`from-${index}`} role="option" aria-selected={index === out} className="choice" onClick={() => setOut(index)}>{port}</div>
                ))}
              </div>
            </div>
            <div>
              <div className="muted">To</div>
              <div role="listbox" aria-label="To port" className="choices" tabIndex={0} aria-activedescendant={into >= 0 ? `to-${into}` : undefined} onKeyDown={(event) => move(event, targets.length, into < 0 ? -1 : into, (next) => setInto(next))}>
                {targets.map((target, index) => (
                  <div key={target.key} id={`to-${index}`} role="option" aria-selected={index === into} className="choice" onClick={() => setInto(index)}>
                    {target.node.type} · {target.port}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {problem ? <div className="field-error">{problem}</div> : null}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn" disabled={into < 0 || outputs.length === 0} onClick={connect}>Connect</button>
          </div>
        </>
      )}
    </Modal>
  );
}
