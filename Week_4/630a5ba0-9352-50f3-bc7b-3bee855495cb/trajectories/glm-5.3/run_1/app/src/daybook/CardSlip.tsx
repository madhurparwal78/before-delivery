import { useEffect, useRef, useState } from 'react';
import type { ApiTask } from '../api/client';
import { ESTIMATE_CHOICES, ESTIMATE_CHOICE_LABEL } from '../../src-shared/constants';
import { dayLabelOf } from './labels';

export interface CardCallbacks {
  onMoveStart: (e: React.PointerEvent<HTMLButtonElement>, task: ApiTask) => void;
  onKeyboardPick: (task: ApiTask) => void;
  onToggleDone: (task: ApiTask) => void;
  onEstimate: (task: ApiTask, minutes: number) => void;
  onDropOnCardZone: (task: ApiTask) => void;
}

export function CardSlip({
  task,
  showEstimates,
  callbacks,
  fromDayLabel,
  held,
  rolledBack,
}: {
  task: ApiTask;
  showEstimates: boolean;
  callbacks: CardCallbacks;
  fromDayLabel: string | null;
  held: boolean;
  rolledBack: boolean;
}): JSX.Element {
  const zoneRef = useRef<HTMLFieldSetElement | null>(null);
  return (
    <li className={`card${held ? ' dragging' : ''}${rolledBack ? ' rolled-back' : ''}`} aria-roledescription="card">
      <div className="row">
        <button
          type="button"
          className="handle"
          aria-label={`Move ${task.title}`}
          onPointerDown={(e) => callbacks.onMoveStart(e, task)}
          onKeyDown={(e) => onKey(e, task, callbacks)}
        >
          <MoveIcon />
        </button>
        <label className="title-row" style={{ display: 'contents' }}>
          <input
            type="checkbox"
            aria-label={`Done: ${task.title}`}
            checked={task.status === 'done'}
            onChange={() => callbacks.onToggleDone(task)}
          />
        </label>
        <span className={`title mono-label${task.status === 'done' ? ' done' : ''}`}>{task.title}</span>
        <span className="estimate">{task.estimateMinutes === null ? 'No estimate' : `${task.estimateMinutes}m`}</span>
      </div>
      {fromDayLabel !== null ? <span className="from-day">From {fromDayLabel}</span> : null}
      {showEstimates && task.status === 'open' ? (
        <div className="estimate-options" role="radiogroup" aria-label={`Estimate for ${task.title}`}>
          {ESTIMATE_CHOICES.map((minutes) => (
            <label key={minutes}>
              <input
                type="radio"
                name={`estimate-${task.id}`}
                value={minutes}
                checked={task.estimateMinutes === minutes}
                onChange={() => callbacks.onEstimate(task, minutes)}
              />
              <span className="mono">{ESTIMATE_CHOICE_LABEL[minutes]}</span>
            </label>
          ))}
        </div>
      ) : null}
    </li>
  );
}

const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, task: ApiTask, callbacks: CardCallbacks): void => {
  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    callbacks.onKeyboardPick(task);
  }
};

function MoveIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
