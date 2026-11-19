import { breakpointTabName } from '../../shared/messages.js';
import type { Scope } from '../../shared/types.js';
import { useTabKeys } from './Tabs.js';

/** The tablist "Breakpoints": Base and one tab per breakpoint, narrowest first. */
export function BreakpointTabs({ breakpoints, scope, onSelect }: { breakpoints: { min_width: number }[]; scope: Scope; onSelect: (scope: Scope) => void }) {
  const keys = useTabKeys();
  const scopes: Scope[] = ['base', ...breakpoints.map((breakpoint) => breakpoint.min_width)];
  return (
    <div role="tablist" aria-label="Breakpoints" className="tabs bp-tabs" onKeyDown={keys}>
      {scopes.map((candidate) => (
        <button key={candidate} type="button" role="tab" aria-selected={candidate === scope} tabIndex={candidate === scope ? 0 : -1} className="tab mono" onClick={() => onSelect(candidate)}>
          {breakpointTabName(candidate)}
        </button>
      ))}
    </div>
  );
}
