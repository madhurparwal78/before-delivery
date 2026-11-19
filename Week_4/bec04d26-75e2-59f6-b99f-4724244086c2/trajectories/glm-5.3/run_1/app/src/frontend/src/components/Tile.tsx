import type { ReturnJson } from '../../../shared/types';
import { stateColour, tileClass } from '../lib/design';

/**
 * One drawn "folded return": a sheet with one folded corner, stamped with the
 * state's two-letter code and the period, in black lines or light on black.
 */
export function Tile({
  ret,
  stateCodes,
  size = 'normal',
}: {
  ret: ReturnJson;
  stateCodes: string[];
  size?: 'normal' | 'large' | 'phone';
}): React.ReactNode {
  const colour = stateColour(stateCodes, ret.state);
  return (
    <div
      className={`${tileClass(colour)} tile-${size}`}
      data-return-id={ret.id}
      data-status={ret.status}
      data-overdue={String(ret.overdue)}
      data-due-at={ret.due_at}
      data-state={ret.state}
      data-version={ret.version}
      data-rate={ret.edition.rate}
      data-edition={ret.edition.effective_date}
    >
      <svg viewBox="0 0 120 150" aria-hidden="true" className="tile-svg">
        <g className={colour === 'black' ? 'tile-lines-light' : 'tile-lines'}>
          <path d="M30 22 h60 v84 l-14 16 h-60 v-100 z" fill="none" strokeWidth="3" />
          <path d="M90 22 v16 h14" fill="none" strokeWidth="3" />
          <line x1="42" y1="52" x2="78" y2="52" strokeWidth="3" />
          <line x1="42" y1="66" x2="78" y2="66" strokeWidth="3" />
          <line x1="42" y1="80" x2="64" y2="80" strokeWidth="3" />
        </g>
        <text
          x="60"
          y="36"
          textAnchor="middle"
          className={`tile-stamp ${colour === 'black' ? 'tile-stamp-light' : ''}`}
        >
          {ret.state}
        </text>
        <text
          x="60"
          y="112"
          textAnchor="middle"
          className={`tile-period ${colour === 'black' ? 'tile-stamp-light' : ''}`}
        >
          {ret.period_label}
        </text>
      </svg>
      {ret.overdue ? <span className="tile-overdue-word">Overdue</span> : null}
    </div>
  );
}

export function EmptyTile({ sentence }: { sentence: string }): React.ReactNode {
  return (
    <div className="empty-state">
      <div className="tile tile-green tile-empty" aria-hidden="true">
        <svg viewBox="0 0 120 150" className="tile-svg">
          <g className="tile-lines">
            <path d="M30 22 h60 v84 l-14 16 h-60 v-100 z" fill="none" strokeWidth="3" />
            <path d="M90 22 v16 h14" fill="none" strokeWidth="3" />
          </g>
        </svg>
      </div>
      <p>{sentence}</p>
    </div>
  );
}
