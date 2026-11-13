import { useRef, type KeyboardEvent } from 'react';
import { BREAKPOINTS, BREAKPOINT_LEVELS, type Breakpoint } from '../../shared/types';
import { Switch } from './controls';
import { useEditorSelector, useEditorStore } from './EditorProvider';

export function PreviewBar() {
  const { actions } = useEditorStore();
  const breakpoint = useEditorSelector((e) => e.breakpoint);
  const preview = useEditorSelector((e) => e.preview);
  const reduceMotion = useEditorSelector((e) => e.reduceMotion);
  const scroll = useEditorSelector((e) => e.scroll);
  const radios = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: Breakpoint): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = BREAKPOINTS[(BREAKPOINTS.indexOf(current) + step + BREAKPOINTS.length) % BREAKPOINTS.length] as Breakpoint;
    actions.setBreakpoint(next);
    radios.current[next]?.focus();
  };

  return (
    <div className="preview-bar">
      <div role="radiogroup" aria-label="Breakpoint" className="segmented">
        {BREAKPOINTS.map((bp) => (
          <button
            key={bp}
            ref={(node) => {
              radios.current[bp] = node;
            }}
            type="button"
            role="radio"
            aria-checked={bp === breakpoint}
            tabIndex={bp === breakpoint ? 0 : -1}
            className="segment"
            onClick={() => actions.setBreakpoint(bp)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                actions.setBreakpoint(bp);
              } else onKeyDown(event, bp);
            }}
          >
            {BREAKPOINT_LEVELS[bp]}
          </button>
        ))}
      </div>
      <Switch label="Preview" checked={preview} onChange={actions.setPreview} />
      <Switch label="Reduce motion" checked={reduceMotion} onChange={actions.setReduceMotion} />
      <label className="scroll-field">
        <span>Scroll progress</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={scroll}
          aria-label="Scroll progress"
          onChange={(event) => actions.setScroll(Number(event.target.value))}
        />
        <span className="num scroll-value" aria-hidden="true">
          {scroll}
        </span>
      </label>
    </div>
  );
}
