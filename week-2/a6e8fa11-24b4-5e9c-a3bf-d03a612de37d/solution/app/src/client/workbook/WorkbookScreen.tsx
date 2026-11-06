// The workbook screen: header, formula bar, sync strip, grid, sheet tabs and the rail.
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type Area, cellName, qualifiedArea, qualifiedCell } from "../../shared/refs.js";
import { canEdit } from "../../shared/roles.js";
import { type NumberFormat } from "../../shared/values.js";
import { ApiFailure, api } from "../api.js";
import { COPY, SEASON_CHIP, SEASON_WORD, recalcAnnouncement } from "../copy.js";
import { NotFound } from "../App.js";
import { useSession } from "../session.js";
import { type Role, type SeasonState, type WorkbookSummary } from "../types.js";
import { Icon } from "../ui/Icon.js";
import { notify } from "../ui/notices.js";
import { FormulaBar, type MenuItem, SeasonMenu, SyncStrip } from "./Chrome.js";
import { CutoffDialog, ExportDialog, ShareDialog, SheetNameDialog } from "./Dialogs.js";
import { Furrow } from "./furrow.js";
import { type Editing, Grid, type Selection } from "./Grid.js";
import { ChangedPanel, ChartsPanel, ConflictsPanel, VersionsPanel } from "./RailPanels.js";
import { type CommitEffect, WorkbookSession } from "./session.js";
import { TabList } from "./Tabs.js";

type RailTab = "conflicts" | "charts" | "changed" | "versions";
type DialogState = { kind: "cutoff" | "reopen" | "export" | "share" | "addSheet" } | { kind: "renameSheet"; sheetId: string } | null;

const editors: Role[] = ["lead", "data_manager"];

/** What the member's role allows in the current season state, read from the shared role table to show or disable controls. */
function permissions(role: Role, state: SeasonState): { cells: boolean; structure: boolean } {
  return { cells: canEdit(role, "cell", state), structure: canEdit(role, "structure", state) };
}

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function areaOf(sel: Selection): Area {
  return {
    top: Math.min(sel.anchor.row, sel.active.row),
    bottom: Math.max(sel.anchor.row, sel.active.row),
    left: Math.min(sel.anchor.col, sel.active.col),
    right: Math.max(sel.anchor.col, sel.active.col),
  };
}

/** Sheet tabs carry the furrow's change badges, so only they follow it frame by frame. */
function SheetTabs({
  furrow,
  sheets,
  selected,
  onSelect,
  onRename,
}: {
  furrow: Furrow;
  sheets: ReadonlyArray<{ id: string; name: string }>;
  selected: string;
  onSelect(id: string): void;
  onRename?: (id: string) => void;
}): JSX.Element {
  useSyncExternalStore(furrow.subscribe, furrow.getVersion);
  return (
    <TabList
      label="Sheets"
      className="sheet-tabs"
      idPrefix="sheet"
      items={sheets.map((s) => ({ id: s.id, label: s.name, badge: furrow.badges.get(s.id) }))}
      selected={selected}
      onSelect={onSelect}
      onRename={onRename}
    />
  );
}

export function WorkbookScreen({ id }: { id: string }): JSX.Element {
  const { user } = useSession();
  const session = useMemo(() => new WorkbookSession(id, user.id), [id, user.id]);
  const furrow = useMemo(() => new Furrow((sheetId, cell, value) => session.engine?.formatIn(sheetId, cell, value) ?? String(value)), [session]);
  useSyncExternalStore(session.subscribe, session.getVersion);

  const [sheetPick, setSheetPick] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ anchor: { row: 1, col: 1 }, active: { row: 1, col: 1 } });
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  editingRef.current = editing;
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= 1100);
  const [railTab, setRailTab] = useState<RailTab>("conflicts");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [conflictFocus, setConflictFocus] = useState(0);
  const formulaRef = useRef<HTMLInputElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const sheetTabsRef = useRef<HTMLDivElement>(null);
  const formulaBarRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);

  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);

  const snapshot = session.snapshot;
  const engine = session.engine;
  const sheets = engine?.sheets ?? [];
  const sheet = sheets.find((s) => s.id === sheetPick) ?? sheets[0];
  const sheetId = sheet?.id ?? "";

  const focusGrid = useCallback(() => setFocusToken((t) => t + 1), []);
  const readOnlyNotice = useCallback(() => notify(COPY.readOnly), []);

  if (session.missing) return <NotFound />;
  if (!snapshot || !engine || !sheet) {
    return (
      <main className="workbook loading" aria-busy="true">
        <div className="wb-skeleton graph-ground" />
      </main>
    );
  }

  const role = snapshot.myRole;
  const allowed = permissions(role, snapshot.state);
  const lead = editors.includes(role);
  const manager = role === "data_manager";
  const activeCell = cellName(selection.active.row, selection.active.col);
  const activeStored = engine.stored(sheetId, activeCell);
  const reduced = reducedMotion();

  const playFurrow = (effect: CommitEffect): void => {
    const sheetCount = new Set(effect.changes.map((c) => c.sheetId)).size;
    furrow.play(effect, sheetId, reduced, recalcAnnouncement(effect.ref, effect.changes.length, sheetCount));
    if (reduced) {
      setRailOpen(true);
      setRailTab("changed");
    }
  };

  const commitInput = (cell: string, input: string): void => {
    if (engine.input(sheetId, cell) === input) return;
    playFurrow(session.commitCell(sheetId, cell, input));
  };

  const moveBy = (dRow: number, dCol: number): void => {
    const row = Math.min(500, Math.max(1, selection.active.row + dRow));
    const col = Math.min(26, Math.max(1, selection.active.col + dCol));
    setSelection({ anchor: { row, col }, active: { row, col } });
  };

  const commitEditor = (dRow: number, dCol: number): void => {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    setEditing(null);
    commitInput(activeCell, current.draft);
    moveBy(dRow, dCol);
    focusGrid();
  };

  const switchSheet = (targetId: string): void => {
    setSheetPick(targetId);
    furrow.clearBadge(targetId);
  };

  const stepSheet = (step: 1 | -1): void => {
    const i = sheets.findIndex((s) => s.id === sheetId);
    const next = sheets[(i + step + sheets.length) % sheets.length];
    switchSheet(next.id);
    focusGrid();
  };

  const area = areaOf(selection);
  const toggleBold = (): void => {
    if (!allowed.cells) return readOnlyNotice();
    let anyPlain = false;
    for (let r = area.top; r <= area.bottom; r++) for (let c = area.left; c <= area.right; c++) if (!engine.format(sheetId, cellName(r, c)).bold) anyPlain = true;
    session.commitFormat(sheetId, area, { bold: anyPlain });
  };

  const setFormat = (f: NumberFormat): void => {
    if (allowed.cells) session.commitFormat(sheetId, area, { numberFormat: f });
  };

  const paste = (text: string): void => {
    const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    let last: CommitEffect | null = null;
    rows.forEach((line, r) =>
      line.split("\t").forEach((value, c) => {
        const row = selection.active.row + r;
        const col = selection.active.col + c;
        if (row > 500 || col > 26) return;
        const cell = cellName(row, col);
        if (engine.input(sheetId, cell) !== value) last = session.commitCell(sheetId, cell, value);
      }),
    );
    if (last) playFurrow(last);
  };

  const seasonAction = async (action: "start" | "close" | "archive"): Promise<void> => {
    setSeasonBusy(true);
    try {
      await api.post<{ workbook: WorkbookSummary }>(`/api/workbooks/${id}/season`, { action });
      notify(action === "start" ? "Season started." : action === "close" ? "Season closed." : "Workbook archived.");
      await session.refresh();
    } catch (err) {
      notify(err instanceof ApiFailure && err.status === 409 ? `That isn't allowed while the workbook is ${SEASON_WORD[snapshot.state]}.` : "The season wasn't changed. Try again.");
    } finally {
      setSeasonBusy(false);
    }
  };

  const state = snapshot.state;
  const menuItems: MenuItem[] = [
    { label: "Start season", enabled: state === "draft", run: () => void seasonAction("start") },
    { label: "Set cutoff…", enabled: state === "draft" || state === "in_season", run: () => setDialog({ kind: "cutoff" }) },
    { label: "Close season now", enabled: state === "in_season", run: () => void seasonAction("close") },
    { label: "Reopen season…", enabled: state === "locked", run: () => setDialog({ kind: "reopen" }) },
    { label: "Archive workbook", enabled: state === "locked" && manager, run: () => void seasonAction("archive") },
  ];

  const openRailOn = (tab: RailTab): void => {
    setRailOpen(true);
    setRailTab(tab);
  };

  const regionKeys = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key === "Escape" && railOpen && window.innerWidth < 600 && railRef.current?.contains(document.activeElement)) {
      setRailOpen(false);
      return;
    }
    if (e.key !== "F6") return;
    e.preventDefault();
    const regions = [formulaBarRef.current, gridRef.current, sheetTabsRef.current, railRef.current];
    const at = regions.findIndex((r) => r?.contains(document.activeElement));
    const next = (at + (e.shiftKey ? -1 : 1) + regions.length) % regions.length;
    if (next === 0) formulaRef.current?.focus();
    else if (next === 1) gridRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus();
    else if (next === 2) sheetTabsRef.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus();
    else {
      setRailOpen(true);
      requestAnimationFrame(() => railRef.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus());
    }
  };

  const sheetDrag = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      dragStart.current = e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      const start = dragStart.current;
      dragStart.current = null;
      const height = railRef.current?.getBoundingClientRect().height ?? 0;
      if (start !== null && e.clientY - start > height / 2) setRailOpen(false);
    },
  };

  const conflictsCount = session.conflicts.length;
  const railTabs = [
    { id: "conflicts", label: "Conflicts" },
    { id: "charts", label: "Charts" },
    { id: "changed", label: "Changed cells" },
    ...(lead ? [{ id: "versions", label: "Versions" }] : []),
  ];

  return (
    <main className="workbook" onKeyDown={regionKeys}>
      <header className="wb-header">
        <div className="wb-title">
          <h1>{snapshot.name}</h1>
          <span role="status" aria-label="Season state" className={`chip chip-${state}`}>
            {SEASON_CHIP[state]}
          </span>
        </div>
        <div className="wb-actions">
          {lead && <SeasonMenu items={menuItems} busy={seasonBusy} />}
          {lead && (
            <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: "export" })}>
              <Icon name="download" />
              Export
            </button>
          )}
          {manager && (
            <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: "share" })}>
              <Icon name="share" />
              Share
            </button>
          )}
          <button type="button" className="btn btn-secondary rail-toggle" aria-expanded={railOpen} aria-controls="workbook-rail" onClick={() => setRailOpen((o) => !o)}>
            <Icon name="rail" />
            <span className="rail-label-long">Workbook rail</span>
            <span className="rail-label-short" aria-hidden="true">
              Rail
            </span>
          </button>
        </div>
      </header>

      <div ref={formulaBarRef}>
        <FormulaBar
          refText={qualifiedCell(sheet.name, activeCell)}
          input={editing ? editing.draft : (activeStored?.input ?? "")}
          format={activeStored?.format.numberFormat ?? "general"}
          bold={activeStored?.format.bold ?? false}
          canEdit={allowed.cells}
          inputRef={formulaRef}
          onFormat={setFormat}
          onBold={toggleBold}
          onCommit={(value) => commitInput(activeCell, value)}
          onEscape={focusGrid}
          onReadOnlyType={readOnlyNotice}
        />
      </div>

      <SyncStrip
        online={session.online}
        phase={session.phase}
        pending={session.pendingCount}
        inFlight={session.inFlightCount}
        conflicts={conflictsCount}
        furrow={furrow}
        onConflicts={() => {
          openRailOn("conflicts");
          setConflictFocus((n) => n + 1);
        }}
      />

      <div className="wb-body">
        <div className="wb-main">
          <div className="grid-region" ref={gridRef}>
            <Grid
              engine={engine}
              sheetId={sheetId}
              sheetName={sheet.name}
              furrow={furrow}
              selection={selection}
              editing={editing}
              pending={session.pendingCells()}
              rollbacks={session.rollbacks}
              readOnly={!allowed.cells}
              focusToken={focusToken}
              onSelect={setSelection}
              onEditStart={(draft) => setEditing({ draft })}
              onDraft={(draft) => setEditing({ draft })}
              onCommit={commitEditor}
              onCancel={() => {
                editingRef.current = null;
                setEditing(null);
                focusGrid();
              }}
              onClear={() => commitInput(activeCell, "")}
              onSheetStep={stepSheet}
              onBold={toggleBold}
              onPaste={paste}
              onReadOnlyType={readOnlyNotice}
            />
          </div>
          <div className="sheet-strip" ref={sheetTabsRef}>
            <SheetTabs
              furrow={furrow}
              sheets={sheets}
              selected={sheetId}
              onSelect={(sid) => {
                switchSheet(sid);
                focusGrid();
              }}
              onRename={allowed.structure ? (sid) => setDialog({ kind: "renameSheet", sheetId: sid }) : undefined}
            />
            {lead && (
              <button type="button" className="btn btn-quiet add-sheet" disabled={!allowed.structure} onClick={() => setDialog({ kind: "addSheet" })}>
                <Icon name="plus" />
                Add sheet
              </button>
            )}
          </div>
        </div>

        <aside id="workbook-rail" ref={railRef} className={`rail${railOpen ? " open" : ""}`} aria-label="Workbook rail">
          <div className="rail-handle" aria-hidden="true" {...sheetDrag}>
            <span />
          </div>
          <TabList label="Rail" className="rail-tabs" idPrefix="rail" items={railTabs} selected={railTab} onSelect={(t) => setRailTab(t as RailTab)} />
          <div className="rail-panel" role="tabpanel" aria-labelledby={`rail-${railTab}`}>
            {railTab === "conflicts" && <ConflictsPanel session={session} conflicts={session.conflicts} focusFirst={conflictFocus} />}
            {railTab === "charts" && (
              <ChartsPanel
                session={session}
                engine={engine}
                sheetId={sheetId}
                furrow={furrow}
                selectionRange={qualifiedArea(sheet.name, area)}
                canBuild={lead && allowed.structure}
              />
            )}
            {railTab === "changed" && <ChangedPanel furrow={furrow} />}
            {railTab === "versions" && lead && (
              <VersionsPanel workbookId={id} zone={snapshot.timeZone} canRestore={manager} state={state} onRestored={() => void session.refresh()} />
            )}
          </div>
        </aside>
      </div>

      {(dialog?.kind === "cutoff" || dialog?.kind === "reopen") && (
        <CutoffDialog
          workbookId={id}
          mode={dialog.kind}
          current={dialog.kind === "cutoff" ? snapshot.closesAt : null}
          zone={snapshot.timeZone}
          state={state}
          onDone={() => void session.refresh()}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog?.kind === "addSheet" || dialog?.kind === "renameSheet") && (
        <SheetNameDialog
          engine={engine}
          renaming={dialog.kind === "renameSheet" ? dialog.sheetId : null}
          onSave={(name) => {
            if (dialog.kind === "renameSheet") session.renameSheet(dialog.sheetId, name);
            else switchSheet(session.addSheet(name));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "export" && <ExportDialog workbookId={id} sheetId={sheetId} onClose={() => setDialog(null)} />}
      {dialog?.kind === "share" && <ShareDialog workbookId={id} zone={snapshot.timeZone} onClose={() => setDialog(null)} />}
    </main>
  );
}
