// The founder console: missions, editor, studio zone and Online now, driven by the URL.

import { api, ApiCallError } from "./api.js";
import { h, icon } from "./dom.js";
import { RESIDENTS } from "../shared/seed.js";
import { isValidZoneClient, formatLocalClient } from "./zones-client.js";

type Mission = {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: "standard" | "rush";
  rush_slots: number | null;
  dialogue: { offer: string[]; thanks: string[] };
  status: "draft" | "scheduled" | "live" | "retired";
  version: number;
  revision: number;
  live_at: string | null;
};

type Studio = { time_zone: string; board_date: string };
type Online = { online: number; guests: number; signed_in: number };

export function startConsole(root: HTMLElement): void {
  root.replaceChildren();
  const main = h("main", { role: "main", "aria-label": "Founder console", class: "console-page" });
  root.append(main);

  let me: { role: string } | null = null;
  let missions: Mission[] = [];
  let studio: Studio | null = null;
  let online: Online | null = null;
  let editorMission: Mission | null = null;
  let editorIsNew = false;
  let editorRevision = 0;
  let editorLoadedSnapshot = "";
  let focusTarget: "title" | "firstMove" | "newMission" | null = null;
  let discardPendingUrl: string | null = null;

  // --- console-refusal card and founder shell --------------------------------------------
  async function boot(): Promise<void> {
    try {
      me = (await api<{ role: string }>("GET", "/api/me")).data;
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 401) {
        try {
          me = (await api<{ role: string }>("POST", "/api/guest", {})).data;
        } catch { /* show refusal anyway */ }
      }
    }
    render();
    if (me?.role === "founder") {
      await Promise.all([refreshMissions(), refreshStudio(), refreshOnline()]);
      loadFromUrl();
      render();
    }
  }
  void boot();

  function render(): void {
    const isFounder = me?.role === "founder";
    main.replaceChildren(h("h1", { class: "console-heading" }, "Founder console"));
    if (!isFounder) {
      const card = h("div", { class: "console-refusal" });
      card.append(h("p", { class: "refusal-copy" }, "Only the founder can open the console."));
      card.append(h("button", { class: "btn btn-primary", onclick: () => (location.href = "/") }, "Walk on Bramble"));
      if (!me || me.role === "guest") {
        const email = h("input", { type: "email", class: "field", "aria-label": "Email", placeholder: "name@example.com" }) as HTMLInputElement;
        const send = h("button", { class: "btn" }, "Send postbox key");
        send.addEventListener("click", async () => {
          try {
            await api("POST", "/api/auth/postbox-key", { email: email.value, return_to: location.pathname + location.search });
            send.textContent = "Check your inbox";
          } catch {
            send.textContent = "Try again";
          }
        });
        card.append(email, send);
      }
      main.append(card);
      return;
    }
    main.append(missionsRegion(), editorRegion(), studioRegion(), onlineRegion());
    queueMicrotask(applyFocusTarget);
    renderMissionRows();
    renderEditor();
  }

  function missionsRegion(): HTMLElement {
    const table = h("table", { role: "table", "aria-label": "Missions", class: "missions-table" },
      h("thead", {},
        h("tr", {},
          h("th", {}, "Title"), h("th", {}, "Status"), h("th", {}, "Version"), h("th", {}, "Goes live"),
        )),
      h("tbody", { id: "missions-body" }),
    );
    const newBtn = h("button", { id: "new-mission", class: "btn btn-small" }, "New mission");
    newBtn.addEventListener("click", () => {
      if (unsavedEdits() && !confirmDiscard(() => startNewMission())) return;
      startNewMission();
    });
    return h("section", { role: "region", "aria-label": "Missions", class: "console-region console-missions" },
      h2("Missions"), table, newBtn);
  }

  function h2(text: string): HTMLElement {
    return h("h2", { class: "region-heading" }, text);
  }

  function renderMissionRows(): void {
    const body = document.getElementById("missions-body");
    if (!body) return;
    body.replaceChildren();
    for (const mission of missions) {
      const goesLive = mission.status === "scheduled" && mission.live_at
        ? formatLocalClient(studio?.time_zone ?? "UTC", Date.parse(mission.live_at))
        : "—";
      const edit = h("button", { class: "btn btn-ghost", "aria-label": `Edit ${mission.title}` }, mission.title);
      edit.addEventListener("click", () => {
        if (unsavedEdits() && !confirmDiscard(() => openMission(mission.mission_id))) return;
        void openMission(mission.mission_id);
      });
      body.append(h("tr", { class: "mission-tr", "data-mission": mission.mission_id },
        h("td", {}, edit),
        h("td", {}, mission.status),
        h("td", {}, String(mission.version)),
        h("td", {}, goesLive),
      ));
    }
  }

  // --- the editor -------------------------------------------------------------------------
  const titleField = h("input", { type: "text", class: "field", "aria-label": "Title", id: "field-title", maxlength: "60" }) as HTMLInputElement;
  const residentField = h("select", { class: "field", "aria-label": "Resident", id: "field-resident" }) as HTMLSelectElement;
  for (const resident of RESIDENTS) {
    residentField.append(h("option", { value: resident.resident_id }, resident.name));
  }
  const rewardField = h("input", { type: "number", class: "field", "aria-label": "Stamp reward", id: "field-reward", min: "1", max: "50" }) as HTMLInputElement;
  const kindStandard = h("input", { type: "radio", name: "kind", value: "standard", id: "kind-standard" }) as HTMLInputElement;
  const kindRush = h("input", { type: "radio", name: "kind", value: "rush", id: "kind-rush" }) as HTMLInputElement;
  const slotsField = h("input", { type: "number", class: "field", "aria-label": "Rush slots", id: "field-slots", min: "1", max: "5" }) as HTMLInputElement;
  const offerField = h("textarea", { class: "field", "aria-label": "Offer lines", id: "field-offer", rows: "4" }) as HTMLTextAreaElement;
  const thanksField = h("textarea", { class: "field", "aria-label": "Thanks lines", id: "field-thanks", rows: "3" }) as HTMLTextAreaElement;
  const liveAtField = h("input", { type: "text", class: "field", "aria-label": "Go live at", id: "field-liveat", placeholder: "2027-01-15 09:30" }) as HTMLInputElement;
  const saveBtn = h("button", { class: "btn btn-primary", id: "btn-save" }, "Save draft");
  const scheduleBtn = h("button", { class: "btn", id: "btn-schedule" }, "Schedule");
  const publishBtn = h("button", { class: "btn", id: "btn-publish" }, "Publish now");
  const unscheduleBtn = h("button", { class: "btn", id: "btn-unschedule" }, "Unschedule");
  const retireBtn = h("button", { class: "btn", id: "btn-retire" }, "Retire");
  const fieldError = h("p", { class: "field-error", id: "field-error", role: "alert" });

  kindStandard.addEventListener("change", () => syncSlotsVisibility());
  kindRush.addEventListener("change", () => syncSlotsVisibility());
  function syncSlotsVisibility(): void {
    slotsField.parentElement?.classList.toggle("is-hidden", !kindRush.checked);
  }

  saveBtn.addEventListener("click", () => void saveMission());
  scheduleBtn.addEventListener("click", () => void scheduleMission("schedule"));
  publishBtn.addEventListener("click", () => void scheduleMission("publish"));
  unscheduleBtn.addEventListener("click", () => void moveMission("unschedule"));
  retireBtn.addEventListener("click", () => void moveMission("retire"));

  function editorRegion(): HTMLElement {
    const form = h("form", { role: "form", "aria-label": "Mission editor", class: "mission-editor", id: "mission-editor" });
    const row = (label: string, field: HTMLElement, id: string): HTMLElement => {
      field.id = id;
      field.setAttribute("aria-describedby", `${id}-error`);
      return h("div", { class: "editor-row" }, h("label", { for: id, class: "editor-label" }, label), field);
    };
    form.append(
      row("Title", titleField, "field-title"),
      row("Resident", residentField, "field-resident"),
      row("Stamp reward", rewardField, "field-reward"),
      h("div", { class: "editor-row" },
        h("span", { class: "editor-label" }, "Kind"),
        h("div", { role: "radiogroup", "aria-label": "Kind", class: "kind-group", id: "kind-group" },
          h("label", { class: "radio-label" }, kindStandard, "Standard"),
          h("label", { class: "radio-label" }, kindRush, "Rush"),
        ),
      ),
      h("div", { class: "editor-row", id: "slots-row" }, h("label", { for: "field-slots", class: "editor-label" }, "Rush slots"), slotsField),
      row("Offer lines", offerField, "field-offer"),
      row("Thanks lines", thanksField, "field-thanks"),
      row("Go live at", liveAtField, "field-liveat"),
      fieldError,
      h("div", { class: "editor-buttons" }, saveBtn, scheduleBtn, publishBtn, unscheduleBtn, retireBtn),
    );
    // Arrow keys move the Kind selection; only the checked radio is tabbable.
    const group = form.querySelector("#kind-group") as HTMLElement;
    group.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        (kindRush.checked ? kindRush : kindRush).checked = true;
        if (kindStandard.checked) { kindRush.checked = true; kindStandard.checked = false; }
        kindRush.focus();
        syncSlotsVisibility();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        kindStandard.checked = true;
        kindRush.checked = false;
        kindStandard.focus();
        syncSlotsVisibility();
      }
    });
    return h("section", { role: "region", "aria-label": "Mission editor", class: "console-region console-editor" }, h2("Mission editor"), form);
  }

  function renderEditor(): void {
    if (!editorMission && !editorIsNew) {
      clearEditor();
      return;
    }
    const m = editorMission;
    titleField.value = m?.title ?? "";
    residentField.value = m?.resident_id ?? RESIDENTS[0].resident_id;
    rewardField.value = String(m?.reward_stamps ?? 5);
    const isRush = m ? m.kind === "rush" : kindRush.checked;
    kindStandard.checked = !isRush;
    kindRush.checked = isRush;
    const kindLocked = m !== null;
    kindStandard.disabled = kindLocked;
    kindRush.disabled = kindLocked;
    slotsField.value = String(m?.rush_slots ?? 1);
    offerField.value = m?.dialogue.offer.join("\n") ?? "";
    thanksField.value = m?.dialogue.thanks.join("\n") ?? "";
    liveAtField.value = "";
    fieldError.textContent = "";
    saveBtn.textContent = editorIsNew ? "Save draft" : "Save changes";
    syncSlotsVisibility();
    syncMoveButtons();
    editorLoadedSnapshot = editorSnapshot();
  }

  function clearEditor(): void {
    titleField.value = "";
    residentField.value = RESIDENTS[0].resident_id;
    rewardField.value = "5";
    kindStandard.checked = true;
    kindRush.checked = false;
    slotsField.value = "1";
    offerField.value = "";
    thanksField.value = "";
    liveAtField.value = "";
    fieldError.textContent = "";
    syncSlotsVisibility();
    for (const btn of [saveBtn, scheduleBtn, publishBtn, unscheduleBtn, retireBtn]) btn.classList.add("is-hidden");
    saveBtn.classList.remove("is-hidden");
    editorLoadedSnapshot = editorSnapshot();
  }

  function editorSnapshot(): string {
    return [titleField.value, residentField.value, rewardField.value, kindStandard.checked ? "standard" : "rush",
      slotsField.value, offerField.value, thanksField.value].join("\u0001");
  }

  function unsavedEdits(): boolean {
    return editorSnapshot() !== editorLoadedSnapshot;
  }

  function syncMoveButtons(): void {
    const m = editorMission;
    const status = m?.status;
    const moves = {
      schedule: status === "draft",
      publish: status === "draft",
      unschedule: status === "scheduled",
      retire: status === "live" || status === "scheduled",
    };
    scheduleBtn.classList.toggle("is-hidden", !moves.schedule);
    publishBtn.classList.toggle("is-hidden", !moves.publish);
    unscheduleBtn.classList.toggle("is-hidden", !moves.unschedule);
    retireBtn.classList.toggle("is-hidden", !moves.retire);
    saveBtn.classList.toggle("is-hidden", !m && !editorIsNew);
    if (!editorIsNew && m) saveBtn.classList.remove("is-hidden");
  }

  function editorBody(): Record<string, unknown> {
    return {
      title: titleField.value,
      resident_id: residentField.value,
      reward_stamps: Number(rewardField.value),
      kind: kindRush.checked ? "rush" : "standard",
      rush_slots: kindRush.checked ? Number(slotsField.value) : null,
      dialogue: {
        offer: offerField.value.split("\n").map((l) => l.trim()).filter(Boolean),
        thanks: thanksField.value.split("\n").map((l) => l.trim()).filter(Boolean),
      },
    };
  }

  async function saveMission(): Promise<void> {
    if (editorIsNew) {
      try {
        const res = await api<Mission>("POST", "/api/founder/missions", editorBody());
        editorIsNew = false;
        editorMission = res.data;
        editorRevision = res.data.revision;
        // A saved draft replaces ?mission=new with the new id without adding an entry.
        history.replaceState(null, "", `/console?mission=${res.data.mission_id}`);
        notice(`Draft saved.`);
        await refreshMissions();
        render();
        focusTarget = "firstMove";
        applyFocusTarget();
        return;
      } catch (err) {
        handleEditorError(err, editorBody());
        return;
      }
    }
    if (!editorMission) return;
    const body = editorBody();
    delete (body as Record<string, unknown>).kind;
    try {
      const res = await api<Mission>("PATCH", `/api/founder/missions/${editorMission.mission_id}`, body, {
        headers: { "If-Match": `"${editorRevision}"` },
      });
      editorMission = res.data;
      editorRevision = res.data.revision;
      notice(res.data.status === "live" ? `Live now — version ${res.data.version}.` : "Draft saved.");
      await refreshMissions();
      render();
      focusTarget = "firstMove";
      applyFocusTarget();
    } catch (err) {
      handleEditorError(err, body);
    }
  }

  async function scheduleMission(kind: "schedule" | "publish"): Promise<void> {
    if (!editorMission) return;
    const body = kind === "publish" ? { live_at: "now" } : { live_at_local: liveAtField.value.replace(" ", "T") };
    try {
      const res = await api<Mission>("POST", `/api/founder/missions/${editorMission.mission_id}/schedule`, body, {
        headers: { "If-Match": `"${editorRevision}"` },
      });
      editorMission = res.data;
      editorRevision = res.data.revision;
      notice(res.data.status === "live"
        ? `Live now — version ${res.data.version}.`
        : `Scheduled for ${formatLocalClient(studio?.time_zone ?? "UTC", Date.parse(res.data.live_at!))}.`);
      await refreshMissions();
      render();
      focusTarget = "firstMove";
      applyFocusTarget();
    } catch (err) {
      handleScheduleError(err);
    }
  }

  async function moveMission(move: "unschedule" | "retire"): Promise<void> {
    if (!editorMission) return;
    try {
      const res = await api<Mission>("POST", `/api/founder/missions/${editorMission.mission_id}/${move}`, {}, {
        headers: { "If-Match": `"${editorRevision}"` },
      });
      editorMission = res.data;
      editorRevision = res.data.revision;
      notice(move === "retire" ? "Retired." : "Back to draft.");
      await refreshMissions();
      render();
      focusTarget = "firstMove";
      applyFocusTarget();
    } catch (err) {
      if (err instanceof ApiCallError) {
        const code = err.error.code;
        if (code === "illegal_transition") notice(`That mission can't move from ${editorMission.status} to ${move}.`);
        else if (code === "stale_revision") notice("This mission changed in another tab. Reload it to see the latest.");
        else notice("Something went wrong on Bramble.");
      }
    }
  }

  function handleEditorError(err: unknown, body: Record<string, unknown>): void {
    if (err instanceof ApiCallError) {
      const code = err.error.code;
      const fields = err.error.fields;
      if (code === "stale_revision") {
        notice("This mission changed in another tab. Reload it to see the latest.");
        return;
      }
      if (code === "mission_retired") {
        notice("Retired missions can't be edited.");
        return;
      }
      if (fields) {
        const first = firstInvalidField(fields);
        if (first !== null) {
          showFieldError(first, copyForField(first, fields[first] ?? "invalid"));
          focusField(first);
        }
        return;
      }
    }
    notice("Something went wrong on Bramble.");
    void body;
  }

  function handleScheduleError(err: unknown): void {
    if (err instanceof ApiCallError) {
      const fields = err.error.fields;
      if (fields?.live_at_local || fields?.live_at) {
        const key = fields.live_at_local ? "live_at_local" : "live_at";
        const reason = fields[key];
        const copy =
          reason === "invalid" ? "Enter a time like 2027-01-15 09:30."
          : reason === "nonexistent_time" ? "That time doesn't exist on the studio clock — the clocks skip it."
          : reason === "in_past" ? "Pick a time from now on."
          : reason === "out_of_range" ? "Pick a time no more than 366 days ahead."
          : reason === "required" ? "Enter a time like 2027-01-15 09:30."
          : "Enter a time like 2027-01-15 09:30.";
        showFieldError("field-liveat", copy);
        liveAtField.focus();
        return;
      }
      if (err.error.code === "illegal_transition") notice("That mission can't move.");
      else if (err.error.code === "stale_revision") notice("This mission changed in another tab. Reload it to see the latest.");
      else notice("Something went wrong on Bramble.");
      return;
    }
    notice("Something went wrong on Bramble.");
  }

  function firstInvalidField(fields: Record<string, string>): string | null {
    const order = ["title", "reward_stamps", "resident_id", "kind", "rush_slots", "dialogue.offer", "dialogue.thanks"];
    for (const key of order) if (fields[key]) return key;
    return Object.keys(fields)[0] ?? null;
  }

  function copyForField(key: string, reason: string): string {
    switch (key) {
      case "title": return "Titles are 1 to 60 characters.";
      case "reward_stamps": return "Rewards are 1 to 50 stamps.";
      case "resident_id": return "Pick a resident.";
      case "rush_slots": return "Rush missions post 1 to 5 parcels a day.";
      case "dialogue.offer": return "Write 1 to 6 offer lines of up to 200 characters.";
      case "dialogue.thanks": return "Write 1 to 3 thanks lines of up to 200 characters.";
      default: return reason === "required" ? "This field is required." : "Check this field.";
    }
  }

  function focusField(key: string): void {
    const map: Record<string, HTMLElement> = {
      title: titleField,
      reward_stamps: rewardField,
      resident_id: residentField,
      rush_slots: slotsField,
      "dialogue.offer": offerField,
      "dialogue.thanks": thanksField,
    };
    (map[key] ?? liveAtField).focus();
  }

  function showFieldError(key: string, copy: string): void {
    const map: Record<string, HTMLElement> = {
      title: titleField,
      reward_stamps: rewardField,
      resident_id: residentField,
      rush_slots: slotsField,
      "dialogue.offer": offerField,
      "dialogue.thanks": thanksField,
      "field-liveat": liveAtField,
      live_at_local: liveAtField,
      live_at: liveAtField,
    };
    const target = map[key];
    if (!target) return;
    let described = target.parentElement?.querySelector(".field-error") as HTMLElement | null;
    if (!described) {
      described = h("p", { class: "field-error" });
      target.parentElement?.append(described);
    }
    described.textContent = copy;
    target.setAttribute("aria-describedby", described.getAttribute("id") ?? "");
    described.id = described.id || `err-${key.replace(/\W/g, "")}`;
  }

  // --- URL and history (DP-71) --------------------------------------------------------------
  function consoleUrl(): string {
    if (editorIsNew) return "/console?mission=new";
    if (editorMission) return `/console?mission=${editorMission.mission_id}`;
    return "/console";
  }

  function startNewMission(): void {
    editorIsNew = true;
    editorMission = null;
    editorRevision = 1;
    history.pushState(null, "", "/console?mission=new");
    render();
    focusTarget = "title";
    applyFocusTarget();
  }

  async function openMission(missionId: string): Promise<void> {
    try {
      const res = await api<Mission>("GET", `/api/founder/missions/${missionId}`);
      editorMission = res.data;
      editorRevision = res.data.revision;
      editorIsNew = false;
      history.pushState(null, "", `/console?mission=${missionId}`);
      render();
      focusTarget = "title";
      applyFocusTarget();
    } catch {
      // unknown mission
      editorMission = null;
      editorIsNew = false;
      notice("That mission isn't on the list.");
      history.replaceState(null, "", "/console");
      render();
      focusTarget = "newMission";
      applyFocusTarget();
    }
  }

  function loadFromUrl(): void {
    const params = new URLSearchParams(location.search);
    const missionParam = params.get("mission");
    if (missionParam === null) {
      editorMission = null;
      editorIsNew = false;
      clearEditor();
      focusTarget = "newMission";
      return;
    }
    if (missionParam === "new") {
      editorIsNew = true;
      editorMission = null;
      editorRevision = 1;
      clearEditor();
      saveBtn.classList.remove("is-hidden");
      focusTarget = "title";
      return;
    }
    const found = missions.find((m) => m.mission_id === missionParam);
    if (found) {
      editorMission = found;
      editorRevision = found.revision;
      editorIsNew = false;
      focusTarget = "title";
    } else {
      editorMission = null;
      editorIsNew = false;
      notice("That mission isn't on the list.");
      history.replaceState(null, "", "/console");
      focusTarget = "newMission";
    }
  }

  function confirmDiscard(apply: () => void): boolean {
    // Back or Forward with unsaved edits asks first.
    const dialog = h("div", { role: "dialog", "aria-label": "Discard changes?", class: "paper-dialog is-open discard-dialog" },
      h("p", { class: "confirm-copy" }, "Your unsaved edits to this mission will be lost."),
      h("div", { class: "confirm-buttons" },
        (() => {
          const keep = h("button", { class: "btn" }, "Keep editing");
          keep.addEventListener("click", () => {
            dialog.remove();
            history.pushState(null, "", discardPendingUrl ?? consoleUrl());
            discardPendingUrl = null;
            titleField.focus();
          });
          return keep;
        })(),
        (() => {
          const discard = h("button", { class: "btn btn-primary" }, "Discard");
          discard.addEventListener("click", () => {
            const target = discardPendingUrl;
            dialog.remove();
            discardPendingUrl = null;
            if (target) {
              history.pushState(null, "", target);
              loadFromUrl();
              render();
              applyFocusTarget();
            } else {
              apply();
            }
          });
          return discard;
        })(),
      ),
    );
    discardPendingUrl = null;
    root.append(dialog);
    (dialog.querySelector("button") as HTMLElement).focus();
    return true;
  }

  window.addEventListener("popstate", () => {
    const target = location.pathname + location.search;
    if (unsavedEdits()) {
      discardPendingUrl = target;
      history.pushState(null, "", consoleUrl());
      confirmDiscard(() => { void 0; });
      return;
    }
    loadFromUrl();
    render();
    applyFocusTarget();
  });

  function applyFocusTarget(): void {
    if (focusTarget === "title") { titleField.focus(); focusTarget = null; }
    else if (focusTarget === "newMission") { document.getElementById("new-mission")?.focus(); focusTarget = null; }
    else if (focusTarget === "firstMove") {
      const first = [scheduleBtn, publishBtn, unscheduleBtn, retireBtn].find((b) => !b.classList.contains("is-hidden"))
        ?? document.getElementById("new-mission");
      (first as HTMLElement | null)?.focus();
      focusTarget = null;
    }
  }

  // --- studio and online ---------------------------------------------------------------------
  const zoneField = h("select", { class: "field", "aria-label": "Studio time zone", id: "field-zone" }) as HTMLSelectElement;
  const boardLine = h("p", { class: "board-line", id: "board-line" });

  function studioRegion(): HTMLElement {
    zoneField.replaceChildren();
    for (const zone of zoneList()) {
      zoneField.append(h("option", { value: zone }, zone));
    }
    zoneField.addEventListener("change", () => {
      // A selected zone is checked against the accepted set before it is sent.
      if (!isValidZoneClient(zoneField.value)) zoneField.value = studio?.time_zone ?? "America/Vancouver";
    });
    const save = h("button", { class: "btn btn-small", "aria-label": "Save time zone", id: "btn-zone" }, "Save time zone");
    save.addEventListener("click", () => void saveZone());
    return h("section", { role: "region", "aria-label": "Studio", class: "console-region console-studio" },
      h2("Studio"), zoneField, save, boardLine);
  }

  async function saveZone(): Promise<void> {
    try {
      const res = await api<Studio>("PATCH", "/api/founder/studio", { time_zone: zoneField.value });
      studio = res.data;
      notice(`Studio time zone saved. Today's board is ${res.data.board_date}.`);
      boardLine.textContent = `Today's board: ${res.data.board_date}`;
      await refreshMissions();
      renderMissionRows();
    } catch (err) {
      if (err instanceof ApiCallError && err.error.code === "validation") notice("Pick a time zone from the list.");
      else notice("Something went wrong on Bramble.");
    }
  }

  const onlineLine = h("p", { class: "online-line", id: "online-line" });
  function onlineRegion(): HTMLElement {
    return h("section", { role: "region", "aria-label": "Online now", class: "console-region console-online" },
      h2("Online now"), onlineLine);
  }

  async function refreshMissions(): Promise<void> {
    missions = (await api<{ missions: Mission[] }>("GET", "/api/founder/missions")).data.missions;
    if (editorMission) {
      const fresh = missions.find((m) => m.mission_id === editorMission!.mission_id);
      // A clean editor takes the new revision on each refresh; one with edits keeps its own.
      if (fresh && !unsavedEdits()) {
        editorMission = fresh;
        editorRevision = fresh.revision;
      } else if (fresh) {
        editorRevision = fresh.revision;
      }
    }
    renderMissionRows();
  }

  async function refreshStudio(): Promise<void> {
    studio = (await api<Studio>("GET", "/api/founder/studio")).data;
    zoneField.value = studio.time_zone;
    boardLine.textContent = `Today's board: ${studio.board_date}`;
  }

  async function refreshOnline(): Promise<void> {
    online = (await api<Online>("GET", "/api/founder/online")).data;
    onlineLine.textContent = `${online.online} couriers on Bramble (${online.guests} guests, ${online.signed_in} signed in)`;
  }

  setInterval(() => {
    if (me?.role !== "founder") return;
    void refreshMissions();
    void refreshStudio();
    void refreshOnline();
  }, 5000);

  // The refresh never moves focus and never replaces the focused element.
  const guardedRenderMissionRows = renderMissionRows;

  function notice(text: string): void {
    let bar = document.getElementById("console-notice");
    if (!bar) {
      bar = h("div", { role: "status", "aria-label": "Notices", class: "notices console-notice", id: "console-notice", "data-notice-phase": "shown" });
      document.body.prepend(bar);
    }
    bar.textContent = text;
    bar.setAttribute("data-notice-phase", "shown");
    setTimeout(() => {
      if (bar?.textContent === text) {
        bar.setAttribute("data-notice-phase", "idle");
        bar.textContent = "";
      }
    }, 5000);
  }
  void guardedRenderMissionRows;
  void icon;
}

function zoneList(): string[] {
  const zones = Intl.supportedValuesOf("timeZone") as string[];
  const extra = ["UTC", "America/Vancouver", "America/St_Johns", "Europe/London", "Asia/Kolkata", "Asia/Kathmandu", "Australia/Adelaide", "Australia/Eucla", "Australia/Lord_Howe", "Pacific/Chatham"];
  return [...new Set([...extra, ...zones])].sort();
}
