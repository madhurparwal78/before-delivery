import { useEffect, useState } from 'react';
import { Segmented } from './Field';
import { useMedia, SHEETS_QUERY } from '../lib/useMedia';
import { useWorkbench, type Tool } from '../workbench';

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: 'select', label: 'Select', icon: 'M4 3l9 4-4 1.5L7.5 13z' },
  { tool: 'line', label: 'Line', icon: 'M3 13L13 3' },
  { tool: 'circle', label: 'Circle', icon: 'M8 3a5 5 0 1 0 0.01 0z' },
  { tool: 'arc', label: 'Arc', icon: 'M3 12a6 6 0 0 1 10 -4' },
  { tool: 'point', label: 'Point', icon: 'M8 6.2a1.8 1.8 0 1 0 0.01 0z' },
];

function Icon({ path, filled }: { path: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="tool-icon">
      <path d={path} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Readout() {
  const { slackShown } = useWorkbench();
  return (
    <div role="status" aria-label="Slack" className="slack-readout">
      {slackShown === null ? null : slackShown === 0 ? (
        <span className="held-word">Fully held</span>
      ) : (
        <>
          <span>Slack </span>
          <span className="num slack-number">{slackShown}</span>
        </>
      )}
    </div>
  );
}

function Decimals() {
  const wb = useWorkbench();
  const precision = wb.member?.precision ?? 2;
  const [text, setText] = useState(String(precision));
  useEffect(() => setText(String(precision)), [precision]);
  const commit = (value: string) => {
    const n = Number(value);
    if (value !== '' && Number.isInteger(n) && n >= 0 && n <= 4 && n !== precision) void wb.setPrecision(n);
  };
  return (
    <label className="decimals">
      <span>Decimals</span>
      <input
        type="number"
        className="num"
        min={0}
        max={4}
        value={text}
        aria-label="Decimals"
        onChange={(event) => {
          setText(event.target.value);
          commit(event.target.value);
        }}
        onBlur={() => setText(String(precision))}
      />
    </label>
  );
}

/** The one strip along the bottom edge: tools, Slack readout, units and decimals (and the sheet buttons on phones). */
export function CommandStrip() {
  const wb = useWorkbench();
  const sheets = useMedia(SHEETS_QUERY);
  const inSketch = wb.view?.kind === 'sketch';
  const founder = wb.member?.role === 'founder';
  return (
    <div className="command-strip panel">
      {sheets && (
        <div className="sheet-buttons">
          <button type="button" className="icon-button" aria-label="Feature tree" title="Feature tree" onClick={() => wb.setSheet('tree')}>
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
              <path d="M3 3h5M5 8h8M5 13h8M3 3v10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="icon-button" aria-label="Properties" title="Properties" onClick={() => wb.setSheet('properties')}>
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12M10 2.5v3M5 6.5v3M11 10.5v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
      <div role="toolbar" aria-label="Tools" className="tools">
        {TOOLS.map(({ tool, label, icon }) => (
          <button key={tool} type="button" title={label} aria-pressed={inSketch && wb.tool === tool && !wb.extrude} disabled={!inSketch} onClick={() => wb.setTool(tool)}>
            <Icon path={icon} />
            <span className="tool-label">{label}</span>
          </button>
        ))}
        {founder && (
          <button type="button" title="Extrude" aria-pressed={inSketch && !!wb.extrude} disabled={!inSketch} onClick={() => wb.openExtrude()}>
            <Icon path="M3 6l5-3 5 3v5l-5 3-5-3zM3 6l5 3 5-3M8 9v5" />
            <span className="tool-label">Extrude</span>
          </button>
        )}
      </div>
      <Readout />
      <div className="strip-units">
        <Segmented
          label="Units"
          name="units"
          value={wb.member?.units ?? 'mm'}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'in', label: 'in' },
          ]}
          onChange={(units) => void wb.setUnits(units)}
        />
        <Decimals />
      </div>
    </div>
  );
}
