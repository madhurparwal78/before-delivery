// The Plan page: floor plan with the scene legend, the 24-hour scrubber, the 'At this time' list,
// the room list and the room inspector. Owners at the scrubbed time come from GET /api/plan.

import { addDays, longDate, parseDate, shortWeekday } from "../shared/zone.ts";
import type { DayPlan, OwnerSource } from "../shared/types.ts";
import { load } from "./api.ts";
import { h, num, phone, pulse, reducedMotion, setNum, setText, uid } from "./dom.ts";
import { icon } from "./icons.ts";
import { clockOf, live } from "./live.ts";
import { drawFloorPlan, type RoomShape } from "./floorplan.ts";
import { DeviceSheet, deviceList } from "./devices.ts";
import { Sheet } from "./sheets.ts";
import type { Shell } from "./shell.ts";

const MINUTE = 60_000;
const KEY_STEP = 15;
const PAGE_STEP = 60;
const DRAG_SNAP = 5;
const STAGGER_MS = 40;
const FILL_MS = 240;

interface PlanOwnerNow {
  scene_id: string | null;
  since: string | null;
  source: OwnerSource;
  guest_scene_id: string | null;
}

type Wall = { hour: number; minute: number } | "end";

/** Owners at an instant: the day's start owners with every change at or before it applied. */
function ownersAt(plan: DayPlan, instant: number): Map<string, PlanOwnerNow> {
  const owners = new Map<string, PlanOwnerNow>(plan.start_owners.map((owner) => [owner.room_id, { ...owner }]));
  for (const change of plan.changes) {
    if (Date.parse(change.at) > instant) break;
    for (const roomId of change.room_ids) {
      owners.set(roomId, {
        scene_id: change.scene_id,
        since: change.at,
        source: change.source === "guest" ? "guest" : change.scene_id === null ? "none" : "schedule",
        guest_scene_id: change.source === "guest" ? change.guest_scene_id : null,
      });
    }
  }
  return owners;
}

/** `<since>`: HH:MM on the given day, else "Ddd HH:MM"; plus the zone name inside a repeated hour. */
function sinceText(iso: string, day: string): string {
  const instant = Date.parse(iso);
  const prefix = iso.slice(0, 10) === day ? "" : `${shortWeekday(iso.slice(0, 10))} `;
  const suffix = live.zone.inRepeatedHour(instant) ? ` ${live.zone.abbr(instant)}` : "";
  return `${prefix}${clockOf(iso)}${suffix}`;
}

function guestUntil(guestId: string | null): string | null {
  const guest = guestId ? live.guests.get(guestId) : undefined;
  return guest ? clockOf(guest.ends_at) : null;
}

function sceneFill(sceneId: string | null): string {
  const tint = live.scene(sceneId)?.tint;
  return tint ? `var(--fill-${tint})` : "transparent";
}

export async function planPage(shell: Shell): Promise<void> {
  const { main, planTime } = shell;
  const zone = live.zone;
  const small = window.matchMedia("(max-width: 1023.98px)");

  // ---- address: the server has already written it in full (/plan?day=…&at=HH:MM±HH:MM) ----------
  const params = new URLSearchParams(location.search.replace(/\+/g, "%2B"));
  const asked = /^(\d{2}):(\d{2})([+-]\d{2}:\d{2})$/.exec(params.get("at") ?? "");
  const askedDay = parseDate(params.get("day"));

  let plan = await load<DayPlan>(`/api/plan?day=${askedDay ?? live.status.day}`);
  let start = Date.parse(plan.start);
  let end = Date.parse(plan.end);
  let max = Math.round((end - start) / MINUTE);
  let value = 0;

  const instantOf = (minutes: number): number => start + minutes * MINUTE;
  const wallOf = (minutes: number): string => (minutes >= max ? "24:00" : zone.clock(instantOf(minutes)));
  const clamp = (minutes: number): number => Math.max(0, Math.min(max, minutes));

  /** The scrubber value for a wall time on the current plan day. */
  function valueForWall(wall: Wall, offset: string | null): number {
    if (wall === "end") return max;
    return clamp(Math.round((zone.addressInstant(plan.day, wall.hour, wall.minute, offset) - start) / MINUTE));
  }
  const currentWall = (): Wall => {
    if (value >= max) return "end";
    const wall = zone.wall(instantOf(value));
    return { hour: wall.hour, minute: wall.minute };
  };
  const nowValue = (): number => clamp(Math.floor((Date.parse(live.status.now) - start) / MINUTE));

  value = askedDay && asked
    ? valueForWall(asked[1] === "24" ? "end" : { hour: Number(asked[1]), minute: Number(asked[2]) }, asked[3] ?? null)
    : nowValue();

  function writeAddress(): void {
    const offset = zone.offsetText(instantOf(value));
    history.replaceState(null, "", `/plan?day=${plan.day}&at=${wallOf(value)}${offset}`);
  }

  // ---- floor plan and legend -----------------------------------------------------------------
  let selected = plan.rooms[0]?.room_id ?? "";
  const { svg, shapes } = drawFloorPlan(plan.rooms, (roomId) => pickRoom(roomId, null));
  const legendList = h("ul", { class: "legend", "aria-label": "Scene legend" });
  const legendScroll = h("div", { class: "legend-scroll" }, legendList);
  const floor = h("section", { class: "floor", "aria-label": "Floor plan" }, h("div", { class: "drawing" }, svg), legendScroll);

  // ---- scrubber ------------------------------------------------------------------------------
  const dayLine = h("p", { class: "day-line" });
  const dayInputId = uid("plan-day");
  const dayInput = h("input", {
    id: dayInputId, class: "input input-date", type: "text", inputmode: "numeric", autocomplete: "off",
    spellcheck: "false", "aria-label": "Plan day", placeholder: "YYYY-MM-DD",
  });
  const previous = h("button", { type: "button", class: "btn" }, icon("chevron-left"), h("span", {}, "Previous day"));
  const next = h("button", { type: "button", class: "btn" }, h("span", {}, "Next day"), icon("chevron-right"));
  const jump = h("button", { type: "button", class: "btn" }, icon("locate-fixed"), h("span", {}, "Jump to now"));
  const thumb = h("span", { class: "thumb", "aria-hidden": "true" });
  const ticks = h("span", { class: "ticks", "aria-hidden": "true" });
  const slider = h("div", {
    class: "slider", role: "slider", tabindex: 0, "aria-label": "Time of day", "aria-valuemin": 0,
  }, h("span", { class: "track", "aria-hidden": "true" }), ticks, thumb);
  const nowMarker = h("div", { class: "now-marker", hidden: true }, h("span", { class: "now-label" }));
  const hourLabels = h("div", { class: "hour-labels", "aria-hidden": "true" });
  const scrub = h(
    "section", { class: "scrub", "aria-label": "Day and time" },
    dayLine,
    h("div", { class: "day-controls" }, previous, dayInput, next, jump),
    h("div", { class: "track-wrap" }, h("div", { class: "track-inner" }, nowMarker, slider, hourLabels)),
  );

  // ---- lists ---------------------------------------------------------------------------------
  const atList = h("ul", { class: "at-list", "aria-label": "At this time" });
  const roomList = h("ul", { class: "room-list", "aria-label": "Rooms" });
  const roomButtons = new Map<string, { button: HTMLButtonElement; now: HTMLElement; guest: HTMLElement }>();
  for (const room of plan.rooms) {
    const now = h("span", { class: "room-now" });
    const guest = h("span", { class: "room-guest", hidden: true });
    const button = h("button", { type: "button", class: "room-btn" }, h("span", { class: "room-btn-name" }, room.name), now, guest);
    button.addEventListener("click", () => pickRoom(room.room_id, button));
    roomButtons.set(room.room_id, { button, now, guest });
    roomList.append(h("li", {}, button));
  }

  main.append(
    h("h1", { class: "visually-hidden" }, "Plan"),
    h("div", { class: "plan-layout" },
      floor, scrub,
      h("div", { class: "plan-lists" },
        h("section", { class: "panel" }, h("h2", { class: "panel-title" }, "At this time"), atList),
        h("section", { class: "panel" }, h("h2", { class: "panel-title" }, "Rooms"), roomList))),
  );

  // ---- inspector -----------------------------------------------------------------------------
  const inspectorTitle = h("h2", { class: "inspector-title" });
  const inspectorNow = h("p", { class: "inspector-now" });
  const inspectorAlert = h("p", { class: "inline-alert", role: "alert", hidden: true });
  const devicesHolder = h("div", { class: "devices-holder" });
  const planLabel = h("p", { class: "panel-title" });
  const planForRoom = h("ul", { class: "room-plan" });
  const closeInspector = h("button", { type: "button", class: "btn btn-quiet inspector-close" }, "Close");
  const inspectorElement = h("div", { class: "inspector", id: "inspector" },
    h("div", { class: "sheet-head" }, inspectorTitle, closeInspector),
    h("div", { class: "sheet-body" }, inspectorNow, inspectorAlert,
      h("h3", { class: "panel-title" }, "Devices"), devicesHolder, planLabel, planForRoom));
  document.body.append(inspectorElement);
  const inspector = new Sheet({ element: inspectorElement, label: "Room inspector", onlyWhen: small, pageRole: "complementary" });
  closeInspector.addEventListener("click", () => inspector.close());
  const deviceSheet = new DeviceSheet();
  let disposeDevices: (() => void) | null = null;

  function renderInspectorRoom(): void {
    const room = plan.rooms.find((candidate) => candidate.room_id === selected);
    if (!room) return;
    setText(inspectorTitle, room.name);
    planLabel.textContent = `Plan for ${room.name}`;
    planForRoom.setAttribute("aria-label", `Plan for ${room.name}`);
    inspectorAlert.hidden = true;
    inspectorAlert.textContent = "";
    disposeDevices?.();
    const list = deviceList(room.room_id, inspectorAlert, (device, opener) => deviceSheet.open(device, opener));
    disposeDevices = list.dispose;
    devicesHolder.replaceChildren(list.element);
    for (const [roomId, shape] of shapes) shape.group.classList.toggle("is-selected", roomId === selected);
    renderInspectorNow();
    renderRoomPlan();
  }

  function renderInspectorNow(): void {
    const room = live.status.rooms.find((candidate) => candidate.room_id === selected);
    if (!room) return;
    const text = room.scene_id === null || room.since === null
      ? `Now: ${room.scene_name ?? "Unplanned"}`
      : `Now: ${room.scene_name} since ${sinceText(room.since, plan.day)}`;
    const until = room.source === "guest" ? guestUntil(room.guest_scene_id) : null;
    setNum(inspectorNow, until ? `${text} · Guest until ${until}` : text);
  }

  function renderRoomPlan(): void {
    const items = plan.changes
      .filter((change) => change.room_ids.includes(selected))
      .map((change) => h("li", {}, num(`${clockOf(change.at)} `), live.sceneName(change.scene_id)));
    planForRoom.replaceChildren(...(items.length ? items : [h("li", { class: "muted" }, "No changes on this day.")]));
  }

  function pickRoom(roomId: string, opener: HTMLButtonElement | null): void {
    selected = roomId;
    renderInspectorRoom();
    if (inspector.modal) inspector.open(opener ?? roomButtons.get(roomId)?.button ?? null);
  }

  // ---- live room list ------------------------------------------------------------------------
  const liveScene = new Map<string, string | null>();
  function renderRoomList(): void {
    for (const room of live.status.rooms) {
      const parts = roomButtons.get(room.room_id);
      if (!parts) continue;
      setText(parts.now, `Now: ${room.scene_name ?? "Unplanned"}`);
      const until = room.source === "guest" ? guestUntil(room.guest_scene_id) : null;
      parts.guest.hidden = until === null;
      if (until) setNum(parts.guest, `Guest until ${until}`);
      if (liveScene.has(room.room_id) && liveScene.get(room.room_id) !== room.scene_id) pulse(parts.button);
      liveScene.set(room.room_id, room.scene_id);
    }
  }

  // ---- shown state and the sweep -------------------------------------------------------------
  const shown = new Map<string, { scene: string | null; counted: string | null }>();
  let timers: number[] = [];

  function paintRoom(roomId: string, shape: RoomShape, instant: boolean): void {
    const room = plan.rooms.find((candidate) => candidate.room_id === roomId);
    const scene = shown.get(roomId)?.scene ?? null;
    const name = live.sceneName(scene);
    shape.group.setAttribute("aria-label", `${room?.name ?? roomId}: ${name}`);
    shape.group.classList.toggle("is-lit", scene !== null);
    setText(shape.scene, name);
    if (instant) shape.fill.style.transition = "none";
    shape.fill.style.fill = sceneFill(scene);
    if (instant) {
      void shape.fill.getBoundingClientRect();
      shape.fill.style.transition = "";
    }
  }

  function renderLegend(): void {
    const counts = new Map<string, number>();
    for (const room of shown.values()) if (room.counted) counts.set(room.counted, (counts.get(room.counted) ?? 0) + 1);
    const existing = new Map([...legendList.children].map((item) => [(item as HTMLElement).dataset.scene ?? "", item as HTMLElement]));
    const items = live.scenes.map((scene) => {
      const item = existing.get(scene.id) ?? h("li", { "data-scene": scene.id },
        h("span", { class: "swatch", "aria-hidden": "true" }), h("span", { class: "legend-name" }), h("span", { class: "legend-count num" }));
      (item.children[0] as HTMLElement).style.background = `var(--tint-${scene.tint})`;
      setText(item.children[1] as HTMLElement, scene.name);
      setText(item.children[2] as HTMLElement, String(counts.get(scene.id) ?? 0));
      return item;
    });
    legendList.replaceChildren(...items);
    const scrolls = legendScroll.scrollWidth > legendScroll.clientWidth + 1;
    if (scrolls) {
      legendScroll.setAttribute("tabindex", "0");
      legendScroll.setAttribute("role", "group");
      legendScroll.setAttribute("aria-label", "Scene legend, scrolls sideways");
    } else {
      legendScroll.removeAttribute("tabindex");
      legendScroll.removeAttribute("role");
      legendScroll.removeAttribute("aria-label");
    }
  }

  function planTimeCopy(owners: Map<string, PlanOwnerNow>): string {
    const instant = instantOf(value);
    const label = `${wallOf(value)}${zone.inRepeatedHour(instant) ? ` ${zone.abbr(instant)}` : ""}`;
    const counts = new Map<string, number>();
    let unplanned = 0;
    for (const room of plan.rooms) {
      const scene = owners.get(room.room_id)?.scene_id ?? null;
      if (scene === null) unplanned += 1;
      else counts.set(scene, (counts.get(scene) ?? 0) + 1);
    }
    const rooms = (n: number) => `${n} room${n === 1 ? "" : "s"}`;
    const parts = live.scenes.filter((scene) => counts.get(scene.id)).map((scene) => `${rooms(counts.get(scene.id) as number)} in ${scene.name}`);
    if (unplanned) parts.push(`${rooms(unplanned)} unplanned`);
    return `At ${label}, ${parts.join(", ")}`;
  }

  function renderAtList(owners: Map<string, PlanOwnerNow>): void {
    const items = plan.rooms.map((room) => {
      const owner = owners.get(room.room_id);
      if (!owner || owner.scene_id === null) return h("li", {}, `${room.name} · Unplanned`);
      const scene = live.sceneName(owner.scene_id);
      const until = owner.source === "guest" ? guestUntil(owner.guest_scene_id) : null;
      const tail = until ? `guest until ${until}` : owner.since ? `since ${sinceText(owner.since, plan.day)}` : "";
      return h("li", {}, h("span", { class: "swatch", "aria-hidden": "true", "data-tint": live.scene(owner.scene_id)?.tint ?? "" }),
        h("span", {}, num(`${room.name} · ${scene} · ${tail}`)));
    });
    atList.replaceChildren(...items);
    for (const swatch of atList.querySelectorAll<HTMLElement>(".swatch[data-tint]")) {
      if (swatch.dataset.tint) swatch.style.background = `var(--tint-${swatch.dataset.tint})`;
    }
  }

  function renderSlider(): void {
    const instant = instantOf(value);
    slider.setAttribute("aria-valuemax", String(max));
    slider.setAttribute("aria-valuenow", String(value));
    slider.setAttribute("aria-valuetext", `${wallOf(value)} ${zone.abbr(instant)}`);
    thumb.style.left = `${(value / max) * 100}%`;
  }

  function renderNowMarker(): void {
    const today = live.status.day === plan.day;
    nowMarker.hidden = !today;
    jump.classList.toggle("is-today", today);
    if (!today) return;
    const now = Date.parse(live.status.now);
    const share = Math.max(0, Math.min(1, (now - start) / (end - start)));
    nowMarker.style.left = `${share * 100}%`;
    const label = nowMarker.firstElementChild as HTMLElement;
    label.style.transform = share < 0.06 ? "none" : share > 0.94 ? "translateX(-100%)" : "translateX(-50%)";
    setNum(label, `Now ${clockOf(live.status.now)}`);
  }

  function renderDay(): void {
    setNum(dayLine, `${longDate(plan.day)}${plan.hours === 24 ? "" : ` · ${plan.hours} hours`}`);
    dayInput.value = plan.day;
    const labelCount = new Map<string, number>();
    for (const mark of plan.hour_marks) labelCount.set(mark.label, (labelCount.get(mark.label) ?? 0) + 1);
    ticks.replaceChildren();
    hourLabels.replaceChildren();
    plan.hour_marks.forEach((mark, index) => {
      const left = `${((Date.parse(mark.at) - start) / (end - start)) * 100}%`;
      const tick = h("span", { class: "tick" });
      tick.style.left = left;
      ticks.append(tick);
      const repeated = (labelCount.get(mark.label) ?? 0) > 1;
      const label = h("span", { class: `hour${index % 2 ? " is-odd" : ""}` },
        h("span", { class: "num" }, mark.label), repeated ? " " : null, repeated ? h("small", { class: "hour-abbr" }, mark.abbr) : null);
      label.style.left = left;
      hourLabels.append(label);
    });
    renderNowMarker();
  }

  /** Every scrubber change: lists and announcement at once; fills sweep in plan order. */
  function showTime(sweep: boolean): void {
    const owners = ownersAt(plan, instantOf(value));
    renderSlider();
    renderAtList(owners);
    planTime.textContent = planTimeCopy(owners);
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
    const changed = plan.rooms.filter((room) => {
      const target = owners.get(room.room_id)?.scene_id ?? null;
      const now = shown.get(room.room_id);
      return !now || now.scene !== target || now.counted !== target;
    });
    if (!sweep || reducedMotion.matches) {
      for (const room of changed) {
        const target = owners.get(room.room_id)?.scene_id ?? null;
        shown.set(room.room_id, { scene: target, counted: target });
        const shape = shapes.get(room.room_id);
        if (shape) paintRoom(room.room_id, shape, true);
      }
      renderLegend();
      return;
    }
    changed.forEach((room, index) => {
      const target = owners.get(room.room_id)?.scene_id ?? null;
      const shape = shapes.get(room.room_id);
      const begin = () => {
        const current = shown.get(room.room_id) ?? { scene: null, counted: null };
        shown.set(room.room_id, { scene: target, counted: current.counted });
        if (shape) paintRoom(room.room_id, shape, false);
      };
      const land = () => {
        shown.set(room.room_id, { scene: target, counted: target });
        renderLegend();
      };
      if (index === 0) begin();
      else timers.push(window.setTimeout(begin, index * STAGGER_MS));
      timers.push(window.setTimeout(land, index * STAGGER_MS + FILL_MS));
    });
  }

  function setValue(minutes: number): void {
    const next = clamp(minutes);
    if (next === value) return;
    value = next;
    showTime(true);
  }

  // ---- day changes ---------------------------------------------------------------------------
  let request = 0;
  async function showDay(day: string, wall: Wall | "now"): Promise<void> {
    const ticket = (request += 1);
    const fetched = await load<DayPlan>(`/api/plan?day=${day}`);
    if (ticket !== request) return;
    plan = fetched;
    start = Date.parse(plan.start);
    end = Date.parse(plan.end);
    max = Math.round((end - start) / MINUTE);
    value = wall === "now" ? nowValue() : valueForWall(wall, null);
    renderDay();
    renderRoomPlan();
    renderInspectorNow();
    showTime(true);
    writeAddress();
  }

  /** Re-reads the current day's plan (a schedule or guest scene changed) without moving the scrubber. */
  async function refreshPlan(): Promise<void> {
    const ticket = (request += 1);
    const fetched = await load<DayPlan>(`/api/plan?day=${plan.day}`);
    if (ticket !== request) return;
    plan = fetched;
    renderRoomPlan();
    showTime(true);
  }

  previous.addEventListener("click", () => void showDay(addDays(plan.day, -1), currentWall()));
  next.addEventListener("click", () => void showDay(addDays(plan.day, 1), currentWall()));
  jump.addEventListener("click", () => void showDay(live.status.day, "now"));
  const typedDay = () => {
    const day = parseDate(dayInput.value.trim());
    if (day && day !== plan.day) void showDay(day, currentWall());
    else if (!day) dayInput.value = plan.day;
  };
  dayInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      typedDay();
    }
  });
  dayInput.addEventListener("change", typedDay);

  // ---- scrubber input ------------------------------------------------------------------------
  slider.addEventListener("keydown", (event) => {
    const steps: Record<string, number> = {
      ArrowRight: value + KEY_STEP, ArrowUp: value + KEY_STEP, ArrowLeft: value - KEY_STEP, ArrowDown: value - KEY_STEP,
      PageUp: value + PAGE_STEP, PageDown: value - PAGE_STEP, Home: 0, End: max,
    };
    const target = steps[event.key];
    if (target === undefined) return;
    event.preventDefault();
    setValue(target);
    writeAddress();
  });
  let dragging: number | null = null;
  const moveTo = (clientX: number) => {
    const box = slider.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    setValue(Math.round((ratio * max) / DRAG_SNAP) * DRAG_SNAP);
  };
  slider.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    dragging = event.pointerId;
    slider.setPointerCapture(event.pointerId);
    slider.focus({ preventScroll: true });
    moveTo(event.clientX);
  });
  slider.addEventListener("pointermove", (event) => {
    if (dragging === event.pointerId) moveTo(event.clientX);
  });
  const release = (event: PointerEvent) => {
    if (dragging !== event.pointerId) return;
    dragging = null;
    writeAddress();
  };
  slider.addEventListener("pointerup", release);
  slider.addEventListener("pointercancel", release);

  // ---- live updates --------------------------------------------------------------------------
  live.on("status", () => {
    renderNowMarker();
    renderRoomList();
    renderInspectorNow();
  });
  live.on("guest_scene", () => void refreshPlan().then(() => {
    renderRoomList();
    renderInspectorNow();
  }));
  live.on("schedule", () => void refreshPlan());
  live.on("scene", () => {
    for (const [roomId, shape] of shapes) paintRoom(roomId, shape, true);
    showTime(false);
    renderRoomPlan();
    renderRoomList();
    renderInspectorNow();
  });
  live.onReconnect(() => void refreshPlan());
  phone.addEventListener("change", renderLegend);
  window.addEventListener("resize", renderLegend);

  renderDay();
  renderRoomList();
  renderInspectorRoom();
  showTime(false);
  writeAddress();
}
