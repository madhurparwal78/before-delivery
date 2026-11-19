import { useRef, type ReactNode } from 'react';
import { operation, type ArgValue, type Step } from '../../shared/catalogue.js';
import { Icon } from '../ui/icons.js';

const FLAG_LABELS: [string, string][] = [
  ['g', 'Global (g)'],
  ['i', 'Ignore case (i)'],
  ['m', 'Multiline (m)'],
  ['s', 'Dot matches newline (s)'],
];

export function RecipePane({
  steps,
  onRemove,
  onMove,
  onSetArg,
  onToggleDisabled,
  onToggleBreakpoint,
  bake,
  spanChips,
  updateBanner,
  onLoadLatest,
  onKeepMine,
  onSave,
  onCopyLink,
  onShare,
  onClear,
  recipeLine,
  linkField,
  onStepFocus,
  phoneMode,
  onAddOperation,
}: {
  steps: Step[];
  onRemove: (i: number) => void;
  onMove: (i: number, to: number) => void;
  onSetArg: (i: number, key: string, value: ArgValue) => void;
  onToggleDisabled: (i: number) => void;
  onToggleBreakpoint: (i: number) => void;
  bake: { kind: string; beforeStep?: number; stepIndex?: number };
  spanChips: Map<number, { start: number; end: number } | 'lost'> | null;
  updateBanner: { authorName: string; version: number } | null;
  onLoadLatest: () => void;
  onKeepMine: () => void;
  onSave: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onClear: () => void;
  recipeLine: string;
  linkField: string | null;
  onStepFocus?: (index: number) => void;
  phoneMode: boolean;
  onAddOperation?: () => void;
}) {
  return (
    <section className="pane" aria-label="Recipe" tabIndex={-1} data-pane="recipe">
      <div className="pane-title">
        <h2 title={recipeLine}>{recipeLine}</h2>
        <div className="tools">
          <button className="icon-btn" aria-label="Save" onClick={onSave} title="Save"><Icon name="save" /></button>
          <button className="icon-btn" aria-label="Copy link" onClick={onCopyLink} title="Copy link"><Icon name="link" /></button>
          <button className="icon-btn" aria-label="Share snapshot" onClick={onShare} title="Share snapshot"><Icon name="share" /></button>
          <button className="icon-btn" aria-label="Clear recipe" onClick={onClear} title="Clear recipe"><Icon name="trash" /></button>
        </div>
      </div>
      {linkField !== null ? (
        <input className="search-field" type="text" aria-label="Recipe link" readOnly value={linkField} onFocus={(e) => e.currentTarget.select()} />
      ) : null}
      {updateBanner !== null ? (
        <div className="update-banner" role="status" aria-label="Recipe update">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Recipe updated by {updateBanner.authorName}</span>
          <button className="btn" onClick={onLoadLatest}>Load latest</button>
          <button className="btn" onClick={onKeepMine}>Keep mine</button>
        </div>
      ) : null}
      <div className="pane-body">
        <ol role="list" aria-label="Recipe steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {steps.map((step, i) => (
            <StepCard
              key={`${i}-${step.op}`}
              index={i}
              step={step}
              onRemove={onRemove}
              onMove={onMove}
              onSetArg={onSetArg}
              onToggleDisabled={onToggleDisabled}
              onToggleBreakpoint={onToggleBreakpoint}
              current={(bake.kind === 'paused' && bake.beforeStep === i) || (bake.kind === 'error' && bake.stepIndex === i)}
              error={bake.kind === 'error' && bake.stepIndex === i}
              chip={spanChips?.get(i) ?? null}
              onStepFocus={onStepFocus}
              phoneMode={phoneMode}
            />
          ))}
          {steps.length === 0 ? <div className="empty-state">No steps. Add one from Operations.</div> : null}
        </ol>
      </div>
      {phoneMode && onAddOperation ? (
        <button className="btn" style={{ margin: '8px 12px' }} onClick={onAddOperation}>Add operation</button>
      ) : null}
    </section>
  );
}

export function StepCard({
  index,
  step,
  onRemove,
  onMove,
  onSetArg,
  onToggleDisabled,
  onToggleBreakpoint,
  current,
  error,
  chip,
  onStepFocus,
  phoneMode,
}: {
  index: number;
  step: Step;
  onRemove: (i: number) => void;
  onMove: (i: number, to: number) => void;
  onSetArg: (i: number, key: string, value: ArgValue) => void;
  onToggleDisabled: (i: number) => void;
  onToggleBreakpoint: (i: number) => void;
  current: boolean;
  error: boolean;
  chip: { start: number; end: number } | 'lost' | null;
  onStepFocus?: (index: number) => void;
  phoneMode: boolean;
}) {
  const spec = operation(step.op);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ startX: number; startY: number; index: number } | null>(null);

  const stepKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete') {
      e.preventDefault();
      onRemove(index);
      return;
    }
    if (e.key.toLowerCase() === 'd') {
      e.preventDefault();
      onToggleDisabled(index);
      return;
    }
    if (e.key.toLowerCase() === 'b') {
      e.preventDefault();
      onToggleBreakpoint(index);
      return;
    }
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      onMove(index, index - 1);
      requestAnimationFrame(() => cardRef.current?.focus());
      return;
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      onMove(index, index + 1);
      requestAnimationFrame(() => cardRef.current?.focus());
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-step-card]'));
      const at = cards.indexOf(cardRef.current!);
      const next = e.key === 'ArrowUp' ? at - 1 : at + 1;
      if (next >= 0 && next < cards.length) cards[next].focus();
    }
  };

  return (
    <li role="listitem" aria-label={`Step ${index + 1}: ${step.op}`}>
      <div
        ref={cardRef}
        className={`step-card${current ? ' current' : ''}${error ? ' error' : ''}`}
        tabIndex={0}
        data-step-card
        aria-current={current ? 'step' : undefined}
        onKeyDown={stepKeyDown}
        onFocus={() => onStepFocus?.(index)}
        style={{ opacity: step.disabled ? 0.55 : 1 }}
      >
        <div className="step-head">
          <span className="num">{index + 1}</span>
          <span className="op-name">{step.op}</span>
          {current ? <span className="state">{error ? 'Error' : 'Current'}</span> : null}
          {error && !current ? <span className="state">Error</span> : null}
          {chip !== null ? (
            <span className="span-chip">{chip === 'lost' ? 'span lost' : `output ${chip.start}–${chip.end}`}</span>
          ) : null}
        </div>
        {spec && spec.args.length > 0 ? (
          <div className="step-args">
            {spec.args.map((arg) => (
              <ArgField key={arg.key} argKey={arg.key} label={arg.label} value={step.args[arg.key]} onChange={(v) => onSetArg(index, arg.key, v)} options={arg.kind === 'option' ? arg.options : null} />
            ))}
          </div>
        ) : null}
        <div className="step-controls">
          <button className="icon-btn drag-handle" aria-label={`Reorder step ${index + 1}`} data-reorder={index}
            onPointerDown={(e) => { dragOrigin.current = { startX: e.clientX, startY: e.clientY, index }; }}
            title="Reorder"><Icon name="grip" /></button>
          <button className="icon-btn" aria-label={`Toggle breakpoint on step ${index + 1}`} aria-pressed={step.breakpoint} onClick={() => onToggleBreakpoint(index)} title="Breakpoint">
            <Icon name={step.breakpoint ? 'debug' : 'circlePause'} />
          </button>
          <button className="icon-btn" aria-label={`Remove step ${index + 1}`} onClick={() => onRemove(index)} title="Remove"><Icon name="trash" /></button>
          <label className="checkbox-line" style={{ marginLeft: 'auto' }}>
            <input type="checkbox" checked={step.disabled} onChange={() => onToggleDisabled(index)} aria-label={`Disable step ${index + 1}`} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Disabled</span>
          </label>
        </div>
      </div>
    </li>
  );
}

function ArgField({ argKey, label, value, onChange, options }: { argKey: string; label: string; value: ArgValue; onChange: (v: ArgValue) => void; options: readonly string[] | null }): ReactNode {
  if (argKey === 'flags') {
    const on = String(value ?? '');
    return (
      <>
        <label>{label}</label>
        <div role="group" aria-label="Flags" style={{ display: 'inline-flex', gap: '10px' }}>
          {FLAG_LABELS.map(([flag, flagLabel]) => (
            <label key={flag} className="checkbox-line">
              <input
                type="checkbox"
                checked={on.includes(flag)}
                onChange={(e) => {
                  const next = new Set(on.split(''));
                  if (e.target.checked) next.add(flag);
                  else next.delete(flag);
                  onChange(['g', 'i', 'm', 's'].filter((f) => next.has(f)).join(''));
                }}
              />
              <span style={{ fontSize: 11.5 }}>{flagLabel}</span>
            </label>
          ))}
        </div>
      </>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <>
        <label>{label}</label>
        <label className="checkbox-line">
          <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        </label>
      </>
    );
  }
  if (options !== null) {
    return (
      <>
        <label>{label}</label>
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </>
    );
  }
  return (
    <>
      <label>{label}</label>
      <input type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </>
  );
}


