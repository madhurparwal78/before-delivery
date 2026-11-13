// tablist "Ribbon": Draw, Annotate and Modify, each holding the buttons that start its commands.
import { Angle, ArrowRightToLine, Circle, CircleDot, Copy, CornerUpRight, Eraser, Hexagon, Layers2, MirrorRectangular, Move, MoveDiagonal, Radius, Route, RotateCw, Ruler, Scaling, Scissors, Slash, Spline, Square, Type, type LucideIcon } from 'lucide-react';
import { Fragment, useState, type KeyboardEvent } from 'react';
import { RIBBON_TABS, type CommandName } from '../../../shared/commands.ts';
import { useEditorState, useEditorStore, type EditorState } from '../store.ts';

type TabName = keyof typeof RIBBON_TABS;
const TAB_NAMES = Object.keys(RIBBON_TABS) as TabName[];

const ICONS: Partial<Record<CommandName, LucideIcon>> = {
  LINE: Slash, PLINE: Route, CIRCLE: Circle, ARC: Radius, RECTANG: Square, POLYGON: Hexagon, SPLINE: Spline,
  MTEXT: Type, DIMLINEAR: Ruler, DIMALIGNED: MoveDiagonal, DIMRADIUS: CircleDot, DIMANGULAR: Angle,
  MOVE: Move, COPY: Copy, ROTATE: RotateCw, MIRROR: MirrorRectangular, SCALE: Scaling, TRIM: Scissors,
  EXTEND: ArrowRightToLine, FILLET: CornerUpRight, OFFSET: Layers2, ERASE: Eraser,
};

/** What a mark-up holder can draw in their own trace. */
const TRACE_BUTTONS: readonly CommandName[] = ['LINE', 'PLINE', 'CIRCLE', 'MTEXT', 'ERASE'];

/** The commands that open a new group; a thin rule is drawn before each. */
const GROUP_STARTS: readonly CommandName[] = ['CIRCLE', 'RECTANG', 'DIMLINEAR', 'TRIM', 'ERASE'];

/** The buttons are disabled for view access, and for mark-up access until the person's own trace is active. */
function disabled(command: CommandName, state: EditorState): boolean {
  const access = state.drawing?.access ?? 'view';
  if (access === 'view') return true;
  if (access === 'markup') return state.activeTrace?.state !== 'open' || !TRACE_BUTTONS.includes(command);
  return false;
}

export function Ribbon() {
  const store = useEditorStore();
  const state = useEditorState();
  const [active, setActive] = useState<TabName>('Draw');
  const [focus, setFocus] = useState<TabName>('Draw');

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const index = TAB_NAMES.indexOf(focus);
    const next = event.key === 'ArrowRight' ? (index + 1) % TAB_NAMES.length
      : event.key === 'ArrowLeft' ? (index + TAB_NAMES.length - 1) % TAB_NAMES.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? TAB_NAMES.length - 1 : -1;
    const name = TAB_NAMES[next];
    if (!name) return;
    event.preventDefault();
    setFocus(name);
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${name}"]`)?.focus();
  };

  return (
    <div className="ribbon">
      <div role="tablist" aria-label="Ribbon" className="ribbon-tabs" onKeyDown={onKeyDown}>
        {TAB_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`ribbon-tab-${name}`}
            data-tab={name}
            aria-selected={active === name}
            aria-controls="ribbon-buttons"
            tabIndex={focus === name ? 0 : -1}
            className="ribbon-tab"
            onFocus={() => setFocus(name)}
            onClick={() => { setActive(name); setFocus(name); }}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="ribbon-buttons" aria-labelledby={`ribbon-tab-${active}`} className="ribbon-buttons">
        {RIBBON_TABS[active].map(([label, command]) => {
          const Icon = ICONS[command];
          const off = disabled(command, state);
          return (
            <Fragment key={label}>
              {GROUP_STARTS.includes(command) && <span className="ribbon-divider" aria-hidden="true" />}
              <button type="button" className="ribbon-button" aria-disabled={off || undefined} onClick={() => store.session.start(command)}>
                {Icon && <Icon size={18} strokeWidth={1.5} aria-hidden="true" />}
                <span>{label}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
