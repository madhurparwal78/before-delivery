// Estate screen: live map, filters, review scrubber, shop table, detail panel.
import { Api, ApiFailure, Figure, Sheet, StaleAnswer, clear, el, euroText, historyParams, reducedMotion, trapFocus } from "./core.js";
import { SHOP_STATES, stateDef, stateLabelLower } from "./states.js";
import type { AppContext, StoreDisplay } from "./app.js";
import { navigate } from "./app.js";

interface StoresAnswer {
  count: number;
  stores: StoreDisplay[];
}

interface ReviewAnswer {
  window_start: string;
  window_end: string;
  events: { seq: number; at: string; order_id: string; order_number: string; store_id: string; type: string }[];
}

interface StockLineAnswer {
  sku: string;
  name: string;
  on_hand: number;
  held: number;
  available: number;
  critical: boolean;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const LON_MIN = -31.5;
const LON_MAX = -6.0;
const LAT_MIN = 36.8;
const LAT_MAX = 42.2;
const START = { lon: -18.75, lat: 39.5, zoom: 1 };

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function clampLon(lon: number): number {
  return Math.min(LON_MAX, Math.max(LON_MIN, lon));
}

function clampLat(lat: number): number {
  return Math.min(LAT_MAX, Math.max(LAT_MIN, lat));
}

function project(lon: number, lat: number, view: { lon: number; lat: number; zoom: number }, size: { w: number; h: number }): { x: number; y: number } {
  const px = (lon - view.lon) * 31 * view.zoom + size.w / 2;
  const py = -(lat - view.lat) * 40 * view.zoom + size.h / 2;
  return { x: px, y: py };
}

function unproject(x: number, y: number, view: { lon: number; lat: number; zoom: number }, size: { w: number; h: number }): { lon: number; lat: number } {
  const lon = (x - size.w / 2) / (31 * view.zoom) + view.lon;
  const lat = -(y - size.h / 2) / (40 * view.zoom) + view.lat;
  return { lon, lat };
}

function regionLabel(region: string): string {
  const map: Record<string, string> = {
    norte: "Norte",
    centro: "Centro",
    sul: "Sul",
    sao_miguel: "São Miguel",
    terceira: "Terceira",
  };
  return map[region] ?? region;
}

export function mountEstate(ctx: AppContext): () => void {
  const root = ctx.root;
  const timers: number[] = [];
  const cleanups: (() => void)[] = [];

  const params = historyParams();
  const qText = params.get("q") ?? "";
  const stateParam = params.get("state");
  const checked = stateParam === null ? [...SHOP_STATES.map((s) => s.key)] : stateParam === "none" ? [] : stateParam.split(",");
  const selectedShop = params.get("shop");

  const main = el("main");
  main.id = "estate-root";

  const statusUpdates = el("div");
  statusUpdates.className = "status";
  statusUpdates.setAttribute("role", "status");
  statusUpdates.setAttribute("aria-label", "Estate updates");
  statusUpdates.id = "estate-updates";

  // --- Skip link ---
  const skip = el("a");
  skip.href = "#shops-table";
  skip.textContent = "Skip to shops table";
  skip.className = "btn small";
  skip.addEventListener("click", (event) => {
    event.preventDefault();
    tableFocusTarget.setAttribute("tabindex", "0");
    tableFocusTarget.focus();
  });
  main.appendChild(skip);
  main.appendChild(statusUpdates);

  // --- Filters ---
  const filtersBtn = el("button");
  filtersBtn.className = "btn small estate-filters-btn";
  filtersBtn.textContent = "Filters";
  filtersBtn.setAttribute("aria-expanded", "false");
  main.appendChild(filtersBtn);

  const filtersPanel = el("div");
  filtersPanel.className = "estate-filter-column";
  filtersPanel.setAttribute("role", "region");
  filtersPanel.setAttribute("aria-label", "Filters");
  const searchInput = el("input");
  searchInput.type = "search";
  searchInput.setAttribute("aria-label", "Search shops");
  searchInput.value = qText;
  filtersPanel.appendChild(searchInput);
  const checkboxes: Record<string, HTMLInputElement> = {};
  for (const def of SHOP_STATES) {
    const label = el("label");
    label.className = "inline";
    const box = el("input");
    box.type = "checkbox";
    box.id = `filter-${def.key}`;
    box.checked = checked.includes(def.key);
    box.setAttribute("aria-label", def.label);
    checkboxes[def.key] = box;
    const span = el("span");
    span.textContent = def.label;
    label.appendChild(box);
    label.appendChild(span);
    filtersPanel.appendChild(label);
  }

  const filterSheetRoot = el("div");
  filterSheetRoot.className = "sheet slide-left";
  filterSheetRoot.setAttribute("role", "region");
  filterSheetRoot.setAttribute("aria-label", "Filters");
  filterSheetRoot.setAttribute("hidden", "hidden");
  document.body.appendChild(filterSheetRoot);
  const filterSheet = new Sheet(filterSheetRoot, {
    onClose: () => filtersBtn.setAttribute("aria-expanded", "false"),
  });

  function placeFilterPanel(): void {
    const narrow = window.innerWidth < 1200;
    if (narrow) {
      if (!filterSheetRoot.contains(filtersPanel)) filterSheetRoot.appendChild(filtersPanel);
    } else if (!grid.contains(filtersPanel)) {
      grid.insertBefore(filtersPanel, grid.firstChild);
    }
  }

  filtersBtn.addEventListener("click", () => {
    if (filterSheet.isOpenNow()) {
      filterSheet.close();
      filtersBtn.focus();
    } else {
      filterSheet.open();
      filtersBtn.setAttribute("aria-expanded", "true");
      searchInput.focus();
    }
  });
  filterSheetRoot.addEventListener("keydown", (event) => {
    if (event.key === "Tab") trapFocus(filterSheetRoot, event);
    if (event.key === "Escape") {
      event.preventDefault();
      filterSheet.close();
      filtersBtn.focus();
    }
  });

  // --- Layout ---
  const grid = el("div");
  grid.className = "estate-grid";
  grid.appendChild(filtersPanel);
  placeFilterPanel();
  const mapWrap = el("div");
  mapWrap.className = "estate-map-wrap";

  const tabsBar = el("div");
  tabsBar.className = "estate-tabs";
  tabsBar.setAttribute("role", "tablist");
  tabsBar.setAttribute("aria-label", "Estate view");
  const tabMap = el("button");
  tabMap.setAttribute("role", "tab");
  tabMap.textContent = "Map";
  tabMap.setAttribute("aria-selected", "true");
  const tabTable = el("button");
  tabTable.setAttribute("role", "tab");
  tabTable.textContent = "Table";
  tabTable.setAttribute("aria-selected", "false");
  tabsBar.appendChild(tabMap);
  tabsBar.appendChild(tabTable);

  const mapView = el("div");
  mapView.className = "estate-map";
  mapView.id = "estate-map";
  mapView.setAttribute("role", "region");
  mapView.setAttribute("aria-label", "Estate map");
  mapView.setAttribute("tabindex", "0");
  mapView.setAttribute("data-store-count", "0");
  mapView.setAttribute("data-viewport", `${START.lon.toFixed(4)},${START.lat.toFixed(4)},${START.zoom.toFixed(2)}`);
  mapView.setAttribute("data-phase", "idle");
  mapView.setAttribute("data-panel", selectedShop ? "open" : "closed");
  mapView.setAttribute("data-motion", reducedMotion() ? "reduced" : "full");
  mapView.setAttribute("data-review-progress", "1.000");

  const canvas = el("canvas");
  canvas.className = "map-canvas";
  mapView.appendChild(canvas);

  const zoomIn = el("button");
  zoomIn.className = "map-zoom-btn";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "Zoom in");
  const zoomOut = el("button");
  zoomOut.className = "map-zoom-btn";
  zoomOut.textContent = "−";
  zoomOut.setAttribute("aria-label", "Zoom out");
  const controls = el("div");
  controls.className = "map-controls";
  controls.appendChild(zoomIn);
  controls.appendChild(zoomOut);
  mapView.appendChild(controls);

  const legend = el("ul");
  legend.className = "legend";
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", "Map legend");
  const legendFigures: Record<string, Figure> = {};
  const legendNodes: Record<string, HTMLElement> = {};
  for (const def of SHOP_STATES) {
    const item = el("li");
    item.className = "legend-item";
    const swatch = el("span");
    swatch.className = "swatch";
    swatch.setAttribute("data-state", def.key);
    item.appendChild(swatch);
    const label = el("span");
    label.textContent = def.label;
    item.appendChild(label);
    const count = el("span");
    count.className = "num";
    count.setAttribute("data-figure", "legend-count");
    const figure = new Figure(count);
    legendFigures[def.key] = figure;
    legendNodes[def.key] = item;
    item.appendChild(count);
    legend.appendChild(item);
  }

  mapWrap.appendChild(tabsBar);
  mapWrap.appendChild(mapView);
  mapWrap.appendChild(legend);

  const detailPanel = el("div");
  detailPanel.className = "estate-detail";
  detailPanel.setAttribute("role", "region");
  detailPanel.setAttribute("aria-label", "Shop detail");
  detailPanel.setAttribute("hidden", "hidden");
  const detailSheet = new Sheet(detailPanel, {});

  const mapColumn = el("div");
  mapColumn.appendChild(mapWrap);
  grid.appendChild(mapColumn);
  grid.appendChild(detailPanel);
  main.appendChild(grid);

  // --- Review scrubber ---
  const scrubberRow = el("div");
  scrubberRow.className = "scrubber-row";
  const slider = el("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1000";
  slider.value = "1000";
  slider.step = "10";
  slider.setAttribute("role", "slider");
  slider.setAttribute("aria-label", "Review last 24 hours");
  slider.setAttribute("aria-valuemin", "0");
  slider.setAttribute("aria-valuemax", "1000");
  const reviewCount = el("span");
  reviewCount.className = "review-count num";
  reviewCount.setAttribute("data-figure", "review-count");
  const reviewFigure = new Figure(reviewCount);
  const readout = el("div");
  readout.className = "status";
  readout.setAttribute("role", "status");
  readout.setAttribute("aria-label", "Review readout");
  scrubberRow.appendChild(slider);
  scrubberRow.appendChild(reviewCount);
  scrubberRow.appendChild(readout);
  main.appendChild(scrubberRow);

  // --- Shops table ---
  const tableWrap = el("div");
  tableWrap.className = "table-scroll estate-table-panel";
  const table = el("table");
  table.className = "data";
  table.id = "shops-table";
  table.setAttribute("aria-label", "Shops");
  const thead = el("thead");
  const headRow = el("tr");
  for (const head of ["Shop", "City", "State", "Critical lines", "Closes", "Actions"]) {
    const th = el("th");
    th.scope = "col";
    th.textContent = head;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  const tableFocusTarget = table;
  const lowerGrid = el("div");
  lowerGrid.className = "estate-lower";
  lowerGrid.appendChild(tableWrap);
  main.appendChild(lowerGrid);

  root.appendChild(main);

  // --- State ---
  const view = { ...START };
  let stores: StoreDisplay[] = [];
  let markers = new Map<string, HTMLElement>();
  let clusters = new Map<string, HTMLElement>();
  let reviewWindowStart = 0;
  let reviewEvents: ReviewAnswer["events"] = [];
  let reviewEventsByStore = new Map<string, number>();
  let glideFrame: number | null = null;
  let dragGlideFrame: number | null = null;
  let coastVelocity = { x: 0, y: 0 };
  let selected: string | null = null;
  const focusReturn = new Map<string, HTMLElement>();
  let storageDown = false;

  // --- Canvas drawing ---
  function drawMap(): void {
    const rect = mapView.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width));
    const height = Math.max(300, Math.floor(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const c = canvas.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, width, height);
    c.fillStyle = "#23201f";
    c.fillRect(0, 0, width, height);
    c.strokeStyle = "#5a544f";
    c.lineWidth = 2;
    c.beginPath();
    const coast: [number, number][] = [
      [-8.8, 37.0], [-8.9, 37.9], [-8.8, 38.6], [-9.0, 38.8], [-9.4, 39.0], [-9.4, 39.7],
      [-8.8, 40.2], [-8.7, 41.1], [-8.4, 41.6], [-8.3, 41.9], [-8.7, 42.0], [-8.8, 41.8],
      [-8.9, 41.5], [-8.7, 41.2], [-8.4, 41.1], [-8.6, 40.7], [-8.8, 40.2], [-8.9, 39.8],
      [-8.8, 39.5], [-9.0, 39.0], [-9.2, 38.7], [-9.0, 38.4], [-8.9, 38.1], [-8.8, 37.6], [-8.8, 37.0],
    ];
    coast.forEach(([lon, lat], index) => {
      const p = project(lon, lat, view, { w: width, h: height });
      if (index === 0) c.moveTo(p.x, p.y);
      else c.lineTo(p.x, p.y);
    });
    c.stroke();
    c.beginPath();
    c.ellipse(...((point) => [point.x, point.y, 60, 40, 0, 0, Math.PI * 2])(project(-25.7, 37.8, view, { w: width, h: height })) as [number, number, number, number, number, number, number]);
    c.stroke();
    c.beginPath();
    c.ellipse(...((point) => [point.x, point.y, 40, 30, 0, 0, Math.PI * 2])(project(-27.2, 38.65, view, { w: width, h: height })) as [number, number, number, number, number, number, number]);
    c.stroke();
  }

  function updateViewportAttribute(): void {
    mapView.setAttribute(
      "data-viewport",
      `${view.lon.toFixed(4)},${view.lat.toFixed(4)},${view.zoom.toFixed(2)}`,
    );
  }

  // --- Markers ---
  function renderMarkers(): void {
    const rect = mapView.getBoundingClientRect();
    const size = { w: rect.width, h: rect.height };
    const oldMarkers = markers;
    markers = new Map();
    for (const store of stores) {
      let node: HTMLButtonElement | undefined = oldMarkers.get(store.id) as HTMLButtonElement | undefined;
      if (!node) {
        node = el("button");
        node.className = "marker";
        node.type = "button";
        node.addEventListener("click", () => selectShop(store.id, node as HTMLElement));
        node.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectShop(store.id, node as HTMLElement);
          }
        });
        const dot = el("span");
        dot.className = "dot";
        node.appendChild(dot);
        const badge = el("span");
        badge.className = "badge num";
        badge.setAttribute("data-figure", "review-badge");
        badge.setAttribute("hidden", "hidden");
        node.appendChild(badge);
      }
      markers.set(store.id, node);
      updateMarker(node, store);
      const pos = project(store.lon, store.lat, view, size);
      node.style.left = `${pos.x}px`;
      node.style.top = `${pos.y}px`;
    }
    for (const [id, node] of oldMarkers) {
      if (!markers.has(id)) node.remove();
    }

    // Clusters below zoom 3
    const oldClusters = clusters;
    clusters = new Map();
    const wasClustered = oldClusters.size > 0;
    const zoomingUp = view.zoom >= 3 && wasClustered;
    if (view.zoom < 3) {
      const byRegion = new Map<string, StoreDisplay[]>();
      for (const store of stores) {
        const list = byRegion.get(store.region) ?? [];
        list.push(store);
        byRegion.set(store.region, list);
      }
      for (const [region, list] of byRegion) {
        if (list.length < 2) continue;
        const meanLat = list.reduce((s, x) => s + x.lat, 0) / list.length;
        const meanLon = list.reduce((s, x) => s + x.lon, 0) / list.length;
        let node: HTMLButtonElement | undefined = oldClusters.get(region) as HTMLButtonElement | undefined;
        if (!node) {
          node = el("button");
          node.className = "cluster-btn";
          node.type = "button";
          node.addEventListener("click", () => {
            glideTo(meanLon, meanLat, 3);
          });
        }
        node.setAttribute("data-cluster-count", String(list.length));
        node.setAttribute("data-region", region);
        node.setAttribute("aria-label", `Cluster of ${list.length} shops in ${regionLabel(region)}, zoom in`);
        node.textContent = String(list.length);
        const pos = project(meanLon, meanLat, view, size);
        node.style.left = `${pos.x}px`;
        node.style.top = `${pos.y}px`;
        clusters.set(region, node);
        mapView.appendChild(node);
      }
      for (const [id, node] of markers) {
        const region = stores.find((s) => s.id === id)?.region;
        if (region && clusters.has(region)) {
          node.setAttribute("data-cluster-phase", "clustered");
        }
      }
    } else {
      for (const [, node] of oldClusters) node.remove();
      const separating = zoomingUp && !reducedMotion();
      let index = 0;
      for (const store of stores) {
        const node = markers.get(store.id);
        if (!node) continue;
        if (node.getAttribute("data-cluster-phase") !== "placed") {
          if (separating) {
            node.setAttribute("data-cluster-phase", "separating");
            const delay = Math.min(index, 11) * 40;
            window.setTimeout(() => node.setAttribute("data-cluster-phase", "placed"), delay + 260);
          } else {
            node.setAttribute("data-cluster-phase", "placed");
          }
        }
        index += 1;
      }
    }
    for (const [id, node] of markers) {
      if (!node.isConnected) mapView.appendChild(node);
    }
    drawMap();
  }

  function updateMarker(node: HTMLElement, store: StoreDisplay): void {
    node.setAttribute("data-store-id", store.id);
    node.setAttribute("data-marker-state", store.display_state);
    node.setAttribute("data-arrival", node.getAttribute("data-arrival") ?? "none");
    node.setAttribute(
      "aria-label",
      `Open ${store.name}, ${stateLabelLower(store.display_state)}, critical lines: ${store.critical_lines}`,
    );
    const dot = node.querySelector<HTMLElement>(".dot");
    if (dot) {
      const def = stateDef(store.display_state);
      dot.style.background = def.fill;
      dot.style.border = `${def.ringWidth} dashed ${def.fill}`;
    }
  }

  // --- Glide ---
  function glideTo(lon: number, lat: number, zoom: number): void {
    if (glideFrame !== null) cancelAnimationFrame(glideFrame);
    const target = { lon: clampLon(lon), lat: clampLat(lat), zoom: clampZoom(zoom) };
    if (reducedMotion()) {
      Object.assign(view, target);
      mapView.setAttribute("data-phase", "settled");
      updateViewportAttribute();
      renderMarkers();
      return;
    }
    const start = { ...view };
    mapView.setAttribute("data-phase", "moving");
    const duration = 640;
    const startTime = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 5);
      view.lon = start.lon + (target.lon - start.lon) * eased;
      view.lat = start.lat + (target.lat - start.lat) * eased;
      view.zoom = start.zoom + (target.zoom - start.zoom) * eased;
      updateViewportAttribute();
      renderMarkers();
      if (t < 1) {
        glideFrame = requestAnimationFrame(step);
      } else {
        glideFrame = null;
        mapView.setAttribute("data-phase", "settled");
      }
    };
    glideFrame = requestAnimationFrame(step);
  }

  // --- Map input ---
  let dragging = false;
  let lastPoint: { x: number; y: number } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { dist: number; zoom: number } | null = null;

  mapView.addEventListener("pointerdown", (event) => {
    mapView.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      dragging = true;
      lastPoint = { x: event.clientX, y: event.clientY };
      coastVelocity = { x: 0, y: 0 };
      if (dragGlideFrame !== null) cancelAnimationFrame(dragGlideFrame);
      mapView.setAttribute("data-phase", "dragging");
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  });
  mapView.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = mapView.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      const before = unproject(mid.x, mid.y, view, { w: rect.width, h: rect.height });
      view.zoom = clampZoom(pinchStart.zoom * (dist / pinchStart.dist));
      const after = unproject(mid.x, mid.y, view, { w: rect.width, h: rect.height });
      view.lon = clampLon(view.lon + before.lon - after.lon);
      view.lat = clampLat(view.lat + before.lat - after.lat);
      updateViewportAttribute();
      renderMarkers();
      return;
    }
    if (dragging && lastPoint && pointers.size === 1) {
      const dx = event.clientX - lastPoint.x;
      const dy = event.clientY - lastPoint.y;
      coastVelocity = { x: dx, y: dy };
      const perLon = 31 * view.zoom;
      const perLat = 40 * view.zoom;
      view.lon = clampLon(view.lon - dx / perLon);
      view.lat = clampLat(view.lat + dy / perLat);
      lastPoint = { x: event.clientX, y: event.clientY };
      updateViewportAttribute();
      renderMarkers();
    }
  });
  const endPointer = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      dragging = false;
      pinchStart = null;
      startDragGlide();
    }
  };
  mapView.addEventListener("pointerup", endPointer);
  mapView.addEventListener("pointercancel", endPointer);

  function startDragGlide(): void {
    if (reducedMotion() || (Math.abs(coastVelocity.x) < 1 && Math.abs(coastVelocity.y) < 1)) {
      mapView.setAttribute("data-phase", "settled");
      return;
    }
    mapView.setAttribute("data-phase", "moving");
    let vx = coastVelocity.x;
    let vy = coastVelocity.y;
    let last = performance.now();
    const rect = mapView.getBoundingClientRect();
    const step = (): void => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const halvings = dt / 0.24;
      const factor = Math.pow(0.5, halvings);
      vx *= factor;
      vy *= factor;
      const speed = Math.hypot(vx, vy) * 60;
      if (speed < 0.5) {
        dragGlideFrame = null;
        mapView.setAttribute("data-phase", "settled");
        return;
      }
      const perLon = 31 * view.zoom;
      const perLat = 40 * view.zoom;
      view.lon = clampLon(view.lon - (vx * dt * 60) / perLon);
      view.lat = clampLat(view.lat + (vy * dt * 60) / perLat);
      updateViewportAttribute();
      renderMarkers();
      dragGlideFrame = requestAnimationFrame(step);
    };
    if (dragGlideFrame !== null) cancelAnimationFrame(dragGlideFrame);
    dragGlideFrame = requestAnimationFrame(step);
    void rect;
  }

  mapView.addEventListener("wheel", (event) => {
    event.preventDefault();
    view.zoom = clampZoom(view.zoom + (event.deltaY < 0 ? 0.25 : -0.25));
    updateViewportAttribute();
    renderMarkers();
  });

  zoomIn.addEventListener("click", () => {
    view.zoom = clampZoom(view.zoom + 1);
    updateViewportAttribute();
    renderMarkers();
  });
  zoomOut.addEventListener("click", () => {
    view.zoom = clampZoom(view.zoom - 1);
    updateViewportAttribute();
    renderMarkers();
  });

  mapView.addEventListener("keydown", (event) => {
    const rect = mapView.getBoundingClientRect();
    const perLon = 31 * view.zoom;
    const perLat = 40 * view.zoom;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      view.lon = clampLon(view.lon + 40 / perLon);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      view.lon = clampLon(view.lon - 40 / perLon);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      view.lat = clampLat(view.lat + 40 / perLat);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      view.lat = clampLat(view.lat - 40 / perLat);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      view.zoom = clampZoom(view.zoom + 1);
    } else if (event.key === "-") {
      event.preventDefault();
      view.zoom = clampZoom(view.zoom - 1);
    } else if (event.key === "Escape" && selected) {
      closeDetail();
      return;
    } else {
      return;
    }
    mapView.setAttribute("data-phase", "settled");
    updateViewportAttribute();
    renderMarkers();
    void rect;
  });

  // --- Filters ---
  function appliedStates(): string[] {
    return SHOP_STATES.filter((s) => checkboxes[s.key].checked).map((s) => s.key);
  }

  function writeAddress(replace = false): void {
    const params = new URLSearchParams();
    const q = searchInput.value.trim();
    if (q) params.set("q", q);
    const states = appliedStates();
    const allChecked = states.length === SHOP_STATES.length;
    if (!allChecked) params.set("state", states.length === 0 ? "none" : states.join(","));
    if (selected) params.set("shop", selected);
    const query = params.toString().replace(/%2C/g, ",");
    const url = `/estate${query ? `?${query}` : ""}`;
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
  }

  async function reloadStores(announceCount = true): Promise<void> {
    if (appliedStates().length === 0) {
      stores = [];
      mapView.setAttribute("data-store-count", "0");
      renderMarkers();
      renderTable();
      updateLegend();
      if (announceCount) statusUpdates.textContent = "No shops match these filters.";
      return;
    }
    if (announceCount) statusUpdates.textContent = "Loading shops.";
    try {
      const params = new URLSearchParams();
      const q = searchInput.value.trim();
      if (q) params.set("q", q);
      const states = appliedStates();
      if (states.length !== SHOP_STATES.length) params.set("state", states.join(","));
      const answer = await ctx.api.get<StoresAnswer>(`/api/stores?${params.toString()}`);
      stores = answer.stores;
      mapView.setAttribute("data-store-count", String(answer.count));
      renderMarkers();
      renderTable();
      updateLegend();
      if (announceCount) statusUpdates.textContent = `${answer.count} shops shown.`;
    } catch (err) {
      if (err instanceof StaleAnswer) return;
      if (announceCount) statusUpdates.textContent = "Something went wrong. Try again.";
    }
  }

  function updateLegend(): void {
    for (const def of SHOP_STATES) {
      const count = stores.filter((s) => s.display_state === def.key).length;
      legendFigures[def.key].set(count);
      legendNodes[def.key].style.display = stores.length === 0 && count === 0 ? "" : "";
    }
  }

  function renderTable(): void {
    const rows = new Map<string, HTMLElement>();
    for (const child of Array.from(tbody.children)) {
      const row = child as HTMLElement;
      if (row.dataset.storeId) rows.set(row.dataset.storeId, row);
    }
    const keep = new Set<string>();
    for (const store of stores) {
      keep.add(store.id);
      let row = rows.get(store.id);
      if (!row) {
        row = el("tr");
        row.dataset.storeId = store.id;
        const nameCell = el("td");
        const name = el("span");
        name.textContent = store.name;
        nameCell.appendChild(name);
        row.appendChild(nameCell);
        const cityCell = el("td");
        cityCell.textContent = store.city;
        row.appendChild(cityCell);
        const stateCell = el("td");
        const swatch = el("span");
        swatch.className = "swatch";
        stateCell.appendChild(swatch);
        const stateLabel = el("span");
        stateCell.appendChild(stateLabel);
        row.appendChild(stateCell);
        const criticalCell = el("td");
        criticalCell.className = "num";
        criticalCell.setAttribute("data-figure", "critical-lines");
        row.appendChild(criticalCell);
        const closesCell = el("td");
        row.appendChild(closesCell);
        const actionsCell = el("td");
        const detailsBtn = el("button");
        detailsBtn.className = "btn small";
        detailsBtn.textContent = "Details";
        detailsBtn.setAttribute("aria-label", `Details for ${store.name}`);
        detailsBtn.addEventListener("click", () => selectShop(store.id, detailsBtn, "table"));
        actionsCell.appendChild(detailsBtn);
        const suspendBtn = el("button");
        suspendBtn.className = "btn small";
        suspendBtn.addEventListener("click", () => openSuspendDialog(store, suspendBtn));
        actionsCell.appendChild(suspendBtn);
        row.appendChild(actionsCell);
        tbody.appendChild(row);
      }
      updateTableRow(row, store);
    }
    for (const [id, row] of rows) {
      if (!keep.has(id)) row.remove();
    }
  }

  function updateTableRow(row: HTMLElement, store: StoreDisplay): void {
    row.setAttribute("data-store-id", store.id);
    row.setAttribute("data-marker-state", store.display_state);
    const stateCell = row.children[2];
    const swatch = stateCell.querySelector<HTMLElement>(".swatch");
    if (swatch) swatch.setAttribute("data-state", store.display_state);
    const labelEl = stateCell.querySelectorAll("span")[1];
    if (labelEl) labelEl.textContent = store.state_label;
    const criticalCell = row.children[3];
    criticalCell.textContent = String(store.critical_lines);
    criticalCell.setAttribute("data-value", String(store.critical_lines));
    const closesCell = row.children[4];
    closesCell.textContent = store.closes_local ?? "";
    const suspendBtn = row.querySelector<HTMLButtonElement>("td:last-child button:last-child");
    if (suspendBtn) {
      const action = store.suspended ? "Resume" : "Suspend";
      suspendBtn.textContent = action;
      suspendBtn.setAttribute("aria-label", `${action} ${store.name}`);
    }
  }

  // --- Selection and detail panel ---
  function selectShop(storeId: string, opener: HTMLElement, source: "map" | "table" = "map"): void {
    selected = storeId;
    focusReturn.set("panel", opener);
    mapView.setAttribute("data-panel", "open");
    writeAddress(true);
    const store = stores.find((s) => s.id === storeId);
    if (store) {
      glideTo(store.lon, store.lat, 6);
      const delay = reducedMotion() ? 0 : 170;
      window.setTimeout(() => openDetail(store, true), delay);
    }
    if (source === "table" && window.innerWidth <= 700) {
      tabMap.setAttribute("aria-selected", "true");
      tabTable.setAttribute("aria-selected", "false");
      mapView.style.display = "";
    }
  }

  function openDetail(store: StoreDisplay, focusHeading: boolean): void {
    clear(detailPanel);
    const heading = el("h2");
    heading.textContent = store.name;
    detailPanel.appendChild(heading);
    const stateLine = el("p");
    stateLine.textContent = `State: ${store.state_label}`;
    detailPanel.appendChild(stateLine);
    const closesLine = el("p");
    closesLine.textContent = store.closes_local ? `Closes at ${store.closes_local}` : "Closed today";
    detailPanel.appendChild(closesLine);
    const criticalLine = el("p");
    const criticalFigure = el("span");
    criticalFigure.className = "num";
    criticalFigure.setAttribute("data-figure", "critical-lines");
    criticalFigure.textContent = String(store.critical_lines);
    criticalLine.appendChild(document.createTextNode("Critical lines: "));
    criticalLine.appendChild(criticalFigure);
    detailPanel.appendChild(criticalLine);

    const criticalTableWrap = el("div");
    criticalTableWrap.className = "table-scroll";
    const criticalTable = el("table");
    criticalTable.className = "data";
    criticalTable.setAttribute("aria-label", "Critical lines");
    const thead = el("thead");
    const headRow = el("tr");
    for (const head of ["SKU", "Name", "On hand"]) {
      const th = el("th");
      th.textContent = head;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    criticalTable.appendChild(thead);
    const ctBody = el("tbody");
    criticalTable.appendChild(ctBody);
    criticalTableWrap.appendChild(criticalTable);
    detailPanel.appendChild(criticalTableWrap);

    void ctx.api
      .get<{ lines: StockLineAnswer[] }>(`/api/stores/${store.id}/stock`)
      .then((answer) => {
        for (const line of answer.lines.filter((l) => l.critical)) {
          const row = el("tr");
          const sku = el("td");
          sku.textContent = line.sku;
          row.appendChild(sku);
          const name = el("td");
          name.textContent = line.name;
          row.appendChild(name);
          const onHand = el("td");
          onHand.textContent = String(line.on_hand);
          row.appendChild(onHand);
          ctBody.appendChild(row);
        }
      })
      .catch(() => void 0);

    const suspendBtn = el("button");
    suspendBtn.className = "btn";
    suspendBtn.textContent = store.suspended ? "Resume shop" : "Suspend shop";
    suspendBtn.addEventListener("click", () => openSuspendDialog(store, suspendBtn));
    detailPanel.appendChild(suspendBtn);
    const closeBtn = el("button");
    closeBtn.className = "btn";
    closeBtn.textContent = "Close detail";
    closeBtn.addEventListener("click", () => closeDetail());
    detailPanel.appendChild(closeBtn);

    detailSheet.open(true);
    if (focusHeading) heading.setAttribute("tabindex", "-1");
    heading.focus();
  }

  function closeDetail(): void {
    selected = null;
    mapView.setAttribute("data-panel", "closed");
    detailSheet.close();
    writeAddress(true);
    const opener = focusReturn.get("panel");
    if (opener && document.contains(opener)) opener.focus();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selected && detailSheet.isOpenNow()) {
      event.preventDefault();
      closeDetail();
    }
  });

  function openSuspendDialog(store: StoreDisplay, opener: HTMLElement): void {
    const backdrop = el("div");
    backdrop.className = "dialog-backdrop";
    const dialog = el("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Suspend shop");
    dialog.setAttribute("data-state", "open");
    const h2 = el("h2");
    h2.textContent = store.suspended ? "Resume shop" : "Suspend shop";
    dialog.appendChild(h2);
    const label = el("label");
    label.htmlFor = "suspend-reason";
    label.textContent = "Reason";
    const reason = el("input");
    reason.id = "suspend-reason";
    reason.type = "text";
    reason.setAttribute("aria-label", "Reason");
    dialog.appendChild(label);
    dialog.appendChild(reason);
    const errorSlot = el("p");
    errorSlot.className = "field-error";
    dialog.appendChild(errorSlot);
    const actions = el("div");
    actions.className = "actions";
    const confirm = el("button");
    confirm.className = "btn";
    confirm.textContent = store.suspended ? "Keep open" : "Suspend";
    const cancel = el("button");
    cancel.className = "btn";
    cancel.textContent = store.suspended ? "Suspend" : "Keep open";
    actions.appendChild(confirm);
    actions.appendChild(cancel);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    reason.focus();

    const closeDialog = (): void => {
      backdrop.remove();
      opener.focus();
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Tab") trapFocus(dialog, event);
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
    });
    cancel.addEventListener("click", closeDialog);
    confirm.addEventListener("click", async () => {
      const wantSuspend = !store.suspended;
      if (wantSuspend && reason.value.trim().length < 1) {
        errorSlot.textContent = "Give a reason.";
        reason.setAttribute("aria-invalid", "true");
        reason.setAttribute("aria-describedby", "suspend-error");
        errorSlot.id = "suspend-error";
        reason.focus();
        return;
      }
      statusUpdates.textContent = "Saving...";
      try {
        const body = wantSuspend ? { suspended: true, reason: reason.value.trim() } : { suspended: false };
        await ctx.api.post<StoreDisplay>(`/api/stores/${store.id}/suspension`, body);
        statusUpdates.textContent = wantSuspend
          ? `${store.name} is suspended.`
          : `${store.name} is open for orders again.`;
        closeDialog();
        await reloadStores(false);
      } catch (err) {
        if (err instanceof StaleAnswer) return;
        statusUpdates.textContent = "Something went wrong. Try again.";
      }
    });
  }

  // --- Review scrubber ---
  function setScrubberPosition(value: number): void {
    slider.value = String(value);
    slider.setAttribute("aria-valuenow", String(value));
    mapView.setAttribute("data-review-progress", (value / 1000).toFixed(3));
    if (reviewWindowStart > 0) {
      const moment = reviewWindowStart + (value / 1000) * 86400 * 1000;
      const byMoment = new Map<string, number>();
      let count = 0;
      for (const event of reviewEvents) {
        if (new Date(event.at).getTime() <= moment) {
          count += 1;
          byMoment.set(event.store_id, (byMoment.get(event.store_id) ?? 0) + 1);
        }
      }
      reviewFigure.set(count);
      reviewEventsByStore = byMoment;
      const lisbon = new Date(moment).toLocaleString("en-GB", { timeZone: "Europe/Lisbon", hour12: false });
      const [datePart, timePart] = lisbon.split(", ");
      readout.textContent = `${count} orders by ${timePart.slice(0, 5)} Lisbon time`;
      void datePart;
      for (const [id, node] of markers) {
        const badge = node.querySelector<HTMLElement>(".badge");
        if (badge) {
          const badgeCount = byMoment.get(id) ?? 0;
          if (badgeCount > 0) {
            badge.removeAttribute("hidden");
            badge.textContent = String(badgeCount);
            badge.setAttribute("data-value", String(badgeCount));
          } else {
            badge.setAttribute("hidden", "hidden");
          }
        }
      }
    }
  }

  slider.addEventListener("input", () => setScrubberPosition(Number(slider.value)));
  slider.addEventListener("keydown", (event) => {
    const current = Number(slider.value);
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setScrubberPosition(Math.min(1000, current + 10));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setScrubberPosition(Math.max(0, current - 10));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setScrubberPosition(Math.min(1000, current + 100));
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setScrubberPosition(Math.max(0, current - 100));
    } else if (event.key === "Home") {
      event.preventDefault();
      setScrubberPosition(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setScrubberPosition(1000);
    }
  });

  async function reloadReview(): Promise<void> {
    try {
      const answer = await ctx.api.get<ReviewAnswer>("/api/estate/review");
      if (reviewWindowStart === 0) {
        reviewWindowStart = new Date(answer.window_start).getTime();
      }
      reviewEvents = answer.events;
      setScrubberPosition(Number(slider.value));
      detectArrivals(answer.events);
    } catch {
      void 0;
    }
  }

  const seenOrders = new Set<string>();
  function detectArrivals(events: ReviewAnswer["events"]): void {
    for (const event of events) {
      if (seenOrders.has(event.order_id)) continue;
      seenOrders.add(event.order_id);
      const node = markers.get(event.store_id);
      if (!node) continue;
      node.setAttribute("data-arrival", "dropping");
      statusUpdates.textContent = `New order ${event.order_number} at ${stores.find((s) => s.id === event.store_id)?.name ?? ""}.`;
      const finish = (): void => node.setAttribute("data-arrival", "none");
      if (reducedMotion()) {
        window.setTimeout(finish, 600);
      } else {
        node.setAttribute("data-arrival", "pulsing");
        window.setTimeout(finish, 620);
      }
    }
  }

  // --- Tabs (phone) ---
  function applyTabs(): void {
    const narrow = window.innerWidth <= 700;
    tabsBar.style.display = narrow ? "flex" : "none";
    const mapSelected = tabMap.getAttribute("aria-selected") === "true";
    mapView.style.display = !narrow || mapSelected ? "" : "none";
    tableWrap.style.display = !narrow || !mapSelected ? "" : "none";
    legend.style.display = !narrow || mapSelected ? "" : "none";
  }
  tabMap.addEventListener("click", () => {
    tabMap.setAttribute("aria-selected", "true");
    tabTable.setAttribute("aria-selected", "false");
    applyTabs();
  });
  tabTable.addEventListener("click", () => {
    tabTable.setAttribute("aria-selected", "true");
    tabMap.setAttribute("aria-selected", "false");
    applyTabs();
  });
  tabsBar.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const mapSelected = tabMap.getAttribute("aria-selected") === "true";
      if (mapSelected && event.key === "ArrowRight") tabTable.click();
      if (!mapSelected && event.key === "ArrowLeft") tabMap.click();
    }
  });
  applyTabs();
  const onResize = (): void => {
    applyTabs();
    placeFilterPanel();
    renderMarkers();
  };
  window.addEventListener("resize", onResize);
  cleanups.push(() => window.removeEventListener("resize", onResize));

  // --- Wire filters ---
  for (const def of SHOP_STATES) {
    checkboxes[def.key].addEventListener("change", () => {
      writeAddress();
      void reloadStores();
    });
  }
  let searchTimer: number | null = null;
  searchInput.addEventListener("input", () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      writeAddress();
      void reloadStores();
    }, 300);
  });

  // --- Initial load ---
  void reloadStores();
  void reloadReview();
  const poll = window.setInterval(() => {
    void reloadStores(false);
    void reloadReview();
  }, 5000);
  timers.push(poll);

  // Restore selected shop from address
  if (selectedShop) {
    void ctx.api
      .get<StoreDisplay>(`/api/stores/${selectedShop}`)
      .then((store) => {
        selected = store.id;
        view.lon = store.lon;
        view.lat = store.lat;
        view.zoom = 6;
        updateViewportAttribute();
        openDetail(store, true);
        renderMarkers();
      })
      .catch(() => void 0);
  }

  return () => {
    for (const timer of timers) window.clearInterval(timer);
    for (const fn of cleanups) fn();
    if (glideFrame !== null) cancelAnimationFrame(glideFrame);
    if (dragGlideFrame !== null) cancelAnimationFrame(dragGlideFrame);
    filterSheetRoot.remove();
  };
}

