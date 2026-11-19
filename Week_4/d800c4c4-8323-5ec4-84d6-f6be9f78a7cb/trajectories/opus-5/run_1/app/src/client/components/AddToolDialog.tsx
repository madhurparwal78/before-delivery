import { useRef, useState } from 'react';
import type { PartShape } from '../../shared/types';
import { Dialog } from './Dialog';
import { FormProblems, problemsFrom, type Problems } from './FormProblems';
import { api, ApiFailed } from '../lib/api';

const SHAPES: PartShape[] = [
  'drill',
  'saw',
  'ladder',
  'hammer',
  'wrench',
  'case',
  'battery',
  'cable',
  'blade',
  'generic',
];

interface AddToolDialogProps {
  readonly onClose: () => void;
  readonly onAdded: (tag: string) => void;
}

export function AddToolDialog({ onClose, onAdded }: AddToolDialogProps): JSX.Element {
  const [tag, setTag] = useState('');
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [partName, setPartName] = useState('');
  const [shape, setShape] = useState<PartShape>('generic');
  const [size, setSize] = useState({ width: '2', height: '2' });
  const [problems, setProblems] = useState<Problems | null>(null);
  const [pending, setPending] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  async function add(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await api.post('/api/items', {
        tag,
        name,
        replacement_cost_cents: Math.round(Number(cost) * 100),
        parts: [{ name: partName, shape, width: Number(size.width), height: Number(size.height) }],
      });
      onAdded(tag.trim().toUpperCase());
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 422) {
        setProblems(problemsFrom(error.fields));
        window.setTimeout(() => summary.current?.focus(), 0);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog label="Add tool" onEscape={onClose}>
      <h2>Add tool</h2>
      <FormProblems problems={problems} ref={summary} onJump={() => undefined} />
      <label>
        Tag
        <input
          aria-label="Tag"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        />
      </label>
      <label>
        Tool name
        <input
          aria-label="Tool name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Replacement cost
        <input
          aria-label="Replacement cost"
          className="numerals"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
      </label>
      <label>
        Part name
        <input
          aria-label="Part name"
          value={partName}
          onChange={(event) => setPartName(event.target.value)}
        />
      </label>
      <label>
        Part shape
        <select
          aria-label="Part shape"
          value={shape}
          onChange={(event) => setShape(event.target.value as PartShape)}
        >
          {SHAPES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
      </label>
      <label>
        Part width in holes
        <input
          aria-label="Part width in holes"
          className="numerals"
          value={size.width}
          onChange={(event) => setSize({ ...size, width: event.target.value })}
        />
      </label>
      <label>
        Part height in holes
        <input
          aria-label="Part height in holes"
          className="numerals"
          value={size.height}
          onChange={(event) => setSize({ ...size, height: event.target.value })}
        />
      </label>
      <button type="button" aria-busy={pending} aria-disabled={pending} onClick={() => void add()}>
        {pending ? 'Adding...' : 'Add tool'}
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </Dialog>
  );
}
