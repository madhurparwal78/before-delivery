import type { KeyboardEventHandler, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { Chip, useReducedMotion } from '../ui';
import type { GraphEdge, GraphNode, NodeKind, StepStatus } from '../types';
import { CELL, COLUMNS, KIND_LABEL, PORTS, ROWS, edgePath, inPortAt, nodeRect, outPortAt } from './geometry';
import { KindIcon } from './KindIcon';

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  name: string;
  col: number;
  row: number;
  status?: StepStatus;
  reused?: boolean;
}

export interface GhostView {
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TokenView {
  runId: string;
  version: number;
  atStep: string;
  col: number;
  row: number;
  slot: number;
}

export interface Preview {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface CanvasProps {
  mode: 'edit' | 'run';
  nodes: CanvasNode[];
  edges: GraphEdge[];
  ghosts?: GhostView[];
  tokens?: TokenView[];
  liveVersion?: number | null;
  animating?: ReadonlySet<string>;
  onEdgeAnimationEnd?: (id: string) => void;
  cursor?: { col: number; row: number };
  cursorLabel?: string;
  candidate?: string | null;
  drawingFrom?: string | null;
  moving?: { id: string; dx: number; dy: number } | null;
  preview?: Preview | null;
  regionRef: RefObject<HTMLDivElement | null>;
  worldRef: RefObject<HTMLDivElement | null>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onNodePointerDown?: (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode) => void;
  onNodeClick: (node: CanvasNode, element: HTMLElement) => void;
  onPortPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>, node: CanvasNode, port: string) => void;
}

function Edges({ nodes, edges, animating, onEnd, ghostVersion }: {
  nodes: Array<GraphNode | CanvasNode>;
  edges: GraphEdge[];
  animating?: ReadonlySet<string>;
  onEnd?: (id: string) => void;
  ghostVersion?: number;
}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <>
      {edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const a = outPortAt(from.kind, edge.port, from.col, from.row);
        const b = inPortAt(to.col, to.row);
        const d = edgePath(a.x, a.y, b.x, b.y);
        const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) - 8, width: Math.abs(b.x - a.x) || 1, height: Math.abs(b.y - a.y) + 16 };
        const data = { 'data-edge-id': edge.id, 'data-from': edge.from, 'data-port': edge.port, 'data-to': edge.to, 'data-order': edge.order };
        if (ghostVersion !== undefined) {
          return (
            <g key={`ghost-${edge.id}`} className="edge ghost" aria-hidden="true" data-anim="none" data-ghost="true" data-version={ghostVersion} {...data}>
              <path className="edge-line" d={d} />
              <text className="ghost-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle">{`v${ghostVersion}`}</text>
            </g>
          );
        }
        return (
          <g
            key={edge.id}
            className="edge"
            role="button"
            tabIndex={-1}
            aria-label={`Edge from ${from.name} to ${to.name}`}
            data-anim={animating?.has(edge.id) ? 'running' : 'none'}
            onAnimationEnd={() => onEnd?.(edge.id)}
            {...data}
          >
            <rect className="edge-box" {...box} />
            <path className="edge-hit" d={d} />
            <path className="edge-line" d={d} />
          </g>
        );
      })}
    </>
  );
}

/** The dark dotted panel: square step nodes on a snapping grid, port dots, dashed curved edges, run tokens and ghosts. */
export function Canvas(props: CanvasProps) {
  const { mode, nodes, edges, ghosts = [], tokens = [], animating, cursor, candidate, drawingFrom, moving, preview } = props;
  const edit = mode === 'edit';
  const reduced = useReducedMotion();
  const width = COLUMNS * CELL;
  const height = ROWS * CELL;
  const positions = new Map(nodes.map((node) => [node.id, node]));
  return (
    <div
      ref={props.regionRef}
      role="region"
      aria-label="Automation canvas"
      className="canvas-panel on-dark"
      style={{ ['--cell' as string]: `${CELL}px` }}
      onKeyDown={props.onKeyDown}
    >
      <div ref={props.worldRef} className="canvas-world" style={{ width, height }}>
        <svg className="canvas-edges" width={width} height={height} focusable="false">
          {ghosts.map((ghost) => (
            <Edges key={`ghost-${ghost.version}`} nodes={ghost.nodes} edges={ghost.edges} ghostVersion={ghost.version} />
          ))}
          <Edges nodes={nodes} edges={edges} animating={animating} onEnd={props.onEdgeAnimationEnd} />
          {preview ? <path className="edge-preview" d={edgePath(preview.x1, preview.y1, preview.x2, preview.y2)} /> : null}
        </svg>
        {edit && cursor ? (
          <div
            role="group"
            aria-label="Grid cursor"
            tabIndex={0}
            className="grid-cursor"
            data-cursor="true"
            data-col={cursor.col}
            data-row={cursor.row}
            style={{ left: (cursor.col - 1) * CELL, top: (cursor.row - 1) * CELL, width: CELL, height: CELL }}
          />
        ) : null}
        {nodes.map((node) => {
          const r = nodeRect(node.col, node.row);
          const shift = moving?.id === node.id ? `translate(${moving.dx}px, ${moving.dy}px)` : undefined;
          const stepNode = node.id !== 'trigger';
          const outPorts = PORTS[node.kind];
          return (
            <div key={node.id} className="node-group" style={{ transform: shift }} data-moving={shift ? 'true' : undefined}>
              <button
                type="button"
                className="node"
                aria-label={node.name}
                tabIndex={edit ? -1 : 0}
                data-step-id={node.id}
                data-kind={node.kind}
                data-col={node.col}
                data-row={node.row}
                data-candidate={candidate === node.id ? 'true' : undefined}
                data-source={drawingFrom === node.id ? 'true' : undefined}
                {...(edit
                  ? {}
                  : {
                      'data-status': node.status ?? 'pending',
                      'data-reused': node.reused ? 'true' : 'false',
                      'data-anim': node.status === 'running' && !reduced ? 'running' : 'none',
                    })}
                style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
                onPointerDown={(event) => props.onNodePointerDown?.(event, node)}
                onClick={(event) => props.onNodeClick(node, event.currentTarget)}
              >
                <KindIcon kind={node.kind} size={Math.round(r.size / 2.4)} />
              </button>
              <div className="node-caption" aria-hidden="true" style={{ left: (node.col - 1) * CELL - CELL * 0.2, top: r.y + r.size + (edit ? 2 : 14), width: CELL * 1.4 }}>
                <span className="node-name">{node.name}</span>
                <span className="node-kind">{KIND_LABEL[node.kind]}</span>
              </div>
              {!edit ? (
                <span className="node-chip" style={{ left: r.x + r.size / 2, top: r.y + r.size - 10 }}>
                  <Chip status={node.status ?? 'pending'} />
                </span>
              ) : null}
              {stepNode ? (
                edit ? (
                  <button
                    type="button"
                    className="port port-in"
                    tabIndex={-1}
                    aria-label={`Input port of ${node.name}`}
                    data-in-port={node.id}
                    style={{ left: inPortAt(node.col, node.row).x - 12, top: inPortAt(node.col, node.row).y - 12 }}
                  />
                ) : (
                  <span className="port port-dot" aria-hidden="true" style={{ left: inPortAt(node.col, node.row).x - 12, top: inPortAt(node.col, node.row).y - 12 }} />
                )
              ) : null}
              {outPorts.map((port) => {
                const at = outPortAt(node.kind, port, node.col, node.row);
                const place = { left: at.x - 12, top: at.y - 12 };
                return edit ? (
                  <button
                    key={port}
                    type="button"
                    className="port port-out"
                    tabIndex={-1}
                    aria-label={`Output port ${port} of ${node.name}`}
                    data-port-name={port}
                    style={place}
                    onPointerDown={(event) => props.onPortPointerDown?.(event, node, port)}
                  />
                ) : (
                  <span key={port} className="port port-dot" aria-hidden="true" style={place} />
                );
              })}
            </div>
          );
        })}
        {tokens.map((token) => {
          const at = positions.get(token.atStep);
          const owner = ghosts.find((ghost) => ghost.version === token.version)?.nodes.find((node) => node.id === token.atStep) ?? at;
          if (!owner) return null;
          const r = nodeRect(owner.col, owner.row);
          const older = props.liveVersion != null && token.version < props.liveVersion;
          return (
            <div
              key={token.runId}
              className="token"
              data-run-token={token.runId}
              data-version={token.version}
              data-at-step={token.atStep}
              style={{ transform: `translate(${r.x + r.size - 12 - token.slot * 16}px, ${Math.max(2, r.y - 8)}px)` }}
            >
              <span className="token-square" />
              {older ? <span className="token-label">{`v${token.version}`}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
