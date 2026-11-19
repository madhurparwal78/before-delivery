// The room screen: lobby, HUD, ammo station drawer, timers list, pause menu,
// debrief and convoy HUD. All server values; the browser renders.
import { api, type RoomState } from "./api";
import { el, clear } from "./ui";
import { fmtMs, fmtLapMs, fmtLapCounting } from "./format";
import type { App } from "./main";
import { connectRoom, type RoomConn } from "./roomconn";
import { openPauseMenu } from "./settings";

export function openRoomHUD(app: App, code: string, initial?: RoomState): void {
  app.activeRoomCode = code;
  const root = app.root;
  clear(root);

  const hud = el("div", { class: "hud", role: "region", "aria-label": "HUD" });
  root.append(hud);

  let state: RoomState | null = initial ?? null;
  let phaseSeen: string | null = null;
  let eventSeqSeen = 0;
  let meId = app.me?.id ?? "";
  let paused = false;
  let timersOpen = false;

  // Fuse clocks currently displayed, by name.
  const fuses = new Map<string, { el: HTMLElement; serverMs: number; countingUp: boolean }>();

  function ensureFuse(parent: HTMLElement, name: string, serverMs: number | null, countingUp = false): HTMLElement {
    let f = fuses.get(name);
    if (!f) {
      const node = el("span", { class: "fuse", role: "timer", "aria-label": name, "data-server-ms": "0" });
      parent.append(node);
      f = { el: node, serverMs: 0, countingUp };
      fuses.set(name, f);
    }
    if (serverMs !== null) {
      f.serverMs = serverMs;
      f.countingUp = countingUp;
      f.el.setAttribute("data-server-ms", String(serverMs));
      f.el.textContent = countingUp ? fmtLapCounting(serverMs) : fmtMs(serverMs);
    }
    return f.el;
  }

  function render(): void {
    if (!state) return;
    const s = state;
    const me = s.players.find((p) => p.id === meId) ?? s.players[0];
    const isSiege = s.mode === "siege";

    // Phase change handling: lobby shows its own panel; over shows debrief.
    if (s.phase !== phaseSeen) {
      phaseSeen = s.phase;
      if (s.phase === "lobby") renderLobby();
      if (s.phase === "over") renderDebrief();
      if (s.phase === "countdown" || s.phase === "race") closeLobby();
    } else if (s.phase === "lobby") {
      // The lobby re-renders from each server snapshot.
      renderLobby();
    }
    if (paused) return;

    clear(hud);

    // Degraded banner.
    if (s.degraded) {
      hud.append(el("div", { class: "banner", role: "status", style: "position:absolute;top:0;left:0;right:0;z-index:70" },
        el("div", { class: "line", text: "Room paused — the room registry dropped. Timers are frozen and resume when it's back." })));
    }

    const topbar = el("div", { class: "topbar" });
    const shopBtn = el("button", { class: "btn btn-ghost", text: "Shop", "aria-label": "Shop" });
    shopBtn.disabled = !s.shop.open;
    shopBtn.addEventListener("click", () => openShop(app, s, conn));
    const timersBtn = el("button", { class: "btn btn-ghost", text: "Timers", "aria-label": "Timers", "aria-expanded": String(timersOpen) });
    timersBtn.addEventListener("click", () => { timersOpen = !timersOpen; timersBtn.setAttribute("aria-expanded", String(timersOpen)); render(); });
    const pauseBtn = el("button", { class: "btn btn-ghost", text: "Pause", "aria-label": "Pause" });
    pauseBtn.addEventListener("click", () => openPauseFor(app, s, conn));
    topbar.append(shopBtn, timersBtn, pauseBtn);

    if (isSiege) {
      const tl = el("div", { class: "corner tl" });
      const waveText = s.phase === "countdown" ? "Countdown"
        : s.phase === "intermission" ? "Intermission"
        : s.phase === "boss_wave" ? "Boss wave"
        : `Wave ${s.wave} of 3`;
      tl.append(
        el("div", { role: "group", "aria-label": "Wave", text: waveText }),
        s.phase_remaining_ms !== null ? ensureFuse(tl, s.phase === "countdown" ? "Countdown" : "Intermission", s.phase_remaining_ms) : el("span"),
      );
      if (s.phase === "wave" && s.wave > 0) tl.append(el("div", { class: "label", text: `Wave ${s.wave} of 3` }));

      const tr = el("div", { class: "corner tr" });
      if (me) {
        tr.append(
          el("div", { class: "readout" }, el("span", { class: "label", text: "Credits" }), el("span", { class: "val", text: `${me.credits} cr` })),
          el("div", { class: "readout" }, el("span", { class: "label", text: "Score" }), el("span", { class: "val", text: String(me.score) })),
        );
      }

      const bl = el("div", { class: "corner bl" });
      if (me) {
        const statusText = me.status === "up" ? "Up" : me.status === "downed" ? "Downed" : "Out";
        bl.append(
          el("div", { class: "readout" }, el("span", { class: "label", text: "Health" }), el("span", { class: "val", text: String(me.hp) })),
          el("div", { class: "health-meter", role: "meter", "aria-label": "Health", "aria-valuenow": String(me.hp), "aria-valuemin": "0", "aria-valuemax": "100" },
            el("span", { class: "fill", style: `width:${me.hp}%` })),
          el("div", { role: "group", "aria-label": "Status", text: statusText }),
        );
        for (const p of s.players) {
          if (p.status === "downed" && p.revive_remaining_ms !== null) {
            bl.append(ensureFuse(bl, `Revive window ${p.callsign}`, p.revive_remaining_ms));
          }
        }
      }

      const br = el("div", { class: "corner br" });
      if (me) {
        br.append(
          el("div", { role: "group", "aria-label": "Ammo", text: `${me.mag} / ${me.reserve}` }),
          el("div", { role: "group", "aria-label": "Grenades", text: String(me.grenades) }),
        );
        if (me.reload_remaining_ms !== null) {
          br.append(ensureFuse(br, "Reload", me.reload_remaining_ms));
        }
      }

      const feed = el("div", { class: "match-feed", role: "status", "aria-label": "Match feed" });
      for (const ev of s.events) {
        if (ev.seq > eventSeqSeen) {
          eventSeqSeen = ev.seq;
          const line = feedLine(ev);
          if (line) feed.append(el("div", { text: line }));
        }
      }

      hud.append(tl, tr, bl, br, topbar, feed);
    } else {
      const v = s.vehicles.find((x) => x.player === meId) ?? s.vehicles[0];
      const top = el("div", { class: "corner tl" });
      top.append(
        el("div", { role: "group", "aria-label": "Lap", text: `Lap ${(v?.laps_done ?? 0) + 1} of 3` }),
        v ? el("div", { role: "timer", "aria-label": "Lap", "data-server-ms": String(v.lap_elapsed_ms), text: fmtLapCounting(v.lap_elapsed_ms) }) : el("span"),
        el("div", { role: "group", "aria-label": "Checkpoint", text: v?.next_checkpoint === "C0" ? "Finish" : `Next checkpoint ${checkpointNum(v?.next_checkpoint ?? "C1")} of 4` }),
        el("div", { role: "group", "aria-label": "Best lap", text: v?.best_lap_ms ? fmtLapMs(v.best_lap_ms) : "—" }),
      );
      hud.append(top, topbar);
      if (v?.state === "wrecked" && v.reset_remaining_ms !== null) {
        const centre = el("div", { class: "corner", style: "top:40%;left:50%;transform:translateX(-50%)" });
        centre.append(ensureFuse(centre, "Reset", v.reset_remaining_ms));
        hud.append(centre);
      }
    }

    // Timers list.
    if (timersOpen) {
      renderTimersList(s);
    }
    app.stage.applySnapshot(s);
    syncTouchControls();
  }

  let timersList: HTMLElement | null = null;
  function renderTimersList(s: RoomState): void {
    if (timersList) timersList.remove();
    timersList = el("ul", { class: "timers-list", role: "list", "aria-label": "Timers" });
    const me = s.players.find((p) => p.id === meId);
    const add = (name: string, ms: number | null): void => {
      if (ms === null) return;
      timersList!.append(el("li", {}, el("span", { text: name }), el("span", { class: "fuse", text: fmtMs(ms) })));
    };
    if (s.phase_remaining_ms !== null) add(s.phase === "countdown" ? "Countdown" : "Intermission", s.phase_remaining_ms);
    if (s.invite_remaining_ms !== null) add("Invite expires", s.invite_remaining_ms);
    if (me?.reload_remaining_ms != null) add("Reload", me.reload_remaining_ms);
    if (me?.revive_remaining_ms != null) add(`Revive window ${me.callsign}`, me.revive_remaining_ms);
    for (const p of s.players) if (p.status === "downed" && p.revive_remaining_ms) add(`Revive window ${p.callsign}`, p.revive_remaining_ms);
    for (const g of s.grenades) add("Grenade fuse", g.fuse_remaining_ms);
    for (const p of s.players) if (p.grace_remaining_ms != null) add("Reconnect grace", p.grace_remaining_ms);
    for (const v of s.vehicles) if (v.reset_remaining_ms != null) add("Reset", v.reset_remaining_ms);
    hud.append(timersList);
  }

  function checkpointNum(id: string): number {
    const n = Number(id.replace("C", ""));
    return Number.isFinite(n) ? n : 1;
  }

  function feedLine(ev: { type: string; [k: string]: unknown }): string | null {
    switch (ev.type) {
      case "player_down": return `${ev.callsign} is down`;
      case "player_revived": return `${ev.callsign} revived`;
      case "player_out": return `${ev.callsign} is out`;
      case "player_respawned": return `${ev.callsign} is back`;
      case "wave_cleared": return (ev.wave as number) === 4 ? "Boss wave cleared" : `Wave ${ev.wave} cleared`;
      case "phase": {
        const ph = ev.phase as string;
        if (ph === "intermission") {
          const to = ev.to_wave as number;
          const secs = Math.ceil(((ev.intermission_ms as number) ?? 20000) / 1000);
          return `Intermission — ${secs} s to ${to === 4 ? "boss wave" : `wave ${to}`}`;
        }
        if (ph === "boss_wave") return "Boss wave";
        if (ph === "over") return ev.result === "victory" ? "Victory" : ev.result === "defeat" ? "Defeat" : "Ended";
        return null;
      }
      case "host_changed": return `${ev.callsign} is now host`;
      case "kill": return null;
      case "reload": return "Reloaded";
      case "explosion": return "Grenade detonated";
      case "lap": return `Lap ${ev.lap}: ${fmtLapMs(ev.lap_ms as number)}`;
      case "wrecked": return `Wrecked — resetting at checkpoint ${checkpointNum(String(ev.checkpoint ?? "C0"))}`;
      case "reset": return "Reset";
      case "finished": return "Finished";
      case "purchase": return null;
      case "disconnected": return null;
      case "reconnected": return null;
      default: return null;
    }
  }

  // ---------- Lobby ----------

  let lobbyScrim: HTMLElement | null = null;
  let lobbyRefs: {
    seatList: HTMLElement;
    readyBtn: HTMLButtonElement;
    startBtn: HTMLButtonElement;
    inviteRow: HTMLElement;
  } | null = null;

  function renderLobby(): void {
    if (!state) return;
    const s = state;
    const me = s.players.find((p) => p.id === meId);
    const iAmHost = s.host === meId;

    if (!lobbyScrim) {
      lobbyScrim = el("div", { class: "scrim", style: "background:transparent;backdrop-filter:none;pointer-events:none" });
      const panel = el("div", { class: "panel", role: "region", "aria-label": "Lobby", style: "pointer-events:auto" });
      const heading = el("h2", { text: `Room ${s.code}` });
      const seatList = el("ul", { class: "hairline-list", role: "list", "aria-label": "Seats" });
      const readyBtn = el("button", { class: "btn btn-ghost", text: "Ready", "aria-pressed": "false" });
      readyBtn.addEventListener("click", async () => {
        const target = !readyNow();
        const res = await api.post(`/rooms/${s.code}/ready`, { ready: target });
        if (res.error) app.toast(res.error.message);
      });
      const startBtn = el("button", { class: "btn btn-mint", text: "Start match" });
      startBtn.addEventListener("click", async () => {
        app.setNotices("Starting match…");
        const res = await api.post(`/rooms/${s.code}/start`);
        if (res.error) {
          app.toast(res.error.code === "not_all_ready" ? "Everyone must be ready first."
            : res.error.code === "not_host" ? "Only the host can start." : res.error.message);
          app.setNotices("");
        }
      });
      const copyBtn = el("button", { class: "btn btn-ghost", text: "Copy invite" });
      copyBtn.addEventListener("click", () => {
        void navigator.clipboard?.writeText(`${location.origin}/room/${s.code}`);
        app.toast("Invite copied.");
      });
      const leaveBtn = el("button", { class: "btn btn-ghost", text: "Leave room" });
      leaveBtn.addEventListener("click", () => { void leave(); });
      const inviteRow = el("div", { class: "seat-note" });
      panel.append(heading, seatList,
        el("div", { class: "btn-row", style: "justify-content:flex-start;flex-wrap:wrap" }, readyBtn, startBtn, copyBtn, leaveBtn),
        inviteRow);
      lobbyScrim.append(panel);
      document.body.append(lobbyScrim);
      lobbyRefs = { seatList, readyBtn, startBtn, inviteRow };
      // Focus lands on the ready button when the lobby opens.
      readyBtn.focus();
    }

    // Patch in place from the snapshot.
    const refs = lobbyRefs!;
    const seats = [...refs.seatList.children];
    s.players.forEach((p, i) => {
      const bits = [`Seat ${p.seat} · ${p.callsign} · ${p.ready ? "Ready" : "Not ready"}`];
      if (p.id === s.host) bits.push("Host");
      if (p.connection === "disconnected") bits.push("Disconnected");
      const line = bits.join(" · ");
      if (seats[i]) seats[i].textContent = line;
      else refs.seatList.append(el("li", { text: line }));
    });
    for (let i = s.players.length; i < seats.length; i++) seats[i].remove();

    refs.readyBtn.setAttribute("aria-pressed", String(me?.ready ?? false));
    refs.startBtn.style.display = iAmHost ? "" : "none";
    refs.startBtn.disabled = !iAmHost || !s.players.every((p) => p.ready);
    if (s.invite_remaining_ms !== null) {
      refs.inviteRow.setAttribute("role", "timer");
      refs.inviteRow.setAttribute("aria-label", "Invite expires");
      refs.inviteRow.textContent = `Invite expires ${fmtMs(s.invite_remaining_ms)}`;
    }
  }

  function readyNow(): boolean {
    if (!state) return false;
    const me = state.players.find((p) => p.id === meId);
    return me?.ready ?? false;
  }

  function closeLobby(): void {
    lobbyScrim?.remove();
    lobbyScrim = null;
    lobbyRefs = null;
  }

  async function leave(): Promise<void> {
    await api.post(`/rooms/${code}/leave`).catch(() => undefined);
    conn.close();
    app.activeRoomCode = null;
    app.stage.setMode("title");
    location.href = "/";
    location.reload();
  }

  function openPauseFor(app2: App, s: RoomState, conn2: RoomConn): void {
    paused = true;
    openPauseMenu(app2, s, {
      onResume(): void { paused = false; render(); },
      onLeave(): void { void leave(); },
    });
  }

  // ---------- Debrief ----------

  function renderDebrief(): void {
    if (!state) return;
    const s = state;
    const result = s.result === "victory" ? "Victory" : s.result === "defeat" ? "Defeat" : "Ended";
    const scrim = el("div", { class: "scrim" });
    const panel = el("div", { class: "panel", role: "dialog", "aria-label": "Debrief" });
    panel.append(el("h2", { text: result }));
    const table = el("table", { role: "table", "aria-label": "Squad results" });
    table.append(el("thead", {}, el("tr", {},
      el("th", { text: "Callsign" }), el("th", { text: "Score" }), el("th", { text: "Kills" }), el("th", { text: "Credits earned" }))));
    const tbody = el("tbody");
    for (const p of s.players) {
      tbody.append(el("tr", {},
        el("td", { text: p.callsign }), el("td", { class: "num-cell", text: String(p.score) }),
        el("td", { class: "num-cell", text: String(p.kills) }), el("td", { class: "num-cell", text: String(p.credits) })));
    }
    table.append(tbody);
    panel.append(table);
    const back = el("button", { class: "btn btn-mint", text: "Back to title" });
    back.addEventListener("click", () => { void leave(); });
    const view = el("button", { class: "btn btn-ghost", text: "View history" });
    view.addEventListener("click", () => {
      scrim.remove();
      import("./history").then((m) => m.openHistoryPanel(app));
    });
    panel.append(el("div", { class: "btn-row" }, back, view));
    scrim.append(panel);
    document.body.append(scrim);
  }

  // ---------- Ammo station ----------

  function openShop(app2: App, s: RoomState, conn2: RoomConn): void {
    const scrim = el("div", { class: "scrim", style: "background:transparent;pointer-events:none" });
    const drawer = el("div", { class: "drawer", role: "dialog", "aria-label": "Ammo station", style: "pointer-events:auto" });
    drawer.append(el("h2", { text: "Ammo station" }));
    const list = el("div");
    const buyButtons: HTMLButtonElement[] = [];
    for (const item of s.shop.items) {
      const row = el("div", { class: "switch-row" });
      const priceText = `${item.price} cr`;
      const buy = el("button", { class: "btn btn-mint", text: `Buy ${item.name} — ${priceText}`, "aria-label": `Buy ${item.name} — ${priceText}` });
      buy.addEventListener("click", async () => {
        buy.disabled = true;
        app2.setNotices(`Buying ${item.name}…`);
        const res = await conn2.purchase(`p${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, item.item);
        buy.disabled = false;
        if (res.ok) app2.toast(`Bought ${item.name} for ${item.price} cr.`);
        else app2.toast(res.message ?? "Something went wrong on the server. Try again.");
      });
      buyButtons.push(buy);
      row.append(el("span", { text: item.name }), buy);
      if (item.next_change_in_ms !== null) {
        row.append(el("div", { class: "seat-note", role: "timer", "aria-label": `Price change ${item.name}`, text: fmtMs(item.next_change_in_ms) }));
      }
      list.append(row);
    }
    const closeBtn = el("button", { class: "btn btn-ghost", text: "Close" });
    closeBtn.addEventListener("click", closeDrawer);
    drawer.append(list, el("div", { class: "btn-row" }, closeBtn));
    scrim.append(drawer);
    document.body.append(scrim);
    buyButtons[0]?.focus();

    function closeDrawer(): void {
      scrim.remove();
      document.removeEventListener("keydown", onKey, true);
      hud.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeDrawer(); }
      if (e.key === "Tab") {
        const f = [closeBtn, ...buyButtons];
        const first = f[0]; const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    // Close when the intermission ends.
    const check = setInterval(() => {
      if (!state || state.phase !== "intermission") { clearInterval(check); closeDrawer(); }
    }, 200);
  }

  // ---------- Connection ----------

  const conn = connectRoom(code, {
    onSnapshot(s): void {
      state = s;
      meId = app.me?.id ?? s.players[0]?.id ?? "";
      app.stage.setMode(s.mode === "convoy" ? "convoy" : "siege");
      app.stage.setPlayerId(meId);
      render();
    },
    onDisconnect(): void {
      app.setNotices("Connection lost — reconnecting. Your seat is held.");
      render();
    },
    onReconnect(n): void {
      app.setNotices(`Reconnected — ${n} buffered reports sent.`);
    },
  });

  // ---------- Input: keyboard, mouse and touch drive the same server actions ----------

  const DEFAULT_BINDINGS: Record<string, string> = {
    move_up: "KeyW", move_down: "KeyS", move_left: "KeyA", move_right: "KeyD",
    aim_left: "KeyQ", aim_right: "KeyE", fire: "Space", reload: "KeyR",
    grenade: "KeyG", revive: "KeyF", shop: "KeyB", timers: "KeyT",
  };
  const ACTION_KEYS = new Set(Object.keys(DEFAULT_BINDINGS));

  let heldKeys = new Set<string>();
  let aim = 90;
  let lastShotAt = 0;
  let moveVec = { x: 0, z: 0 };
  let inputSeq = 0;
  let fireRepeatTimer: number | null = null;

  function bindings(): Record<string, string> {
    return app.settings?.bindings ?? DEFAULT_BINDINGS;
  }

  function actionFor(code: string): string | null {
    if (code === "Escape") return null;
    for (const [a, c] of Object.entries(bindings())) if (c === code) return a;
    return null;
  }

  function inTextField(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName) || t.hasAttribute("contenteditable"));
  }

  function dialogOpen(): boolean {
    // The HUD is not a dialog; only real dialogs block game keys.
    return !!document.querySelector('[role="dialog"]');
  }

  function sendMove(): void {
    if (!state) return;
    inputSeq += 1;
    const res = { seq: inputSeq, move: { x: moveVec.x, z: moveVec.z }, aim };
    void fetch(`/api/rooms/${encodeURIComponent(code)}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(res),
    }).catch(() => undefined);
  }

  function tryFire(): void {
    const now = performance.now();
    if (now - lastShotAt < 100) return; // holding repeats no faster than the fire interval
    lastShotAt = now;
    void conn.sendReport({ report_id: reportId(), type: "shot", aim });
  }

  function startFireRepeat(): void {
    if (fireRepeatTimer !== null) return;
    fireRepeatTimer = window.setInterval(tryFire, 100);
  }

  function stopFireRepeat(): void {
    if (fireRepeatTimer !== null) {
      window.clearInterval(fireRepeatTimer);
      fireRepeatTimer = null;
    }
  }

  function doAction(action: string, isDown: boolean): void {
    switch (action) {
      case "move_up": moveVec.z = isDown ? 1 : moveVec.z === 1 ? 0 : moveVec.z; sendMove(); break;
      case "move_down": moveVec.z = isDown ? -1 : moveVec.z === -1 ? 0 : moveVec.z; sendMove(); break;
      case "move_left": moveVec.x = isDown ? -1 : moveVec.x === -1 ? 0 : moveVec.x; sendMove(); break;
      case "move_right": moveVec.x = isDown ? 1 : moveVec.x === 1 ? 0 : moveVec.x; sendMove(); break;
      case "aim_left": aim = (aim + 30 / 60 + 360) % 360; sendMove(); break;
      case "aim_right": aim = (aim - 30 / 60 + 360) % 360; sendMove(); break;
      case "fire":
        if (isDown) { tryFire(); startFireRepeat(); } else { stopFireRepeat(); }
        break;
      case "reload": if (isDown) void conn.sendReport({ report_id: reportId(), type: "reload" }); break;
      case "grenade":
        if (isDown) {
          const rad = (aim * Math.PI) / 180;
          const tx = (state?.players.find((p) => p.id === meId)?.x ?? 0) + Math.cos(rad) * 8;
          const tz = (state?.players.find((p) => p.id === meId)?.z ?? 0) + Math.sin(rad) * 8;
          void conn.sendReport({ report_id: reportId(), type: "grenade", target: { x: tx, z: tz } });
        }
        break;
      case "revive":
        if (isDown && state) {
          const me = state.players.find((p) => p.id === meId);
          const targets = state.players.filter((p) => p.id !== meId && p.status === "downed");
          if (me && targets.length) {
            targets.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
            void conn.sendReport({ report_id: reportId(), type: "revive", target_player: targets[0].id });
          }
        }
        break;
      case "shop": if (isDown && state?.shop.open) openShop(app, state, conn); break;
      case "timers": if (isDown) { timersOpen = !timersOpen; render(); } break;
    }
  }

  let reportCounter = 0;
  function reportId(): string {
    reportCounter += 1;
    return `b${Date.now()}-${reportCounter}`;
  }

  function gameKeyHandler(e: KeyboardEvent): void {
    if (!state || paused) return;
    if (inTextField(e)) return;
    if (dialogOpen()) return;
    const action = actionFor(e.code);
    if (!action) return;
    e.preventDefault();
    if (e.type === "keydown") {
      if (heldKeys.has(e.code)) return;
      heldKeys.add(e.code);
      doAction(action, true);
    }
  }

  function gameKeyUpHandler(e: KeyboardEvent): void {
    if (!state || paused) return;
    if (inTextField(e)) return;
    if (dialogOpen()) return;
    const action = actionFor(e.code);
    if (!action) return;
    e.preventDefault();
    heldKeys.delete(e.code);
    doAction(action, false);
  }

  document.addEventListener("keydown", gameKeyHandler);
  document.addEventListener("keyup", gameKeyUpHandler);

  // Pause opens with Escape even during a match.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !state || !app.activeRoomCode) return;
    if (inTextField(e)) return;
    if (document.querySelector('[role="dialog"][aria-label="Paused"]')) return;
    e.preventDefault();
    openPauseFor(app, state, conn);
  });

  // ---------- Convoy local driving ----------

  interface CarState { x: number; z: number; heading: number; speed: number }
  let car: CarState = { x: 0, z: 0, heading: 0, speed: 0 };
  let poseSeq = 0;
  let lastPoseAt = 0;
  let carInitialised = false;

  function driveCar(dt: number): void {
    if (!state) return;
    const v = state.vehicles.find((x) => x.player === meId);
    if (!v) return;
    if (!carInitialised || v.state === "wrecked" || v.state === "finished") {
      car = { x: v.x, z: v.z, heading: v.heading, speed: 0 };
      carInitialised = v.state === "running";
      lastPoseAt = performance.now();
      return;
    }
    const up = heldKeys.has(bindings().move_up) || touchThrottle > 0;
    const down = heldKeys.has(bindings().move_down) || touchThrottle < 0;
    const left = heldKeys.has(bindings().move_left) || touchSteer < 0;
    const right = heldKeys.has(bindings().move_right) || touchSteer > 0;

    if (up) car.speed = Math.min(car.speed + 10 * dt, 25);
    else if (down) {
      if (car.speed > 0) car.speed = Math.max(car.speed - 20 * dt, 0);
      else car.speed = Math.max(car.speed - 10 * dt, -8);
    } else {
      const decay = Math.min(5 * dt, Math.abs(car.speed));
      car.speed -= Math.sign(car.speed) * decay;
      if (Math.abs(car.speed) < 0.05) car.speed = 0;
    }
    if (car.speed !== 0) {
      let steer = 0;
      if (left) steer += 90;
      if (right) steer -= 90;
      car.heading = (car.heading + steer * dt + 360) % 360;
    }
    const rad = (car.heading * Math.PI) / 180;
    car.x += Math.cos(rad) * car.speed * dt;
    car.z += Math.sin(rad) * car.speed * dt;

    // Send a pose every 100 ms while running.
    const now = performance.now();
    if (now - lastPoseAt >= 100 && v.state === "running") {
      lastPoseAt = now;
      poseSeq += 1;
      void fetch(`/api/rooms/${encodeURIComponent(code)}/pose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ seq: poseSeq, x: car.x, z: car.z, heading: car.heading }),
      }).then((res) => res.json()).then((body) => {
        if (body && body.accepted === false) {
          // A refused pose snaps the car to the server's vehicle position.
          car = { x: body.vehicle.x, z: body.vehicle.z, heading: body.vehicle.heading, speed: 0 };
        } else if (body && body.vehicle && body.vehicle.state === "wrecked") {
          carInitialised = false;
        }
      }).catch(() => undefined);
    }
  }

  let lastDriveAt = performance.now();
  function driveLoop(): void {
    if (!app.activeRoomCode) return;
    requestAnimationFrame(driveLoop);
    if (document.hidden) return;
    if (state?.mode === "convoy" && state.phase === "race") {
      const now = performance.now();
      const dt = Math.min((now - lastDriveAt) / 1000, 0.1);
      lastDriveAt = now;
      driveCar(dt);
    } else {
      lastDriveAt = performance.now();
    }
  }
  requestAnimationFrame(driveLoop);

  // ---------- Touch ----------

  let touchThrottle = 0;
  let touchSteer = 0;

  function isTouch(): boolean {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  function buildTouchControls(): HTMLElement | null {
    if (!isTouch() || !state || state.mode !== "siege") return null;
    const layer = el("div", { class: "touch-layer" });
    const moveStick = makeStick("move", "Move stick", (dx, dy) => {
      moveVec = { x: dx, z: -dy };
      sendMove();
    });
    const aimStick = makeStick("aim", "Aim stick", (dx, dy) => {
      if (dx === 0 && dy === 0) return;
      aim = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (aim < 0) aim += 360;
      sendMove();
    });
    const actions = el("div", { class: "touch-actions" });
    const fire = el("button", { text: "Fire", "aria-label": "Fire" });
    fire.addEventListener("pointerdown", (e) => { e.preventDefault(); tryFire(); startFireRepeat(); });
    fire.addEventListener("pointerup", () => stopFireRepeat());
    fire.addEventListener("pointerleave", () => stopFireRepeat());
    const reload = el("button", { text: "Reload", "aria-label": "Reload" });
    reload.addEventListener("pointerdown", (e) => { e.preventDefault(); void conn.sendReport({ report_id: reportId(), type: "reload" }); });
    const grenade = el("button", { text: "Grenade", "aria-label": "Grenade" });
    grenade.addEventListener("pointerdown", (e) => { e.preventDefault(); void conn.sendReport({ report_id: reportId(), type: "grenade", target: { x: (state?.players[0]?.x ?? 0) + Math.cos((aim * Math.PI) / 180) * 8, z: (state?.players[0]?.z ?? 0) + Math.sin((aim * Math.PI) / 180) * 8 } }); });
    const pause = el("button", { text: "Pause", "aria-label": "Pause" });
    pause.addEventListener("pointerdown", (e) => { e.preventDefault(); openPauseFor(app, state!, conn); });
    actions.append(fire, reload, grenade, pause);
    layer.append(moveStick, aimStick, actions);
    return layer;
  }

  function makeStick(cls: string, label: string, onMove: (dx: number, dy: number) => void): HTMLElement {
    const stick = el("div", { class: `stick ${cls}`, role: "group", "aria-label": label });
    const nub = el("div", { class: "nub" });
    stick.append(nub);
    let active = false;
    let start = { x: 0, y: 0 };
    stick.addEventListener("pointerdown", (e) => {
      active = true;
      const rect = stick.getBoundingClientRect();
      start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      stick.setPointerCapture(e.pointerId);
    });
    stick.addEventListener("pointermove", (e) => {
      if (!active) return;
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const r = rect.width / 2;
      let dx = (e.clientX - cx) / r;
      let dy = (e.clientY - cy) / r;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      nub.style.transform = `translate(${dx * (rect.width / 2 - 22)}px, ${dy * (rect.height / 2 - 22)}px)`;
      onMove(dx, dy);
    });
    const end = (e: PointerEvent): void => {
      if (!active) return;
      active = false;
      nub.style.transform = "";
      try { stick.releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
      onMove(0, 0);
    };
    stick.addEventListener("pointerup", end);
    stick.addEventListener("pointercancel", end);
    return stick;
  }

  // Touch controls appear on coarse pointers while a match runs.
  const touchHolder = el("div");
  function syncTouchControls(): void {
    clear(touchHolder);
    if (isTouch() && state && state.phase !== "lobby" && state.phase !== "over") {
      const layer = buildTouchControls();
      if (layer) touchHolder.append(layer);
    }
  }
  document.body.append(touchHolder);
}
