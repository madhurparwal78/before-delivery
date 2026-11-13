import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from '../ui/icons';
import type { NodeKind, TriggerNode } from '../../shared/types';
import { Dialog } from '../ui/Dialog';
import { addNode, deleteNode, nodeHolder, saveNode, selectNode, type NodeForm } from './nodes';
import { closeDialog, useEditor } from './state';

const KINDS: NodeKind[] = ['puzzle', 'lock', 'cue', 'exit'];
const LANE = 6;

const formOf = (node: TriggerNode): NodeForm => ({ title: node.title, kind: node.kind, prerequisites: node.prerequisites, placementId: node.placementId, answer: node.answer });

/** The wires: one curve per prerequisite, from the card it comes from to the card that needs it. */
function Wires({ nodes, list }: { nodes: TriggerNode[]; list: React.RefObject<HTMLUListElement | null> }) {
  const [paths, setPaths] = useState<string[]>([]);
  useLayoutEffect(() => {
    const items = list.current?.querySelectorAll<HTMLElement>('li');
    if (!items) return;
    const centre = new Map(nodes.map((n, i) => [n.id, (items[i]?.offsetTop ?? 0) + (items[i]?.offsetHeight ?? 0) / 2]));
    setPaths(
      nodes.flatMap((node, index) =>
        node.prerequisites.map((id, k) => {
          const from = centre.get(id) ?? 0;
          const to = centre.get(node.id) ?? 0;
          const lane = 6 + ((index + k) % 3) * LANE;
          return `M 26 ${from} H ${lane} V ${to} H 26`;
        }),
      ),
    );
  }, [nodes, list]);
  return (
    <svg className="wires" aria-hidden="true" focusable="false">
      {paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="var(--muted)" strokeWidth="1.25" />
      ))}
    </svg>
  );
}

function NodeEditor({ node }: { node: TriggerNode }) {
  const nodes = useEditor((s) => s.nodes);
  const placements = useEditor((s) => s.placements);
  useEditor((s) => s.locks);
  const [form, setForm] = useState<NodeForm>(formOf(node));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const holder = nodeHolder(node.id);
  const locked = holder !== null;

  useEffect(() => {
    setForm(formOf(node));
    setErrors({});
  }, [node.id, node.version]);

  const togglePrerequisite = (id: string): void =>
    setForm((f) => ({ ...f, prerequisites: f.prerequisites.includes(id) ? f.prerequisites.filter((x) => x !== id) : [...f.prerequisites, id] }));

  const save = async (): Promise<void> => {
    const answer = form.answer !== null && form.answer.trim() !== '' && (form.kind === 'puzzle' || form.kind === 'exit') ? form.answer : null;
    setErrors(await saveNode(node, { ...form, answer }));
  };

  return (
    <form className="node-form" onSubmit={(event) => event.preventDefault()}>
      {locked ? <p className="holder">{holder.displayName} is holding this node.</p> : null}
      <label className="field">
        <span>Node title</span>
        <input type="text" value={form.title} readOnly={locked} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        {errors.title ? <span className="field-error">{errors.title}</span> : null}
      </label>
      <label className="field">
        <span>Node kind</span>
        <select value={form.kind} disabled={locked} onChange={(event) => setForm({ ...form, kind: event.target.value as NodeKind })}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        {errors.kind ? <span className="field-error">{errors.kind}</span> : null}
      </label>
      <fieldset className="prerequisites">
        <legend>Prerequisites</legend>
        {nodes.filter((n) => n.id !== node.id).map((other) => (
          <label key={other.id} className="check">
            <input type="checkbox" checked={form.prerequisites.includes(other.id)} disabled={locked} onChange={() => togglePrerequisite(other.id)} />
            <span>{other.title}</span>
          </label>
        ))}
        {errors.prerequisites ? <span className="field-error">{errors.prerequisites}</span> : null}
      </fieldset>
      <label className="field">
        <span>Linked placement</span>
        <select value={form.placementId ?? ''} disabled={locked} onChange={(event) => setForm({ ...form, placementId: event.target.value || null })}>
          <option value="">None</option>
          {placements.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Answer</span>
        <input type="text" value={form.answer ?? ''} readOnly={locked} disabled={form.kind === 'lock' || form.kind === 'cue'} onChange={(event) => setForm({ ...form, answer: event.target.value })} />
        {errors.answer ? <span className="field-error">{errors.answer}</span> : null}
      </label>
      <div className="row">
        <button type="button" className="btn primary" disabled={locked} onClick={() => void save()}>
          Save node
        </button>
        <button type="button" className="btn" disabled={locked} onClick={() => void deleteNode(node)}>
          Delete node
        </button>
      </div>
    </form>
  );
}

/** The Trigger graph sheet: the nodes as cards in chain order with their wires, and the form for the selected node. */
export default function TriggerGraph() {
  const open = useEditor((s) => s.dialogs.graph === true);
  const nodes = useEditor((s) => s.nodes);
  const selectedId = useEditor((s) => s.selectedNodeId);
  const list = useRef<HTMLUListElement>(null);
  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const titles = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);

  return (
    <Dialog name="Trigger graph" open={open} onClose={() => closeDialog('graph')} className="side-sheet" scrim={false}>
      <div className="dialog-head">
        <h2>Trigger graph</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => closeDialog('graph')}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">
        <div className="node-board">
          <ul ref={list} aria-label="Trigger nodes" className="node-list">
            {nodes.map((node) => (
              <li key={node.id} className="node-card" data-kind={node.kind}>
                <button type="button" aria-label={node.title} aria-pressed={node.id === selectedId} onClick={() => selectNode(node.id)}>
                  <span className="node-title">{node.title}</span>
                  <span className="node-meta" aria-hidden="true">
                    {node.kind}
                    {node.prerequisites.length ? ` · needs ${node.prerequisites.map((id) => titles.get(id)).join(', ')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Wires nodes={nodes} list={list} />
        </div>
        <button type="button" className="btn" onClick={() => void addNode()}>
          Add node
        </button>
        {selected ? <NodeEditor key={selected.id} node={selected} /> : <p className="muted">Select a node to edit it.</p>}
      </div>
    </Dialog>
  );
}
