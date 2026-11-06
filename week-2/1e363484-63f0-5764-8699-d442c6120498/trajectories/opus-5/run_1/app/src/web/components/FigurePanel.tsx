import type { Preview } from '../api';
import { coverageNumeral, intervalDisplay, netNumeral, signedTonnes } from '../format';
import { useCountingValue } from '../hooks';
import type { Layout } from '../hooks';

function CountingCoverage({
  value,
  reduced,
}: {
  value: number;
  reduced: boolean;
}): React.ReactElement {
  const shown = useCountingValue(value, reduced);
  return (
    <span aria-hidden="true" className="num">
      {coverageNumeral(shown)}
    </span>
  );
}

function CountingNet({ value, reduced }: { value: number; reduced: boolean }): React.ReactElement {
  const shown = useCountingValue(value, reduced);
  return (
    <span aria-hidden="true" className="num">
      {netNumeral(shown)}
    </span>
  );
}

export interface FigurePanelProps {
  readonly preview: Preview | null;
  readonly floorPct: string;
  readonly bufferPct: string;
  readonly layout: Layout;
  readonly reducedMotion: boolean;
  readonly expanded: boolean;
  readonly sealDisabledReason: string | null;
  readonly canSeal: boolean;
  readonly onOpenBreakdown: () => void;
  readonly onOpenSeal: () => void;
  readonly onToggleExpanded: () => void;
}

export function FigurePanel(props: FigurePanelProps): React.ReactElement {
  const { preview } = props;
  const coverage = preview === null ? 0 : Number(preview.coverage_pct);
  const net = preview === null ? 0 : Number(preview.net_tco2e);
  const floor = Number(props.floorPct);
  const showDetails = props.layout !== 'sheet' || props.expanded;

  const sealButton = (
    <div>
      <button
        type="button"
        className={props.canSeal ? 'armed' : undefined}
        disabled={!props.canSeal}
        onClick={props.onOpenSeal}
      >
        Seal figure
      </button>
      {props.sealDisabledReason !== null ? (
        <p className="seal-reason">{props.sealDisabledReason}</p>
      ) : null}
    </div>
  );

  const breakdownButton = (
    <button type="button" onClick={props.onOpenBreakdown} disabled={preview === null}>
      Unit breakdown
    </button>
  );

  return (
    <section className="figure-panel" aria-label="Figure" role="region">
      <h2>Figure</h2>
      <div className="gauge-row">
        <span
          role="meter"
          aria-label="Coverage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={coverage}
          aria-valuetext={`${preview === null ? '0.0' : preview.coverage_pct}%`}
          className="gauge"
        >
          <span
            className="fill"
            style={{ width: `${coverage}%`, transition: 'width 450ms ease-out' }}
          />
          <span className="floor-tick" style={{ left: `${floor}%` }} />
        </span>
        <span className="floor-label num">Floor {props.floorPct}%</span>
      </div>

      <dl>
        {showDetails ? (
          <>
            <dt>Interval</dt>
            <dd className="num">
              {preview === null
                ? '—'
                : `${intervalDisplay(Date.parse(preview.start))} to ${intervalDisplay(
                    Date.parse(preview.end),
                  )}`}
            </dd>
          </>
        ) : null}
        <dt>Coverage</dt>
        <dd>
          <CountingCoverage value={coverage} reduced={props.reducedMotion} />
          <span className="visually-hidden">
            {preview === null ? '0.0%' : `${preview.coverage_pct}%`}
          </span>
        </dd>
        <dt>Net tCO2e</dt>
        <dd>
          <CountingNet value={net} reduced={props.reducedMotion} />
          <span className="visually-hidden">
            {preview === null ? '0.000' : signedTonnes(preview.net_tco2e)}
          </span>
        </dd>
        {showDetails ? (
          <>
            <dt>CO2 tCO2e</dt>
            <dd className="num">{preview === null ? '—' : signedTonnes(preview.co2_tco2e)}</dd>
            <dt>CH4 tCO2e</dt>
            <dd className="num">{preview === null ? '—' : signedTonnes(preview.ch4_tco2e)}</dd>
            <dt>Buffer tCO2e</dt>
            <dd className="num">
              {preview === null ? '—' : preview.buffer_tco2e}
              <span className="buffer-bar" aria-hidden="true" />
            </dd>
            <dt>Credited tCO2e</dt>
            <dd className="num">
              {preview === null ? '—' : signedTonnes(preview.credited_tco2e)}
            </dd>
            <dt>Readings</dt>
            <dd className="num">{preview === null ? '—' : preview.readings_count}</dd>
          </>
        ) : null}
      </dl>

      {props.layout === 'sheet' ? (
        <div className="dialog-actions">
          {sealButton}
          {props.expanded ? breakdownButton : null}
          <button type="button" aria-expanded={props.expanded} onClick={props.onToggleExpanded}>
            Figure details
          </button>
        </div>
      ) : (
        <div className="dialog-actions">
          {breakdownButton}
          {sealButton}
        </div>
      )}
    </section>
  );
}
