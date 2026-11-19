// Visits: the diary grouped by Lisbon date, and the reading page that waits offline.

import { announce, api, el, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { handleSessionEnd } from "./app.js";
import { UI } from "./copy.js";
import { overlayClose, overlayOpen } from "./overlay.js";

interface VisitOut {
  id: string;
  labelId: string;
  factoryName: string;
  town: string;
  townName: string;
  localDate: string;
  localTime: string;
  at: string;
  lisbonDate: string;
  lisbonDayHours: number;
  shown: string;
}

export function registerVisitsScreen(ctx: RouteCtx): () => void {
  const main = ctx.main;
  const h1 = el("h1", {}, "Visits");
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);
  const diary = el("section", { class: "diary" });
  const newBtn = el("button", { class: "btn btn-primary" }, "Book visit");
  newBtn.addEventListener("click", () => void openBook(newBtn));
  const bar = el("div", { class: "bottom-bar" });
  bar.append(newBtn.cloneNode(true));
  main.append(h1, refreshLine, diary, newBtn, bar);

  async function load(): Promise<void> {
    try {
      const out = await api<{ visits: VisitOut[] }>("/api/visits");
      refreshLine.hidden = true;
      diary.textContent = "";
      const byDate = new Map<string, VisitOut[]>();
      for (const visit of out.visits) {
        const list = byDate.get(visit.lisbonDate) ?? [];
        list.push(visit);
        byDate.set(visit.lisbonDate, list);
      }
      const dates = [...byDate.keys()].sort();
      for (const date of dates) {
        const group = el("section", { class: "diary-group" });
        const hours = byDate.get(date)![0].lisbonDayHours;
        const shownDate = await api<{ shown: string }>(`/api/calendar/${date}`);
        group.append(el("h2", { class: "diary-head" }, hours === 24 ? shownDate.shown : `${shownDate.shown}, ${hours} hours`));
        for (const visit of byDate.get(date)!) {
          const item = el("div", { class: "diary-item" });
          const link = el("a", { href: `/visits/${visit.id}` }, `Visit to ${visit.factoryName}`);
          item.append(link, el("span", {}, visit.shown));
          group.append(item);
        }
        diary.append(group);
      }
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  async function openBook(opener: HTMLElement): Promise<void> {
    const body = overlayOpen({ label: "Book visit", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const labels = await api<{ labels: { id: string; name: string }[] }>("/api/labels");
    const labelSel = el("select", { "aria-label": "Label" });
    for (const label of labels.labels) labelSel.append(el("option", { value: label.id }, label.name));
    const factory = el("input", { type: "text", "aria-label": "Factory" });
    const townSel = el("select", { "aria-label": "Town" });
    for (const [id, name] of [["porto", "Porto"], ["izmir", "Izmir"], ["hoChiMinhCity", "Ho Chi Minh City"], ["cairo", "Cairo"]] as [string, string][]) {
      townSel.append(el("option", { value: id }, name));
    }
    const date = el("input", { type: "text", "aria-label": "Date", placeholder: "YYYY-MM-DD" });
    const time = el("input", { type: "text", "aria-label": "Local time", placeholder: "HH:MM" });
    const save = el("button", { class: "btn btn-primary" }, "Save visit");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(
      el("label", { class: "field" }, el("span", {}, "Label"), labelSel),
      el("label", { class: "field" }, el("span", {}, "Factory"), factory),
      el("label", { class: "field" }, el("span", {}, "Town"), townSel),
      el("label", { class: "field" }, el("span", {}, "Date"), date),
      el("label", { class: "field" }, el("span", {}, "Local time"), time),
      el("div", { class: "dialog-foot" }, save, close),
    );
    save.addEventListener("click", async () => {
      await withWorking(save, UI.working, async () => {
        try {
          const out = await api<{ id: string; factoryName: string }>("/api/visits", {
            method: "POST",
            body: JSON.stringify({
              labelId: labelSel.value,
              factoryName: factory.value,
              town: townSel.value,
              localDate: date.value,
              localTime: time.value,
            }),
          });
          announce(UI.visitBooked(out.factoryName));
          overlayClose(dialog);
          location.href = `/visits/${out.id}`;
        } catch (err) {
          const failure = err as { message?: string; status?: number };
          if (failure.status === 401) handleSessionEnd();
          else announce(failure.message ?? `Give a value here.`);
        }
      });
    });
  }

  void load();
  const timer = window.setInterval(() => void load(), 5000);
  return () => window.clearInterval(timer);
}

interface ReadingOut {
  id: string;
  meter: number;
  value: string;
  unit: string;
  takenAt: string;
}

interface WaitingReading {
  key: string;
  meter: number;
  value: string;
  unit: string;
  takenMs: number;
}

export function registerVisitScreen(ctx: RouteCtx): () => void {
  const visitId = location.pathname.split("/")[2];
  const main = ctx.main;
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);
  const waitingLine = el("p", { class: "hint", "data-part": "waiting-line" }, `All readings sent.`);
  const table = el("table");
  const tbody = el("tbody");
  table.append(el("thead", {}, el("tr", {}, ...["Meter", "Value", "Unit", "Taken"].map((x) => el("th", {}, x)))), tbody);

  const meter = el("input", { type: "text", "aria-label": "Meter" });
  const value = el("input", { type: "text", "aria-label": "Reading" });
  const unit = el("select", { "aria-label": "Unit" });
  for (const [id, name] of [["kWh", "kWh"], ["MJ", "MJ"], ["m3", "m\u00B3 of natural gas"]] as [string, string][]) {
    unit.append(el("option", { value: id }, name));
  }
  const recordBtn = el("button", { class: "btn btn-primary" }, "Record reading");
  const bar = el("div", { class: "bottom-bar" });
  bar.append(recordBtn.cloneNode(true));

  // Readings wait on the device first, then try to send.
  let waiting: WaitingReading[] = loadWaiting();

  function loadWaiting(): WaitingReading[] {
    try {
      return JSON.parse(sessionStorage.getItem(`fio-waiting-${visitId}`) ?? "[]") as WaitingReading[];
    } catch {
      return [];
    }
  }

  function saveWaiting(): void {
    sessionStorage.setItem(`fio-waiting-${visitId}`, JSON.stringify(waiting));
    renderWaiting();
  }

  function renderWaiting(): void {
    if (waiting.length === 0) {
      waitingLine.textContent = `All readings sent.`;
      return;
    }
    const n = waiting.length;
    const offline = navigator.onLine === false;
    waitingLine.textContent = offline
      ? `Offline \u2014 ${n} ${n === 1 ? "reading" : "readings"} waiting on this device.`
      : `Sending \u2014 ${n} ${n === 1 ? "reading" : "readings"} waiting on this device.`;
  }

  recordBtn.addEventListener("click", () => {
    const meterNo = Number.parseInt(meter.value, 10);
    const takenMs = Date.now();
    waiting.push({
      key: `r-${takenMs}-${Math.floor(Math.random() * 1e6)}`,
      meter: meterNo,
      value: value.value,
      unit: unit.value,
      takenMs,
    });
    saveWaiting();
    announce(UI.readingRecorded(meterNo));
    void flush();
  });

  async function flush(): Promise<void> {
    // Try the waiting readings in the order taken.
    const queue = [...waiting];
    for (const reading of queue) {
      try {
        const out = await api<ReadingOut>(`/api/visits/${visitId}/readings`, {
          method: "POST",
          headers: { "Request-Key": reading.key },
          body: JSON.stringify({
            meter: reading.meter,
            value: reading.value,
            unit: reading.unit,
            secondsAgo: Math.max(0, Math.floor((Date.now() - reading.takenMs) / 1000)),
          }),
        });
        waiting = waiting.filter((w) => w.key !== reading.key);
        saveWaiting();
        announce(UI.readingRecorded(out.meter));
      } catch (err) {
        const failure = err as { status?: number; body?: { error?: { code?: string; message?: string; lastValue?: string; lastAt?: string } } };
        if (failure.status === 422) {
          // A reading refused with 422 leaves the device and the waiting count.
          waiting = waiting.filter((w) => w.key !== reading.key);
          saveWaiting();
          announce(failure.body?.error?.message ?? `That reading was refused.`);
          continue;
        }
        if (failure.status === 409 && failure.body?.error?.code === "lower_reading") {
          void openLowerDialog(reading, failure.body.error.lastValue ?? "", failure.body.error.lastAt ?? "", failure.body.error.message ?? "");
          continue;
        }
        // Any other refusal keeps the reading waiting for the next refresh.
        break;
      }
    }
    renderWaiting();
    await loadReadings();
  }

  async function openLowerDialog(reading: WaitingReading, lastValue: string, lastAt: string, message: string): Promise<void> {
    const opener = recordBtn;
    const body = overlayOpen({ label: message, opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const keepMine = el("button", { class: "btn btn-primary" }, "Keep mine");
    const keepRecorded = el("button", { class: "btn" }, "Keep recorded");
    body.append(el("p", {}, message), el("div", { class: "dialog-foot" }, keepMine, keepRecorded));
    keepRecorded.addEventListener("click", () => {
      waiting = waiting.filter((w) => w.key !== reading.key);
      saveWaiting();
      overlayClose(dialog, recordBtn);
    });
    keepMine.addEventListener("click", async () => {
      waiting = waiting.filter((w) => w.key !== reading.key);
      saveWaiting();
      overlayClose(dialog, recordBtn);
      try {
        const out = await api<ReadingOut>(`/api/visits/${visitId}/readings`, {
          method: "POST",
          headers: { "Request-Key": `keep-${reading.key}` },
          body: JSON.stringify({
            meter: reading.meter,
            value: reading.value,
            unit: reading.unit,
            keepMine: true,
            secondsAgo: Math.max(0, Math.floor((Date.now() - reading.takenMs) / 1000)),
          }),
        });
        announce(UI.readingRecorded(out.meter));
      } catch {
        /* the reading is dropped after Keep mine was chosen */
      }
      await loadReadings();
    });
    void lastValue;
    void lastAt;
  }

  async function loadReadings(): Promise<void> {
    try {
      const out = await api<VisitOut & { readings: ReadingOut[] }>(`/api/visits/${visitId}`);
      refreshLine.hidden = true;
      if (main.querySelector("h1") === null) {
        const h1 = el("h1", {}, `Visit to ${out.factoryName}`);
        main.append(h1, refreshLine, el("p", {}, out.shown), waitingLine, table);
        const form = el("div", { class: "panel", "aria-label": "Record a reading" });
        form.append(
          el("label", { class: "field" }, el("span", {}, "Meter"), meter),
          el("label", { class: "field" }, el("span", {}, "Reading"), value),
          el("label", { class: "field" }, el("span", {}, "Unit"), unit),
        );
        main.append(form, bar);
      }
      tbody.textContent = "";
      for (const reading of out.readings) {
        const tr = el("tr");
        tr.append(
          el("td", { class: "num" }, String(reading.meter)),
          el("td", { class: "num" }, reading.value),
          el("td", {}, reading.unit),
          el("td", {}, reading.takenAt),
        );
        tbody.append(tr);
      }
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  async function tick(): Promise<void> {
    renderWaiting();
    if (waiting.length > 0) await flush();
    else await loadReadings();
  }

  void tick();
  const timer = window.setInterval(() => void tick(), 5000);
  return () => window.clearInterval(timer);
}
