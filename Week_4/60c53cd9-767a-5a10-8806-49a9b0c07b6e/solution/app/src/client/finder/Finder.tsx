/** The finder: filters, the tower with its Window Lens, results, the home detail and the hold flow, all on one live inventory. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PublicHold, PublicUnit, TowerAssets, TowerCell } from "../../shared/api-types.js";
import { COPY, priceChangedText, withdrawnText } from "../../shared/copy.js";
import { STACKS, STATUS_LABEL, facingOf, type CellStatus, type StackLetter } from "../../shared/domain.js";
import { formatDollars } from "../../shared/figures.js";
import { api, NetworkError } from "../api.js";
import { useAuth } from "../auth.js";
import { useChrome } from "../chrome.js";
import { Modal } from "../dialogs.js";
import { useLayout, useReread } from "../hooks.js";
import { DURATIONS, easeOut, prefersReducedMotion, tween } from "../motion.js";
import { useMyHolds } from "../my-holds.js";
import { useNotify } from "../notices.js";
import { writeAddress } from "../router.js";
import { webglAvailable } from "../tower/scene.js";
import { TowerStage, type CellView, type StageFailure, type StageMode } from "../tower/TowerStage.js";
import { readUnit } from "../unit-cache.js";
import { ConfirmHold } from "./ConfirmHold.js";
import { Detail } from "./Detail.js";
import { FilterControls } from "./filters.js";
import { Lens, type LensTarget } from "./Lens.js";
import { Results } from "./Results.js";
import { finderAddress, useSearch } from "./use-search.js";

const LIVE: readonly CellStatus[] = ["available", "held", "reserved"];
const INSET_WIDTH = 140;
const FORCED_READS = 3;

interface Pinned {
  readonly code: string;
  /** Opened from the address: shown only once the home has been read. */
  readonly deepLink: boolean;
}

interface OpenUnit {
  readonly unit: PublicUnit | null;
  readonly gone: boolean;
  readonly loaded: boolean;
  readonly apply: (unit: PublicUnit) => void;
  readonly markGone: () => void;
}

/** The open home, re-read on the shared schedule; an older reply never replaces a newer one. */
const useOpenUnit = (code: string | null, deepLink: boolean, onMissing: (message: string) => void): OpenUnit => {
  const notify = useNotify();
  const [unit, setUnit] = useState<PublicUnit | null>(null);
  const [gone, setGone] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const unitRef = useRef<PublicUnit | null>(null);
  const goneRef = useRef(false);
  const issued = useRef(0);
  const applied = useRef(0);
  const missing = useRef(onMissing);
  missing.current = onMissing;

  const take = useCallback((next: PublicUnit, announce: boolean) => {
    const previous = unitRef.current;
    if (previous && next.priceVersion < previous.priceVersion) return;
    if (announce && previous && previous.price !== next.price) notify(priceChangedText(next.code, formatDollars(next.price)));
    unitRef.current = next;
    setUnit(next);
  }, [notify]);

  const markGone = useCallback(() => {
    if (goneRef.current || code === null) return;
    goneRef.current = true;
    setGone(true);
    notify(withdrawnText(code));
  }, [code, notify]);

  const read = useCallback(
    async (force: boolean) => {
      if (code === null) return;
      issued.current += 1;
      const mine = issued.current;
      const result = await readUnit(code, force);
      if (mine < applied.current) return;
      applied.current = mine;
      if (result.status === "ok") {
        setLoaded(true);
        take(result.unit, true);
      } else if (result.status === "gone") {
        if (unitRef.current === null && deepLink) missing.current(result.message);
        else markGone();
        setLoaded(true);
      }
    },
    [code, deepLink, take, markGone],
  );

  useEffect(() => {
    unitRef.current = null;
    goneRef.current = false;
    issued.current = 0;
    applied.current = 0;
    setUnit(null);
    setGone(false);
    setLoaded(false);
    if (code !== null) void read(true);
  }, [code, read]);

  useReread(() => void read(true), code !== null);

  return { unit, gone, loaded, apply: (next) => take(next, false), markGone };
};

interface TowerData {
  readonly cells: ReadonlyMap<string, TowerCell> | null;
  readonly assets: TowerAssets | null;
  readonly refresh: () => void;
  readonly reads: number;
}

const useTower = (): TowerData => {
  const [cells, setCells] = useState<ReadonlyMap<string, TowerCell> | null>(null);
  const [assets, setAssets] = useState<TowerAssets | null>(null);
  const [reads, setReads] = useState(0);
  const issued = useRef(0);
  const applied = useRef(0);
  const refresh = useCallback(() => {
    issued.current += 1;
    const mine = issued.current;
    void api<{ units: TowerCell[]; assets: TowerAssets }>("GET", "/api/tower")
      .then((result) => {
        if (!result.ok || mine < applied.current) return;
        applied.current = mine;
        setCells(new Map(result.body.units.map((cell) => [cell.code, cell])));
        setAssets((previous) => previous ?? result.body.assets);
        setReads((count) => count + 1);
      })
      .catch((error: unknown) => {
        if (!(error instanceof NetworkError)) throw error;
      });
  }, []);
  useEffect(refresh, [refresh]);
  useReread(refresh);
  return { cells, assets, refresh, reads };
};

const FilterSheet = ({ onClosed, children }: { onClosed: () => void; children: ReactNode }): ReactNode => {
  const panel = useRef<HTMLElement | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const closing = useRef(false);

  const slide = (from: number, to: number, done?: () => void): void => {
    cancel.current?.();
    const element = panel.current;
    if (!element) return;
    if (prefersReducedMotion()) {
      element.style.transform = `translateX(${to}%)`;
      done?.();
      return;
    }
    cancel.current = tween(
      DURATIONS.sheetSlide,
      (t) => {
        element.style.transform = `translateX(${from + (to - from) * t}%)`;
      },
      done,
      easeOut,
    );
  };

  const close = (): void => {
    if (closing.current) return;
    closing.current = true;
    slide(0, -105, onClosed);
  };

  return (
    <Modal
      label="Filters"
      className="sheet"
      onClose={close}
      onPanel={(element) => {
        panel.current = element;
        if (element) slide(-105, 0);
      }}
    >
      <div className="sheet-head">
        <h2>Filters</h2>
        <button type="button" className="button" onClick={close}>
          Close
        </button>
      </div>
      {children}
    </Modal>
  );
};

export const Finder = (): ReactNode => {
  const layout = useLayout();
  const { account, openSignIn, sessionLost } = useAuth();
  const notify = useNotify();
  const chrome = useChrome();
  const myHolds = useMyHolds();
  const tower = useTower();

  const [pinned, setPinned] = useState<Pinned | null>(null);
  const pinnedRef = useRef<Pinned | null>(null);
  pinnedRef.current = pinned;
  const [state, actions] = useSearch(useCallback(() => pinnedRef.current?.code ?? null, []));
  const filtersRef = useRef(state.filters);
  filtersRef.current = state.filters;

  const [mode, setMode] = useState<StageMode>(() => (webglAvailable() ? "webgl" : "grid"));
  const [rovingCode, setRovingCode] = useState("38C");
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ code: string; x: number; y: number } | null>(null);
  const [tapCode, setTapCode] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [confirmFor, setConfirmFor] = useState<{ code: string; price: number; priceVersion: number } | null>(null);
  const [confirmation, setConfirmation] = useState<PublicHold | null>(null);
  const [forced, setForced] = useState<ReadonlyMap<string, number>>(new Map());
  const opener = useRef<HTMLElement | null>(null);
  const resultsScroll = useRef<HTMLDivElement>(null);

  const open = useOpenUnit(pinned?.code ?? null, pinned?.deepLink ?? false, (message) => {
    notify(message);
    closeHome();
  });

  // ---- address, history and the open home -------------------------------------------------------------------

  const closeHome = useCallback((): void => {
    setPinned(null);
    setConfirmation(null);
    setConfirmFor(null);
    writeAddress(finderAddress(filtersRef.current, null), "replace");
  }, []);

  useEffect(() => {
    const restore = (): void =>
      actions.restore((code) => {
        setPinned(code === null ? null : { code, deepLink: true });
        setConfirmation(null);
        setConfirmFor(null);
      });
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
    // The search hook's actions are stable callbacks.
  }, []);

  useEffect(() => {
    chrome.setFiltersButton(layout !== "desktop");
    return () => chrome.setFiltersButton(false);
  }, [layout]);

  useEffect(() => {
    if (layout === "desktop" && chrome.sheetOpen) chrome.setSheetOpen(false);
  }, [layout, chrome.sheetOpen]);

  // ---- live statuses ----------------------------------------------------------------------------------------

  useEffect(() => {
    setForced((previous) => {
      if (previous.size === 0) return previous;
      const next = new Map<string, number>();
      for (const [code, reads] of previous) {
        const cell = tower.cells?.get(code);
        if (cell?.status === "available" && tower.reads - reads < FORCED_READS) next.set(code, reads);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [tower.cells, tower.reads]);

  const mineCodes = useMemo(
    () => new Set(myHolds.holds.filter((hold) => hold.status === "active").map((hold) => hold.unitCode)),
    [myHolds.holds],
  );

  const cellState = useCallback(
    (code: string): { status: CellStatus; syncing: boolean } | null => {
      const cell = tower.cells?.get(code);
      if (!cell) return null;
      const status = cell.status === "available" && forced.has(code) ? "held" : cell.status;
      return { status, syncing: cell.syncing };
    },
    [tower.cells, forced],
  );

  const statusLabelOf = useCallback(
    (code: string, fallback: CellStatus): { text: string; syncing: boolean } => {
      const cell = cellState(code);
      const status = cell?.status ?? fallback;
      return { text: status === "held" && mineCodes.has(code) ? "Held by you" : STATUS_LABEL[status], syncing: cell?.syncing ?? false };
    },
    [cellState, mineCodes],
  );

  const matching = useMemo(() => (state.outage === null && state.reply ? new Set(state.reply.matchingCodes) : null), [state.reply, state.outage]);

  const viewFor = useCallback(
    (code: string): CellView => {
      const cell = cellState(code);
      const stack = code.slice(-1) as StackLetter;
      const bearing = STACKS[stack].bearing;
      if (!cell) return { name: code, tone: "muted", pinnable: false };
      if (cell.status === "withdrawn" || cell.status === "unreleased") {
        return { name: `${code} · ${STATUS_LABEL[cell.status]}`, tone: cell.status === "withdrawn" ? "hatched" : "muted", pinnable: false };
      }
      const dimmed = matching !== null && !matching.has(code);
      const label = cell.status === "held" && mineCodes.has(code) ? "Held by you" : STATUS_LABEL[cell.status];
      const name = `${code} · ${bearing}° ${facingOf(bearing)} · ${label}${cell.syncing ? ` · ${COPY.syncing}` : ""}${dimmed ? ` · ${COPY.outsideFilters}` : ""}`;
      const tone = dimmed ? "dim" : cell.status === "available" ? "lit" : "hatched";
      return { name, tone, pinnable: LIVE.includes(cell.status) && !dimmed };
    },
    [cellState, matching, mineCodes],
  );

  // ---- the lens ---------------------------------------------------------------------------------------------

  const pinSource = pinned && !confirmation ? { code: pinned.code, x: anchor?.x ?? window.innerWidth / 2, y: anchor?.y ?? window.innerHeight / 2 } : null;
  const lensSource = hover ?? (layout === "phone" ? (tapCode ? { code: tapCode, x: 0, y: 0 } : focusPoint) : focusPoint) ?? pinSource;
  const lensCode = lensSource?.code ?? null;
  const lensTarget: LensTarget | null = useMemo(() => {
    if (lensCode === null || confirmation) return null;
    const view = viewFor(lensCode);
    const cell = cellState(lensCode);
    const stack = lensCode.slice(-1) as StackLetter;
    const kind = cell?.status === "withdrawn" || cell?.status === "unreleased" || !cell ? "chip-only" : view.tone === "dim" ? "outside" : "view";
    const at = lensSource ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return { code: lensCode, chip: view.name, bearing: STACKS[stack].bearing, kind, x: at.x, y: at.y };
  }, [lensCode, lensSource?.x, lensSource?.y, viewFor, cellState, confirmation]);

  useEffect(() => {
    if (lensCode !== null && lensCode !== currentCode) setCurrentCode(lensCode);
  }, [lensCode]);

  useEffect(() => {
    if (currentCode === null || layout === "phone") return;
    resultsScroll.current?.querySelector<HTMLElement>(`[data-row="${currentCode}"]`)?.scrollIntoView({ block: "nearest" });
  }, [currentCode, layout, state.rows]);

  // ---- pinning ----------------------------------------------------------------------------------------------

  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const pin = useCallback(
    (code: string, element: HTMLElement | null): void => {
      opener.current = element;
      const box = element?.getBoundingClientRect();
      const held = hoverRef.current;
      setAnchor(held?.code === code ? { x: held.x, y: held.y } : box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null);
      setHover(null);
      setRevealed(false);
      setConfirmation(null);
      setConfirmFor(null);
      setPinned({ code, deepLink: false });
      writeAddress(finderAddress(filtersRef.current, code), "replace");
    },
    [],
  );

  const activate = useCallback(
    (code: string, element: HTMLElement): void => {
      if (!viewFor(code).pinnable) return;
      if (layout === "phone" && !element.matches(":focus-visible") && tapCode !== code) {
        setTapCode(code);
        return;
      }
      pin(code, element);
    },
    [viewFor, layout, tapCode, pin],
  );

  const restoreToOpener = useCallback((): HTMLElement | null => {
    if (opener.current?.isConnected) return opener.current;
    const code = pinnedRef.current?.code;
    return code ? document.querySelector<HTMLElement>(`[data-code="${code}"]`) : null;
  }, []);

  // ---- holding ----------------------------------------------------------------------------------------------

  const beginConfirm = useCallback(async (code: string): Promise<void> => {
    const read = await readUnit(code, true);
    if (read.unit) setConfirmFor({ code, price: read.unit.price, priceVersion: read.unit.priceVersion });
  }, []);

  const startHold = (): void => {
    const code = pinned?.code;
    if (!code) return;
    if (!account) {
      openSignIn({ title: "Sign in to hold", onSuccess: () => void beginConfirm(code) });
      return;
    }
    void beginConfirm(code);
  };

  const holdExpired = (code: string): void => {
    const email = account?.email;
    setConfirmFor(null);
    sessionLost();
    openSignIn({ title: "Sign in to hold", ...(email ? { email } : {}), focusPassword: true, onSuccess: () => void beginConfirm(code) });
  };

  const placed = (hold: PublicHold): void => {
    myHolds.add(hold);
    setConfirmFor(null);
    setConfirmation(hold);
    tower.refresh();
  };

  const lostRace = (code: string): void => {
    setForced((previous) => new Map(previous).set(code, tower.reads));
    tower.refresh();
  };

  // ---- derived view of the open home -------------------------------------------------------------------------

  const openCell = pinned ? cellState(pinned.code) : null;
  useEffect(() => {
    if (pinned && openCell?.status === "withdrawn") open.markGone();
  }, [openCell?.status, pinned?.code]);

  const openMine = pinned ? (myHolds.holds.find((hold) => hold.unitCode === pinned.code && hold.status === "active") ?? null) : null;
  const openStatus: CellStatus = open.gone ? "withdrawn" : (openCell?.status ?? open.unit?.status ?? "available");
  const openLabel = open.gone ? STATUS_LABEL.withdrawn : openMine ? "Held by you" : STATUS_LABEL[openStatus];

  const onStageFail = (reason: StageFailure): void => {
    setMode("grid");
    notify(reason === "model" ? COPY.modelDown : COPY.contextLost);
  };

  const filterProps = {
    filters: state.filters,
    errors: state.errors,
    reply: state.reply,
    unavailable: state.outage !== null,
    actions,
  };

  const showDetail = pinned !== null && (!pinned.deepLink || open.loaded);

  return (
    <main className={`finder finder-${layout}`}>
      {state.outage !== null ? (
        <p className="banner banner-black" role="alert">
          {state.outage}
        </p>
      ) : null}
      {state.rateLimit ? (
        <p className="banner banner-black" role="alert">
          {state.rateLimit.message}
        </p>
      ) : null}
      <div className="panes">
        {layout === "desktop" ? (
          <section className="pane pane-filters" aria-label="Filters">
            <FilterControls {...filterProps} idPrefix="pane" />
          </section>
        ) : null}
        <section className="pane pane-tower" aria-label="Tower">
          <TowerStage
            mode={mode}
            assets={tower.assets}
            view={viewFor}
            rovingCode={rovingCode}
            selectedCode={pinned?.code ?? null}
            hoverCode={hover?.code ?? null}
            reservedRight={layout === "phone" ? INSET_WIDTH : 0}
            onFail={onStageFail}
            onRove={setRovingCode}
            onHover={(code, x, y) => setHover(code === null ? null : { code, x, y })}
            onFocusCell={(code, element) => {
              setRovingCode(code);
              if (element.matches(":focus-visible")) {
                const box = element.getBoundingClientRect();
                setFocusPoint({ code, x: box.left + box.width / 2, y: box.top + box.height / 2 });
                if (layout === "phone") setTapCode(code);
              } else {
                setFocusPoint(null);
              }
            }}
            onBlurGrid={() => setFocusPoint(null)}
            onActivate={activate}
          >
            {layout === "phone" ? (
              <div className="lens-slot" data-lens-slot style={{ width: INSET_WIDTH }}>
                {lensTarget === null ? <div className="lens-placeholder" aria-hidden="true" /> : null}
              </div>
            ) : null}
          </TowerStage>
        </section>
        <Results
          rows={state.rows}
          total={state.total}
          busy={state.busy}
          paging={state.paging}
          hasMore={state.hasMore}
          firstLoad={state.reply === null && state.outage === null}
          currentCode={currentCode}
          focusRow={state.focusRow}
          pageError={state.outage === null ? state.pageError : null}
          statusLabel={(unit) => statusLabelOf(unit.code, unit.status)}
          onOpen={pin}
          onMore={actions.loadMore}
          onFocused={actions.clearFocusRow}
          scrollRef={resultsScroll}
        />
      </div>

      {chrome.sheetOpen && layout !== "desktop" ? (
        <FilterSheet onClosed={() => chrome.setSheetOpen(false)}>
          <FilterControls {...filterProps} idPrefix="sheet" />
        </FilterSheet>
      ) : null}

      {showDetail && pinned ? (
        <Detail
          code={pinned.code}
          unit={open.unit}
          gone={open.gone}
          statusText={openLabel}
          syncing={openCell?.syncing ?? open.unit?.syncing ?? false}
          mine={openMine}
          confirmation={confirmation}
          canHold={!open.gone && open.unit !== null && openStatus === "available" && confirmFor === null}
          revealed={revealed || prefersReducedMotion()}
          onClose={() => closeHome()}
          onHold={startHold}
          restoreFocus={restoreToOpener}
        />
      ) : null}

      {confirmFor && pinned ? (
        <ConfirmHold
          key={`${confirmFor.code}-${confirmFor.priceVersion}`}
          code={confirmFor.code}
          price={confirmFor.price}
          priceVersion={confirmFor.priceVersion}
          onPlaced={placed}
          onLostRace={() => lostRace(confirmFor.code)}
          onExpired={() => holdExpired(confirmFor.code)}
          onRepriced={(unit) => open.apply(unit)}
          onCancel={() => setConfirmFor(null)}
          restoreFocus={() => document.querySelector<HTMLElement>(".modal-detail .detail-actions button")}
        />
      ) : null}

      <Lens target={lensTarget} pinned={showDetail && pinned !== null} inset={layout === "phone"} onGrown={() => setRevealed(true)} />
    </main>
  );
};
