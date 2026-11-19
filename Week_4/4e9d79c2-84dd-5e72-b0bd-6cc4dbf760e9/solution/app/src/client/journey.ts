// The quote form and the desk's enquiry form: journey types, stops, the repeated hour, the Journey ticket and its flights.
import { $, $$, announce, call, clearBusy, EASE, isBusy, reducedMotion, safely, setBusy } from "./core.js";
import { closeDialog, isOpen, openDialog } from "./dialogs.js";
import { clearProblems, refusal, registerBuilder, showProblems } from "./forms.js";
import { closeList } from "./address.js";
import { COPY, isEmail, isUkTelephone, JOURNEY_LABELS, OCCASION_LABELS, peopleCount, pickupRefusal, readerLength, returnRefusal } from "../shared/rules.js";
import { addDays, dateToTyped, isRepeatedHour, longDate, longDateTime, typedToDate, weekdayIndex, type LocalDateTime } from "../shared/time.js";

interface Clock { date: string; time: string; instant: string }
let clockRead: Clock | null = null;
const readClock = async (): Promise<Clock | null> => {
  const reply = await safely(() => call("GET", "/api/public/clock"));
  if (reply.ok) clockRead = reply.json;
  return clockRead;
};
const nowOf = (clock: Clock): number => Date.parse(clock.instant) / 1000;

const STOP_LIMIT = 5;
const fieldOf = (root: ParentNode, name: string): HTMLInputElement | null => $<HTMLInputElement>(`[name="${name}"]`, root);
const valueOf = (root: ParentNode, name: string): string => fieldOf(root, name)?.value ?? "";
const radioValue = (root: ParentNode, name: string): string => $<HTMLInputElement>(`input[name="${name}"]:checked`, root)?.value ?? "";
const journeyType = (root: ParentNode): string => radioValue(root, "journeyType") || "oneWay";
const showsReturn = (root: ParentNode): boolean => ["return", "sameDayReturn"].includes(journeyType(root));
const stopInputs = (root: ParentNode): HTMLInputElement[] => $$<HTMLInputElement>("[data-stops] input", root);

const localOf = (root: ParentNode, key: string): (Partial<LocalDateTime> & { typed: string; hour: string; minutes: string }) => {
  const typed = valueOf(root, `${key}.date`);
  const hour = valueOf(root, `${key}.hour`);
  const minutes = valueOf(root, `${key}.minutes`);
  const date = typedToDate(typed);
  const repeated = radioValue(root, `${key}.repeatedHour`);
  return {
    typed, hour, minutes,
    ...(date ? { date } : {}),
    ...(hour && minutes ? { time: `${hour}:${minutes}` } : {}),
    ...(repeated ? { repeatedHour: repeated as LocalDateTime["repeatedHour"] } : {}),
  };
};

// ---- Reshaping: journey type, stops, the repeated hour and today's hours.
const syncWhich = (root: ParentNode, key: string): void => {
  const slot = $(`[data-which="${key}"]`, root);
  if (!slot) return;
  const at = localOf(root, key);
  const repeated = at.date && at.time && isRepeatedHour(at.date, at.time);
  if (!repeated) {
    slot.hidden = true;
    slot.replaceChildren();
    return;
  }
  if (slot.dataset.time === at.time && slot.children.length) { slot.hidden = false; return; }
  slot.dataset.time = at.time;
  slot.hidden = false;
  const label = `Which ${at.time}?`;
  const name = `${key}.repeatedHour`;
  const id = `which-${key}`;
  slot.innerHTML = `<div class="radio-block"><span class="group-label" id="${id}">${label}</span><div class="segments segments-plain" role="radiogroup" aria-labelledby="${id}" data-field="${key}Which">
    <label class="segment"><input type="radio" name="${name}" value="first"><span>First ${at.time} (BST)</span></label>
    <label class="segment"><input type="radio" name="${name}" value="second"><span>Second ${at.time} (GMT)</span></label></div></div>`;
};
const syncHours = (root: ParentNode): void => {
  const select = fieldOf(root, "departAt.hour") as unknown as HTMLSelectElement | null;
  const line = $("[data-no-hours]", root);
  if (!select || !clockRead) return;
  const isToday = typedToDate(valueOf(root, "departAt.date")) === clockRead.date;
  const from = isToday ? Number(clockRead.time.slice(0, 2)) : 0;
  const chosen = select.value;
  const wanted = Array.from({ length: 24 - from }, (_, i) => String(from + i).padStart(2, "0"));
  const have = [...select.options].map((o) => o.value).filter(Boolean);
  if (have.join() !== wanted.join()) {
    for (const option of [...select.options]) if (option.value) option.remove();
    for (const hour of wanted) select.add(new Option(hour, hour));
    select.value = wanted.includes(chosen) ? chosen : "";
  }
  if (line) line.hidden = !(isToday && from === 23 && clockRead.time.slice(3) > "30");
};
const syncShortcuts = (root: ParentNode): void => {
  if (!clockRead) return;
  const date = typedToDate(valueOf(root, "departAt.date"));
  for (const button of $$("[data-shortcut]", root)) {
    button.setAttribute("aria-pressed", String(date === addDays((clockRead as Clock).date, Number(button.dataset.shortcut))));
  }
};
const reshape = (root: ParentNode): void => {
  const type = journeyType(root);
  const details = $(".details-field", root);
  if (details) details.hidden = type !== "severalStops";
  const back = $("[data-return]", root);
  if (back) back.hidden = !showsReturn(root);
  const returnDate = fieldOf(root, "returnAt.date");
  if (returnDate) {
    returnDate.readOnly = type === "sameDayReturn";
    if (type === "sameDayReturn") returnDate.value = valueOf(root, "departAt.date");
  }
  syncWhich(root, "departAt");
  syncWhich(root, "returnAt");
  syncHours(root);
  syncShortcuts(root);
  const add = $("[data-add-stop]", root);
  if (add) {
    if (stopInputs(root).length >= STOP_LIMIT) add.setAttribute("aria-disabled", "true");
    else add.removeAttribute("aria-disabled");
  }
};

const stopHtml = (index: number): string => `<div class="stop-entry"><div class="field field-combo"><label for="stop-${index}-${Date.now() % 100000}">Stop ${index}</label><div class="field-line"><svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.800 7 11 7 11z"/></svg><input id="stop-${index}-${Date.now() % 100000}" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="street-address" data-address data-checked="false" data-stop-field></div></div><button type="button" class="btn btn-field" data-remove-stop>Remove stop</button></div>`;
const addStop = (root: ParentNode, text = "", checked = false): HTMLInputElement => {
  const holder = $("[data-stops]", root) as HTMLElement;
  holder.insertAdjacentHTML("beforeend", stopHtml(holder.children.length + 1));
  const input = (holder.lastElementChild as HTMLElement).querySelector("input") as HTMLInputElement;
  input.value = text;
  input.dataset.checked = String(checked);
  return input;
};
const renumberStops = (root: ParentNode): void => {
  $$(".stop-entry", root).forEach((entry, i) => {
    const label = $("label", entry);
    if (label) label.textContent = `Stop ${i + 1}`;
  });
};

// ---- The body both enquiry routes take.
const enquiryBody = (root: ParentNode): Record<string, unknown> => {
  const type = journeyType(root);
  const localBody = (key: string): LocalDateTime | null => {
    const at = localOf(root, key);
    return { date: at.date ?? at.typed, time: at.time ?? "", ...(at.repeatedHour ? { repeatedHour: at.repeatedHour } : {}) };
  };
  const stopOf = (input: HTMLInputElement): { text: string; checked: boolean } => ({ text: input.value, checked: input.dataset.checked === "true" });
  const number = (name: string): number | null => (valueOf(root, name) === "" ? null : Number(valueOf(root, name)));
  return {
    occasion: radioValue(root, "occasion"), journeyType: type,
    stops: [fieldOf(root, "from"), ...stopInputs(root), fieldOf(root, "to")].map((i) => stopOf(i as HTMLInputElement)),
    departAt: localBody("departAt"), returnAt: showsReturn(root) ? localBody("returnAt") : null,
    party: { people: number("people"), large: number("large") ?? 0, medium: number("medium") ?? 0, hand: number("hand") ?? 0, wheelchairs: number("wheelchairs") ?? 0 },
    details: type === "severalStops" ? valueOf(root, "details") : null,
    name: valueOf(root, "name"), email: valueOf(root, "email"), telephone: valueOf(root, "telephone"), language: valueOf(root, "language") || "en",
    website: valueOf(root, "website"),
  };
};

// ---- Public form: steps, draft and ticket.
const STEPS = ["route", "when", "details", "thanks"];
const TITLES: Record<string, string> = { route: "Route", when: "When and who", details: "Your details", thanks: "Thank you" };
const DRAFT_KEY = "wayticket-quote-draft";
const NOT_GIVEN = "Not yet given";
const touched = new Set<string>();

const checkRoute = (root: ParentNode): Record<string, string> => {
  const fields: Record<string, string> = {};
  if (!radioValue(root, "occasion")) fields.occasion = COPY.occasion;
  if (!valueOf(root, "from").trim()) fields.from = COPY.from;
  if (!valueOf(root, "to").trim()) fields.to = COPY.to;
  if (journeyType(root) === "severalStops") {
    const details = valueOf(root, "details");
    if (!details.trim() || readerLength(details) > 2000) fields.details = COPY.details;
  }
  return fields;
};
const inRange = (text: string, low: number, high: number): boolean => /^\d+$/.test(text) && Number(text) >= low && Number(text) <= high;
const checkWhen = (root: ParentNode, clock: Clock | null): Record<string, string> => {
  const fields: Record<string, string> = {};
  const out = localOf(root, "departAt");
  const now = clock ? nowOf(clock) : 0;
  const refusedOut = clock ? pickupRefusal(out, now, clock.date) : out.date ? null : COPY.date;
  if (refusedOut) {
    if (refusedOut.startsWith("Choose which")) fields.departAtWhich = refusedOut;
    else fields[refusedOut === COPY.hour || refusedOut === COPY.notice || isTimeCopy(refusedOut) ? "departAt.hour" : "departAt"] = refusedOut;
  }
  if (showsReturn(root) && !refusedOut) {
    const refusedBack = returnRefusal(localOf(root, "returnAt"), out as LocalDateTime);
    if (refusedBack) {
      if (refusedBack.startsWith("Choose which")) fields.returnAtWhich = refusedBack;
      else fields[refusedBack === COPY.date ? "returnAt" : "returnAt.hour"] = refusedBack;
    }
  }
  if (!inRange(valueOf(root, "people"), 1, 400)) fields.people = COPY.people;
  for (const bag of ["large", "medium", "hand"]) if (!inRange(valueOf(root, bag), 0, 40)) fields[bag] = COPY.bags;
  if (!inRange(valueOf(root, "wheelchairs"), 0, 10)) fields.wheelchairs = COPY.wheelchairs;
  return fields;
};
const isTimeCopy = (copy: string): boolean => copy.includes("does not exist");
const checkDetails = (root: ParentNode): Record<string, string> => {
  const fields: Record<string, string> = {};
  if (!valueOf(root, "name").trim()) fields.name = COPY.name;
  if (!isEmail(valueOf(root, "email"))) fields.email = COPY.email;
  if (!isUkTelephone(valueOf(root, "telephone"))) fields.telephone = COPY.telephone;
  return fields;
};

const lineValues = (root: ParentNode): Record<string, string | null> => {
  const type = journeyType(root);
  const stamp = (key: string): string | null => {
    const at = localOf(root, key);
    if (!at.date || !at.time) return null;
    const suffix = at.repeatedHour === "first" ? " (BST)" : at.repeatedHour === "second" ? " (GMT)" : "";
    return `${longDateTime(at.date, at.time)}${suffix}`;
  };
  const stops = stopInputs(root).map((i) => i.value.trim()).filter(Boolean);
  const people = valueOf(root, "people");
  const anyBag = ["large", "medium", "hand"].some((b) => touched.has(b));
  const trimmed = (name: string): string | null => valueOf(root, name).trim() || null;
  return {
    occasion: OCCASION_LABELS[radioValue(root, "occasion")] ?? null,
    journey: JOURNEY_LABELS[type],
    from: trimmed("from"), to: trimmed("to"),
    stops: stops.length ? stops.join("; ") : null,
    details: type === "severalStops" ? trimmed("details") : null,
    out: stamp("departAt"),
    return: showsReturn(root) ? stamp("returnAt") : null,
    people: /^\d+$/.test(people) ? peopleCount(Number(people)) : null,
    bags: anyBag ? `${valueOf(root, "large") || 0} large, ${valueOf(root, "medium") || 0} medium, ${valueOf(root, "hand") || 0} hand` : null,
    wheelchairs: touched.has("wheelchairs") ? valueOf(root, "wheelchairs") || "0" : null,
    name: trimmed("name"), email: trimmed("email"), telephone: trimmed("telephone"),
  };
};
const LINE_OF_FIELD = (name: string): string | null => {
  if (name === "occasion") return "occasion";
  if (name === "journeyType") return "journey";
  if (["from", "to", "details", "people", "wheelchairs", "name", "email", "telephone"].includes(name)) return name;
  if (["large", "medium", "hand"].includes(name)) return "bags";
  if (name.startsWith("departAt")) return "out";
  if (name.startsWith("returnAt")) return "return";
  return null;
};
const shownLines = (): HTMLElement[] => $$("[data-ticket-line]");
const setLine = (line: string, value: string | null): void => {
  for (const row of shownLines().filter((r) => r.dataset.ticketLine === line)) {
    const cell = $("[data-ticket-value]", row);
    if (cell) cell.textContent = value ?? NOT_GIVEN;
    row.dataset.answered = value ? "1" : "";
  }
};
const syncRowVisibility = (root: ParentNode): void => {
  const type = journeyType(root);
  const stopsShown = stopInputs(root).length > 0;
  for (const row of shownLines()) {
    const line = row.dataset.ticketLine;
    if (line === "stops") row.hidden = !stopsShown;
    if (line === "details") row.hidden = type !== "severalStops";
    if (line === "return") row.hidden = !showsReturn(root);
  }
};
const syncCount = (): void => {
  const inPanel = $$(".ticket [data-ticket-line]");
  const answered = inPanel.filter((r) => !r.hidden && r.dataset.answered === "1").length;
  for (const button of $$("[data-ticket-count]")) button.textContent = `Journey ticket, ${answered} answered`;
};

const flights = new Map<string, { element: HTMLElement; value: string; animation: Animation }>();
const flightTarget = (line: string): DOMRect => {
  const sheet = document.getElementById("ticket-sheet");
  if (innerWidth >= 1024) return ($(`.ticket [data-ticket-line="${line}"]`) as HTMLElement).getBoundingClientRect();
  if (sheet && isOpen(sheet)) return ($(`[data-ticket-line="${line}"]`, sheet) as HTMLElement).getBoundingClientRect();
  return ($("[data-ticket-count]") as HTMLElement).getBoundingClientRect();
};
const fly = (line: string, value: string, from: Element): void => {
  if (reducedMotion()) {
    setLine(line, value);
    return syncCount();
  }
  const flying = flights.get(line);
  if (flying) {
    flying.value = value;
    flying.element.textContent = value;
    return;
  }
  const start = from.getBoundingClientRect();
  const end = flightTarget(line);
  const element = document.createElement("div");
  element.className = "ticket-flight";
  element.dataset.part = "ticket-flight";
  element.setAttribute("aria-hidden", "true");
  element.textContent = value;
  element.style.left = `${start.left}px`;
  element.style.top = `${start.top}px`;
  document.body.append(element);
  const animation = element.animate(
    [{ transform: "translate(0, 0)", opacity: 1 }, { transform: `translate(${end.left - start.left}px, ${end.top - start.top}px)`, opacity: 0.35 }],
    { duration: 320, easing: EASE, fill: "both" },
  );
  const entry = { element, value, animation };
  flights.set(line, entry);
  const land = (): void => {
    flights.delete(line);
    element.remove();
    setLine(line, entry.value);
    syncCount();
  };
  animation.addEventListener("finish", land);
  animation.addEventListener("cancel", land);
};
/** Answers the ticket after a control changed: each answer that completes or changes a line makes one flight. */
const updateTicket = (root: ParentNode, source: Element | null, sourceLine: string | null): void => {
  syncRowVisibility(root);
  const values = lineValues(root);
  const inPanel = (line: string): HTMLElement | null => $(`.ticket [data-ticket-line="${line}"] [data-ticket-value]`);
  for (const [line, value] of Object.entries(values)) {
    const showing = flights.get(line)?.value ?? (inPanel(line)?.textContent === NOT_GIVEN ? null : inPanel(line)?.textContent ?? null);
    if (value === showing) continue;
    if (value === null) {
      flights.get(line)?.animation.cancel();
      setLine(line, null);
    } else if (source && line === sourceLine) fly(line, value, source);
    else setLine(line, value);
  }
  syncCount();
};

const saveDraftFields = (root: HTMLFormElement): void => {
  const fields: Record<string, string> = {};
  for (const element of [...root.elements] as HTMLInputElement[]) {
    if (!element.name || element.dataset.stopField !== undefined) continue;
    if (element.type === "radio") { if (element.checked) fields[element.name] = element.value; } else fields[element.name] = element.value;
  }
  const checked = (name: string): string => fieldOf(root, name)?.dataset.checked ?? "false";
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
    fields, fromChecked: checked("from"), toChecked: checked("to"),
    stops: stopInputs(root).map((i) => ({ text: i.value, checked: i.dataset.checked === "true" })), touched: [...touched],
  }));
};
const restoreDraftFields = (root: HTMLFormElement): void => {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return;
  const draft = JSON.parse(raw) as { fields: Record<string, string>; fromChecked: string; toChecked: string; stops: { text: string; checked: boolean }[]; touched: string[] };
  for (const name of draft.touched) touched.add(name);
  for (const stop of draft.stops) addStop(root, stop.text, stop.checked);
  for (const [key, value] of Object.entries(draft.fields)) {
    if (key.endsWith(".repeatedHour")) continue;
    const radio = $<HTMLInputElement>(`input[type="radio"][name="${key}"][value="${CSS.escape(value)}"]`, root);
    if (radio) radio.checked = true;
    else {
      const field = fieldOf(root, key);
      if (field) field.value = value;
    }
  }
  reshape(root);
  for (const key of ["departAt", "returnAt"]) {
    const repeated = draft.fields[`${key}.repeatedHour`];
    const radio = repeated ? $<HTMLInputElement>(`input[name="${key}.repeatedHour"][value="${repeated}"]`, root) : null;
    if (radio) radio.checked = true;
  }
  const from = fieldOf(root, "from");
  const to = fieldOf(root, "to");
  if (from) from.dataset.checked = draft.fromChecked;
  if (to) to.dataset.checked = draft.toChecked;
};

const stepFromPath = (): string => {
  const step = location.pathname.split("/").pop() as string;
  return STEPS.includes(step) ? step : "route";
};
const showStep = (root: HTMLFormElement, step: string, direction: number): void => {
  const current = $<HTMLElement>(`.step[data-step="${step}"]`, root) as HTMLElement;
  for (const section of $$(".step", root)) section.hidden = section !== current;
  document.title = `${TITLES[step]} | Get a free quote`;
  const back = $("[data-step-back]", root);
  if (back) back.hidden = step === "route" || step === "thanks";
  const actions = $("[data-quote-actions]", root);
  if (actions) actions.hidden = step === "thanks";
  const next = $("[data-step-next]", root);
  if (next) next.hidden = !["route", "when"].includes(step);
  const send = $("[data-step-send]", root);
  if (send) send.hidden = step !== "details";
  if (direction !== 0 && !reducedMotion()) {
    current.animate([{ transform: `translateX(${direction * 48}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: EASE });
  }
};
const firstMissing = (root: HTMLFormElement): string | null => {
  if (Object.keys(checkRoute(root)).length) return "route";
  const out = localOf(root, "departAt");
  if (!out.date || !out.time || !valueOf(root, "people")) return "when";
  return null;
};
const goTo = (root: HTMLFormElement, step: string, direction: number): void => {
  history.pushState({ step }, "", `/quote/${step}`);
  showStep(root, step, direction);
  $<HTMLElement>(`.step[data-step="${step}"] h1`, root)?.focus();
};

const initPublicForm = (root: HTMLFormElement): void => {
  restoreDraftFields(root);
  const chosen = new URLSearchParams(location.search).get("occasion");
  if (chosen) {
    const radio = $<HTMLInputElement>(`input[name="occasion"][value="${CSS.escape(chosen)}"]`, root);
    if (radio) radio.checked = true;
    history.replaceState(null, "", location.pathname);
  }
  reshape(root);
  syncRowVisibility(root);
  for (const [line, value] of Object.entries(lineValues(root))) setLine(line, value);
  syncCount();
  saveDraftFields(root);
  void readClock().then(() => reshape(root));

  const step = stepFromPath();
  const missing = step === "thanks" ? null : firstMissing(root);
  const order = (s: string): number => STEPS.indexOf(s);
  if (missing && order(step) > order(missing)) {
    history.replaceState({ step: missing }, "", `/quote/${missing}`);
    showStep(root, missing, 0);
  } else showStep(root, step, 0);
  if (step === "thanks") {
    const reference = sessionStorage.getItem("wayticket-reference");
    const line = $("[data-thanks-line]", root);
    if (reference && line) line.textContent = `Request sent. Your reference is ${reference}.`;
  }
  addEventListener("popstate", () => showStep(root, stepFromPath(), 0));

  const afterChange = (source: HTMLElement, name: string): void => {
    reshape(root);
    updateTicket(root, source.closest("label") ?? source, LINE_OF_FIELD(name));
    saveDraftFields(root);
    clearProblemsIfFixed(root);
  };
  root.addEventListener("change", (event) => {
    const field = event.target as HTMLInputElement;
    if (field.dataset.stopField !== undefined) return afterChangeStops(root, field);
    afterChange(field, field.name);
  });
  root.addEventListener("focusout", (event) => {
    const field = event.target as HTMLInputElement;
    if (["large", "medium", "hand", "wheelchairs"].includes(field.name)) touched.add(field.name);
    if (field.dataset.stopField !== undefined) return afterChangeStops(root, field);
    if (field.matches("input[type=text],input[type=email],input[type=tel],input[type=number],textarea")) afterChange(field, field.name);
  });
  root.addEventListener("input", () => {
    reshape(root);
    saveDraftFields(root);
    syncRowVisibility(root);
    const values = lineValues(root);
    for (const [line, value] of Object.entries(values)) {
      if (value === null && !flights.has(line)) setLine(line, null);
    }
    syncCount();
  });
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const shortcut = target.closest<HTMLElement>("[data-shortcut]");
    if (shortcut) {
      void readClock().then((clock) => {
        if (!clock) return;
        const date = fieldOf(root, "departAt.date") as HTMLInputElement;
        date.value = dateToTyped(addDays(clock.date, Number(shortcut.dataset.shortcut)));
        reshape(root);
        updateTicket(root, date, "out");
        saveDraftFields(root);
      });
    }
    if (target.closest("[data-step-back]")) {
      const at = STEPS.indexOf(stepFromPath());
      clearProblems(root);
      goTo(root, STEPS[at - 1], -1);
    }
    const next = target.closest<HTMLElement>("[data-step-next]");
    if (next && !isBusy(next)) void pressNext(root);
    const send = target.closest<HTMLElement>("[data-step-send]");
    if (send && !isBusy(send)) void pressSend(root, send);
    if (target.closest("[data-calendar]")) openCalendar(root, (target.closest("[data-calendar]") as HTMLElement));
  });
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const step_ = stepFromPath();
    if (step_ === "details") ($("[data-step-send]", root) as HTMLElement).click();
    else if (step_ !== "thanks") ($("[data-step-next]", root) as HTMLElement).click();
  });
};
const clearProblemsIfFixed = (root: HTMLFormElement): void => {
  const box = $<HTMLElement>("[data-problems]", root);
  if (box && !box.hidden && !$$("[aria-invalid]", root).length) box.hidden = true;
};
const afterChangeStops = (root: HTMLFormElement, field: HTMLInputElement): void => {
  reshape(root);
  updateTicket(root, field, "stops");
  saveDraftFields(root);
};
const pressNext = async (root: HTMLFormElement): Promise<void> => {
  const step = stepFromPath();
  closeList();
  const clock = step === "when" ? await readClock() : clockRead;
  const fields = step === "route" ? checkRoute(root) : checkWhen(root, clock);
  if (Object.keys(fields).length) return showProblems(root, fields);
  clearProblems(root);
  goTo(root, STEPS[STEPS.indexOf(step) + 1], 1);
};
const pressSend = async (root: HTMLFormElement, button: HTMLElement): Promise<void> => {
  const fields = checkDetails(root);
  if (Object.keys(fields).length) return showProblems(root, fields);
  clearProblems(root);
  setBusy(button);
  const reply = await safely(() => call("POST", "/api/public/enquiries", enquiryBody(root)));
  clearBusy(button);
  if (!reply.ok) {
    const code = reply.json?.error?.fields as Record<string, string> | undefined;
    const earlier = code && Object.keys(code).find((k) => !["name", "email", "telephone"].includes(k));
    if (earlier) {
      const owner = ["occasion", "journeyType", "from", "to", "details"].includes(earlier) ? "route" : "when";
      goTo(root, owner, -1);
    }
    return refusal(root, reply);
  }
  const reference: string = reply.json.reference;
  sessionStorage.setItem("wayticket-reference", reference);
  sessionStorage.removeItem(DRAFT_KEY);
  const line = $("[data-thanks-line]", root);
  const copy = `Request sent. Your reference is ${reference}.`;
  if (line) line.textContent = copy;
  announce(copy, false);
  goTo(root, "thanks", 1);
};

// ---- The calendar.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
let calendarFor: { root: HTMLFormElement; key: string } | null = null;
let calendarMonth = "";
let calendarFocus = "";
const drawCalendar = (focusCell: boolean): void => {
  const holder = $("[data-calendar-grid]");
  const label = $("[data-month-label]");
  if (!holder || !label) return;
  const first = `${calendarMonth}-01`;
  label.textContent = `${MONTHS[Number(calendarMonth.slice(5)) - 1]} ${calendarMonth.slice(0, 4)}`;
  const start = addDays(first, -((weekdayIndex(first) + 6) % 7));
  const cells: string[] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(start, week * 7 + day);
      const inMonth = date.slice(0, 7) === calendarMonth;
      row.push(`<td role="gridcell" class="day${inMonth ? "" : " day-off"}${date === calendarFocus ? " day-focus" : ""}" data-day="${date}" tabindex="${date === calendarFocus ? 0 : -1}" aria-label="${longDate(date)}">${Number(date.slice(8))}</td>`);
    }
    cells.push(`<tr>${row.join("")}</tr>`);
  }
  holder.innerHTML = `<table class="calendar-grid" role="grid" aria-label="${label.textContent}"><thead><tr>${DAYS.map((d) => `<th scope="col">${d}</th>`).join("")}</tr></thead><tbody>${cells.join("")}</tbody></table>`;
  if (focusCell) $<HTMLElement>(`[data-day="${calendarFocus}"]`, holder)?.focus();
};
const openCalendar = (root: HTMLFormElement, opener: HTMLElement): void => {
  const key = opener.dataset.calendar as string;
  calendarFor = { root, key };
  calendarFocus = typedToDate(valueOf(root, `${key}.date`)) ?? clockRead?.date ?? "2027-01-01";
  calendarMonth = calendarFocus.slice(0, 7);
  drawCalendar(false);
  const dialog = document.getElementById("calendar") as HTMLElement;
  openDialog(dialog, opener);
  $<HTMLElement>(`[data-day="${calendarFocus}"]`, dialog)?.focus();
};
const moveCalendar = (date: string): void => {
  calendarFocus = date;
  calendarMonth = date.slice(0, 7);
  drawCalendar(true);
};
const addMonths = (date: string, by: number): string => {
  let year = Number(date.slice(0, 4));
  let month = Number(date.slice(5, 7)) + by;
  while (month < 1) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  const day = Math.min(Number(date.slice(8)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const chooseDay = (date: string): void => {
  if (!calendarFor) return;
  const field = fieldOf(calendarFor.root, `${calendarFor.key}.date`) as HTMLInputElement;
  field.value = dateToTyped(date);
  const dialog = document.getElementById("calendar") as HTMLElement;
  closeDialog(dialog);
  field.dispatchEvent(new Event("change", { bubbles: true }));
};
const initCalendar = (): void => {
  const dialog = document.getElementById("calendar");
  if (!dialog) return;
  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const day = target.closest<HTMLElement>("[data-day]");
    if (day) chooseDay(day.dataset.day as string);
    const month = target.closest<HTMLElement>("[data-month]");
    if (month) {
      calendarFocus = addMonths(calendarFocus, Number(month.dataset.month));
      calendarMonth = calendarFocus.slice(0, 7);
      drawCalendar(false);
    }
  });
  dialog.addEventListener("keydown", (event) => {
    const day = (event.target as HTMLElement).closest<HTMLElement>("[data-day]");
    if (!day) return;
    const date = day.dataset.day as string;
    const offset = (weekdayIndex(date) + 6) % 7;
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(date, -1), ArrowRight: () => addDays(date, 1), ArrowUp: () => addDays(date, -7), ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -offset), End: () => addDays(date, 6 - offset), PageUp: () => addMonths(date, -1), PageDown: () => addMonths(date, 1),
    };
    if (moves[event.key]) {
      event.preventDefault();
      moveCalendar(moves[event.key]());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseDay(date);
    }
  });
};

// ---- Shared behaviour for both forms.
const initSharedBehaviour = (): void => {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const root = target.closest<HTMLFormElement>("[data-journey]");
    if (!root) return;
    if (target.closest("[data-add-stop]") && !target.closest("[aria-disabled]") && stopInputs(root).length < STOP_LIMIT) {
      const input = addStop(root);
      reshape(root);
      syncRowVisibility(root);
      input.focus();
    }
    const remove = target.closest<HTMLElement>("[data-remove-stop]");
    if (remove) {
      const entry = remove.closest(".stop-entry") as HTMLElement;
      const after = entry.nextElementSibling;
      entry.remove();
      renumberStops(root);
      reshape(root);
      if (root.dataset.journey === "public") {
        updateTicket(root, null, null);
        saveDraftFields(root);
      }
      ((after ? $("[data-remove-stop]", after) : $("[data-add-stop]", root)) as HTMLElement).focus();
    }
  });
  document.addEventListener("change", (event) => {
    const root = (event.target as HTMLElement).closest<HTMLFormElement>("[data-journey='desk']");
    if (root) reshape(root);
  });
  document.addEventListener("input", (event) => {
    const root = (event.target as HTMLElement).closest<HTMLFormElement>("[data-journey='desk']");
    if (root) reshape(root);
  });
};

export const initJourney = (): void => {
  initSharedBehaviour();
  initCalendar();
  registerBuilder("journey", (form) => ({ body: enquiryBody(form), errors: {} }));
  const form = $<HTMLFormElement>("[data-journey='public']");
  if (form) initPublicForm(form);
  else void readClock();
};
export const markDeskJourneyForms = (): void => {
  for (const form of $$<HTMLFormElement>("[data-journey='desk']")) {
    form.dataset.builder = "journey";
    if (!form.dataset.shaped) {
      form.dataset.shaped = "1";
      reshape(form);
    }
  }
};
