// /estate: the live map of every shop of the lead's group, with filters kept in the address.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, api } from "../lib/api";
import { SEARCH_DEBOUNCE_MS, useDebounced, useInterval, useLatestRequest } from "../lib/hooks";
import { useMedia } from "../lib/media";
import { MOTION, commit, reducedMotion } from "../lib/motion";
import { Overlay } from "../lib/overlay";
import { loadScreen, saveScreen } from "../lib/persist";
import { navigate, useLocation } from "../lib/router";
import { useMe } from "../session";
import type { Review, StockLine, Shop, ShopList } from "../types";
import { type EngineState, MapEngine, OPENING_VIEW, SELECT_ZOOM } from "./engine";
import { type Filters, filtersToSearch, listQuery, parseFilters, withStates } from "./filters";
import { type Arrival, MapView } from "./mapview";
import { DetailPanel, Legend, Scrubber, ShopsTable, SuspendDialog, readoutText } from "./panels";
import { ALL_STATES, STATE_DEFINITIONS } from "./stateDef";

const WIDE = "(min-width: 1200px)";
const ESTATE_PHONE = "(max-width: 699px)";
const POLL_MS = 5000;
const EMPTY_COPY = "No shops match these filters.";
const ERROR_COPY = "Something went wrong. Try again.";

interface PanelMemory {
  focus: "close" | "suspend" | "heading";
  scroll: number;
}

export function Estate() {
  const me = useMe();
  const { search } = useLocation();
  const filters = useMemo(() => parseFilters(search), [search]);
  const wide = useMedia(WIDE);
  const phone = useMedia(ESTATE_PHONE);
  const [engineState, setEngineState] = useState<EngineState>({ view: OPENING_VIEW, phase: "idle" });
  const engine = useMemo(() => new MapEngine((next) => commit(() => setEngineState(next))), []);
  useEffect(() => () => engine.dispose(), [engine]);

  const [shops, setShops] = useState<Shop[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("Loading shops.");
  const [searchText, setSearchText] = useState(filters.q);
  const [review, setReview] = useState<Review | null>(null);
  const [scrub, setScrub] = useState(1000);
  const [arrivals, setArrivals] = useState<Record<string, Arrival>>({});
  const [tab, setTab] = useState<"map" | "table">("map");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [panel, setPanel] = useState<{ id: string; open: boolean; restored: boolean }>({ id: "", open: false, restored: false });
  const [panelShop, setPanelShop] = useState<Shop | null>(null);
  const [panelStock, setPanelStock] = useState<StockLine[]>([]);
  const [suspend, setSuspend] = useState<{ open: boolean; shop: Shop | null }>({ open: false, shop: null });
  const regionRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const filtersButton = useRef<HTMLButtonElement | null>(null);
  const panelOpener = useRef<HTMLElement | null>(null);
  const suspendOpener = useRef<HTMLElement | null>(null);
  const names = useRef(new Map<string, string>());
  const seenOrders = useRef<Set<string> | null>(null);
  const selectToken = useRef(0);
  const memory = useRef<PanelMemory>(loadScreen<PanelMemory>(me.user.id, "estate-panel") ?? { focus: "heading", scroll: 0 });
  const restoring = useRef(filters.shop !== null);
  const listRequests = useLatestRequest();
  const shown = useRef(-1);
  const [tableFocus, setTableFocus] = useState(0);
  const [tabFocus, setTabFocus] = useState<"map" | "table" | null>(null);
  const { pathname } = useLocation();

  // ---- the address is the source of truth for filters ----
  const canonical = filtersToSearch(filters);
  useEffect(() => {
    if (canonical !== search) navigate(`${pathname}${canonical}`, { replace: true });
  }, [canonical, search, pathname]);

  useEffect(() => setSearchText(filters.q), [filters.q]);

  const push = (next: Filters) => navigate(`/estate${filtersToSearch(next)}`);
  const applySearch = useDebounced(() => {
    const trimmed = searchText.trim();
    if (trimmed !== filters.q) push({ ...filters, q: trimmed });
  }, SEARCH_DEBOUNCE_MS);

  // ---- shops: re-read on every filter change and every five seconds ----
  const stateKey = filters.none ? "none" : listQuery(filters);
  const readShops = useCallback((announce: boolean) => {
    if (filters.none) {
      setShops([]);
      setLoaded(true);
      setMessage(EMPTY_COPY);
      shown.current = 0;
      return;
    }
    const token = listRequests.begin();
    if (announce) setMessage("Loading shops.");
    api<ShopList>("GET", `/api/stores${listQuery(filters)}`).then((answer) => {
      if (!listRequests.isLatest(token)) return;
      for (const shop of answer.stores) names.current.set(shop.id, shop.name);
      setShops(answer.stores);
      setLoaded(true);
      if (announce || answer.count !== shown.current) setMessage(answer.count === 0 ? EMPTY_COPY : `${answer.count} shops shown.`);
      shown.current = answer.count;
    }, (error: unknown) => {
      if (listRequests.isLatest(token) && error instanceof ApiFailure) setMessage(ERROR_COPY);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);
  useEffect(() => readShops(true), [readShops]);

  const readReview = useCallback(() => {
    api<Review>("GET", "/api/estate/review").then((answer) => {
      setReview((current) => current ?? answer);
      const known = seenOrders.current;
      const placed = answer.events.filter((event) => event.type === "order.placed");
      if (known === null) {
        seenOrders.current = new Set(placed.map((event) => event.order_id));
        return;
      }
      const fresh = placed.filter((event) => !known.has(event.order_id));
      for (const event of fresh) known.add(event.order_id);
      setReview((current) => (current ? { ...current, events: answer.events } : answer));
      const last = fresh[fresh.length - 1];
      if (last) setMessage(`New order ${last.order_number} at ${names.current.get(last.store_id) ?? last.store_id}.`);
      for (const event of fresh) arrive(event.store_id);
    }, () => undefined);
  }, []);
  useEffect(readReview, [readReview]);

  const readPanel = useCallback(() => {
    if (!panel.id) return;
    api<Shop>("GET", `/api/stores/${panel.id}`).then(setPanelShop, () => undefined);
    api<{ lines: StockLine[] }>("GET", `/api/stores/${panel.id}/stock`).then((answer) => setPanelStock(answer.lines), () => undefined);
  }, [panel.id]);
  useEffect(readPanel, [readPanel]);

  useInterval(() => {
    readShops(false);
    readReview();
    readPanel();
  }, POLL_MS);

  // ---- an order arriving: it drops onto its marker, then the ring pulses once ----
  function arrive(shopId: string): void {
    const set = (value: Arrival) => commit(() => setArrivals((current) => ({ ...current, [shopId]: value })));
    set("dropping");
    window.setTimeout(() => {
      set("pulsing");
      window.setTimeout(() => set("none"), reducedMotion() ? 600 : MOTION.arrivalPulseMs);
    }, MOTION.arrivalDropMs);
  }

  // ---- selecting a shop and the detail panel ----
  const openPanel = useCallback((id: string, restored: boolean) => {
    setPanel({ id, open: true, restored });
    navigate(`/estate${filtersToSearch({ ...parseFilters(location.search), shop: id })}`, { replace: true });
  }, []);

  function select(id: string, opener: HTMLElement | null) {
    const shop = shops.find((candidate) => candidate.id === id) ?? panelShop;
    if (!shop) return;
    panelOpener.current = opener;
    const token = ++selectToken.current;
    engine.glideTo({ lon: shop.lon, lat: shop.lat, zoom: SELECT_ZOOM }, () => {
      if (token !== selectToken.current) return;
      if (reducedMotion()) commit(() => openPanel(id, false));
      else window.setTimeout(() => token === selectToken.current && commit(() => openPanel(id, false)), MOTION.panelDelayMs);
    });
  }

  function closePanel() {
    selectToken.current += 1;
    setPanel((current) => ({ ...current, open: false, restored: false }));
    navigate(`/estate${filtersToSearch({ ...parseFilters(location.search), shop: null })}`, { replace: true });
  }

  // a shop named in the address opens its panel at once, with no glide
  useEffect(() => {
    if (!restoring.current || !loaded) return;
    restoring.current = false;
    const shop = shops.find((candidate) => candidate.id === filters.shop);
    if (!shop) {
      navigate(`/estate${filtersToSearch({ ...filters, shop: null })}`, { replace: true });
      return;
    }
    engine.jump({ lon: shop.lon, lat: shop.lat, zoom: SELECT_ZOOM });
    setPanelShop(shop);
    openPanel(shop.id, true);
  }, [loaded, shops, filters, engine, openPanel]);

  useEffect(() => {
    if (filters.shop === null && panel.open) setPanel((current) => ({ ...current, open: false }));
  }, [filters.shop, panel.open]);

  useEffect(() => {
    const record = () => {
      const scroller = document.querySelector<HTMLElement>(".detail-scroll");
      if (scroller) saveScreen(me.user.id, "estate-panel", { ...memory.current, scroll: scroller.scrollTop });
    };
    window.addEventListener("pagehide", record);
    return () => window.removeEventListener("pagehide", record);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rememberPanel = (patch: Partial<PanelMemory>) => {
    memory.current = { ...memory.current, ...patch };
    saveScreen(me.user.id, "estate-panel", memory.current);
  };

  // ---- suspend and resume ----
  async function saveSuspension(shop: Shop, reason: string): Promise<boolean> {
    setMessage("Saving...");
    try {
      await api<Shop>("POST", `/api/stores/${shop.id}/suspension`, { suspended: true, reason });
      setMessage(`${shop.name} is suspended.`);
      readShops(false);
      readPanel();
      return true;
    } catch {
      setMessage(ERROR_COPY);
      return false;
    }
  }

  async function resume(shop: Shop) {
    setMessage("Saving...");
    try {
      await api<Shop>("POST", `/api/stores/${shop.id}/suspension`, { suspended: false });
      setMessage(`${shop.name} is open for orders again.`);
      readShops(false);
      readPanel();
    } catch {
      setMessage(ERROR_COPY);
    }
  }

  function askSuspend(shop: Shop, opener: HTMLElement) {
    suspendOpener.current = opener;
    setSuspend({ open: true, shop });
  }

  // ---- the review scrubber ----
  const windowStart = review ? Date.parse(review.window_start) : 0;
  const moment = review ? windowStart + (scrub / 1000) * 86_400_000 : 0;
  const placedBy = review ? review.events.filter((event) => event.type === "order.placed" && Date.parse(event.at) <= moment) : [];
  const badges: Record<string, number> = {};
  for (const event of placedBy) badges[event.store_id] = (badges[event.store_id] ?? 0) + 1;
  const readout = review ? readoutText(placedBy.length, moment) : "";

  const counts: Record<string, number> = {};
  for (const shop of shops) counts[shop.display_state] = (counts[shop.display_state] ?? 0) + 1;

  const toggle = (state: (typeof ALL_STATES)[number], checked: boolean) => {
    const next = checked ? [...filters.states, state] : filters.states.filter((candidate) => candidate !== state);
    push(withStates({ ...filters, shop: filters.shop }, filters.none ? (checked ? [state] : []) : next));
  };

  const filterControls = (
    <>
      <label className="field-label" htmlFor="shop-search">Search shops</label>
      <input
        id="shop-search" type="search" className="field" value={searchText}
        onChange={(event) => { setSearchText(event.target.value); applySearch(); }}
      />
      <fieldset className="states">
        <legend className="visually-hidden">Shop states</legend>
        {STATE_DEFINITIONS.map((definition) => (
          <label key={definition.key} className="check">
            <input
              type="checkbox" checked={!filters.none && filters.states.includes(definition.key)}
              onChange={(event) => toggle(definition.key, event.target.checked)}
            />
            <span>{definition.label}</span>
          </label>
        ))}
      </fieldset>
    </>
  );

  const tablePanel = (
    <ShopsTable
      shops={shops} tableRef={tableRef}
      onDetails={(shop, opener) => { if (phone) setTab("map"); select(shop.id, opener); }}
      onSuspend={askSuspend} onResume={(shop) => void resume(shop)}
    />
  );

  useEffect(() => {
    if (tableFocus > 0) tableRef.current?.focus();
  }, [tableFocus]);
  useEffect(() => {
    if (tabFocus) document.getElementById(`tab-${tabFocus}`)?.focus();
  }, [tabFocus, tab]);

  const showMap = !phone || tab === "map";
  const showTable = !phone || tab === "table";

  return (
    <div className={`estate ${wide ? "estate-wide" : ""}`}>
      <a
        href="#shops-table" className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          if (phone) setTab("table");
          setTableFocus((tick) => tick + 1);
        }}
      >
        Skip to shops table
      </a>
      {wide ? (
        <section className="filters-col" role="region" aria-label="Filters" data-state="open">{filterControls}</section>
      ) : (
        <>
          <button
            ref={filtersButton} type="button" className="btn filters-button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters
          </button>
          <Overlay open={filtersOpen} role="region" label="Filters" onClose={() => setFiltersOpen(false)} opener={filtersButton} className="filters-sheet">
            {filterControls}
          </Overlay>
        </>
      )}
      {phone ? (
        <div role="tablist" aria-label="Estate view" className="tabs">
          {(["map", "table"] as const).map((name) => (
            <button
              key={name} type="button" role="tab" id={`tab-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
              className={tab === name ? "tab active" : "tab"} onClick={() => setTab(name)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  const other = name === "map" ? "table" : "map";
                  setTab(other);
                  setTabFocus(other);
                }
              }}
            >
              {name === "map" ? "Map" : "Table"}
            </button>
          ))}
        </div>
      ) : null}
      {showMap ? (
        <div className="map-col">
          <div className="map-frame">
            <MapView
              engine={engine} view={engineState.view} phase={engineState.phase} shops={shops} countKnown={loaded}
              panelOpen={panel.open} progress={scrub / 1000} arrivals={arrivals} badges={badges} regionRef={regionRef}
              onSelect={(id, opener) => select(id, opener)}
            />
            <div className="zoom-buttons">
              <button type="button" className="btn" aria-label="Zoom in" onClick={() => engine.zoomBy(1)}>+</button>
              <button type="button" className="btn" aria-label="Zoom out" onClick={() => engine.zoomBy(-1)}>−</button>
            </div>
          </div>
          <div className="legend-strip">{loaded ? <Legend counts={counts} /> : null}</div>
          <Scrubber value={scrub} onChange={setScrub} count={placedBy.length} readout={readout} />
        </div>
      ) : null}
      <p role="status" aria-label="Estate updates" className={shops.length === 0 && loaded ? "estate-status blunt-line" : "estate-status status-line"}>{message}</p>
      <DetailPanel
        open={panel.open} restored={panel.restored} shop={panelShop} stock={panelStock} opener={panelOpener} wide={wide}
        onClose={closePanel} onSuspend={askSuspend} onResume={(shop) => void resume(shop)}
        initialFocus={panel.restored ? (memory.current.focus === "heading" ? "h2" : `[data-part="${memory.current.focus}"]`) : "h2"}
        onScroll={(scroll) => rememberPanel({ scroll })} onFocusPart={(focus) => rememberPanel({ focus })} scrollTop={memory.current.scroll}
      />
      {showTable ? tablePanel : null}
      <SuspendDialog
        shop={suspend.shop} open={suspend.open} opener={suspendOpener} onClose={() => setSuspend((current) => ({ ...current, open: false }))}
        onSaved={() => setSuspend((current) => ({ ...current, open: false }))} save={saveSuspension}
      />
    </div>
  );
}
