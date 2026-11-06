// The dispatch board: drag a thread from an interpreter to a request, read the four gates, pin or recoil.
import type { Board, BoardInterpreter, ConsumerPreferences, DryRun, GateResult, Named, RequestView, SeatView } from "../../shared/api.js";
import { SETTING_LABELS } from "../../shared/domain.js";
import { agencyDate, dayHeading } from "../../shared/time.js";
import { call, get } from "../api.js";
import type { Screen } from "../app.js";
import { Card, mark } from "../board/card.js";
import { Thread } from "../board/thread.js";
import { h, prefersReducedMotion, replace, say, statusRegion, uid } from "../dom.js";
import { emptyNote, when } from "../ui.js";
import { prepList, seatLine } from "./request-detail.js";

const REFRESH_MS = 5000;
const DRY_RUN_TIMEOUT_MS = 5000;

type Answer = { gates: GateResult[]; allPass: boolean } | { taken: Named } | "failed" | "pending";

interface Probe {
  card: Card;
  seat: SeatView;
  answer: Answer;
  waiters: (() => void)[];
  timer: number;
}

interface Hold {
  person: BoardInterpreter;
  chip: HTMLButtonElement;
  mode: "pointer" | "keyboard";
  thread: Thread | null;
  probe: Probe | null;
  pointerId: number;
}

/** The seat a card targets: its lowest-numbered open seat, or its highest seat when none is open. */
function targetSeat(r: RequestView): SeatView | undefined {
  const seats = [...r.seats].sort((a, b) => a.position - b.position);
  return seats.find((s) => s.status === "open") ?? seats[seats.length - 1];
}

const gateSummary = (ref: string, position: number, gates: GateResult[]): string =>
  `${ref} seat ${position}: ${gates.map((g) => `${g.label} ${g.pass ? "pass" : "fail"}`).join(", ")}.`;

export async function boardScreen({ main, onLeave }: Screen): Promise<void> {
  const gateStatus = statusRegion("Gate results", "status board-line");
  const boardStatus = statusRegion("Board status", "status board-line");
  const chips = h("ul", { class: "chips", "aria-label": "Interpreters" });
  const timetable = h("section", { class: "timetable", id: "board-requests", tabindex: "-1", "aria-label": "Requests, next 72 hours" });
  const detail = h("section", { class: "detail", "aria-label": "Request detail" });
  const tabRequests = h("button", { type: "button", role: "tab", id: uid("tab"), class: "tab" }, "Requests");
  const tabDetail = h("button", { type: "button", role: "tab", id: uid("tab"), class: "tab" }, "Detail");
  const tabs = h("div", { role: "tablist", "aria-label": "Board views", class: "board-tabs" }, tabRequests, tabDetail);
  timetable.setAttribute("role", "region");
  detail.setAttribute("role", "region");
  // Under 900px each region sits in its own tab panel, so it keeps its region role and name.
  const requestsPanel = h("div", { class: "board-panel" }, timetable);
  const detailPanel = h("div", { class: "board-panel" }, detail);
  main.append(
    h("div", { class: "board-bar" }, h("p", { class: "board-hint" }, "Drag an interpreter onto a request to check the four gates."), gateStatus, boardStatus),
    tabs,
    h("div", { class: "board" }, h("div", { class: "rail" }, h("h2", { class: "visually-hidden" }, "Interpreters"), chips), requestsPanel, detailPanel),
  );

  const cards = new Map<string, Card>();
  const lastGates = new Map<string, { name: string; position: number; gates: GateResult[] }>();
  const preferredNames = new Map<string, string[]>();
  let interpreters: BoardInterpreter[] = [];
  let order = "";
  let selected: string | null = null;
  let hold: Hold | null = null;
  let firstLoad = true;
  let activeTab: "requests" | "detail" = "requests";
  const narrow = window.matchMedia("(max-width: 899px)");

  // Tabs under 900px: Requests and Detail, one panel at a time.
  const showTab = (tab: "requests" | "detail", fade: boolean): void => {
    activeTab = tab;
    const isNarrow = narrow.matches;
    for (const [button, panel, name] of [
      [tabRequests, requestsPanel, "requests"],
      [tabDetail, detailPanel, "detail"],
    ] as const) {
      const on = name === tab;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
      if (isNarrow) {
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", button.id);
        panel.hidden = !on;
        if (on && fade && !prefersReducedMotion()) panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
      } else {
        panel.removeAttribute("role");
        panel.removeAttribute("aria-labelledby");
        panel.hidden = false;
      }
    }
  };
  const applyMode = (): void => {
    tabs.hidden = !narrow.matches;
    showTab(activeTab, false);
  };
  narrow.addEventListener("change", applyMode);
  onLeave(() => narrow.removeEventListener("change", applyMode));
  tabRequests.addEventListener("click", () => showTab("requests", true));
  tabDetail.addEventListener("click", () => showTab("detail", true));
  tabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = activeTab === "requests" ? "detail" : "requests";
    showTab(next, true);
    (next === "requests" ? tabRequests : tabDetail).focus();
  });
  timetable.addEventListener("focus", () => {
    if (narrow.matches) showTab("requests", false);
  });
  applyMode();

  // The detail pane: the selected request in full.
  const renderDetail = (): void => {
    const r = selected ? cards.get(selected)?.request : undefined;
    if (!r) {
      replace(detail, h("h2", {}, "No request selected"), emptyNote("Select a request card to see its seats, prep files and latest gate results."));
      return;
    }
    const gates = lastGates.get(r.id);
    const preferred = preferredNames.get(r.consumer.id);
    replace(
      detail,
      h("h2", {}, h("span", { class: "fig" }, r.ref), ` ${r.title}`),
      h("p", { class: "meta" }, h("span", { class: "fig" }, when(r.start, r.end)), ` · ${SETTING_LABELS[r.setting]} · ${r.org_name}`),
      h("p", { class: "state-line" }, "Status ", h("span", { class: "state" }, r.status), r.in_cancellation_window ? h("span", { class: "window-mark" }, "In cancellation window") : null),
      h(
        "dl",
        { class: "facts" },
        h("dt", {}, "Location"),
        h("dd", {}, r.location),
        h("dt", {}, "Deaf consumer"),
        h("dd", {}, r.consumer.name),
        h("dt", {}, "Preferred interpreters"),
        h("dd", {}, preferred === undefined ? "Loading…" : preferred.length ? preferred.join(", ") : "None recorded"),
      ),
      h("h3", {}, "Seats"),
      h("ul", { class: "seats" }, r.seats.map((s) => h("li", { "data-state": s.status }, seatLine(s, r.seats_total)))),
      h("h3", {}, "Prep files"),
      ...prepList(r.prep_files),
      h("h3", {}, "Latest gate results"),
      gates
        ? h(
            "div",
            {},
            h("p", { class: "meta" }, `${gates.name}, seat ${gates.position}`),
            h(
              "ul",
              { class: "gate-lines" },
              gates.gates.map((g) =>
                h(
                  "li",
                  { class: "pip", "data-state": g.pass ? "pass" : "fail" },
                  h("span", { class: "pip-dot" }, mark()),
                  h("span", {}, `${g.label}: ${g.pass ? "pass" : "fail"}`, g.reason ? h("span", { class: "gate-reason" }, ` ${g.reason}`) : null),
                ),
              ),
            ),
          )
        : emptyNote("No gates checked for this request yet."),
      h("p", {}, h("a", { href: `/requests/${r.id}` }, `Open ${r.ref} in full`)),
    );
    if (preferred === undefined) {
      void get<ConsumerPreferences>(`/api/consumers/${r.consumer.id}/preferences`).then((result) => {
        if (!result.ok) return;
        const names = result.data.preferred.map((id) => interpreters.find((i) => i.id === id)?.name ?? "").filter(Boolean);
        preferredNames.set(r.consumer.id, names);
        if (selected === r.id) renderDetail();
      });
    }
  };

  const select = (id: string, switchTab: boolean): void => {
    selected = id;
    for (const [cid, card] of cards) card.el.classList.toggle("selected", cid === id);
    renderDetail();
    if (switchTab && narrow.matches) showTab("detail", true);
  };

  // Holding a chip.
  const leaveCard = (): void => {
    const probe = hold?.probe;
    if (!probe) return;
    window.clearTimeout(probe.timer);
    probe.card.el.classList.remove("is-target");
    probe.card.pipsTo("unchecked");
    // A dry-run abandoned before its answer leaves no pending copy behind.
    if (probe.answer === "pending") say(gateStatus, "");
    if (hold) hold.probe = null;
    for (const wake of probe.waiters) wake();
  };

  const enterCard = (card: Card): void => {
    const current = hold;
    if (!current || current.probe?.card === card) return;
    leaveCard();
    const seat = targetSeat(card.request);
    if (!seat) return;
    const probe: Probe = { card, seat, answer: "pending", waiters: [], timer: 0 };
    current.probe = probe;
    card.el.classList.add("is-target");
    card.clearNote();
    card.pipsTo("pending");
    const ref = card.request.ref;
    say(gateStatus, `Checking gates for ${ref} seat ${seat.position}…`);
    const settle = (answer: Answer): void => {
      if (probe.answer !== "pending") return;
      probe.answer = answer;
      window.clearTimeout(probe.timer);
      for (const wake of probe.waiters) wake();
      probe.waiters = [];
    };
    const fail = (): void => {
      if (hold?.probe !== probe || probe.answer !== "pending") return;
      say(gateStatus, `Could not check gates for ${ref}. Nothing was offered.`);
      card.pipsTo("unchecked");
      settle("failed");
    };
    probe.timer = window.setTimeout(fail, DRY_RUN_TIMEOUT_MS);
    void call<DryRun>("POST", `/api/seats/${seat.id}/dry-run`, { interpreter_id: current.person.id }).then((result) => {
      if (hold?.probe !== probe || probe.answer !== "pending") return;
      if (result.ok) {
        card.pipsTo(result.data.gates);
        lastGates.set(card.request.id, { name: current.person.name, position: seat.position, gates: result.data.gates });
        say(gateStatus, gateSummary(ref, seat.position, result.data.gates));
        if (selected === card.request.id) renderDetail();
        settle({ gates: result.data.gates, allPass: result.data.all_pass });
      } else if (result.error.code === "seat_taken" && result.error.holder) {
        card.pipsTo("unchecked");
        say(gateStatus, `Seat taken by ${result.error.holder.name}.`);
        settle({ taken: result.error.holder });
      } else fail();
    });
  };

  const endHold = (focusChip: boolean): void => {
    const done = hold;
    if (!done) return;
    hold = null;
    window.clearTimeout(done.probe?.timer);
    done.probe?.card.el.classList.remove("is-target");
    done.chip.setAttribute("aria-pressed", "false");
    done.chip.classList.remove("is-held");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("wheel", blockScroll);
    if (focusChip) done.chip.focus();
    if (pending) {
      pending = null;
      applyBoard(latest);
    }
  };

  const pin = async (current: Hold, probe: Probe): Promise<void> => {
    const { card, seat } = probe;
    const ref = card.request.ref;
    const name = current.person.name;
    say(boardStatus, `Offering ${ref} seat ${seat.position} to ${name}…`);
    const result = await call<{ request: RequestView }>("POST", `/api/seats/${seat.id}/offers`, { interpreter_id: current.person.id });
    if (result.ok) {
      say(boardStatus, `Offered ${ref} seat ${seat.position} to ${name}.`);
      card.clearNote();
      card.update(result.data.request);
      current.thread?.pin(card.socketCenter(seat.position));
      select(card.request.id, false);
      return;
    }
    current.thread?.recoil();
    const error = result.error;
    let copy = "Not offered. The request can no longer take offers.";
    if (error.code === "gate_failed" && error.gates) {
      const failed = error.gates.find((g) => !g.pass);
      card.pipsTo(error.gates);
      copy = `Not offered. ${failed?.reason ?? ""}`;
      card.say(failed?.reason ?? copy, "gate");
    } else if (error.code === "seat_taken" && error.holder) {
      copy = `Seat taken by ${error.holder.name}.`;
      card.say(copy, "info");
    } else if (error.code === "offer_window_closed") {
      copy = "Too late to send an offer for this seat.";
      card.say(copy, "info");
    } else card.say(copy, "info");
    say(boardStatus, copy);
  };

  /** A release (pointer up or Enter): pin when all four gates pass, otherwise recoil with the reason. */
  const release = async (): Promise<void> => {
    const current = hold;
    if (!current) return;
    window.removeEventListener("pointermove", onMove);
    const probe = current.probe;
    if (!probe) {
      current.thread?.recoil();
      endHold(current.mode === "keyboard");
      return;
    }
    if (probe.answer === "pending") await new Promise<void>((resolve) => probe.waiters.push(resolve));
    if (hold !== current || current.probe !== probe) return;
    probe.card.settlePips();
    const answer = probe.answer;
    if (answer !== "pending" && answer !== "failed" && "gates" in answer && answer.allPass) {
      endHold(current.mode === "keyboard");
      await pin(current, probe);
      return;
    }
    current.thread?.recoil();
    if (answer !== "pending" && answer !== "failed") {
      if ("taken" in answer) probe.card.say(`Seat taken by ${answer.taken.name}.`, "info");
      else {
        const reason = answer.gates.find((g) => !g.pass)?.reason ?? "";
        probe.card.say(reason, "gate");
      }
    }
    endHold(current.mode === "keyboard");
  };

  const cardAt = (x: number, y: number): Card | undefined => {
    const el = document.elementFromPoint(x, y)?.closest("article.card");
    const id = el instanceof HTMLElement ? el.dataset.id : undefined;
    return id ? cards.get(id) : undefined;
  };

  const anchorOf = (chip: HTMLElement) => (): { x: number; y: number } => {
    const box = chip.getBoundingClientRect();
    return narrow.matches ? { x: box.left + box.width / 2, y: box.top } : { x: box.right, y: box.top + box.height / 2 };
  };

  function onMove(event: PointerEvent): void {
    if (!hold || event.pointerId !== hold.pointerId) return;
    hold.thread?.follow({ x: event.clientX, y: event.clientY });
    const card = cardAt(event.clientX, event.clientY);
    if (card) enterCard(card);
    else leaveCard();
  }
  function onUp(event: PointerEvent): void {
    if (!hold || event.pointerId !== hold.pointerId) return;
    window.removeEventListener("pointerup", onUp);
    const card = cardAt(event.clientX, event.clientY);
    if (!card || hold.probe?.card !== card) leaveCard();
    void release();
  }
  function onCancel(event: PointerEvent): void {
    if (!hold || event.pointerId !== hold.pointerId) return;
    leaveCard();
    void release();
  }
  function blockScroll(event: WheelEvent): void {
    event.preventDefault();
  }

  const resetPips = (): void => {
    for (const card of cards.values()) card.pipsTo("unchecked");
  };

  const pickUp = (person: BoardInterpreter, chip: HTMLButtonElement, mode: Hold["mode"], event?: PointerEvent): void => {
    if (hold) endHold(false);
    resetPips();
    hold = { person, chip, mode, thread: null, probe: null, pointerId: event?.pointerId ?? -1 };
    chip.classList.add("is-held");
    if (mode === "keyboard") {
      chip.setAttribute("aria-pressed", "true");
      const first = timetable.querySelector<HTMLElement>("article.card");
      if (narrow.matches) showTab("requests", false);
      first?.focus();
      return;
    }
    if (event) {
      hold.thread = new Thread(anchorOf(chip), { x: event.clientX, y: event.clientY });
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("wheel", blockScroll, { passive: false });
    }
  };

  const renderChips = (): void => {
    replace(
      chips,
      interpreters.map((person) => {
        const codesId = uid("codes");
        const chip = h(
          "button",
          { type: "button", class: "chip", "aria-pressed": "false", "aria-describedby": codesId },
          h("span", { class: "chip-name" }, person.name),
          h(
            "span",
            { class: "chip-codes fig", id: codesId, "aria-hidden": "true" },
            person.credentials.map((c) =>
              c.expired ? h("s", { class: "code expired" }, c.type, h("span", { class: "visually-hidden" }, " expired")) : h("span", { class: "code" }, c.type),
            ),
          ),
        );
        chip.addEventListener("pointerdown", (event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          event.preventDefault();
          pickUp(person, chip, "pointer", event);
        });
        chip.addEventListener("click", (event) => {
          if (event.detail !== 0) return;
          if (hold?.mode === "keyboard" && hold.chip === chip) endHold(true);
          else pickUp(person, chip, "keyboard");
        });
        return h("li", {}, chip);
      }),
    );
  };

  // Keyboard matching and card selection.
  const cardList = (): HTMLElement[] => [...timetable.querySelectorAll<HTMLElement>("article.card")];
  timetable.addEventListener("focusin", (event) => {
    const card = event.target instanceof HTMLElement && event.target.matches("article.card") ? cards.get(event.target.dataset.id ?? "") : undefined;
    if (card && hold?.mode === "keyboard") enterCard(card);
  });
  timetable.addEventListener("keydown", (event) => {
    const el = event.target instanceof HTMLElement && event.target.matches("article.card") ? event.target : null;
    if (!el) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const list = cardList();
      const next = list[list.indexOf(el) + (event.key === "ArrowDown" ? 1 : -1)];
      next?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (hold?.mode === "keyboard") void release();
      else select(el.dataset.id ?? "", true);
    }
  });
  timetable.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>("article.card") : null;
    if (el && !hold) select(el.dataset.id ?? "", true);
  });
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && hold?.mode === "keyboard") {
      leaveCard();
      endHold(true);
    }
  };
  document.addEventListener("keydown", onEscape);
  onLeave(() => document.removeEventListener("keydown", onEscape));
  main.addEventListener("focusout", () => {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (hold?.mode === "keyboard" && !(active instanceof HTMLElement && active.matches("article.card"))) leaveCard();
    });
  });

  // Data: first load and the refresh every five seconds.
  let latest: Board | null = null;
  let pending: Board | null = null;

  function applyBoard(board: Board | null): void {
    if (!board) return;
    if (!interpreters.length || JSON.stringify(board.interpreters) !== JSON.stringify(interpreters)) {
      if (hold) pending = board;
      else {
        interpreters = board.interpreters;
        renderChips();
      }
    }
    for (const r of board.requests) cards.get(r.id)?.update(r);
    const signature = board.requests.map((r) => r.id).join(",");
    if (signature === order) {
      if (selected && board.requests.some((r) => r.id === selected)) renderDetail();
      return;
    }
    if (hold) {
      pending = board;
      return;
    }
    order = signature;
    const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.id : undefined;
    const keep = new Set(board.requests.map((r) => r.id));
    for (const id of [...cards.keys()]) if (!keep.has(id)) cards.delete(id);
    const days = new Map<string, RequestView[]>();
    for (const r of board.requests) {
      const day = agencyDate(new Date(r.start));
      days.set(day, [...(days.get(day) ?? []), r]);
    }
    const groups = [...days.values()].map((list) => {
      const els = list.map((r) => {
        let card = cards.get(r.id);
        if (!card) {
          card = new Card(r);
          cards.set(r.id, card);
        }
        card.el.classList.toggle("selected", r.id === selected);
        return card.el;
      });
      return h("section", { class: "day" }, h("h2", { class: "day-heading" }, dayHeading(new Date(list[0]?.start ?? ""))), h("div", { class: "day-cards" }, els));
    });
    replace(timetable, groups.length ? groups : [emptyNote("No requests start in the next 72 hours.")]);
    if (focusedId) cards.get(focusedId)?.el.focus();
    if (firstLoad && !prefersReducedMotion()) {
      groups.forEach((group, i) =>
        group.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: i * 70, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" }),
      );
    }
    firstLoad = false;
    if (selected && !cards.has(selected)) selected = null;
    renderDetail();
  }

  const refresh = async (): Promise<void> => {
    const result = await get<Board>("/api/board");
    if (!result.ok) {
      if (firstLoad) say(boardStatus, "The board could not be loaded. It will try again in a few seconds.");
      return;
    }
    latest = result.data;
    applyBoard(latest);
  };
  await refresh();
  const timer = window.setInterval(() => void refresh(), REFRESH_MS);
  onLeave(() => {
    window.clearInterval(timer);
    hold?.thread?.remove();
    endHold(false);
  });
}
