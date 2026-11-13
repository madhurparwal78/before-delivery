import { useEffect, useRef, useState, type FormEvent } from 'react';
import { post } from '../api';
import type { Placement, PlayNode } from '../../shared/types';
import type { Units } from '../../shared/units';
import { solveRefusal } from './refusal';
import { Sheet } from './Sheet';
import { sizeText } from './sizeText';
import type { SolveResult } from './usePlaytest';

interface Props {
  open: boolean;
  onClose: () => void;
  token: string;
  nodes: PlayNode[];
  placements: Placement[];
  units: Units;
  /** The node the tester just walked up to: its entry is brought into view. */
  focusNodeId: string | null;
  onSolved: (result: SolveResult) => void;
  announce: (message: string) => void;
}

const stateWord = (node: PlayNode): 'solved' | 'available' | 'waiting' => (node.solved ? 'solved' : node.available ? 'available' : 'waiting');

interface EntryProps {
  node: PlayNode;
  placement: Placement | undefined;
  token: string;
  units: Units;
  onSolved: (result: SolveResult) => void;
  announce: (message: string) => void;
}

function PuzzleEntry({ node, placement, token, units, onSolved, announce }: EntryProps) {
  const [answer, setAnswer] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const solve = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    try {
      const result = await post<SolveResult>(`/api/play/${token}/solves`, { nodeId: node.id, answer: node.needsAnswer ? answer : undefined });
      setRefusal(null);
      onSolved(result);
      announce(`${node.title} solved.`);
    } catch (failure) {
      const message = solveRefusal(failure);
      setRefusal(message);
      announce(message);
    } finally {
      setPending(false);
    }
  };

  const state = stateWord(node);
  return (
    <li className="puzzle" data-node={node.id} data-state={state}>
      <div className="puzzle-head">
        <strong>{node.title}</strong>
        <span className="puzzle-state">{state}</span>
      </div>
      {placement ? (
        <p className="puzzle-link">
          {placement.label} · {sizeText(placement.widthMm, placement.depthMm, placement.heightMm, units)}
        </p>
      ) : null}
      {node.available ? (
        <form className="puzzle-solve" onSubmit={solve}>
          {node.needsAnswer ? <input aria-label={`Answer for ${node.title}`} placeholder="Answer" autoComplete="off" value={answer} onChange={(event) => setAnswer(event.target.value)} /> : null}
          <button type="submit" className="btn primary" aria-label={`Solve ${node.title}`} disabled={pending}>
            Solve
          </button>
        </form>
      ) : null}
      {refusal ? <p className="field-error">{refusal}</p> : null}
    </li>
  );
}

/** Every node of the chain with its state; available puzzles and the exit take an answer when they need one. */
export function PuzzlesSheet({ open, onClose, token, nodes, placements, units, focusNodeId, onSolved, announce }: Props) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!open || !focusNodeId) return;
    list.current?.querySelector(`[data-node="${focusNodeId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, focusNodeId]);

  return (
    <Sheet name="Puzzles" open={open} onClose={onClose}>
      <ol ref={list} className="puzzle-list">
        {nodes.map((node) => (
          <PuzzleEntry key={node.id} node={node} placement={placements.find((p) => p.id === node.placementId)} token={token} units={units} onSolved={onSolved} announce={announce} />
        ))}
      </ol>
    </Sheet>
  );
}
