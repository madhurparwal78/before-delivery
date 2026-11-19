import { ApiFailure, get, post, upload } from "../api";
import { clockText, copy, stampLine } from "../copy";
import { openDialog } from "../dialog";
import { clear, h, icon, setText } from "../dom";
import { PageHandle } from "../router";
import { buildFooter } from "../shell";
import { Dive, Pen } from "../types";

const SONAR_LIMIT = 20_000_000;

/// The Dives page: plan a dive, check the forecast, start it, finish it with
/// its track and read it back as recorded.
export async function divesPage(container: HTMLElement): Promise<PageHandle> {
  let dives: Dive[] = [];
  let pens: Pen[] = [];
  let serverNow = new Date().toISOString();
  let openDive: string | null = null;
  let clockBase: { elapsed: number; at: number } | null = null;
  let destroyed = false;
  let loadSequence = 0;

  const list = h("ul", { class: "list", "aria-label": "Dives", role: "list" });
  const detail = h("section", { class: "panel", "aria-label": "Dive detail" });
  const planButton = h("button", { type: "button", class: "text-button" }, "Plan dive");
  const main = h("main", {}, [
    h("div", { class: "band" }, [planButton]),
    h("div", { class: "page grid12 dives-layout" }, [
      h("div", { class: "panel", style: "grid-column: span 4" }, list),
      h("div", { style: "grid-column: span 8" }, detail),
    ]),
  ]);
  container.appendChild(main);
  container.appendChild(buildFooter());

  const rows = new Map<string, { root: HTMLElement; button: HTMLButtonElement }>();

  function penName(penId: string): string {
    return pens.find((pen) => pen.id === penId)?.name ?? penId;
  }

  function renderList(): void {
    const seen = new Set<string>();
    for (const dive of dives) {
      seen.add(dive.id);
      let row = rows.get(dive.id);
      if (!row) {
        const button = h("button", {
          type: "button",
          class: "row-button",
          "aria-label": `${dive.id}, ${penName(dive.pen_id)}`,
        });
        button.addEventListener("click", () => {
          openDive = dive.id;
          clockBase = null;
          renderDetail();
        });
        const root = h("li", {}, button);
        rows.set(dive.id, { root, button });
        list.appendChild(root);
        row = { root, button };
      }
      setText(row.button, `${dive.id} ${penName(dive.pen_id)} ${dive.status}`);
      row.button.setAttribute("aria-label", `${dive.id}, ${penName(dive.pen_id)}`);
      row.button.setAttribute("aria-pressed", openDive === dive.id ? "true" : "false");
    }
    for (const [id, row] of [...rows]) {
      if (!seen.has(id)) {
        row.root.remove();
        rows.delete(id);
      }
    }
  }

  const diveStatus = h("div", { role: "status", "aria-label": "Dive status" });
  const clearanceStatus = h("div", { role: "status", "aria-label": "Clearance status" });
  const hoursTable = h("table", { "aria-label": "Forecast hours" });
  const clock = h("div", { role: "timer", class: "num", "aria-label": "Dive clock" }, "00:00:00");
  const trackTable = h("table", { "aria-label": "Track" });
  const trackBox = h("textarea", { "aria-label": "Track samples", rows: "5" });
  const sonarList = h("ul", { class: "list" });
  const trackError = h("div", { class: "field-error hidden" });
  const checkButton = h("button", { type: "button" }, "Check forecast");
  const startButton = h("button", { type: "button" }, "Start dive");
  const finishButton = h("button", { type: "button" }, "Finish dive");
  const sonarButton = h("button", { type: "button" }, "Attach sonar capture");
  const sonarChooser = h("input", {
    type: "file",
    class: "sr-only",
    "aria-hidden": "true",
    tabindex: "-1",
  });
  const summary = h("div", { class: "num" });

  let checkSequence = 0;

  function current(): Dive | null {
    return dives.find((dive) => dive.id === openDive) ?? null;
  }

  function renderDetail(): void {
    const dive = current();
    clear(detail);
    if (!dive) {
      detail.appendChild(h("div", { class: "empty-state" }, "No dive selected"));
      return;
    }
    detail.appendChild(
      h("div", {}, [
        h("div", { class: "panel-title" }, penName(dive.pen_id)),
        summary,
        diveStatus,
        h("div", { class: "actions" }, [
          checkButton,
          startButton,
          finishButton,
          sonarButton,
          sonarChooser,
        ]),
        clearanceStatus,
        hoursTable,
        h("div", { class: "label" }, "Dive clock"),
        clock,
        h("label", { class: "field" }, [
          h("span", {}, "Track samples"),
          trackBox,
          trackError,
        ]),
        trackTable,
        h("div", { class: "label" }, "Sonar captures"),
        sonarList,
      ]),
    );
    setText(
      summary,
      `${stampLine(dive.planned_start)} \u00b7 ${dive.planned_minutes} min`,
    );
    setText(diveStatus, copy.diveStatus(dive.status));
    renderClearance(dive);
    renderTrack(dive);
    renderSonar(dive);
    renderClock(dive);
  }

  function renderClearance(dive: Dive): void {
    if (dive.clearance) setText(clearanceStatus, dive.clearance.message);
    clear(hoursTable);
    if (!dive.clearance || !dive.clearance.hours.length) return;
    hoursTable.appendChild(h("caption", {}, "Forecast hours"));
    hoursTable.appendChild(
      h("thead", {}, h("tr", {}, [
        h("th", {}, "Time"),
        h("th", {}, "Current"),
        h("th", {}, "Wave height"),
        h("th", {}, "Within limits"),
      ])),
    );
    const body = h("tbody", {});
    for (const hour of dive.clearance.hours) {
      body.appendChild(
        h("tr", {}, [
          h("td", { class: "num" }, `${hour.time.slice(11, 16)} UTC`),
          h("td", { class: "num" }, `${hour.current_m_s.toFixed(2)} m/s`),
          h("td", { class: "num" }, `${hour.wave_m.toFixed(2)} m`),
          h("td", {}, hour.within_limits ? "Yes" : "No"),
        ]),
      );
    }
    hoursTable.appendChild(body);
  }

  function renderTrack(dive: Dive): void {
    clear(trackTable);
    if (!dive.track.length) return;
    trackTable.appendChild(h("caption", {}, "Track"));
    trackTable.appendChild(
      h("thead", {}, h("tr", {}, [
        h("th", {}, "t"),
        h("th", {}, "Bearing"),
        h("th", {}, "Depth"),
      ])),
    );
    const body = h("tbody", {});
    for (const sample of dive.track) {
      body.appendChild(
        h("tr", {}, [
          h("td", { class: "num" }, `${sample.t_s} s`),
          h("td", { class: "num" }, `${sample.bearing_deg.toFixed(1)}\u00b0`),
          h("td", { class: "num" }, `${sample.depth_m.toFixed(1)} m`),
        ]),
      );
    }
    trackTable.appendChild(body);
  }

  function renderSonar(dive: Dive): void {
    clear(sonarList);
    for (const capture of dive.sonar) {
      sonarList.appendChild(
        h("li", {}, [
          h(
            "a",
            {
              href: `/api/sonar/${capture.id}/raw`,
              download: capture.file_name,
              "aria-label": `Download sonar ${capture.id}`,
            },
            [icon("download"), `Download sonar ${capture.id}`],
          ),
        ]),
      );
    }
  }

  /// The dive clock counts up from the server's elapsed seconds using the
  /// browser's elapsed time, never its wall-clock time.
  function renderClock(dive: Dive): void {
    if (dive.status === "started" && dive.elapsed_s !== null) {
      if (!clockBase) clockBase = { elapsed: dive.elapsed_s, at: performance.now() };
      setText(clock, clockText(clockBase.elapsed + (performance.now() - clockBase.at) / 1000));
      return;
    }
    clockBase = null;
    setText(clock, clockText(0));
  }

  async function load(): Promise<void> {
    const token = ++loadSequence;
    const payload = await get("/api/dives");
    if (destroyed || token !== loadSequence) return;
    dives = payload.dives as Dive[];
    serverNow = payload.server_now as string;
    if (!openDive && dives.length) openDive = dives[0].id;
    renderList();
    renderDetail();
  }

  planButton.addEventListener("click", () => openPlanDialog());

  function nextWholeHour(): string {
    const at = new Date(serverNow);
    at.setUTCMinutes(0, 0, 0);
    at.setUTCHours(at.getUTCHours() + 1);
    return `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)}`;
  }

  function openPlanDialog(): void {
    openDialog({
      name: "Plan dive",
      build: (handle) => {
        const penSelect = h("select", { "aria-label": "Pen" });
        for (const pen of pens) {
          penSelect.appendChild(h("option", { value: pen.id }, pen.name));
        }
        const start = h("input", { type: "text", "aria-label": "Planned start (UTC)" });
        start.value = nextWholeHour();
        const minutes = h("input", { type: "text", "aria-label": "Planned minutes" });
        minutes.value = "90";
        const certificate = h("input", {
          type: "text",
          "aria-label": "Diver certificate number",
        });
        const error = h("div", { class: "field-error hidden" });
        const plan = h("button", { type: "button", class: "text-button" }, "Plan");
        plan.addEventListener("click", async () => {
          const iso = `${start.value.trim().replace(" ", "T")}:00Z`;
          try {
            const payload = await post("/api/dives", {
              pen_id: penSelect.value,
              planned_start: iso,
              planned_minutes: Number(minutes.value),
              diver_certificate_no: certificate.value,
            });
            handle.close();
            openDive = (payload.dive as Dive).id;
            clockBase = null;
            await load();
          } catch (failure) {
            error.classList.remove("hidden");
            clear(error);
            error.appendChild(icon("alert"));
            error.appendChild(
              document.createTextNode(
                failure instanceof ApiFailure ? failure.message : copy.unreachable,
              ),
            );
          }
        });
        return h("div", {}, [
          h("h2", {}, "Plan dive"),
          h("label", { class: "field" }, [h("span", {}, "Pen"), penSelect]),
          h("label", { class: "field" }, [h("span", {}, "Planned start (UTC)"), start]),
          h("label", { class: "field" }, [h("span", {}, "Planned minutes"), minutes]),
          h("label", { class: "field" }, [
            h("span", {}, "Diver certificate number"),
            certificate,
          ]),
          error,
          h("div", { class: "actions" }, [plan]),
        ]);
      },
    });
  }

  /// Check forecast follows Newest action wins: the newest check's pending and
  /// result text always win.
  checkButton.addEventListener("click", async () => {
    const dive = current();
    if (!dive) return;
    const token = ++checkSequence;
    setText(clearanceStatus, copy.checkingForecast);
    try {
      await post(`/api/dives/${dive.id}/clearance`);
      if (token !== checkSequence) return;
      await load();
    } catch (failure) {
      if (token !== checkSequence) return;
      setText(
        clearanceStatus,
        failure instanceof ApiFailure ? failure.message : copy.unreachable,
      );
      await load();
      if (token === checkSequence && failure instanceof ApiFailure) {
        setText(clearanceStatus, failure.message);
      }
    }
  });

  startButton.addEventListener("click", async () => {
    const dive = current();
    if (!dive) return;
    setText(clearanceStatus, copy.startingDive);
    startButton.setAttribute("disabled", "");
    try {
      await post(`/api/dives/${dive.id}/start`);
      clockBase = null;
      await load();
      setText(clearanceStatus, copy.diveStarted);
    } catch (failure) {
      setText(
        clearanceStatus,
        failure instanceof ApiFailure ? failure.message : copy.unreachable,
      );
    } finally {
      startButton.removeAttribute("disabled");
    }
  });

  finishButton.addEventListener("click", async () => {
    const dive = current();
    if (!dive) return;
    trackError.classList.add("hidden");
    setText(clearanceStatus, copy.finishingDive);
    const lines = trackBox.value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const track = lines.map((line) => {
      const [t, bearing, depth] = line.split(",");
      return {
        t_s: Number(t),
        bearing_deg: Number(bearing),
        depth_m: Number(depth),
      };
    });
    try {
      await post(`/api/dives/${dive.id}/finish`, { track });
      await load();
      setText(clearanceStatus, copy.diveRecorded);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const entry = Object.entries(failure.fields).find(([key]) => key.startsWith("track["));
        if (entry) {
          const index = Number(entry[0].slice(6, -1)) + 1;
          trackError.classList.remove("hidden");
          clear(trackError);
          trackError.appendChild(icon("alert"));
          trackError.appendChild(
            document.createTextNode(copy.trackRowInvalid(index, entry[1])),
          );
          setText(clearanceStatus, copy.trackRowInvalid(index, entry[1]));
          return;
        }
        setText(clearanceStatus, failure.message);
        return;
      }
      setText(clearanceStatus, copy.unreachable);
    }
  });

  sonarButton.addEventListener("click", () => sonarChooser.click());
  sonarChooser.addEventListener("change", async () => {
    const dive = current();
    const file = sonarChooser.files?.[0];
    if (!dive || !file) return;
    if (file.size > SONAR_LIMIT) {
      setText(clearanceStatus, copy.sonarTooLarge);
      return;
    }
    setText(clearanceStatus, copy.uploadingSonar);
    try {
      const payload = await upload(
        `/api/dives/${dive.id}/sonar`,
        file,
        file.name,
        file.type || "application/octet-stream",
      );
      await load();
      setText(clearanceStatus, copy.attachedSonar(payload.capture.id as string));
    } catch (failure) {
      setText(
        clearanceStatus,
        failure instanceof ApiFailure ? failure.message : copy.unreachable,
      );
    }
  });

  const penPayload = await get("/api/pens");
  pens = penPayload.pens as Pen[];
  await load();

  const ticker = window.setInterval(() => {
    const dive = current();
    if (dive) renderClock(dive);
  }, 1000);
  const refresh = window.setInterval(() => void load(), 30000);

  return {
    destroy(): void {
      destroyed = true;
      window.clearInterval(ticker);
      window.clearInterval(refresh);
    },
  };
}
