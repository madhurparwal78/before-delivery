import { Pause } from "lucide";
import { stepLimit, type InputEvent, type LayoutId, type Mode } from "../../shared/model";
import { get, send, errorCode } from "../api";
import { h, icon } from "../dom";
import { fmtCoins, fmtDelta, fmtSpeed, fmtTime, type Units } from "../format";
import { sendFinish } from "../race/finish";
import { DRIVING_KEYS } from "../race/keys";
import { RaceSession, ghostFromReplay, type GhostState, type HudModel } from "../race/session";
import { createRaceView, type RaceView } from "../race/view";
import { navigate, type PageContext } from "../router";
import { me } from "../session";
import { renderShell } from "../shell";
import { openDialog } from "../ui/dialog";
import type { Championship, Garage, RunCreated, RunSummary } from "../types";

const DESKTOP_NOTICE = "Racing needs a desktop browser with a keyboard.";
const GHOST_UNAVAILABLE = "Ghost unavailable. Racing without it.";

export function desktopNotice(main: HTMLElement): void {
  main.append(h("div", { class: "desktop-notice" },
    h("h1", null, "Desktop racing"),
    h("p", null, DESKTOP_NOTICE),
    h("p", null, h("a", { href: "/garage", class: "button" }, "Back to the garage"))));
}

// The ghost's run summary and stored replay, driven through the race model up front.
async function loadGhost(runId: string, signal: AbortSignal): Promise<GhostState> {
  try {
    const summary = await get<RunSummary>(`/v1/runs/${runId}`, signal);
    const replay = await get<{ inputs: InputEvent[] }>(`/v1/runs/${runId}/replay`, signal);
    if (summary.status !== 200 || replay.status !== 200) return { kind: "unavailable" };
    const run = summary.data;
    const laps = Math.max(1, run.lapResults?.length ?? 1);
    return {
      kind: "ready",
      ghost: ghostFromReplay(run.name, run.carId, run.car.stats, run.layoutId, run.mode, laps, stepLimit(run.mode, laps), replay.data.inputs),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function racePage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Race";
  const main = renderShell(true, ["Grid", "Race", "Finish"]);
  if (window.innerWidth < 1024) {
    desktopNotice(main);
    return;
  }
  const params = ctx.url.searchParams;
  const layoutId = params.get("layout") as LayoutId;
  const mode = params.get("mode") as Mode;
  const eventId = params.get("event");
  const laps = params.get("laps");
  const ghostId = params.get("ghost");
  const units: Units = me()!.units;

  const lines = new Map<string, HTMLElement>();
  const hud = h("section", { class: "hud", role: "region", "aria-label": "Race HUD", tabindex: "0" });
  const line = (key: string, text: string | null, extra = "") => {
    let el = lines.get(key);
    if (text === null) {
      el?.remove();
      lines.delete(key);
      return;
    }
    if (!el) {
      el = h("p", { class: `hud-line ${extra}` });
      lines.set(key, el);
      const order = ["lap", "position", "speed", "coins", "drift", "stage", "ghost", "delta", "prompt"];
      const after = order.slice(order.indexOf(key) + 1).map((k) => lines.get(k)).find((node) => node?.isConnected);
      hud.insertBefore(el, after ?? null);
    }
    if (el.textContent !== text) el.textContent = text;
  };
  const updates = h("p", { role: "status", "aria-label": "Race updates", class: "status-line" });
  const pauseButton = h("button", { type: "button" }, icon(Pause, 16), "Pause");
  const viewSlot = h("div", { class: "race-view" });
  const failure = h("p", { class: "dialog-error", role: "alert" });
  main.append(
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Stage 02 · Race"), h("h1", null, "Race"))),
    h("div", { class: "race-layout" },
      viewSlot,
      h("div", null, hud, h("div", { class: "race-tools" }, pauseButton), updates,
        h("p", { class: "race-keys" }, "Up or W throttle · Down or S brake · Left/Right or A/D lanes · Space drift · Escape pause"))),
    failure);
  hud.focus();

  let ghost: GhostState = ghostId ? { kind: "loading" } : { kind: "none" };
  let lastHud: HudModel | null = null;
  const paintGhostLabel = () => {
    if (ghost.kind === "loading") line("ghost", "Ghost: loading");
    else if (ghost.kind === "unavailable") line("ghost", GHOST_UNAVAILABLE);
    else if (ghost.kind === "ready") line("ghost", `Ghost: ${ghost.ghost.name}`);
    else line("ghost", null);
  };
  const paintHud = (model: HudModel) => {
    lastHud = model;
    line("lap", `Lap ${model.lap}/${model.laps}`);
    line("position", model.position ? `Position ${model.position.p}/${model.position.cars}` : null);
    line("speed", fmtSpeed(model.speedMps, units));
    line("coins", model.coins === null ? null : `Coins ${fmtCoins(model.coins)}`);
    line("drift", model.drift ? `Drift ${fmtCoins(model.drift.score)}` : null);
    line("stage", model.drift ? `Stage time ${model.drift.secondsLeft}` : null);
    paintGhostLabel();
    line("delta", model.deltaMs === null ? null : `Delta ${fmtDelta(model.deltaMs)}`);
    line("prompt", model.prompt ? "Press Enter to start" : null, "hud-prompt");
  };

  let session: RaceSession | null = null;
  let view: RaceView | null = null;
  let paused: ReturnType<typeof openDialog> | null = null;
  let generation = 0;

  async function createRun(): Promise<RunCreated | null> {
    const garage = (await get<Garage>("/v1/garage", ctx.signal)).data;
    const body: Record<string, unknown> = { layoutId, mode, carId: garage.selectedCarId };
    if (eventId) {
      body.eventId = eventId;
      const championship = (await get<Championship>("/v1/championship", ctx.signal)).data;
      const event = championship.leagues.flatMap((league) => league.events).find((entry) => entry.eventId === eventId);
      if (event && !event.eligible && event.loanerCarId) body.loaner = true;
    }
    if (laps) body.laps = Number(laps);
    const result = await send<RunCreated>("POST", "/v1/runs", body, ctx.signal);
    if (result.status !== 201) {
      const message = (result.data as unknown as { error?: { message?: string } })?.error?.message ?? "This race could not start.";
      failure.textContent = `${message} (${errorCode(result) ?? result.status})`;
      return null;
    }
    return result.data;
  }

  async function startRun(): Promise<void> {
    const mine = ++generation;
    session?.dispose();
    session = null;
    updates.textContent = "";
    const run = await createRun().catch(() => null);
    if (!run || mine !== generation || ctx.signal.aborted) return;
    if (!view) {
      view = createRaceView(run.layoutId, run.mode);
      viewSlot.append(view.canvas);
    }
    session = new RaceSession(run, view, () => ghost, {
      hud: paintHud,
      lapDone: (lap, lapMs, valid) => { updates.textContent = `Lap ${lap}: ${fmtTime(lapMs)}${valid ? "" : ", invalid"}`; },
      finished: (body) => {
        sendFinish(run.runId, body);
        navigate(`/runs/${run.runId}`, { replace: true, state: { arrived: true } });
      },
    });
  }

  function openPause(): void {
    if (paused || !session) return;
    session.pause();
    const resume = h("button", { type: "button", class: "primary" }, "Resume");
    const restart = h("button", { type: "button" }, "Restart");
    const quit = h("button", { type: "button" }, "Quit to garage");
    const handle = openDialog({
      title: "Paused",
      body: [h("p", null, "The race is stopped on this step. Nothing moves until you resume.")],
      actions: [resume, restart, quit],
      onEscape: () => doResume(),
      initialFocus: resume,
      docked: true,
    });
    paused = handle;
    const close = () => {
      handle.close();
      paused = null;
    };
    const doResume = () => {
      close();
      session?.resume();
      hud.focus();
    };
    resume.addEventListener("click", doResume);
    restart.addEventListener("click", () => {
      close();
      if (lastHud) paintHud({ ...lastHud, lap: 1, speedMps: 0, deltaMs: lastHud.deltaMs === null ? null : 0, prompt: true });
      hud.focus();
      void startRun();
    });
    quit.addEventListener("click", () => {
      close();
      session?.dispose();
      navigate("/garage", { state: { focusNav: true } });
    });
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (paused || !session) return;
    if (event.key === "Escape") {
      event.preventDefault();
      openPause();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (session.waiting) session.begin();
    } else if (DRIVING_KEYS.has(event.key)) {
      event.preventDefault();
      session.keyDown(event.key, event.repeat);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (DRIVING_KEYS.has(event.key) || event.key === "Enter") {
      if (!paused) event.preventDefault();
      session?.keyUp(event.key);
    }
  };
  const onHidden = () => { if (document.hidden && session?.running) openPause(); };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", onHidden);
  pauseButton.addEventListener("click", openPause);
  ctx.signal.addEventListener("abort", () => {
    generation += 1;
    session?.dispose();
    paused?.close();
    view?.dispose();
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("visibilitychange", onHidden);
  });

  paintGhostLabel();
  if (ghostId) {
    void loadGhost(ghostId, ctx.signal).then((state) => {
      if (ctx.signal.aborted) return;
      ghost = state;
      paintGhostLabel();
      if (session?.waiting) session.paint();
    });
  }
  await startRun();
}
