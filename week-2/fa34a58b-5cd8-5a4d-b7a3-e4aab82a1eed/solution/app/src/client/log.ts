// The Day log: a household day's runs and clips (default the hub's today), and the clip sheet.

import { addDays, longDate, parseDate } from "../shared/zone.ts";
import type { ApiErrorBody, Clip, Run, Schedule } from "../shared/types.ts";
import { load } from "./api.ts";
import { emptyNote, h, num, pulse, setNum } from "./dom.ts";
import { icon } from "./icons.ts";
import { clockOf, live, secondsOf } from "./live.ts";
import { Sheet, sheetHeader } from "./sheets.ts";
import type { Shell } from "./shell.ts";

const STORING = "Storing clip…";
const MISMATCH = "Clip incomplete. Not saved.";
const MEDIA_DOWN = "The clip can't be loaded while clip storage is unreachable.";

function clipCopy(clip: Clip): string {
  if (clip.state === "stored") return `${clip.stored_size} bytes`;
  if (clip.state === "size_mismatch") return MISMATCH;
  return STORING;
}

export async function logPage(shell: Shell): Promise<void> {
  const schedules = (await load<{ schedules: Schedule[] }>("/api/schedules")).schedules;
  const scheduleName = (id: string) => schedules.find((schedule) => schedule.id === id)?.name ?? id;
  let day = live.status.day;

  const dayInput = h("input", {
    class: "input input-date", type: "text", inputmode: "numeric", autocomplete: "off", spellcheck: "false",
    "aria-label": "Log day", placeholder: "YYYY-MM-DD",
  });
  const previous = h("button", { type: "button", class: "btn" }, icon("chevron-left"), h("span", {}, "Previous day"));
  const next = h("button", { type: "button", class: "btn" }, h("span", {}, "Next day"), icon("chevron-right"));
  const heading = h("h2", { class: "log-day" });
  const runs = h("ul", { class: "line-list", "aria-label": "Runs" });
  const clips = h("ul", { class: "line-list", "aria-label": "Clips" });
  const runsEmpty = emptyNote("No runs on this day.");
  const clipsEmpty = emptyNote("No clips on this day.");
  shell.main.append(
    h("div", { class: "page-head" }, h("h1", {}, "Day log")),
    h("div", { class: "day-controls" }, previous, dayInput, next),
    heading,
    h("div", { class: "log-columns" },
      h("section", { class: "panel" }, h("h3", { class: "panel-title" }, "Runs"), runs, runsEmpty),
      h("section", { class: "panel" }, h("h3", { class: "panel-title" }, "Clips"), clips, clipsEmpty)),
  );

  // ---- clip sheet ----------------------------------------------------------------------------
  const sheetPanel = h("div", { class: "sheet sheet-wide" });
  const sheet = new Sheet({ element: sheetPanel, label: "Clip", onClose: () => stopVideo() });
  const sheetTitle = h("h2", { class: "sheet-title" });
  const video = h("video", { class: "clip-video", preload: "none", playsinline: true });
  const play = h("button", { type: "button", class: "btn btn-primary" }, icon("play"), h("span", {}, "Play"));
  const sheetState = h("p", { class: "clip-state" });
  const sizes = h("dl", { class: "sizes" });
  const mediaAlert = h("p", { class: "inline-alert", role: "alert", hidden: true });
  sheetPanel.append(sheetHeader(() => sheet, sheetTitle),
    h("div", { class: "sheet-body" }, h("div", { class: "clip-frame" }, video), sheetState, sizes, mediaAlert,
      h("div", { class: "form-actions" }, play)));
  let openClip: Clip | null = null;
  let objectUrl: string | null = null;

  function stopVideo(): void {
    video.pause();
    video.removeAttribute("src");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    openClip = null;
  }

  function renderSheet(clip: Clip): void {
    setNum(sheetState, clipCopy(clip));
    sheetState.classList.toggle("is-alert", clip.state === "size_mismatch");
    sizes.replaceChildren(
      h("dt", {}, "Declared size"), h("dd", {}, num(`${clip.declared_size} bytes`)),
      h("dt", {}, "Stored size"), h("dd", {}, clip.stored_size === null ? "Not yet reported" : num(`${clip.stored_size} bytes`)),
    );
    play.disabled = !clip.playable;
  }

  function showClip(clip: Clip, opener: HTMLElement): void {
    stopVideo();
    openClip = clip;
    const name = `Clip from ${clip.camera_name} at ${secondsOf(clip.recorded_at)}`;
    sheet.setLabel(name);
    sheetTitle.replaceChildren(num(name));
    mediaAlert.hidden = true;
    renderSheet(clip);
    sheet.open(opener);
  }

  play.addEventListener("click", async () => {
    const clip = openClip;
    if (!clip) return;
    mediaAlert.hidden = true;
    if (!objectUrl) {
      let response: Response;
      try {
        response = await fetch(`/api/clips/${encodeURIComponent(clip.id)}/media`, { cache: "no-store" });
      } catch {
        response = new Response(null, { status: 503 });
      }
      if (!response.ok) {
        const answer = (await response.json().catch(() => null)) as ApiErrorBody | null;
        mediaAlert.hidden = false;
        mediaAlert.textContent = response.status === 503 ? MEDIA_DOWN : (answer?.error.message ?? MEDIA_DOWN);
        return;
      }
      objectUrl = URL.createObjectURL(await response.blob());
      if (openClip !== clip) return;
      video.src = objectUrl;
    }
    video.play().catch(() => undefined);
  });

  // ---- lists ---------------------------------------------------------------------------------
  const clipRows = new Map<string, { row: HTMLElement; state: HTMLElement; clip: Clip }>();
  function clipRow(clip: Clip): HTMLElement {
    const label = `${clip.camera_name} ${secondsOf(clip.recorded_at)}`;
    const button = h("button", { type: "button", class: "line-btn", "aria-label": label }, icon("video"), h("span", {}, num(label)));
    const state = h("span", { class: `line-meta${clip.state === "size_mismatch" ? " is-alert" : ""}` }, num(clipCopy(clip)));
    button.addEventListener("click", () => showClip(clipRows.get(clip.id)?.clip ?? clip, button));
    const row = h("li", { class: "line" }, button, state);
    clipRows.set(clip.id, { row, state, clip });
    return row;
  }

  function runRow(run: Run): HTMLElement {
    return h("li", { class: "line" }, h("span", { class: "line-text" },
      num(`${clockOf(run.ran_at)} ${live.sceneName(run.scene_id)} · ${run.room_ids.length} rooms · ${scheduleName(run.schedule_id)}`)));
  }

  let ticket = 0;
  async function show(target: string): Promise<void> {
    const mine = (ticket += 1);
    const [runData, clipData] = await Promise.all([
      load<{ runs: Run[] }>(`/api/runs?day=${target}`),
      load<{ clips: Clip[] }>(`/api/clips?day=${target}`),
    ]);
    if (mine !== ticket) return;
    day = target;
    dayInput.value = day;
    heading.replaceChildren(day === live.status.day ? "Today" : num(longDate(day)));
    runs.replaceChildren(...runData.runs.map(runRow));
    runsEmpty.hidden = runData.runs.length > 0;
    clipRows.clear();
    clips.replaceChildren(...clipData.clips.map(clipRow));
    clipsEmpty.hidden = clipData.clips.length > 0;
  }

  async function refreshRuns(): Promise<void> {
    const data = await load<{ runs: Run[] }>(`/api/runs?day=${day}`);
    if (runs.childElementCount !== data.runs.length) {
      runs.replaceChildren(...data.runs.map(runRow));
      runsEmpty.hidden = data.runs.length > 0;
    }
  }

  live.on("clip", (message) => {
    const clip = message.clip;
    if (clip.day !== day) return;
    const existing = clipRows.get(clip.id);
    if (existing) {
      existing.clip = clip;
      existing.state.replaceChildren(num(clipCopy(clip)));
      existing.state.classList.toggle("is-alert", clip.state === "size_mismatch");
      pulse(existing.row);
    } else {
      const row = clipRow(clip);
      const after = [...clipRows.values()].filter((item) => item.clip.recorded_at > clip.recorded_at && item.row !== row)
        .sort((a, b) => a.clip.recorded_at.localeCompare(b.clip.recorded_at))[0];
      if (after) clips.insertBefore(row, after.row);
      else clips.append(row);
      clipsEmpty.hidden = true;
    }
    if (openClip?.id === clip.id) {
      openClip = clip;
      renderSheet(clip);
    }
  });
  let lastDay = live.status.day;
  live.on("status", () => {
    if (day === live.status.day) void refreshRuns();
    if (lastDay !== live.status.day) {
      lastDay = live.status.day;
      heading.replaceChildren(day === live.status.day ? "Today" : num(longDate(day)));
    }
  });
  live.onReconnect(() => void show(day));

  previous.addEventListener("click", () => void show(addDays(day, -1)));
  next.addEventListener("click", () => void show(addDays(day, 1)));
  const typed = () => {
    const parsed = parseDate(dayInput.value.trim());
    if (parsed) void show(parsed);
    else dayInput.value = day;
  };
  dayInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      typed();
    }
  });
  dayInput.addEventListener("change", typed);
  await show(day);
}
