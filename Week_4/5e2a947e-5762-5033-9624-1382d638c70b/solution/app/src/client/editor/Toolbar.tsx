import type { LayoutMode, ThemeName } from '../../shared/model.ts';
import { can } from '../../shared/rules.ts';
import { Glyph } from './glyphs.tsx';
import type { MapSession } from './session.ts';
import type { Ui } from './ui.ts';
import { useSession } from './useSession.ts';

const LAYOUT_TILES: { value: LayoutMode; name: string }[] = [
  { value: 'map', name: 'Mind map' },
  { value: 'org', name: 'Org chart' },
  { value: 'list', name: 'List' },
];

const THEME_TILES: { value: ThemeName; name: string }[] = [
  { value: 'daylight', name: 'Daylight' },
  { value: 'paper', name: 'Paper' },
  { value: 'dusk', name: 'Dusk' },
];

/** Tiny line drawings: the layout and the theme each tile stands for. */
function Drawing(props: { kind: LayoutMode | ThemeName }) {
  const lines = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' as const };
  const box = (x: number, y: number, w = 8, h = 5, fill = false) => <rect x={x} y={y} width={w} height={h} rx={2} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={1.6} />;
  switch (props.kind) {
    case 'map':
      return (
        <svg viewBox="0 0 32 24" width="28" height="22" aria-hidden="true">
          {box(12, 9.5, 8, 5, true)}
          <path d="M12 12 H8 M20 12 H24" {...lines} />
          {box(1, 3, 7, 4)}
          {box(1, 17, 7, 4)}
          {box(24, 3, 7, 4)}
          {box(24, 17, 7, 4)}
          <path d="M8 12 L8 5 M8 12 L8 19 M24 12 L24 5 M24 12 L24 19" {...lines} />
        </svg>
      );
    case 'org':
      return (
        <svg viewBox="0 0 32 24" width="28" height="22" aria-hidden="true">
          {box(12, 2, 8, 5, true)}
          {box(1, 16, 8, 5)}
          {box(12, 16, 8, 5)}
          {box(23, 16, 8, 5)}
          <path d="M16 7 V11 M5 11 H27 M5 11 V16 M16 11 V16 M27 11 V16" {...lines} />
        </svg>
      );
    case 'list':
      return (
        <svg viewBox="0 0 32 24" width="28" height="22" aria-hidden="true">
          <path d="M3 4 H17 M8 10 H24 M8 15 H22 M3 20 H19" {...lines} />
        </svg>
      );
    case 'daylight':
      return (
        <svg viewBox="0 0 32 24" width="28" height="22" aria-hidden="true">
          <rect x="3" y="6" width="26" height="12" rx="6" fill="none" stroke="currentColor" stroke-width="2.4" />
        </svg>
      );
    case 'paper':
      return (
        <svg viewBox="0 0 32 24" width="28" height="22" aria-hidden="true">
          <path d="M4 10 H28" {...lines} />
          <path d="M4 17 H28" {...lines} stroke-width={3} />
        </svg>
      );
    case 'dusk':
      return (
        <svg viewBox="0 0 32 24" width="28" height="22" aria-hidden="true">
          <rect x="3" y="6" width="26" height="12" rx="6" fill="currentColor" />
        </svg>
      );
  }
}

function Picker<T extends LayoutMode | ThemeName>(props: { label: string; tiles: { value: T; name: string }[]; current: T; onPick: (value: T) => void }) {
  const { tiles, current } = props;
  return (
    <div role="radiogroup" aria-label={props.label} class="picker-row">
      {tiles.map((tile, at) => (
        <button
          key={tile.value}
          type="button"
          role="radio"
          class="tile"
          aria-checked={current === tile.value}
          aria-label={tile.name}
          title={tile.name}
          tabIndex={current === tile.value ? 0 : -1}
          onClick={() => props.onPick(tile.value)}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            const next = tiles[(at + step + tiles.length) % tiles.length];
            if (next) {
              props.onPick(next.value);
              (event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[(at + step + tiles.length) % tiles.length])?.focus();
            }
          }}
        >
          <Drawing kind={tile.value} />
        </button>
      ))}
    </div>
  );
}

function Tool(props: { name: string; icon: string; onClick: () => void; primary?: boolean; pressed?: boolean; label?: boolean }) {
  return (
    <button type="button" class={`tool${props.primary ? ' tool-primary' : ''}${props.label ? ' tool-labelled' : ''}`} aria-label={props.name} title={props.name} aria-pressed={props.pressed} onClick={props.onClick}>
      <Glyph name={props.icon} size={20} />
      <span class="tool-label" aria-hidden="true">
        {props.name}
      </span>
    </button>
  );
}

export function Toolbar(props: { session: MapSession; ui: Ui; drawer: boolean }) {
  const { session, ui } = props;
  useSession(session);
  const role = session.role;
  const edit = can(role, 'edit');
  return (
    <div role="toolbar" aria-label="Map tools" class={`toolbar${props.drawer ? ' toolbar-drawer' : ''}`}>
      {edit ? (
        <div class="picker" aria-label="Layout and theme">
          <Picker label="Layout" tiles={LAYOUT_TILES} current={session.display.layout} onPick={(value) => session.setLayout(value)} />
          <Picker label="Theme" tiles={THEME_TILES} current={session.display.theme} onPick={(value) => session.setTheme(value)} />
        </div>
      ) : (
        <span class="view-only">
          <Glyph name="eye" size={18} />
          View only
        </span>
      )}
      <div class="tool-group">
        {edit ? <Tool name="Undo" icon="undo" onClick={() => session.undo()} /> : null}
        {edit ? <Tool name="Redo" icon="redo" onClick={() => session.redo()} /> : null}
        <span class="tool-sep" aria-hidden="true" />
        <Tool name="Fit to screen" icon="fit" onClick={() => session.fit()} />
        <Tool name="Focus branch" icon="focus" onClick={ui.focusBranch} />
        {edit ? <Tool name="Add cross-link" icon="link" onClick={() => ui.openDialog('link')} /> : null}
        {edit ? <Tool name="Add boundary" icon="boundary" onClick={ui.addBoundary} /> : null}
        <Tool name="Find" icon="find" onClick={ui.openFind} />
        <span class="tool-sep" aria-hidden="true" />
        {edit ? <Tool name="Save version" icon="save" onClick={() => ui.openDialog('save')} /> : null}
        <Tool name="History" icon="history" onClick={() => ui.openDialog('history')} />
        <Tool name="Activity" icon="activity" pressed={ui.panel === 'activity'} onClick={() => ui.togglePanel('activity')} />
        <Tool name="Details" icon="details" pressed={ui.panel === 'details'} onClick={() => ui.togglePanel('details')} />
        <span class="tool-sep" aria-hidden="true" />
        {can(role, 'manage') ? <Tool name="Share" icon="share" primary label onClick={() => ui.openDialog('share')} /> : null}
        {edit ? <Tool name="Import outline" icon="import" onClick={() => ui.openDialog('import')} /> : null}
        <Tool name="Export" icon="export" onClick={() => ui.openDialog('export')} />
        {can(role, 'present') ? <Tool name="Start presentation" icon="present" onClick={ui.startPresentation} /> : null}
      </div>
      <button type="button" role="switch" class="switch" aria-checked={session.connection === 'offline'} aria-label="Work offline" onClick={() => session.setOffline(session.connection !== 'offline')}>
        <span class="switch-track" aria-hidden="true">
          <span class="switch-thumb" />
        </span>
        <span class="switch-label" aria-hidden="true">
          Work offline
        </span>
      </button>
    </div>
  );
}
