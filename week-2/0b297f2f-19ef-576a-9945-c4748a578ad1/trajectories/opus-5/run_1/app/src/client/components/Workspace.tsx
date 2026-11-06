import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { announce as copy } from '../../shared/copy';
import type { LoanObject, Placement, Wall } from '../../shared/types';
import { formatLength, formatLuxHours, formatWhole } from '../../shared/units';
import { focusIds } from '../state/focus';
import { useApp } from '../state/store';
import {
  Header,
  LiveRegions,
  ViewGroup,
  useFocusTrap,
  useLayout,
  useReducedMotion,
  type Layout,
} from './common';
import { LuxDetailsDialog, PlaceDialog, PlacementDetailsDialog } from './dialogs';
import { ObjectRail } from './ObjectRail';
import { PreviewPanel } from './PreviewPanel';
import { SceneView } from './SceneView';

type OpenDialog =
  | { kind: 'place'; object: LoanObject }
  | { kind: 'details'; placementId: string }
  | { kind: 'lux'; placementId: string }
  | null;

export function Workspace(): ReactElement {
  const app = useApp();
  const layout = useLayout();
  const reducedMotion = useReducedMotion();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const dialogRef = useRef<OpenDialog>(null);
  dialogRef.current = dialog;

  const walls = app.exhibition?.gallery.walls ?? [];
  const isLight = app.viewParam === 'light' || app.viewParam === 'light-eye';
  const previewInInspector = layout !== 'phone';

  useEffect(() => {
    if (!isLight) setLegendOpen(false);
  }, [isLight]);

  useEffect(() => {
    if (layout === 'desk') setRailOpen(false);
  }, [layout]);

  useEffect(() => {
    if (app.previewPanelOpen) {
      app.requestFocus(focusIds.previewHeading);
    }
  }, [app.previewPanelOpen]);

  const inTextField = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || target.isContentEditable;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dialogRef.current !== null) return;
      if (inTextField(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (app.undoToast) {
          event.preventDefault();
          void app.runUndo();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '1') app.chooseView('plan');
      else if (event.key === '2') app.chooseView('wall');
      else if (event.key === '3') app.chooseView('light');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [app]);

  const onViewSettled = useCallback(
    (view: 'plan' | 'wall' | 'light') => {
      app.announce(
        view === 'plan' ? copy.planView : view === 'wall' ? copy.wallView : copy.lightView,
      );
    },
    [app],
  );

  const closeRail = useCallback(() => {
    setRailOpen(false);
    app.requestFocus('objects-toggle');
  }, [app]);

  const openRail = useCallback(() => {
    setRailOpen(true);
    if (app.previewPanelOpen) app.openPreviewPanel(false);
  }, [app]);

  const togglePreviewSheet = useCallback(() => {
    const next = !app.previewPanelOpen;
    if (next) setRailOpen(false);
    app.openPreviewPanel(next);
  }, [app]);

  const selected = app.placements.find((placement) => placement.id === app.selectedId) ?? null;
  const detailsPlacement =
    dialog?.kind === 'details'
      ? (app.placements.find((item) => item.id === dialog.placementId) ?? null)
      : null;
  const luxPlacement =
    dialog?.kind === 'lux'
      ? (app.placements.find((item) => item.id === dialog.placementId) ?? null)
      : null;

  const openDetails = (placementId: string): void => setDialog({ kind: 'details', placementId });

  const sceneColumn = (
    <div className="scene-column">
      {isLight ? (
        <LuxLegend layout={layout} open={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} />
      ) : null}
      <SceneView
        walls={walls}
        placements={app.placements}
        selectedId={app.selectedId}
        viewParam={app.viewParam}
        reducedMotion={reducedMotion}
        onSelect={app.select}
        onDragTo={app.dragTo}
        onDragEnd={app.endDrag}
        onViewSettled={onViewSettled}
      />
      <UndoToast />
      <p className="over-budget-count">{`${app.overBudgetCount} over budget`}</p>
      <SceneLedger
        layout={layout}
        onOpenDetails={openDetails}
        onOpenLux={(placementId) => setDialog({ kind: 'lux', placementId })}
      />
    </div>
  );

  const inspector = (
    <Inspector
      selected={selected}
      walls={walls}
      onOpenDetails={openDetails}
      showPreview={previewInInspector}
    />
  );

  return (
    <>
      <Header
        showViewGroup
        extra={
          layout === 'tablet' ? (
            <button
              type="button"
              id="objects-toggle"
              aria-expanded={railOpen}
              onClick={() => (railOpen ? closeRail() : openRail())}
            >
              Objects
            </button>
          ) : undefined
        }
      />
      <LiveRegions />
      <main id="main" tabIndex={-1} className={`workspace workspace-${layout}`}>
        <h1 id={focusIds.mainHeading} tabIndex={-1} className="display-title">
          {app.exhibition?.exhibition.title ?? ''}
        </h1>
        <h2 className="display-title gallery-name">{app.exhibition?.gallery.name ?? ''}</h2>
        {layout === 'phone' ? <ViewGroup className="view-group-phone" /> : null}
        <div className="workspace-columns">
          {layout === 'desk' ? <ObjectRail onPlace={(object) => setDialog({ kind: 'place', object })} /> : null}
          {sceneColumn}
          {inspector}
        </div>
        {layout !== 'desk' && railOpen ? (
          <RailPanel layout={layout} onClose={closeRail} onPlace={(object) => setDialog({ kind: 'place', object })} />
        ) : null}
        {layout === 'phone' && app.previewPanelOpen ? (
          <PreviewSheet onClose={() => app.openPreviewPanel(false)} />
        ) : null}
      </main>
      {layout === 'phone' ? (
        <div className="phone-bar">
          <button
            type="button"
            id="objects-toggle"
            aria-expanded={railOpen}
            onClick={() => (railOpen ? closeRail() : openRail())}
          >
            Objects
          </button>
          <button
            type="button"
            id="preview-toggle"
            aria-expanded={app.previewPanelOpen}
            onClick={togglePreviewSheet}
          >
            Lender preview
          </button>
        </div>
      ) : null}
      {dialog?.kind === 'place' ? (
        <PlaceDialog
          object={dialog.object}
          walls={walls}
          onClose={(options) => {
            setDialog(null);
            setRailOpen(false);
            if (!options?.keepFocus) {
              app.requestFocus(focusIds.cardAction(dialog.object.id, 'place'));
            }
          }}
        />
      ) : null}
      {detailsPlacement ? (
        <PlacementDetailsDialog
          placement={detailsPlacement}
          walls={walls}
          onClose={() => {
            setDialog(null);
            app.focusAfter({ after: 'details-closed', placementId: detailsPlacement.id });
          }}
        />
      ) : null}
      {luxPlacement ? (
        <LuxDetailsDialog
          placement={luxPlacement}
          onClose={() => {
            setDialog(null);
            app.focusAfter({ after: 'details-closed', placementId: luxPlacement.id });
          }}
        />
      ) : null}
    </>
  );
}

function LuxLegend({
  layout,
  open,
  onToggle,
}: {
  layout: Layout;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const legend = (
    <section className="lux-legend" aria-label="Lux legend">
      <p>Within limit: ink outline</p>
      <p>Over budget: red outline with hatching</p>
    </section>
  );
  if (layout === 'desk') return legend;
  return (
    <div className="lux-legend-disclosure">
      <button type="button" aria-expanded={open} onClick={onToggle}>
        Lux legend
      </button>
      {open ? legend : null}
    </div>
  );
}

function RailPanel({
  layout,
  onClose,
  onPlace,
}: {
  layout: Layout;
  onClose: () => void;
  onPlace: (object: LoanObject) => void;
}): ReactElement {
  const app = useApp();
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, true);

  useEffect(() => {
    const first = app.objects[0];
    if (first) app.requestFocus(focusIds.cardTitle(first.id));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="panel-scrim" onPointerDown={onClose} />
      <div className={`rail-panel rail-panel-${layout}`} ref={containerRef}>
        <ObjectRail onPlace={onPlace} />
      </div>
    </>
  );
}

function PreviewSheet({ onClose }: { onClose: () => void }): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, true);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <>
      <div className="panel-scrim" onPointerDown={onClose} />
      <div className="preview-sheet" ref={containerRef}>
        <PreviewPanel />
      </div>
    </>
  );
}

function UndoToast(): ReactElement | null {
  const { undoToast, runUndo } = useApp();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 200);
    return () => window.clearInterval(timer);
  }, []);
  if (!undoToast) return null;
  const left = Math.max(
    0,
    Math.ceil((undoToast.remainingMs - (Date.now() - undoToast.receivedAt)) / 1000),
  );
  return (
    <section className="undo-toast" aria-label="Undo" data-region="undo">
      <p>{`${undoToast.title} ${undoToast.kind === 'remove' ? 'removed' : 'moved'}.`}</p>
      <p>{`${left} s left`}</p>
      <button type="button" id={focusIds.undoButton} onClick={() => void runUndo()}>
        Undo
      </button>
    </section>
  );
}

function SceneLedger({
  layout,
  onOpenDetails,
  onOpenLux,
}: {
  layout: Layout;
  onOpenDetails: (placementId: string) => void;
  onOpenLux: (placementId: string) => void;
}): ReactElement {
  const app = useApp();
  const isLight = app.viewParam === 'light' || app.viewParam === 'light-eye';
  const compact = layout === 'phone';
  const rows = app.placements;

  const onHandleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    placement: Placement,
    index: number,
  ): void => {
    if (isLight) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        const previous = rows[index - 1];
        if (previous) app.requestFocus(focusIds.handle(previous.id));
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = rows[index + 1];
        if (next) app.requestFocus(focusIds.handle(next.id));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onOpenLux(placement.id);
      }
      return;
    }
    const step = event.shiftKey ? 100 : 10;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      app.nudge(placement.id, -step, 0);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      app.nudge(placement.id, step, 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      app.nudge(placement.id, 0, step);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      app.nudge(placement.id, 0, -step);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onOpenDetails(placement.id);
    }
  };

  return (
    <div className="scene-ledger">
      <h2 id={focusIds.sceneLedgerHeading} tabIndex={-1}>
        Scene ledger
      </h2>
      <table aria-label="Scene ledger">
        <thead>
          <tr>
            <th scope="col">Work</th>
            {compact ? null : <th scope="col">Wall</th>}
            <th scope="col">Offset</th>
            {compact ? null : <th scope="col">Centre height</th>}
            {compact ? null : <th scope="col">Lux</th>}
            {compact ? null : <th scope="col">Lux-hours</th>}
            <th scope="col">Lux status</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((placement, index) => (
            <tr key={placement.id}>
              <td>
                <button
                  type="button"
                  id={focusIds.handle(placement.id)}
                  onClick={() => app.select(placement.id)}
                  onFocus={() => app.select(placement.id)}
                  onKeyDown={(event) => onHandleKeyDown(event, placement, index)}
                >
                  {placement.objectTitle}
                </button>
              </td>
              {compact ? null : <td>{placement.wallName}</td>}
              <td className="figure">{formatLength(placement.offsetMm, app.unit)}</td>
              {compact ? null : (
                <td className="figure">{formatLength(placement.centreHeightMm, app.unit)}</td>
              )}
              {compact ? null : (
                <td className="figure">{`${formatWhole(placement.plannedLux)} lux`}</td>
              )}
              {compact ? null : (
                <td className="figure">{formatLuxHours(placement.plannedLuxHours)}</td>
              )}
              <td>{placement.luxStatus === 'over' ? 'Over budget' : 'Within limit'}</td>
              <td>{statusLabel(placement)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusLabel(placement: Placement): string {
  switch (placement.status) {
    case 'proposed':
      return 'Proposed';
    case 'claimed':
      return `Claimed by ${placement.claimedBy?.name ?? ''}`;
    case 'hung':
      return 'Hung';
    case 'signed_off':
      return 'Signed off';
    default:
      return 'Removed';
  }
}

function Inspector({
  selected,
  walls,
  onOpenDetails,
  showPreview,
}: {
  selected: Placement | null;
  walls: Wall[];
  onOpenDetails: (placementId: string) => void;
  showPreview: boolean;
}): ReactElement {
  const app = useApp();
  return (
    <section className="inspector" aria-label="Inspector">
      {selected ? (
        <div className="inspector-details">
          <h2>{selected.objectTitle}</h2>
          <p>{selected.wallName}</p>
          <p className="figure">{formatLength(selected.offsetMm, app.unit)}</p>
          <p className="figure">{formatLength(selected.centreHeightMm, app.unit)}</p>
          <p className="figure">{`${formatWhole(selected.plannedLux)} lux`}</p>
          <p className="figure">{formatLuxHours(selected.plannedLuxHours)}</p>
          <p>{selected.luxStatus === 'over' ? 'Over budget' : 'Within limit'}</p>
          {app.staff?.role === 'curator' && selected.status === 'proposed' ? (
            <button type="button" onClick={() => void app.removeFromWall(selected.id)}>
              Remove from wall
            </button>
          ) : null}
          <button type="button" onClick={() => onOpenDetails(selected.id)}>
            Details
          </button>
        </div>
      ) : (
        <p className="inspector-empty">No work selected.</p>
      )}
      <WallsPanel walls={walls} />
      {showPreview ? <PreviewPanel /> : null}
    </section>
  );
}

function WallsPanel({ walls }: { walls: Wall[] }): ReactElement {
  const app = useApp();
  const isCurator = app.staff?.role === 'curator';
  return (
    <section className="walls-panel" aria-label="Walls">
      <h2>Walls</h2>
      <ul>
        {walls.map((wall) => (
          <li key={wall.id}>
            {isCurator ? (
              <WallLuxField wall={wall} />
            ) : (
              <p>{`${wall.name}: ${formatWhole(wall.plannedLux)} lux`}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WallLuxField({ wall }: { wall: Wall }): ReactElement {
  const app = useApp();
  const [value, setValue] = useState(String(wall.plannedLux));
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current) setValue(String(wall.plannedLux));
  }, [wall.plannedLux]);
  return (
    <div className="field wall-lux">
      <label htmlFor={`lux-${wall.id}`}>{`Lux on ${wall.name}`}</label>
      <input
        id={`lux-${wall.id}`}
        type="text"
        value={value}
        onChange={(event) => {
          edited.current = true;
          setValue(event.target.value);
        }}
      />
      <button
        type="button"
        id={focusIds.wallLuxSave(wall.id)}
        onClick={() => {
          edited.current = false;
          void app.saveWallLux(wall.id, Number(value));
        }}
      >
        {`Save lux for ${wall.name}`}
      </button>
    </div>
  );
}
