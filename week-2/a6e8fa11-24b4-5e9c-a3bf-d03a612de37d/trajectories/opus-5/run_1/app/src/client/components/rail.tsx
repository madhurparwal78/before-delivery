import { useEffect, useRef } from 'react';
import { ConflictDto, VersionDto } from '../../shared/api';
import { ChartType } from '../../shared/workbook';
import { EMPTY_TRAY, reasonText, stamp } from '../lib/copy';
import { ChangedCell, WorkbookStore } from '../lib/store';
import { ChartFigure, ChartFigureProps } from './chart';

export type RailTab = 'Conflicts' | 'Charts' | 'Changed cells' | 'Versions';

export interface RailProps {
  store: WorkbookStore;
  open: boolean;
  onClose: () => void;
  tab: RailTab;
  onTab: (tab: RailTab) => void;
  tabs: RailTab[];
  conflicts: ConflictDto[];
  onResolve: (conflict: ConflictDto, choice: 'reapply' | 'keep_current') => void;
  resolving: string | null;
  changedCells: ChangedCell[];
  charts: ChartFigureProps[];
  chartBuilder: {
    range: string;
    onRange: (value: string) => void;
    title: string;
    onTitle: (value: string) => void;
    type: ChartType;
    onType: (value: ChartType) => void;
    onAdd: () => void;
    rangeError: string | null;
    titleError: string | null;
  } | null;
  versions: {
    list: VersionDto[];
    label: string;
    onLabel: (value: string) => void;
    onSave: () => void;
    saving: boolean;
    labelError: string | null;
    onRestore: ((version: VersionDto) => void) | null;
  } | null;
  conflictFocusToken: number;
}

export function Rail(props: RailProps): JSX.Element {
  const { store, tab, tabs } = props;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const firstConflictButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (props.conflictFocusToken > 0 && tab === 'Conflicts') {
      if (props.conflicts.length > 0) firstConflictButton.current?.focus();
      else tabRefs.current.Conflicts?.focus();
    }
  }, [props.conflictFocusToken, tab, props.conflicts.length]);

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      props.onTab(next);
      window.setTimeout(() => tabRefs.current[next]?.focus(), 0);
    }
  };

  const handleDrag = (event: React.PointerEvent) => {
    const start = event.clientY;
    const height = (event.currentTarget.parentElement as HTMLElement).clientHeight;
    const finish = (up: PointerEvent) => {
      window.removeEventListener('pointerup', finish);
      if (up.clientY - start > height / 2) props.onClose();
    };
    window.addEventListener('pointerup', finish);
  };

  return (
    <aside
      className={`rail${props.open ? ' open' : ''}`}
      aria-label="Workbook rail"
      onKeyDown={(event) => {
        if (event.key === 'Escape') props.onClose();
      }}
    >
      <div className="rail-handle" onPointerDown={handleDrag} />
      <div className="rail-tabs" role="tablist" aria-label="Rail">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            ref={(node) => {
              tabRefs.current[name] = node;
            }}
            className={`rail-tab${tab === name ? ' current' : ''}`}
            onClick={() => props.onTab(name)}
            onKeyDown={onTabKeyDown}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="rail-body" role="tabpanel" aria-label={tab}>
        {tab === 'Conflicts' ? (
          props.conflicts.length === 0 ? (
            <p className="muted">{EMPTY_TRAY}</p>
          ) : (
            <ul className="conflict-list" aria-label="Open conflicts">
              {props.conflicts.map((conflict, index) => (
                <li key={conflict.id} className="conflict-item">
                  <h3>{conflict.ref}</h3>
                  <p>Yours: {conflict.myInput}</p>
                  {conflict.kind === 'conflict' ? (
                    <p>
                      Current: {conflict.currentInput} by {conflict.currentAuthor?.name ?? 'another member'}
                    </p>
                  ) : (
                    <p>Not saved: {reasonText(conflict.reason ?? 'invalid_op')}</p>
                  )}
                  <div className="conflict-actions">
                    <button
                      type="button"
                      className="primary-button small"
                      ref={index === 0 ? firstConflictButton : undefined}
                      disabled={props.resolving === conflict.id}
                      onClick={() => props.onResolve(conflict, 'reapply')}
                    >
                      {props.resolving === conflict.id ? 'Re-applying…' : `Re-apply mine for ${conflict.ref}`}
                    </button>
                    <button
                      type="button"
                      className="ghost-button small"
                      onClick={() => props.onResolve(conflict, 'keep_current')}
                    >
                      Keep current for {conflict.ref}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === 'Charts' ? (
          <div className="chart-panel">
            {props.chartBuilder ? <ChartBuilder builder={props.chartBuilder} /> : null}
            {props.charts.map((chart) => (
              <ChartFigure key={chart.title} {...chart} />
            ))}
          </div>
        ) : null}

        {tab === 'Changed cells' ? (
          <ul className="changed-list" aria-label="Changed cells">
            {props.changedCells.map((change) => (
              <li key={change.ref} className="numerals">
                {change.ref} {change.from} → {change.to}
              </li>
            ))}
          </ul>
        ) : null}

        {tab === 'Versions' && props.versions ? (
          <VersionsPanel versions={props.versions} timeZone={store.timeZone} />
        ) : null}
      </div>
    </aside>
  );
}

function ChartBuilder({ builder }: { builder: NonNullable<RailProps['chartBuilder']> }): JSX.Element {
  return (
    <div className="chart-builder">
      <label className="field">
        <span>Chart range</span>
        <input type="text" value={builder.range} onChange={(event) => builder.onRange(event.target.value)} />
      </label>
      {builder.rangeError ? <p className="field-error">{builder.rangeError}</p> : null}
      <fieldset className="field" role="radiogroup" aria-label="Chart type">
        <legend>Chart type</legend>
        <label>
          <input
            type="radio"
            name="chart-type"
            checked={builder.type === 'bar'}
            onChange={() => builder.onType('bar')}
          />
          Bar
        </label>
        <label>
          <input
            type="radio"
            name="chart-type"
            checked={builder.type === 'line'}
            onChange={() => builder.onType('line')}
          />
          Line
        </label>
      </fieldset>
      <label className="field">
        <span>Chart title</span>
        <input type="text" value={builder.title} maxLength={60} onChange={(event) => builder.onTitle(event.target.value)} />
      </label>
      {builder.titleError ? <p className="field-error">{builder.titleError}</p> : null}
      <button type="button" className="primary-button small" onClick={builder.onAdd}>
        Add chart
      </button>
    </div>
  );
}

function VersionsPanel({
  versions,
  timeZone,
}: {
  versions: NonNullable<RailProps['versions']>;
  timeZone: string;
}): JSX.Element {
  return (
    <div className="versions-panel">
      <label className="field">
        <span>Version label</span>
        <input
          type="text"
          value={versions.label}
          maxLength={60}
          onChange={(event) => versions.onLabel(event.target.value)}
        />
      </label>
      {versions.labelError ? <p className="field-error">{versions.labelError}</p> : null}
      <button type="button" className="primary-button small" disabled={versions.saving} onClick={versions.onSave}>
        {versions.saving ? 'Saving…' : 'Save version'}
      </button>
      <ul className="version-list" aria-label="Versions">
        {versions.list.map((version) => (
          <li key={version.id}>
            <span className="numerals">
              Version {version.number} · {version.label} · {stamp(version.createdAt, timeZone)} ·{' '}
              {version.createdBy.name}
            </span>
            {versions.onRestore ? (
              <button
                type="button"
                className="ghost-button small"
                onClick={() => versions.onRestore?.(version)}
              >
                Restore version {version.number}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
