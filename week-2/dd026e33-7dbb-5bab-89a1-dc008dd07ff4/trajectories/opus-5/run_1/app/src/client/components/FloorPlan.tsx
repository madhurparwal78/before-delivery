import { useRef, type ReactNode } from 'react';
import { BAY_CLASS_LABEL, type Bay } from '../../shared/types';

export type FloorPlanMode = 'browse' | 'picker';

export interface FloorPlanProps {
  readonly bays: readonly Bay[];
  readonly mode: FloorPlanMode;
  readonly selected?: string | null;
  onActivate(bay: Bay): void;
}

function stateOf(bay: Bay, mode: FloorPlanMode): string {
  if (bay.car !== null) return `occupied by ${bay.car.name}`;
  if (mode === 'picker' && bay.reason === 'class_change') return 'other class';
  if (mode === 'picker' && bay.reason === 'too_small') return 'too small';
  return 'free';
}

function isEligible(bay: Bay, mode: FloorPlanMode): boolean {
  if (mode === 'browse') return true;
  return bay.eligible !== false;
}

/** The floor plan: one Tab stop, arrow keys by row and column, Enter or tap to activate. */
export function FloorPlan({ bays, mode, selected, onActivate }: FloorPlanProps): ReactNode {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const rows = [...new Set(bays.map((bay) => bay.row))].sort((left, right) => left - right);
  const focusTarget = selected ?? bays[0]?.id ?? null;

  const move = (bay: Bay, rowStep: number, columnStep: number): void => {
    const targetRow = bay.row + rowStep;
    const targetColumn = bay.column + columnStep;
    const next = bays.find(
      (candidate) => candidate.row === targetRow && candidate.column === targetColumn,
    );
    if (next === undefined) return;
    const element = groupRef.current?.querySelector<HTMLButtonElement>(
      `[data-bay="${next.id}"]`,
    );
    element?.focus();
  };

  return (
    <div className="floor-plan" role="group" aria-label="Floor plan" ref={groupRef}>
      {rows.map((row) => (
        <div className="floor-plan-row" key={row}>
          {bays
            .filter((bay) => bay.row === row)
            .sort((left, right) => left.column - right.column)
            .map((bay) => {
              const eligible = isEligible(bay, mode);
              const state = stateOf(bay, mode);
              return (
                <button
                  type="button"
                  key={bay.id}
                  data-bay={bay.id}
                  className={[
                    'bay',
                    bay.car === null ? 'bay-free' : 'bay-occupied',
                    eligible ? '' : 'bay-ineligible',
                    selected === bay.id ? 'bay-selected' : '',
                  ]
                    .filter((part) => part !== '')
                    .join(' ')}
                  aria-label={`Bay ${bay.code}, ${BAY_CLASS_LABEL[bay.class]}, ${state}`}
                  aria-disabled={eligible ? undefined : true}
                  tabIndex={focusTarget === bay.id ? 0 : -1}
                  style={{
                    flexGrow: bay.length_mm,
                    minHeight: `${Math.round(bay.width_mm / 28)}px`,
                  }}
                  onClick={() => {
                    if (eligible) onActivate(bay);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      move(bay, 0, 1);
                    } else if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      move(bay, 0, -1);
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      move(bay, 1, 0);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      move(bay, -1, 0);
                    }
                  }}
                >
                  <span className="bay-code mono">{bay.code}</span>
                  <span className="bay-class">{BAY_CLASS_LABEL[bay.class]}</span>
                  <span className="bay-state">{bay.car === null ? 'Free' : bay.car.name}</span>
                  {bay.car === null ? null : <span className="bay-tab" aria-hidden="true" />}
                  {mode === 'picker' && !eligible ? (
                    <span className="bay-reason">{state === 'free' ? '' : state}</span>
                  ) : null}
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}
