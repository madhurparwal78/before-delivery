// Coverage board: the dispatch sheet with language gutter, day columns,
// capsules with seat lanes, and the Hatch Seam motion.
import { api, ApiCallError, el, formatHMM, formatRange, parseInstant, centralWeekStartISO, addDaysISO, formatDayShort, centralMinutesOfDay, prefersReducedMotion } from "../lib";
import { countNumeral, createDrawer, pollWhileConnected, seatLanes, statusRegion } from "../components";
import { App } from "../main";
import type { CoverageAssignment, CoverageResponse, StaffAssignmentView } from "../types";

const DAY_START = 360; // 06:00
const DAY_SPAN = 960; // 06:00 → 22:00
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface SeatKeyState {
  status: string;
  initials: string | null;
}

interface WeekState {
  seats: Map<string, SeatKeyState>; // "<number>|<seat>" → last seen state
  uncovered: Map<string, number>;   // language code → last seen uncovered minutes
}

export function renderBoard(app: App): void {
  const main = app.main;
  const drawer = createDrawer();
  const boardStatus = statusRegion("Board updates");

  let weekISO = centralWeekStartISO(new Date());
  let selectedDay = 0;
  const weeks = new Map<string, WeekState>();
  let lastData: CoverageResponse | null = null;

  const weekHeading = el("h2", { text: "" });
  const prevBtn = el("button", { class: "btn btn-quiet", text: "Previous week" });
  const nextBtn = el("button", { class: "btn btn-quiet", text: "Next week" });
  prevBtn.addEventListener("click", () => { weekISO = addDaysISO(weekISO, -7); load(); });
  nextBtn.addEventListener("click", () => { weekISO = addDaysISO(weekISO, 7); load(); });

  const weekBoard = el("div", { class: "board-wrap board-week" });
  const singleWrap = el("div", { class: "board-single-day" });
  const tabsWrap = el("div", { class: "day-tabs", role: "tablist", "aria-label": "Days" });

  main.append(
    el("section", { "aria-label": "Coverage board" },
      el("h1", { text: "Coverage board" }),
      el("div", { class: "two-col", style: "align-items: center;" },
        weekHeading,
        el("div", { class: "two-col", style: "margin: 0;" }, prevBtn, nextBtn)),
      boardStatus.el,
      tabsWrap,
      weekBoard,
      singleWrap,
    ),
  );

  const hoursAndMinutes = (minutes: number): string =>
    `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;

  const centralDayIndex = (instant: Date, weekStart: string): number => {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
    const startISO = fmt.format(instant);
    return Math.round((Date.parse(`${startISO}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000);
  };

  const formatHeading = (mondayISO: string): string => {
    const d = new Date(`${mondayISO}T12:00:00Z`);
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
  };

  const load = (): void => {
    api<CoverageResponse>("GET", `/api/coverage?week=${weekISO}`).then((data) => {
      const outageText = boardStatus.el.textContent;
      const prev = weeks.get(data.week_start) ?? { seats: new Map(), uncovered: new Map() };

      const seams: Record<string, "forward" | "reverse"> = {};
      const numerals: Record<string, { from: number; to: number }> = {};
      const announcements: string[] = [];

      for (const lang of data.languages) {
        const prevUncovered = prev.uncovered.get(lang.code) ?? 0;
        if (prevUncovered !== lang.uncovered_minutes) {
          numerals[lang.code] = { from: prevUncovered, to: lang.uncovered_minutes };
          prev.uncovered.set(lang.code, lang.uncovered_minutes);
        }
        for (const a of lang.assignments) {
          for (const seat of a.seats) {
            const key = `${a.number}|${seat.seat}`;
            const before = prev.seats.get(key);
            const now = { status: seat.status, initials: seat.interpreter_initials };
            prev.seats.set(key, now);
            if (before && before.status === "open" && now.status !== "open") {
              seams[key] = "forward";
              announcements.push(`${lang.name}, ${formatDayShort(parseInstant(a.start_at)!)}: seat ${seat.seat} covered by ${now.initials}, ${hoursAndMinutes(lang.uncovered_minutes)} uncovered this week`);
            } else if (before && before.status !== "open" && now.status === "open") {
              seams[key] = "reverse";
              announcements.push(`${lang.name}, ${formatDayShort(parseInstant(a.start_at)!)}: seat ${seat.seat} open, ${hoursAndMinutes(lang.uncovered_minutes)} uncovered this week`);
            }
          }
        }
      }
      weeks.set(data.week_start, prev);

      lastData = data;
      renderBoard(data, seams, numerals);
      // The label swap and the check glyph land when the fill sweep completes.
      if (!prefersReducedMotion() && Object.keys(seams).length > 0) {
        setTimeout(() => renderBoard(data, {}, {}), 490);
      }

      if (announcements.length > 0) {
        boardStatus.set(announcements.join(". ") + ".");
      } else if (outreach(outageText)) {
        boardStatus.set("");
      }
    }).catch(() => {
      boardStatus.set("Board not updating. Retrying…");
    });
  };

  const outreach = (text: string | null): boolean =>
    (text ?? "").includes("not updating");

  const renderBoard = (data: CoverageResponse, seams: Record<string, "forward" | "reverse">, numerals: Record<string, { from: number; to: number }>): void => {
    weekHeading.textContent = `Week of ${formatHeading(data.week_start)}`;
    // Only the board that matches the viewport exists in the accessibility tree.
    const narrow = window.innerWidth < 1024;
    weekBoard.toggleAttribute("hidden", narrow);
    singleWrap.toggleAttribute("hidden", !narrow);
    if (narrow) {
      singleWrap.replaceChildren(buildTable(data, seams, numerals, selectedDay));
    } else {
      weekBoard.replaceChildren(buildTable(data, seams, numerals, -1));
    }
    renderTabs();
  };

  const renderTabs = (): void => {
    tabsWrap.replaceChildren();
    for (let day = 0; day < 7; day++) {
      const dateISO = addDaysISO(weekISO, day);
      const label = `${DAY_LABELS[day]} ${Number(dateISO.slice(8, 10))}`;
      const tab = el("button", {
        class: "btn btn-quiet",
        role: "tab",
        "aria-selected": day === selectedDay ? "true" : "false",
        tabindex: day === selectedDay ? "0" : "-1",
        text: label,
        onclick: () => { selectedDay = day; load(); },
        onkeydown: (e: KeyboardEvent) => {
          let target = -1;
          if (e.key === "ArrowRight") target = (day + 1) % 7;
          else if (e.key === "ArrowLeft") target = (day + 6) % 7;
          else if (e.key === "Home") target = 0;
          else if (e.key === "End") target = 6;
          if (target >= 0) {
            e.preventDefault();
            selectedDay = target;
            load();
            (tabsWrap.children[target] as HTMLButtonElement | undefined)?.focus();
          }
        },
      });
      tabsWrap.append(tab);
    }
  };

  const buildTable = (data: CoverageResponse, seams: Record<string, "forward" | "reverse">, numerals: Record<string, { from: number; to: number }>, dayFilter: number): HTMLTableElement => {
    const table = el("table", { class: "board", role: "presentation" });
    const colGroup = el("colgroup", {}, el("col", { class: "gutter" }));
    const headRow = el("tr", {}, el("th", { class: "gutter-head", text: "Language" }));
    for (let day = 0; day < 7; day++) {
      if (dayFilter >= 0 && day !== dayFilter) continue;
      const dateISO = addDaysISO(data.week_start, day);
      headRow.append(el("th", { text: `${DAY_LABELS[day]} ${Number(dateISO.slice(8, 10))}` }));
    }
    table.append(colGroup, el("thead", {}, headRow));

    const tbody = el("tbody");
    for (const lang of data.languages) {
      const numeralNode = el("span", {
        class: `lang-uncovered num ${lang.uncovered_minutes > 0 ? "is-gap" : ""}`,
        text: formatHMM(lang.uncovered_minutes),
      });
      const uncoveredGroup = el("div", { role: "group", "aria-label": `${lang.name} uncovered` }, numeralNode);
      if (numerals[lang.code]) {
        const delta = numerals[lang.code];
        countNumeral(numeralNode, delta.from, delta.to, formatHMM);
      }
      const langGroup = el("div", { role: "group", "aria-label": lang.name },
        el("span", { class: "lang-name", text: lang.name }), uncoveredGroup);
      const tr = el("tr", {}, el("td", { class: "lang-cell" }, langGroup));

      for (let day = 0; day < 7; day++) {
        if (dayFilter >= 0 && day !== dayFilter) continue;
        const dayCell = el("td", { class: "day-cell" });
        const rules = el("div", { class: "hour-rules" });
        for (let h = 1; h < 16; h++) rules.append(el("i", { style: `left: ${(h * 60 / DAY_SPAN) * 100}%` }));
        const dayCapsules = lang.assignments.filter(
          (a) => centralDayIndex(parseInstant(a.start_at)!, data.week_start) === day,
        );
        // Stack overlapping capsules so each stays readable and tappable.
        const tracks = assignTracks(dayCapsules);
        const capsules = el("div", { class: "capsules" });
        for (const { assignment, track, trackCount } of tracks) {
          capsules.append(buildCapsule(assignment, seams, track, trackCount));
        }
        dayCell.append(rules, capsules);
        tr.append(dayCell);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    return table;
  };

  /** Give each overlapping capsule its own horizontal track. */
  const assignTracks = (dayCapsules: CoverageAssignment[]): { assignment: CoverageAssignment; track: number; trackCount: number }[] => {
    const sorted = [...dayCapsules].sort((x, y) =>
      parseInstant(x.start_at)!.getTime() - parseInstant(y.start_at)!.getTime() || x.number.localeCompare(y.number));
    const placed: { assignment: CoverageAssignment; track: number; start: number; end: number }[] = [];
    let trackCount = 1;
    for (const assignment of sorted) {
      const start = parseInstant(assignment.start_at)!.getTime();
      const end = start + assignment.duration_minutes * 60000;
      let track = 0;
      while (true) {
        const conflict = placed.find((p) => p.track === track && start < p.end && end > p.start);
        if (!conflict) break;
        track += 1;
      }
      placed.push({ assignment, track, start, end });
      trackCount = Math.max(trackCount, track + 1);
    }
    return placed.map((p) => ({ assignment: p.assignment, track: p.track, trackCount }));
  };

  const buildCapsule = (a: CoverageAssignment, seams: Record<string, "forward" | "reverse">, track: number, trackCount: number): HTMLButtonElement => {
    const start = parseInstant(a.start_at)!;
    const startMin = centralMinutesOfDay(start);
    const left = ((startMin - DAY_START) / DAY_SPAN) * 100;
    const width = (a.duration_minutes / DAY_SPAN) * 100;
    const covered = a.seats.filter((s) => s.status !== "open").length;
    const allCovered = covered === a.seats.length;
    const range = formatRange(start, parseInstant(a.end_at)!);
    const heightPct = 100 / trackCount;
    const capsule = el("button", {
      class: `capsule ${a.status === "cancelled" ? "is-cancelled" : ""}`,
      style: `left: ${left}%; width: ${width}%; top: calc(${track * heightPct}% + 2px); height: calc(${heightPct}% - 4px);`,
      "aria-label": `${a.number}, ${range}, ${covered} of ${a.seats.length} covered`,
      onclick: (e: Event) => openAssignment(a.number, e.currentTarget as HTMLElement),
    });
    const lanes = el("div", { class: "lanes" });
    for (const seat of a.seats) {
      const seam = seams[`${a.number}|${seat.seat}`] ?? "none";
      const open = seat.status === "open";
      const lane = el("div", { role: "group", "aria-label": `Seat ${seat.seat}`, class: `lane ${open ? "hatched" : "held"}` });
      if (!open) {
        const fill = el("div", { class: "fill" });
        if (seam === "forward" && !prefersReducedMotion()) fill.classList.add("seam");
        if (seam === "reverse" && !prefersReducedMotion()) fill.classList.add("seam-reverse");
        lane.append(fill);
      }
      lane.append(el("span", { class: "label", text: open ? "open" : (seat.interpreter_initials ?? "") }));
      lanes.append(lane);
    }
    const caption = el("div", { class: "caption" },
      el("span", { class: "num", text: a.number }),
      allCovered ? checkGlyph() : el("span", {}),
      el("span", { text: `${covered} of ${a.seats.length} covered` }));
    capsule.append(lanes, caption);
    return capsule;
  };

  const checkGlyph = (): SVGSVGElement => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "All seats covered");
    svg.style.width = "14px";
    svg.style.height = "14px";
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2.5 8.5l3.5 3.5 7-8");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("fill", "none");
    svg.append(path);
    return svg;
  };

  const openAssignment = (number: string, opener: HTMLElement): void => {
    api<StaffAssignmentView>("GET", `/api/assignments/${number}`).then((a) => {
      const content = el("div", {},
        el("p", {}, el("span", { class: "num", text: a.number }), ` — ${a.org.name}`),
        el("dl", { class: "kv" },
          el("dt", { text: "Language" }), el("dd", { text: a.language }),
          el("dt", { text: "Setting" }), el("dd", { text: a.setting }),
          el("dt", { text: "Time" }), el("dd", { text: formatRange(parseInstant(a.start_at)!, parseInstant(a.end_at)!) }),
          el("dt", { text: "City" }), el("dd", { text: a.city }),
          el("dt", { text: "Duration" }), el("dd", { text: `${a.duration_minutes} min` }),
        ),
        el("div", { style: "margin: 10px 0;" }, seatLanes(a.seats)),
        seatHolderList(a),
      );
      if (a.status === "draft") {
        const releaseStatus = statusRegion("Release status");
        const releaseBtn = el("button", {
          class: "btn btn-primary",
          text: "Release to interpreters",
          onclick: async () => {
            releaseBtn.disabled = true;
            releaseStatus.set("Releasing…");
            try {
              const res = await api<{ offers_sent: number }>("POST", `/api/assignments/${number}/release`, {});
              releaseStatus.set(`Released. Offers going out to ${res.offers_sent} qualified interpreters.`);
              load();
            } catch (err) {
              releaseBtn.disabled = false;
              releaseStatus.set(err instanceof ApiCallError && err.code === "invalid_transition"
                ? "This request has already been released or closed."
                : "Couldn't reach Teamseat. Try again.");
            }
          },
        });
        content.append(releaseStatus.el, releaseBtn);
      }
      drawer.open(content, opener, `Assignment ${number}`);
    }).catch(() => drawer.close());
  };

  const seatHolderList = (a: StaffAssignmentView): HTMLElement => {
    const list = el("ul");
    for (const seat of a.seats) {
      list.append(el("li", {
        text: `Seat ${seat.seat}: ${seat.status === "open" ? "open" : `${seat.interpreter_initials} (${seat.interpreter_name})`}`,
      }));
    }
    return list;
  };

  renderTabs();
  load();
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const onResize = (): void => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (lastData && main.isConnected) renderBoard(lastData, {}, {});
    }, 150);
  };
  window.addEventListener("resize", onResize);
  pollWhileConnected(main, load);
}
