import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/api.js';
import { Dialog } from './Dialog.js';
import type { ClusterListResponse, ClusterSummary } from '../../shared/types.js';

interface AddToClusterDialogProps {
  workspaceSlug: string;
  onClose: () => void;
  onPick: (cluster: ClusterSummary) => void;
}

export function AddToClusterDialog({ workspaceSlug, onClose, onPick }: AddToClusterDialogProps): JSX.Element {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<ClusterSummary[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    const timer = setTimeout(() => {
      const search = text === '' ? '' : `?q=${encodeURIComponent(text)}`;
      void apiGet<ClusterListResponse>(`/api/workspaces/${workspaceSlug}/clusters${search}`)
        .then((response) => {
          if (latest.current === ticket) {
            setOptions(response.clusters);
            setHighlighted(0);
          }
        })
        .catch(() => undefined);
    }, 150);
    return () => clearTimeout(timer);
  }, [text, workspaceSlug]);

  return (
    <Dialog name="Add to cluster" onClose={onClose}>
      <h2>Add to cluster</h2>
      <div className="field">
        <label htmlFor="picker-find">Find a cluster</label>
        <input
          id="picker-find"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="picker-listbox"
          aria-autocomplete="list"
          data-autofocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlighted((current) => Math.min(options.length - 1, current + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlighted((current) => Math.max(0, current - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const picked = options[highlighted];
              if (picked !== undefined) {
                onPick(picked);
              }
            }
          }}
        />
      </div>
      <ul className="picker-list" id="picker-listbox" role="listbox" aria-label="Clusters">
        {options.map((option, index) => (
          <li
            key={option.id}
            role="option"
            aria-selected={index === highlighted}
            aria-label={`${option.title} · ${option.itemCount} items`}
            onClick={() => onPick(option)}
          >
            <span>
              {option.title} · <span className="count">{option.itemCount}</span> items
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
