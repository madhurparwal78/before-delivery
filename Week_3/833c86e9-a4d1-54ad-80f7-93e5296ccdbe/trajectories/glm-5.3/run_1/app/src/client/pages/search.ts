import { state, t, fmt, moneyEl, moneyText } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import { status, toast, openDialog, outageBand } from "../ui.js";
import { onEvent } from "../events.js";
import { onCleanup as regCleanup, currentRenderToken } from "../router.js";
import { destinationCombobox, destValue, partyControls, openDatePicker, setPickerContext, type DestOption, type DayInfo } from "../widgets/search.js";
import type { Page } from "../router.js";

type SearchResult = {
  code: string; name: string; stars: number; score: number; distance_km: number;
  x: number; y: number; total_minor: number; avg_night_minor: number;
  display_minor: number; display_currency: string; refundable: boolean; rank: number;
  amenities: string[];
};

type SearchResponse = {
  canonical: string;
  notices: { key: string; name?: string; date?: string; n?: number; value?: string }[];
  count: number;
  results: SearchResult[];
  counts: { stars: Record<string, number>; amen: Record<string, number>; free: number };
  histogram: { from_minor: number; count: number }[];
  pins: { code: string; name: string; x: number; y: number; score: number; display_minor: number }[];
  next_cursor: string | null;
};

const MAP_DEBOUNCE = Number(process.env.KIP_MAP_DEBOUNCE_MS);

let destinations: DestOption[] = [];
let lastSearchUrl = "";

const page: Page = {
  async render(main: HTMLElement, params: URLSearchParams): Promise<void> {
    const token = currentRenderToken();
    main.replaceChildren();
    const destsRes = await api<DestOption[]>("/api/destinations");
    destinations = destsRes.ok ? destsRes.data : [];
    const destCode = params.get("dest") ?? "";
    const dest = destinations.find((d) => d.code === destCode) ?? null;

    const form = document.createElement("form");
    form.className = "search-form";
    const destWrap = destinationCombobox(dest, () => undefined);
    form.appendChild(destWrap);

    const datesBtn = document.createElement("button");
    datesBtn.type = "button";
    datesBtn.dataset.focusKey = "dates";
    updateDatesLabel(datesBtn, params.get("in"), params.get("out"), dest?.zone ?? "UTC");
    datesBtn.addEventListener("click", () => {
      const selected = destValue(destWrap, destinations);
      openDatePicker({
        opener: datesBtn,
        dest: selected?.code ?? destCode,
        zone: selected?.zone ?? "UTC",
        cur: state.cur,
        arrival: params.get("in"),
        departure: params.get("out"),
        onPicked: (inDate, outDate) => {
          if (inDate && outDate) {
            runSearch({ in: inDate, out: outDate }, false);
          } else {
            updateDatesLabel(datesBtn, params.get("in"), params.get("out"), selected?.zone ?? "UTC");
          }
        }
      });
    });
    form.appendChild(datesBtn);

    const party = partyControls(Number(params.get("adults") ?? 2), parseAges(params.get("ages")), (a, ages) => {
      pendingParty = { adults: a, ages };
    });
    form.appendChild(party);
    let pendingParty = { adults: Number(params.get("adults") ?? 2), ages: parseAges(params.get("ages")) };

    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.dataset.focusKey = "search";
    searchBtn.textContent = ui("search.search");
    searchBtn.addEventListener("click", () => {
      const selected = destValue(destWrap, destinations);
      const next = new URLSearchParams(location.search);
      if (selected) next.set("dest", selected.code);
      next.set("adults", String(pendingParty.adults));
      if (pendingParty.ages.length > 0) next.set("ages", pendingParty.ages.join(",")); else next.delete("ages");
      runSearch(next, true);
    });
    form.appendChild(searchBtn);
    main.appendChild(form);

    // announcements
    const announcements = document.createElement("div");
    announcements.className = "status-line";
    announcements.setAttribute("role", "status");
    announcements.dataset.status = "search-announcements";
    main.appendChild(announcements);
    const linkNotice = document.createElement("div");
    linkNotice.className = "status-line";
    linkNotice.setAttribute("role", "status");
    linkNotice.dataset.status = "link-notice";
    main.appendChild(linkNotice);
    const roomAdvice = document.createElement("div");
    roomAdvice.className = "status-line";
    roomAdvice.setAttribute("role", "status");
    roomAdvice.dataset.status = "room-advice";
    main.appendChild(roomAdvice);

    // results heading
    const heading = document.createElement("h2");
    heading.textContent = ui("search.results");
    heading.id = "results-heading";
    heading.tabIndex = -1;
    main.appendChild(heading);

    // price display and sort
    const controls = document.createElement("div");
    controls.className = "search-controls";
    const displayGroup = document.createElement("fieldset");
    displayGroup.setAttribute("role", "radiogroup");
    displayGroup.setAttribute("aria-label", ui("search.display"));
    const perNight = document.createElement("input");
    perNight.type = "radio"; perNight.name = "display"; perNight.id = "display-night";
    perNight.dataset.focusKey = "display-night";
    const perNightLabel = document.createElement("label");
    perNightLabel.htmlFor = "display-night";
    perNightLabel.textContent = ui("search.per_night");
    const totalRadio = document.createElement("input");
    totalRadio.type = "radio"; totalRadio.name = "display"; totalRadio.id = "display-total";
    totalRadio.dataset.focusKey = "display-total";
    const totalLabel = document.createElement("label");
    totalLabel.htmlFor = "display-total";
    totalLabel.textContent = ui("search.total");
    const cur = params.get("display") ?? "total";
    if (cur === "night") perNight.checked = true; else totalRadio.checked = true;
    perNight.addEventListener("change", () => runSearch({ display: "night" }, true));
    totalRadio.addEventListener("change", () => runSearch({ display: "total" }, true));
    const taxes = document.createElement("input");
    taxes.type = "checkbox";
    taxes.id = "taxes";
    taxes.dataset.focusKey = "taxes";
    taxes.setAttribute("role", "switch");
    taxes.setAttribute("aria-label", ui("search.taxes"));
    taxes.checked = (params.get("tax") ?? "1") !== "0";
    taxes.addEventListener("change", () => runSearch({ tax: taxes.checked ? "1" : "0" }, true));
    const taxesLabel = document.createElement("label");
    taxesLabel.htmlFor = "taxes";
    taxesLabel.textContent = ui("search.taxes");
    displayGroup.append(perNight, perNightLabel, totalRadio, totalLabel);
    const sortSel = document.createElement("select");
    sortSel.dataset.focusKey = "sort";
    sortSel.setAttribute("aria-label", ui("search.sort"));
    for (const [value, key] of [["rank", "search.sort.rank"], ["price_asc", "search.sort.price_asc"], ["price_desc", "search.sort.price_desc"], ["score_desc", "search.sort.score_desc"], ["distance_asc", "search.sort.distance_asc"]] as const) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = ui(key);
      sortSel.appendChild(opt);
    }
    sortSel.value = params.get("sort") ?? "rank";
    sortSel.addEventListener("change", () => runSearch({ sort: sortSel.value }, true));
    controls.append(displayGroup, taxesLabel, taxes, sortSel);
    main.appendChild(controls);

    // layout: filters | rows | map
    const layout = document.createElement("div");
    layout.className = "search-page";
    const filtersCol = document.createElement("aside");
    filtersCol.className = "search-filters desktop-only";
    const rowsCol = document.createElement("div");
    rowsCol.className = "search-rows";
    rowsCol.dataset.role = "rows";
    const mapCol = document.createElement("aside");
    mapCol.className = "search-map desktop-only";
    layout.append(filtersCol, rowsCol, mapCol);
    main.appendChild(layout);

    // phone tools row
    const toolsRow = document.createElement("div");
    toolsRow.className = "search-tools-row phone-only";
    const filtersBtn = document.createElement("button");
    filtersBtn.dataset.focusKey = "filters-open";
    filtersBtn.textContent = ui("filters.title");
    filtersBtn.addEventListener("click", () => {
      openDialog((body) => { renderFilters(body, () => runSearchNow()); }, { opener: filtersBtn, sheet: true, label: ui("filters.title") });
    });
    const mapBtn = document.createElement("button");
    mapBtn.dataset.focusKey = "map-open";
    mapBtn.textContent = ui("map.region");
    mapBtn.addEventListener("click", () => {
      const dlg = openDialog((body) => { renderMap(body, () => runSearchNow()); }, { opener: mapBtn, sheet: true, label: ui("map.region") });
    });
    toolsRow.append(filtersBtn, mapBtn);
    main.appendChild(toolsRow);

    const scrollToFocus = (): void => {
      const key = document.activeElement?.getAttribute("data-focus-key");
      if (key) {
        const target = document.querySelector(`[data-focus-key="${key}"]`);
        if (target && target !== document.activeElement) (target as HTMLElement).focus();
      }
    };

    async function load(url: URLSearchParams, push: boolean): Promise<void> {
      const sp = url.toString();
      const res = await api<SearchResponse>(`/api/search?${sp}`);
      if (!res.ok) {
        if (res.status === 429) toast(t("rate.limited", { fmt: fmt() }));
        return;
      }
      const data = res.data;
      // replace the URL with the canonical form, unless a newer render took over
      const target = `/search?${data.canonical}`;
      if (token === currentRenderToken()) {
        if (push) history.pushState({}, "", target);
        else history.replaceState({}, "", target);
      }
      lastSearchUrl = sp;
      // notices
      const notices = data.notices.map((n) => noticeText(n)).filter(Boolean);
      status("link-notice", notices.join(" "));
      status("search-announcements", t("count.found", { count_noun: "property", n: data.count, fmt: fmt() }));
      lastPins = data.pins;
      renderFilters(filtersCol, () => runSearchNow());
      renderRows(rowsCol, data);
      renderMap(mapCol, () => runSearchNow());
      scrollToFocus();
    }

    function runSearch(patch: Record<string, string | null> | URLSearchParams, push: boolean): void {
      const next = patch instanceof URLSearchParams ? new URLSearchParams(patch) : new URLSearchParams(location.search);
      if (!(patch instanceof URLSearchParams)) {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
      }
      void load(next, push);
    }
    function runSearchNow(): void {
      void load(new URLSearchParams(location.search), true);
    }

    await load(new URLSearchParams(location.search), false);

    // focus the results heading on first load
    heading.focus({ preventScroll: true });
    window.scrollTo(0, 0);

    const off = onEvent(() => {
      // re-run the current search with no history entry
      void load(new URLSearchParams(location.search), false);
    }, "availability");
    const offClock = onEvent(() => { void load(new URLSearchParams(location.search), false); }, "account.changed");
    regCleanup(() => { off(); offClock(); });

    function noticeText(n: { key: string; name?: string; date?: string; n?: number; value?: string }): string {
      const f = fmt();
      switch (n.key) {
        case "notice.ignored": return t("notice.ignored", { name: n.name ?? "", fmt: f });
        case "notice.arrival": return t("notice.arrival", { date: n.date ? f.date(n.date, dest?.zone ?? "UTC") : "", fmt: f });
        case "notice.departure": return t("notice.departure", { date: n.date ? f.date(n.date, dest?.zone ?? "UTC") : "", fmt: f });
        case "notice.adults": return t("notice.adults", { n: n.n ?? 0, fmt: f });
        case "notice.age": return t("notice.age", { value: n.value ?? "", fmt: f });
        case "notice.reset": return t("notice.reset", { name: n.name ?? "", fmt: f });
        case "notice.swapped": return t("notice.swapped", { fmt: f });
        default: return "";
      }
    }

    function renderFilters(host: HTMLElement, onChange: () => void): void {
      host.replaceChildren();
      const stars = document.createElement("div");
      stars.className = "filters";
      const h3 = document.createElement("h3");
      h3.textContent = ui("filters.stars");
      stars.appendChild(h3);
      const url = new URLSearchParams(location.search);
      const checkedStars = (url.get("stars") ?? "").split(",").filter(Boolean);
      for (const s of [3, 4, 5]) {
        const label = document.createElement("label");
        label.className = "toggle";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.focusKey = "stars-" + s;
        cb.dataset.count = "0";
        cb.setAttribute("aria-label", `${s} ${ui("filters.stars").toLowerCase()}`);
        cb.checked = checkedStars.includes(String(s));
        cb.addEventListener("change", () => {
          const set = new Set(checkedStars);
          if (cb.checked) set.add(String(s)); else set.delete(String(s));
          const list = [...set].sort();
          runSearch({ stars: list.length > 0 ? list.join(",") : null }, true);
          onChange();
        });
        const text = document.createElement("span");
        text.textContent = `${s} ${ui("filters.stars").toLowerCase()}`;
        const count = document.createElement("span");
        count.className = "count";
        stars.append(label);
        label.append(cb, text, count);
      }
      const amen = document.createElement("div");
      amen.className = "filters";
      const ah3 = document.createElement("h3");
      ah3.textContent = ui("filters.amenities");
      amen.appendChild(ah3);
      const checkedAmen = (url.get("amen") ?? "").split(",").filter(Boolean);
      for (const a of ["pool", "parking", "wifi", "spa", "pets"]) {
        const label = document.createElement("label");
        label.className = "toggle";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.focusKey = "amen-" + a;
        cb.dataset.count = "0";
        cb.setAttribute("aria-label", ui("amen." + a));
        cb.checked = checkedAmen.includes(a);
        cb.addEventListener("change", () => {
          const set = new Set(checkedAmen);
          if (cb.checked) set.add(a); else set.delete(a);
          const list = [...set].sort();
          runSearch({ amen: list.length > 0 ? list.join(",") : null }, true);
          onChange();
        });
        const text = document.createElement("span");
        text.textContent = ui("amen." + a);
        amen.append(label);
        label.append(cb, text);
      }
      const cancel = document.createElement("div");
      cancel.className = "filters";
      const ch3 = document.createElement("h3");
      ch3.textContent = ui("filters.cancellation");
      cancel.appendChild(ch3);
      const freeLabel = document.createElement("label");
      freeLabel.className = "toggle";
      const freeCb = document.createElement("input");
      freeCb.type = "checkbox";
      freeCb.dataset.focusKey = "free";
      freeCb.dataset.count = "0";
      freeCb.setAttribute("aria-label", ui("filters.free"));
      freeCb.checked = url.get("free") === "1";
      freeCb.addEventListener("change", () => {
        runSearch({ free: freeCb.checked ? "1" : null }, true);
        onChange();
      });
      freeLabel.append(freeCb, document.createTextNode(ui("filters.free")));
      cancel.appendChild(freeLabel);
      host.append(stars, amen, cancel);

      // price range
      const price = document.createElement("div");
      price.className = "filters";
      const ph3 = document.createElement("h3");
      price.appendChild(ph3);
      const minIn = document.createElement("input");
      minIn.type = "number";
      minIn.dataset.focusKey = "min";
      minIn.setAttribute("role", "spinbutton");
      minIn.setAttribute("aria-label", ui("filters.lowest"));
      minIn.value = url.get("min") ?? "";
      minIn.addEventListener("change", () => runSearch({ min: minIn.value || null }, true));
      const maxIn = document.createElement("input");
      maxIn.type = "number";
      maxIn.dataset.focusKey = "max";
      maxIn.setAttribute("role", "spinbutton");
      maxIn.setAttribute("aria-label", ui("filters.highest"));
      maxIn.value = url.get("max") ?? "";
      maxIn.addEventListener("change", () => runSearch({ max: maxIn.value || null }, true));
      price.append(minIn, maxIn);
      host.appendChild(price);

      // histogram
      const hist = document.createElement("div");
      hist.className = "histogram";
      const hh3 = document.createElement("h3");
      hist.appendChild(hh3);
      const bars = document.createElement("div");
      bars.className = "histogram-bars";
      hist.appendChild(bars);
      host.appendChild(hist);
    }

    function renderRows(host: HTMLElement, data: SearchResponse): void {
      host.replaceChildren();
      // update filter counts and histogram from this response
      const applyCounts = (host2: HTMLElement) => {
        for (const s of [3, 4, 5]) {
          const cb = host2.querySelector<HTMLInputElement>(`[data-focus-key="stars-${s}"]`);
          if (cb) { cb.dataset.count = String(data.counts.stars[String(s)] ?? 0); cb.dataset.checkedCount = String(data.counts.stars[String(s)] ?? 0); }
        }
        for (const a of ["pool", "parking", "wifi", "spa", "pets"]) {
          const cb = host2.querySelector<HTMLInputElement>(`[data-focus-key="amen-${a}"]`);
          if (cb) cb.dataset.count = String(data.counts.amen[a] ?? 0);
        }
        const free = host2.querySelector<HTMLInputElement>('[data-focus-key="free"]');
        if (free) free.dataset.count = String(data.counts.free);
        const bars = host2.querySelector<HTMLElement>(".histogram-bars");
        if (bars) {
          bars.replaceChildren();
          data.histogram.forEach((b, i) => {
            const bar = document.createElement("button");
            const from = b.from_minor / 100;
            const to = i === 11 ? from + 50 : (b.from_minor + 5000) / 100;
            const label = i === 11
              ? `${from} euros and up, ${b.count} ${b.count === 1 ? "property" : "properties"}`
              : `${from} to ${to} euros, ${b.count} ${b.count === 1 ? "property" : "properties"}`;
            bar.setAttribute("role", "img");
            bar.setAttribute("aria-label", label);
            bar.dataset.from = String(b.from_minor);
            bar.dataset.count = String(b.count);
            bar.style.height = `${Math.max(2, (b.count / Math.max(1, data.count)) * 90)}px`;
            bars.appendChild(bar);
          });
        }
      };
      applyCounts(filtersCol);
      document.querySelectorAll<HTMLElement>(".bottom-sheet").forEach((s) => applyCounts(s));

      if (data.results.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        const word = document.createElement("p");
        word.className = "huge";
        word.textContent = t("empty.results.word", { fmt: fmt() });
        const help = document.createElement("p");
        help.textContent = t("empty.results", { fmt: fmt() });
        empty.append(word, help);
        host.appendChild(empty);
        return;
      }
      const list = document.createElement("div");
      list.dataset.role = "result-list";
      for (const r of data.results) {
        list.appendChild(resultRow(r));
      }
      host.appendChild(list);
      // paging
      const paging = document.createElement("div");
      paging.className = "paging";
      if (new URLSearchParams(location.search).get("cursor")) {
        const prev = document.createElement("a");
        prev.href = prevPageUrl();
        prev.dataset.focusKey = "prev-page";
        prev.textContent = ui("page.prev");
        prev.addEventListener("click", (e) => { e.preventDefault(); history.back(); });
        paging.appendChild(prev);
      }
      if (data.next_cursor) {
        const next = document.createElement("a");
        next.href = "#";
        next.dataset.focusKey = "next-page";
        next.textContent = ui("page.next");
        next.addEventListener("click", (e) => {
          e.preventDefault();
          const url = new URLSearchParams(location.search);
          url.set("cursor", data.next_cursor!);
          runSearch(url, true);
        });
        paging.appendChild(next);
      }
      host.appendChild(paging);
    }

    function resultRow(r: SearchResult): HTMLElement {
      const article = document.createElement("article");
      article.dataset.code = r.code;
      const label = `${r.name}, ${r.stars} stars, score ${fmt().num(r.score)}, ${fmt().num(r.distance_km)} kilometres, total ${moneyText(r.display_minor, r.display_currency as "EUR")}`;
      article.setAttribute("aria-label", label);
      const start = document.createElement("div");
      const name = document.createElement("a");
      name.className = "name";
      name.href = `/properties/${r.code}${location.search}`;
      name.dataset.focusKey = "row-" + r.code;
      name.textContent = r.name;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${r.stars} stars · ${fmt().num(r.score)} · ${fmt().num(r.distance_km)} km`;
      start.append(name, meta);
      if (r.refundable) {
        const tag = document.createElement("span");
        tag.className = "tag sage";
        tag.textContent = ui("tag.refundable");
        start.appendChild(tag);
      }
      const end = document.createElement("div");
      end.className = "end";
      const total = document.createElement("div");
      total.className = "total";
      total.append(moneyEl(r.display_minor, r.display_currency as "EUR"));
      const mapBtn = document.createElement("button");
      mapBtn.dataset.focusKey = "rowmap-" + r.code;
      mapBtn.textContent = `${ui("row.show_map")} ${r.name}`;
      mapBtn.setAttribute("aria-label", `Show ${r.name} on the map`);
      mapBtn.addEventListener("click", () => {
        const mapRegion = document.querySelector<HTMLElement>("[data-role='map']");
        if (mapRegion) {
          selectPin(r.code);
          const pin = mapRegion.querySelector<HTMLElement>(`[data-code="${r.code}"]`);
          pin?.scrollIntoView({ block: "center" });
          (pin?.querySelector("button") ?? pin)?.focus();
        }
        const url = new URLSearchParams(location.search);
        url.set("sel", r.code);
        runSearch(url, true);
      });
      end.append(total, mapBtn);
      article.append(start, end);
      return article;
    }

    function renderMap(host: HTMLElement, onChange: () => void): void {
      host.replaceChildren();
      const region = document.createElement("div");
      region.className = "map-region";
      region.setAttribute("role", "region");
      region.setAttribute("aria-label", ui("map.region"));
      region.dataset.zoom = params.get("zoom") ?? "2";
      region.dataset.cx = params.get("cx") ?? String(dest?.cx ?? 500);
      region.dataset.cy = params.get("cy") ?? String(dest?.cy ?? 500);
      host.appendChild(region);
      const plane = document.createElement("div");
      plane.className = "map-plane";
      region.appendChild(plane);
      const tools = document.createElement("div");
      tools.className = "map-tools";
      for (const [key, label] of [["pan_n", "map.pan_n"], ["pan_s", "map.pan_s"], ["pan_e", "map.pan_e"], ["pan_w", "map.pan_w"], ["zoom_in", "map.zoom_in"], ["zoom_out", "map.zoom_out"]] as const) {
        const b = document.createElement("button");
        b.dataset.focusKey = key;
        b.setAttribute("aria-label", ui(label));
        b.textContent = label.split("_")[1].slice(0, 1).toUpperCase();
        b.addEventListener("click", () => {
          const zoom = Number(region.dataset.zoom);
          const cx = Number(region.dataset.cx);
          const cy = Number(region.dataset.cy);
          if (key === "zoom_in") setView(zoom + 1, cx, cy);
          else if (key === "zoom_out") setView(zoom - 1, cx, cy);
          else if (key === "pan_n") setView(zoom, cx, cy - 100 / 2 ** zoom);
          else if (key === "pan_s") setView(zoom, cx, cy + 100 / 2 ** zoom);
          else if (key === "pan_e") setView(zoom, cx + 100 / 2 ** zoom, cy);
          else if (key === "pan_w") setView(zoom, cx - 100 / 2 ** zoom, cy);
        });
        tools.appendChild(b);
      }
      region.appendChild(tools);
      const searchAreaWrap = document.createElement("div");
      searchAreaWrap.className = "map-search-area";
      region.appendChild(searchAreaWrap);

      let debounce: number | null = null;
      function setView(zoom: number, cx: number, cy: number): void {
        const z = Math.max(0, Math.min(5, zoom));
        region.dataset.zoom = String(z);
        region.dataset.cx = String(Math.max(0, Math.min(1000, cx)));
        region.dataset.cy = String(Math.max(0, Math.min(1000, cy)));
        redraw();
        if (debounce) clearTimeout(debounce);
        debounce = window.setTimeout(() => {
          const url = new URLSearchParams(location.search);
          url.set("zoom", region.dataset.zoom!);
          url.set("cx", region.dataset.cx!);
          url.set("cy", region.dataset.cy!);
          const current = lastSearchUrl;
          if (current.includes("zoom=" + region.dataset.zoom) && current.includes("cx=" + region.dataset.cx) && current.includes("cy=" + region.dataset.cy)) {
            searchAreaWrap.replaceChildren();
            return;
          }
          const btn = document.createElement("button");
          btn.dataset.focusKey = "search-area";
          btn.textContent = ui("map.search_area");
          btn.addEventListener("click", () => {
            const u = new URLSearchParams(location.search);
            u.set("zoom", region.dataset.zoom!);
            u.set("cx", region.dataset.cx!);
            u.set("cy", region.dataset.cy!);
            runSearch(u, true);
            onChange();
          });
          searchAreaWrap.replaceChildren(btn);
        }, MAP_DEBOUNCE);
      }

      function redraw(): void {
        const zoom = Number(region.dataset.zoom);
        const cx = Number(region.dataset.cx);
        const cy = Number(region.dataset.cy);
        const side = 1000 / 2 ** zoom;
        const pins = (lastPins ?? []);
        const inView = pins.filter((p) => Math.abs(p.x - cx) <= side / 2 && Math.abs(p.y - cy) <= side / 2);
        const clusters = new Map<string, { x: number; y: number; members: typeof inView }>();
        const singles: typeof inView = [];
        const size = 200 / 2 ** zoom;
        for (const p of inView) {
          const key = `${Math.floor(p.x / size)},${Math.floor(p.y / size)}`;
          const cell = clusters.get(key);
          if (cell) cell.members.push(p);
          else clusters.set(key, { x: p.x, y: p.y, members: [p] });
        }
        plane.replaceChildren();
        for (const [key, cell] of clusters) {
          if (cell.members.length >= 2) {
            const meanX = cell.members.reduce((s, m) => s + m.x, 0) / cell.members.length;
            const meanY = cell.members.reduce((s, m) => s + m.y, 0) / cell.members.length;
            const btn = document.createElement("button");
            btn.dataset.code = cell.members.map((m) => m.code).sort()[0];
            btn.dataset.kind = "cluster";
            btn.className = "map-pin cluster";
            btn.setAttribute("aria-label", `${cell.members.length} ${cell.members.length === 1 ? "property" : "properties"}, ${ui("map.cluster")}`);
            btn.textContent = String(cell.members.length);
            btn.addEventListener("click", () => setView(zoom + 1, Math.round(meanX * 10) / 10, Math.round(meanY * 10) / 10));
            plane.appendChild(btn);
          } else {
            singles.push(...cell.members);
          }
        }
        for (const p of singles) {
          const btn = document.createElement("button");
          btn.dataset.code = p.code;
          btn.dataset.kind = "pin";
          btn.className = "map-pin";
          btn.setAttribute("aria-pressed", String(location.search.includes("sel=" + p.code)));
          btn.setAttribute("aria-label", `${p.name}, score ${fmt().num(p.score)}, from ${moneyText(p.display_minor, state.cur)}`);
          btn.textContent = moneyText(p.display_minor, state.cur);
          btn.addEventListener("click", () => selectPin(p.code));
          plane.appendChild(btn);
        }
        // position pins after layout
        requestAnimationFrame(() => {
          const rect = plane.getBoundingClientRect();
          for (const el of [...plane.children] as HTMLElement[]) {
            const x = Number(el.dataset.code ? (el.dataset.kind === "pin" ? pins.find((p) => p.code === el.dataset.code)?.x : clusterMean(el, pins, clusters)) : 500);
            const y = Number(el.dataset.kind === "pin" ? pins.find((p) => p.code === el.dataset.code)?.y : clusterMeanY(el, pins, clusters));
            const px = ((x - (cx - side / 2)) / side) * rect.width;
            const py = ((y - (cy - side / 2)) / side) * rect.height;
            el.style.left = `${px}px`;
            el.style.top = `${py}px`;
          }
        });
      }

      // drag to pan
      let dragging = false;
      let startX = 0, startY = 0;
      plane.addEventListener("pointerdown", (e) => {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
      });
      plane.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const rect = plane.getBoundingClientRect();
        const zoom = Number(region.dataset.zoom);
        const side = 1000 / 2 ** zoom;
        const dx = ((e.clientX - startX) / rect.width) * side;
        const dy = ((e.clientY - startY) / rect.height) * side;
        startX = e.clientX;
        startY = e.clientY;
        setView(zoom, Number(region.dataset.cx) - dx, Number(region.dataset.cy) - dy);
      });
      plane.addEventListener("pointerup", () => { dragging = false; });
      plane.addEventListener("pointerleave", () => { dragging = false; });

      redraw();
    }

    function selectPin(code: string): void {
      const url = new URLSearchParams(location.search);
      if (url.get("sel") === code) return;
      url.set("sel", code);
      runSearch(url, true);
    }

    function updateDatesLabel(btn: HTMLButtonElement, inDate: string | null, outDate: string | null, zone: string): void {
      const label = ui("search.dates");
      if (inDate && outDate) {
        const nights = Math.round((Date.parse(outDate) - Date.parse(inDate)) / 86400000);
        btn.setAttribute("aria-label", `${label}, ${fmt().dayMonth(inDate, zone)} to ${fmt().dayMonth(outDate, zone)}, ${nights} ${nights === 1 ? "night" : "nights"}`);
        btn.textContent = `${fmt().dayMonth(inDate, zone)} – ${fmt().dayMonth(outDate, zone)}`;
      } else {
        btn.setAttribute("aria-label", label);
        btn.textContent = label;
      }
    }
  }
};

let lastPins: SearchResponse["pins"] | null = null;

function parseAges(raw: string | null): number[] {
  if (!raw) return [];
  return raw.split(",").map(Number).filter((n) => Number.isInteger(n));
}

function prevPageUrl(): string {
  const url = new URLSearchParams(location.search);
  url.delete("cursor");
  return "/search?" + url.toString();
}


function clusterMean(el: HTMLElement, pins: SearchResponse["pins"], clusters: Map<string, { x: number; y: number; members: SearchResponse["pins"] }>): number {
  const c = [...clusters.values()].find((x) => x.members.map((m) => m.code).sort()[0] === el.dataset.code);
  return c ? c.x : 500;
}
function clusterMeanY(el: HTMLElement, pins: SearchResponse["pins"], clusters: Map<string, { x: number; y: number; members: SearchResponse["pins"] }>): number {
  const c = [...clusters.values()].find((x) => x.members.map((m) => m.code).sort()[0] === el.dataset.code);
  return c ? c.y : 500;
}

export default page;
