import type { KeyboardEvent } from 'react';
import { Chip, useReducedMotion } from '../ui';
import type { NodeKind, StepStatus } from '../types';
import { KIND_LABEL } from './geometry';

export interface ListItem {
  id: string;
  kind: NodeKind;
  name: string;
  col: number;
  row: number;
  status?: StepStatus;
  reused?: boolean;
}

/** The narrow-screen replacement for the canvas: one item per step, in order. */
export function StepList({ items, onOpen }: { items: ListItem[]; onOpen: (item: ListItem, element: HTMLElement) => void }) {
  const reduced = useReducedMotion();
  const move = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button.step-item-button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (at === -1 || !next) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <ul aria-label="Steps" className="step-list" onKeyDown={move}>
      {items.map((item) => (
        <li
          key={item.id}
          className="step-item"
          data-step-id={item.id}
          data-kind={item.kind}
          data-col={item.col}
          data-row={item.row}
          {...(item.status === undefined ? {} : { 'data-status': item.status, 'data-reused': item.reused ? 'true' : 'false', 'data-anim': item.status === 'running' && !reduced ? 'running' : 'none' })}
        >
          <button type="button" className="step-item-button" onClick={(event) => onOpen(item, event.currentTarget)}>
            {item.name}
          </button>
          <span className="mono-label muted">{KIND_LABEL[item.kind]}</span>
          {item.status === undefined ? null : <Chip status={item.status} />}
        </li>
      ))}
    </ul>
  );
}
