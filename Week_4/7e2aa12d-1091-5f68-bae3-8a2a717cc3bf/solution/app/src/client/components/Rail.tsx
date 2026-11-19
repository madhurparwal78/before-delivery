import type { Axis, Scope } from '../../shared/types.js';
import { breakpointTabName } from '../../shared/messages.js';
import type { Outcome } from '../lib/workspace.js';
import { BreakpointTabs } from './BreakpointTabs.js';
import { CommitField } from './CommitField.js';

interface RailProps {
  breakpoints: { min_width: number }[];
  scope: Scope;
  gap: { row: number; column: number };
  /** The tab the gap is inherited from, when the scope has no gap of its own. */
  inheritedFrom: Scope | null;
  designers: string[];
  onSelect: (scope: Scope) => void;
  onAddBreakpoint: () => void;
  onRemoveBreakpoint: () => void;
  onGap: (axis: 'row' | 'column', text: string) => Promise<Outcome>;
  onAddTrack: (axis: Axis) => void;
}

/** The rail, left of the canvas: breakpoints, gaps, new tracks and who else is here. */
export function Rail({ breakpoints, scope, gap, inheritedFrom, designers, onSelect, onAddBreakpoint, onRemoveBreakpoint, onGap, onAddTrack }: RailProps) {
  return (
    <>
      <section className="rail-section" aria-label="Breakpoint scope">
        <p className="label">Breakpoints</p>
        <BreakpointTabs breakpoints={breakpoints} scope={scope} onSelect={onSelect} />
        <div className="button-row">
          <button type="button" onClick={onAddBreakpoint}>
            Add breakpoint
          </button>
          <button type="button" disabled={scope === 'base'} onClick={onRemoveBreakpoint}>
            Remove breakpoint
          </button>
        </div>
      </section>
      <section className="rail-section" aria-label="Gaps">
        <p className="label">Gaps</p>
        <div className="gap-fields">
          <label>
            <span>Row gap</span>
            <CommitField label="Row gap" value={String(gap.row)} onCommit={(text) => onGap('row', text)} />
          </label>
          <label>
            <span>Column gap</span>
            <CommitField label="Column gap" value={String(gap.column)} onCommit={(text) => onGap('column', text)} />
          </label>
        </div>
        {inheritedFrom !== null && <p className="note">Gap inherited from {breakpointTabName(inheritedFrom)}</p>}
      </section>
      <section className="rail-section" aria-label="New tracks">
        <p className="label">Tracks</p>
        <div className="button-row">
          <button type="button" onClick={() => onAddTrack('column')}>
            Add column
          </button>
          <button type="button" onClick={() => onAddTrack('row')}>
            Add row
          </button>
        </div>
      </section>
      <section className="rail-section" aria-label="Presence">
        <p className="label">Designers</p>
        <ul aria-label="Designers here" className="designers">
          {designers.map((name) => (
            <li key={name} className="mono">
              {name}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
