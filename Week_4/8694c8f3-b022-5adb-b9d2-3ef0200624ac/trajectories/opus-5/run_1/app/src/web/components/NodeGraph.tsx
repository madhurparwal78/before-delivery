import { useRef, useState } from 'react';
import { store } from '../store.js';
import { Dialog, useStoreState } from './common.js';
import { KEYABLE_PROPERTIES, LFO_SHAPES, NODE_TYPES, propertyLabel } from '../../shared/domain.js';
import type { GraphNodeDoc, SetDocument } from '../../shared/types.js';

const BUILTIN_PORTS: Record<string, { inputs: string[]; outputs: string[] }> = {
  'Beat clock': { inputs: [], outputs: ['beat', 'phase'] },
  LFO: { inputs: ['beat'], outputs: ['value'] },
  Remap: { inputs: ['in'], outputs: ['out'] },
  'Layer property': { inputs: ['value'], outputs: [] },
};

function portsFor(type: string): { inputs: string[]; outputs: string[] } {
  const builtin = BUILTIN_PORTS[type];
  if (builtin !== undefined) return builtin;
  const plugin = store.scriptHost.plugins.get(type);
  return plugin === undefined ? { inputs: [], outputs: [] } : { inputs: plugin.inputs, outputs: plugin.outputs };
}

function defaultParams(type: string, doc: SetDocument): Record<string, string | number> {
  if (type === 'LFO') return { shape: 'sine', rate_beats: 1 };
  if (type === 'Remap') return { in_min: -1, in_max: 1, out_min: 0, out_max: 1 };
  if (type === 'Layer property') {
    const target = doc.layers.find((layer) => layer.kind !== 'group') ?? doc.layers[0];
    return { layer_id: target?.id ?? '', property: 'props.twist' };
  }
  return {};
}

export function NodeGraph() {
  const state = useStoreState();
  const doc = state.doc;
  const [adding, setAdding] = useState(false);
  const [wiring, setWiring] = useState<GraphNodeDoc | null>(null);
  const [fromPort, setFromPort] = useState<string | null>(null);
  const [toTarget, setToTarget] = useState<string | null>(null);
  const dragging = useRef<{ nodeId: string; startX: number; startY: number; x: number; y: number } | null>(null);
  if (doc === null) return null;

  const updateNode = (node: GraphNodeDoc, params: Record<string, string | number>): void => {
    store.commit({
      target: 'graph',
      type: 'graph.node.update',
      payload: { node_id: node.node_id, params },
      baseVersion: doc.graph.version,
    });
  };

  const nodeTypes = [...NODE_TYPES, ...store.scriptHost.nodeTypes()];

  return (
    <div>
      <div style={{ display: 'flex', gap: '4px', paddingBottom: '4px' }}>
        <button type="button" className="row-button" onClick={() => setAdding(!adding)} aria-haspopup="menu">
          Add node
        </button>
        {adding ? (
          <div className="menu-pop" role="menu" aria-label="Node types" style={{ position: 'static' }}>
            {nodeTypes.map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdding(false);
                  store.commit({
                    target: 'graph',
                    type: 'graph.node.add',
                    payload: {
                      node_id: crypto.randomUUID(),
                      type,
                      params: defaultParams(type, doc),
                      x: 20 + doc.graph.nodes.length * 20,
                      y: 20 + doc.graph.nodes.length * 14,
                    },
                  });
                }}
              >
                {type}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="graph-canvas">
        <svg className="graph-wires" aria-hidden="true">
          {doc.graph.wires.map((wire) => {
            const from = doc.graph.nodes.find((node) => node.node_id === wire.from.node_id);
            const to = doc.graph.nodes.find((node) => node.node_id === wire.to.node_id);
            if (from === undefined || to === undefined) return null;
            return (
              <line
                key={wire.wire_id}
                x1={from.x + 104}
                y1={from.y + 22}
                x2={to.x}
                y2={to.y + 22}
                stroke="#4ea8ff"
                strokeWidth="1.5"
              />
            );
          })}
        </svg>
        {doc.graph.nodes.map((node) => (
          <button
            key={node.node_id}
            type="button"
            className="graph-node"
            aria-label={`${node.type} node`}
            style={{ left: `${node.x}px`, top: `${node.y}px` }}
            onPointerDown={(event) => {
              dragging.current = {
                nodeId: node.node_id,
                startX: event.clientX,
                startY: event.clientY,
                x: node.x,
                y: node.y,
              };
              const move = (pointer: PointerEvent): void => {
                const drag = dragging.current;
                if (drag === null) return;
                drag.x = node.x + pointer.clientX - drag.startX;
                drag.y = node.y + pointer.clientY - drag.startY;
              };
              const up = (): void => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                const drag = dragging.current;
                dragging.current = null;
                if (drag === null || (drag.x === node.x && drag.y === node.y)) return;
                store.commit({
                  target: 'graph',
                  type: 'graph.node.update',
                  payload: { node_id: node.node_id, x: Math.round(drag.x), y: Math.round(drag.y) },
                  baseVersion: doc.graph.version,
                });
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key.toLowerCase() === 'c') {
                event.preventDefault();
                setWiring(node);
                setFromPort(portsFor(node.type).outputs[0] ?? null);
                setToTarget(null);
                return;
              }
              if (event.key === 'Delete') {
                event.preventDefault();
                store.commit({
                  target: 'graph',
                  type: 'graph.node.remove',
                  payload: { node_id: node.node_id },
                  baseVersion: doc.graph.version,
                });
              }
            }}
          >
            <span>{node.type}</span>
            <span className="ports">
              {portsFor(node.type).inputs.join(' ')} {'\u2192'} {portsFor(node.type).outputs.join(' ')}
            </span>
            {node.type === 'LFO' ? (
              <select
                aria-label="LFO shape"
                value={String(node.params['shape'] ?? 'sine')}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => updateNode(node, { ...node.params, shape: event.target.value })}
              >
                {LFO_SHAPES.map((shape) => (
                  <option key={shape} value={shape}>
                    {shape}
                  </option>
                ))}
              </select>
            ) : null}
            {node.type === 'Layer property' ? (
              <>
                <select
                  aria-label="Target layer"
                  value={String(node.params['layer_id'] ?? '')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => updateNode(node, { ...node.params, layer_id: event.target.value })}
                >
                  {doc.layers.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      {layer.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Target property"
                  value={String(node.params['property'] ?? 'props.twist')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => updateNode(node, { ...node.params, property: event.target.value })}
                >
                  {KEYABLE_PROPERTIES.map((property) => (
                    <option key={property} value={property}>
                      {propertyLabel(property)}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </button>
        ))}
      </div>

      {wiring === null ? null : (
        <Dialog title="Connect wire" onClose={() => setWiring(null)}>
          <div className="form-row">
            <span className="label">From port</span>
            <ul className="listbox" role="listbox" aria-label="From port" tabIndex={0}>
              {portsFor(wiring.type).outputs.map((port) => (
                <li
                  key={port}
                  role="option"
                  aria-selected={fromPort === port}
                  onClick={() => setFromPort(port)}
                >
                  {port}
                </li>
              ))}
            </ul>
          </div>
          <div className="form-row">
            <span className="label">To port</span>
            <ul className="listbox" role="listbox" aria-label="To port" tabIndex={0}>
              {doc.graph.nodes
                .filter((node) => node.node_id !== wiring.node_id)
                .flatMap((node) =>
                  portsFor(node.type).inputs.map((port) => (
                    <li
                      key={`${node.node_id}:${port}`}
                      role="option"
                      aria-selected={toTarget === `${node.node_id}:${port}`}
                      onClick={() => setToTarget(`${node.node_id}:${port}`)}
                    >
                      {`${node.type} ${port}`}
                    </li>
                  )),
                )}
            </ul>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="row-button"
              onClick={() => {
                if (fromPort === null || toTarget === null) return;
                const [nodeId, port] = toTarget.split(':') as [string, string];
                store.commit({
                  target: 'graph',
                  type: 'graph.wire.add',
                  payload: {
                    wire_id: crypto.randomUUID(),
                    from: { node_id: wiring.node_id, port: fromPort },
                    to: { node_id: nodeId, port },
                  },
                });
                setWiring(null);
              }}
            >
              Connect
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
