import { apiJson, el, navigate, ApiError } from "./api.js";
import { openDialog, firstFieldError, errorMessage } from "./dialogs.js";

interface CrewMember { id: string; name: string; rank: string; email: string }
interface ClockChange { id: string; changes_at_utc: string; old_offset_minutes: number; new_offset_minutes: number }
interface Fix { id: string; at_utc: string; latitude: number; longitude: number }
interface RotaWatch { id: string; label: string; start_time: string; end_time: string; from_date: string; to_date: string }
interface RuleSetPeriod { id: string; rule_set: string; effective_from_utc: string; effective_until_utc: string; flag_reference: string }
interface InspectionLink { id: string; url: string; from_date: string; to_date: string; expires_at_utc: string; state: string }

/** `/vessels/<vessel id>` — crew, clock changes and fixes, rota and plan, rule
 *  sets, drills and call-outs, and inspection links. */
export async function renderVessel(vesselId: string): Promise<void> {
  document.title = "Vessel — Sixbell Rest Log";
  const app = document.getElementById("app")!;
  app.textContent = "";

  const heading = el("h1", {}, "");
  const signOut = el("button", { type: "button" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await fetch("/api/session", { method: "DELETE" });
    navigate("/");
  });

  const feedback = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Feedback" });
  const archiveStatus = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Archive status" });

  const crewPane = el("section", { class: "pane", role: "region", "aria-label": "Crew" },
    el("span", { class: "pane-label" }, "Crew"));
  const crewList = el("ul");
  const addCrewButton = el("button", { type: "button" }, "Add crew");
  crewPane.append(crewList, addCrewButton);

  const clockPane = el("section", { class: "pane", role: "region", "aria-label": "Clock changes" },
    el("span", { class: "pane-label" }, "Clock changes"));
  const changeList = el("ul");
  const logChangeButton = el("button", { type: "button" }, "Log clock change");
  const fixList = el("ul", { class: "small" });
  const addFixButton = el("button", { type: "button" }, "Add position fix");
  clockPane.append(changeList, logChangeButton, el("hr", { class: "rule-top" }), el("span", { class: "pane-label" }, "Position fixes"), fixList, addFixButton);

  const rotaPane = el("section", { class: "pane", role: "region", "aria-label": "Rota" },
    el("span", { class: "pane-label" }, "Rota"));
  const watchList = el("ul", { class: "small" });
  const addWatchButton = el("button", { type: "button" }, "Add watch");
  const planFor = el("select");
  const planFrom = el("input", { type: "text" });
  const planTo = el("input", { type: "text" });
  const checkPlan = el("button", { type: "button" }, "Check plan");
  const planVerdict = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Plan verdict" });
  const planTable = el("table", { "aria-label": "Planned watches" });
  planTable.append(tableHead(["Ship's date", "Day length", "Watch", "Ship's time", "Elapsed hours", "Planned rest"]));
  const planBody = el("tbody");
  planTable.append(planBody);
  rotaPane.append(watchList, addWatchButton,
    el("hr", { class: "rule-top" }),
    el("label", { for: "plan-for" }, "Plan for"), planFor,
    el("label", { for: "plan-from" }, "Plan from"), planFrom,
    el("label", { for: "plan-to" }, "Plan to"), planTo,
    checkPlan, planVerdict, planTable);

  const ruleSetsPane = el("section", { class: "pane", role: "region", "aria-label": "Rule sets" },
    el("span", { class: "pane-label" }, "Rule sets"));
  const ruleSetList = el("ul", { class: "small" });
  const scheduleButton = el("button", { type: "button" }, "Schedule rule set");
  ruleSetsPane.append(ruleSetList, scheduleButton);

  const eventsPane = el("section", { class: "pane", role: "region", "aria-label": "Drills and call-outs" },
    el("span", { class: "pane-label" }, "Drills and call-outs"));
  const eventList = el("ul", { class: "small" });
  const logEventButton = el("button", { type: "button" }, "Log drill or call-out");
  eventsPane.append(eventList, logEventButton);

  const linksPane = el("section", { class: "pane", role: "region", "aria-label": "Inspection links" },
    el("span", { class: "pane-label" }, "Inspection links"));
  const linksList = el("div");
  const shareButton = el("button", { type: "button" }, "Share with an inspector");
  linksPane.append(linksList, shareButton);

  app.append(el("header", {}, heading, signOut), archiveStatus, feedback,
    crewPane, clockPane, rotaPane, ruleSetsPane, eventsPane, linksPane);

  const crew = (await apiJson<{ crew: CrewMember[] }>(`/api/vessels/${vesselId}/crew`)).crew;
  heading.textContent = crew.length > 0 ? "" : "";
  const vessels = await apiJson<{ vessels: { id: string; name: string }[] }>("/api/vessels");
  const vessel = vessels.vessels.find((v) => v.id === vesselId);
  if (!vessel) {
    heading.textContent = "We couldn't find that page.";
    return;
  }
  heading.textContent = vessel.name;

  const changes = (await apiJson<{ clock_changes: ClockChange[] }>(`/api/vessels/${vesselId}/clock-changes`)).clock_changes;
  const fixes = (await apiJson<{ fixes: Fix[] }>(`/api/vessels/${vesselId}/fixes`)).fixes;
  const watches = await apiJson<RotaWatch[]>(`/api/vessels/${vesselId}/rota-watches`).catch(() => [] as RotaWatch[]);
  const ruleSets = (await apiJson<{ rule_sets: RuleSetPeriod[] }>(`/api/vessels/${vesselId}/rule-sets`)).rule_sets;
  const events = (await apiJson<{ events: { id: string; crew_id: string; kind: string; start_utc: string; end_utc: string; description: string }[] }>(`/api/vessels/${vesselId}/events`)).events ?? [];
  const links = (await apiJson<{ links: InspectionLink[] }>(`/api/vessels/${vesselId}/inspection-links`)).links;

  for (const member of crew) {
    const review = el("a", { href: `/voyage/${vesselId}/${member.id}` }, `Review ${member.name}`);
    const li = el("li", {}, `${member.name}, ${member.rank} — `, review);
    crewList.append(li);
    planFor.append(el("option", { value: member.id }, member.name));
  }

  for (const change of changes) {
    const minutes = change.new_offset_minutes - change.old_offset_minutes;
    const label = minutes < 0 ? `+${Math.abs(minutes) / 60} h` : `-${minutes / 60} h`;
    changeList.append(el("li", { class: "small" },
      `${change.changes_at_utc}: ${change.old_offset_minutes} to ${change.new_offset_minutes} minutes (${label})`));
  }
  for (const fix of fixes) {
    fixList.append(el("li", {}, `${fix.at_utc} ${fix.latitude.toFixed(2)} ${fix.longitude.toFixed(2)}`));
  }
  for (const watch of watches) {
    watchList.append(el("li", {}, `${watch.label} ${watch.start_time} to ${watch.end_time}, ${watch.from_date} to ${watch.to_date}`));
  }
  for (const period of ruleSets) {
    ruleSetList.append(el("li", {}, `${period.rule_set} from ${period.effective_from_utc} until ${period.effective_until_utc} (${period.flag_reference})`));
  }
  for (const event of events) {
    const member = crew.find((c) => c.id === event.crew_id);
    eventList.append(el("li", {}, `${member?.name ?? event.crew_id}: ${event.kind} ${event.start_utc} to ${event.end_utc} — ${event.description}`));
  }
  renderLinks();

  pollArchiveStatus();

  function renderLinks(): void {
    linksList.textContent = "";
    for (const link of links) {
      const address = el("input", { type: "text", readonly: true, value: `${window.location.origin}${link.url}` });
      address.setAttribute("aria-label", "Link address");
      const state = el("span", { class: "muted small" }, ` ${link.state}`);
      const line = el("div", { class: "small" }, address, state);
      if (link.state === "active") {
        const revoke = el("button", { type: "button" }, "Revoke link");
        const replace = el("button", { type: "button" }, "Replace link");
        revoke.addEventListener("click", async () => {
          feedback.textContent = "Revoking link.";
          try {
            await apiJson(`/api/inspection-links/${link.id}/revoke`, { method: "POST" });
            feedback.textContent = "Link revoked.";
            link.state = "revoked";
            renderLinks();
          } catch (error) {
            feedback.textContent = error instanceof ApiError && error.code === "link_ended" ? "This link no longer opens." : "Something went wrong. Try again.";
          }
        });
        replace.addEventListener("click", async () => {
          feedback.textContent = "Replacing link.";
          try {
            const fresh = await apiJson<InspectionLink>(`/api/inspection-links/${link.id}/regenerate`, { method: "POST" });
            feedback.textContent = "Link replaced. The old link no longer opens.";
            const index = links.indexOf(link);
            if (index >= 0) links.splice(index, 1, fresh);
            renderLinks();
          } catch (error) {
            feedback.textContent = error instanceof ApiError && error.code === "link_ended" ? "This link no longer opens." : "Something went wrong. Try again.";
          }
        });
        line.append(revoke, replace);
      }
      linksList.append(line);
    }
  }

  async function pollArchiveStatus(): Promise<void> {
    try {
      const status = await apiJson<{ archive: string; checked_at_utc: string }>("/api/archive-status");
      archiveStatus.textContent = status.archive === "unreachable"
        ? "Archive unreachable. Hours are still being logged; sealing resumes on its own."
        : "";
    } catch {
      archiveStatus.textContent = "";
    }
    window.setTimeout(() => void pollArchiveStatus(), 10_000);
  }

  addCrewButton.addEventListener("click", () => {
    openDialog({
      label: "Add crew",
      fields: [
        { name: "name", type: "text" },
        { name: "rank", type: "text" },
        { name: "email", type: "text" },
        { name: "passcode", type: "text" },
      ],
      submitLabel: "Save crew member",
    }, addCrewButton, async (values) => {
      feedback.textContent = "Saving crew member.";
      try {
        const member = await apiJson<CrewMember>(`/api/vessels/${vesselId}/crew`, {
          method: "POST",
          body: JSON.stringify(values),
        });
        feedback.textContent = "Crew member saved.";
        crewList.append(el("li", {}, `${member.name}, ${member.rank}`));
        planFor.append(el("option", { value: member.id }, member.name));
        return;
      } catch (error) {
        feedback.textContent = error instanceof ApiError && error.status === 409
          ? "That email already has an account."
          : "Something went wrong. Try again.";
        return firstFieldError(error);
      }
    });
  });

  logChangeButton.addEventListener("click", () => {
    openDialog({
      label: "Log clock change",
      fields: [
        { name: "changes-at", type: "text" },
        { name: "new-offset", type: "text" },
        { name: "latitude", type: "text" },
        { name: "longitude", type: "text" },
      ],
      submitLabel: "Save clock change",
    }, logChangeButton, async (values) => {
      feedback.textContent = "Saving clock change.";
      try {
        const saved = await apiJson<{ id: string; label: string; zone_warning: boolean; ship_date_cells: number }>(`/api/vessels/${vesselId}/clock-changes`, {
          method: "POST",
          body: JSON.stringify({
            changes_at_utc: values["changes-at"],
            new_offset_minutes: Number(values["new-offset"]),
            latitude: Number(values.latitude),
            longitude: Number(values.longitude),
          }),
        });
        feedback.textContent = "Clock change saved.";
        if (saved.zone_warning) {
          feedback.textContent = "The new offset is more than 1 hour from the nautical zone for this longitude. Ships may keep port time, so the change is saved.";
        }
        return;
      } catch (error) {
        // A midnight crossing names its message; other field errors show as-is.
        const message = error instanceof ApiError && error.fieldErrors?.["changes_at_utc"]
          ? error.fieldErrors["changes_at_utc"]
          : firstFieldError(error);
        feedback.textContent = message;
        return message;
      }
    });
  });

  addFixButton.addEventListener("click", () => {
    openDialog({
      label: "Add position fix",
      fields: [
        { name: "at-utc", type: "text" },
        { name: "latitude", type: "text" },
        { name: "longitude", type: "text" },
      ],
      submitLabel: "Save fix",
    }, addFixButton, async (values) => {
      feedback.textContent = "Saving.";
      try {
        await apiJson(`/api/vessels/${vesselId}/fixes`, {
          method: "POST",
          body: JSON.stringify({
            at_utc: values["at-utc"],
            latitude: Number(values.latitude),
            longitude: Number(values.longitude),
          }),
        });
        feedback.textContent = "Saved.";
        return;
      } catch (error) {
        feedback.textContent = firstFieldError(error);
        return firstFieldError(error);
      }
    });
  });

  addWatchButton.addEventListener("click", () => {
    openDialog({
      label: "Add watch",
      fields: [
        { name: "crew-id", type: "select", options: crew.map((c) => c.id) },
        { name: "label", type: "text" },
        { name: "start-time", type: "text" },
        { name: "end-time", type: "text" },
        { name: "from-date", type: "text" },
        { name: "to-date", type: "text" },
      ],
      submitLabel: "Save watch",
    }, addWatchButton, async (values) => {
      feedback.textContent = "Saving.";
      try {
        await apiJson(`/api/vessels/${vesselId}/rota-watches`, {
          method: "POST",
          body: JSON.stringify({
            crew_id: values["crew-id"],
            label: values.label,
            start_time: values["start-time"],
            end_time: values["end-time"],
            from_date: values["from-date"],
            to_date: values["to-date"],
          }),
        });
        feedback.textContent = "Saved.";
        return;
      } catch (error) {
        feedback.textContent = firstFieldError(error);
        return firstFieldError(error);
      }
    });
  });

  checkPlan.addEventListener("click", async () => {
    planVerdict.textContent = "Checking plan.";
    try {
      const result = await apiJson<{
        days: { ship_date: string; day_hours: number; watches: { label: string; start_ship_time: string; end_ship_time: string; elapsed_hours: number }[]; planned_rest_hours: number }[];
        plan: { verdict: string; breaches: { rule: string; window_hours: number; window_start_utc: string; window_end_utc: string }[] };
      }>(`/api/vessels/${vesselId}/rota?crew_id=${planFor.value}&from=${planFrom.value}&to=${planTo.value}`);
      planVerdict.textContent = result.plan.verdict === "pass"
        ? "This plan passes the rules."
        : `This plan breaches the rules in ${result.plan.breaches.length} windows.`;
      planBody.textContent = "";
      for (const day of result.days) {
        for (const watch of day.watches) {
          planBody.append(el("tr", {},
            el("td", {}, day.ship_date),
            el("td", {}, day.day_hours.toFixed(1)),
            el("td", {}, watch.label),
            el("td", {}, `${watch.start_ship_time} to ${watch.end_ship_time}`),
            el("td", {}, watch.elapsed_hours.toFixed(1)),
            el("td", {}, day.planned_rest_hours.toFixed(1))));
        }
        if (day.watches.length === 0) {
          planBody.append(el("tr", {},
            el("td", {}, day.ship_date),
            el("td", {}, day.day_hours.toFixed(1)),
            el("td", {}, "—"),
            el("td", {}, "—"),
            el("td", {}, "—"),
            el("td", {}, day.planned_rest_hours.toFixed(1))));
        }
      }
    } catch (error) {
      planVerdict.textContent = firstFieldError(error);
    }
  });

  scheduleButton.addEventListener("click", () => {
    openDialog({
      label: "Schedule rule set",
      fields: [
        { name: "effective-from", type: "text" },
        { name: "effective-until", type: "text" },
        { name: "flag-reference", type: "text" },
      ],
      submitLabel: "Save rule set",
    }, scheduleButton, async (values) => {
      feedback.textContent = "Scheduling rule set.";
      try {
        await apiJson(`/api/vessels/${vesselId}/rule-sets`, {
          method: "POST",
          body: JSON.stringify({
            rule_set: "flag_exception",
            effective_from_utc: values["effective-from"],
            effective_until_utc: values["effective-until"],
            flag_reference: values["flag-reference"],
          }),
        });
        feedback.textContent = "Rule set scheduled.";
        return;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 409) feedback.textContent = "Another rule set is already in force for those dates.";
          else if (error.fieldErrors) {
            const first = Object.values(error.fieldErrors)[0] ?? "";
            feedback.textContent = first.includes("after now") ? "Pick a start time after now."
              : first.includes("two weeks") ? "A flag exception cannot run longer than two weeks."
              : first;
          } else feedback.textContent = "Something went wrong. Try again.";
        } else {
          feedback.textContent = "Something went wrong. Try again.";
        }
        return firstFieldError(error);
      }
    });
  });

  logEventButton.addEventListener("click", () => {
    openDialog({
      label: "Log drill or call-out",
      fields: [
        { name: "crew-id", type: "select", options: crew.map((c) => c.id) },
        { name: "type", type: "select", options: ["drill", "call_out"] },
        { name: "start-utc", type: "text" },
        { name: "end-utc", type: "text" },
        { name: "description", type: "text" },
      ],
      submitLabel: "Save event",
    }, logEventButton, async (values) => {
      feedback.textContent = "Saving.";
      try {
        await apiJson(`/api/vessels/${vesselId}/events`, {
          method: "POST",
          body: JSON.stringify({
            crew_id: values["crew-id"],
            kind: values.type,
            start_utc: values["start-utc"],
            end_utc: values["end-utc"],
            description: values.description,
          }),
        });
        feedback.textContent = "Saved.";
        return;
      } catch (error) {
        feedback.textContent = firstFieldError(error);
        return firstFieldError(error);
      }
    });
  });

  shareButton.addEventListener("click", () => {
    openDialog({
      label: "Share with an inspector",
      fields: [
        { name: "from-ship-date", type: "text" },
        { name: "to-ship-date", type: "text" },
        { name: "expires", type: "text" },
      ],
      submitLabel: "Create link",
    }, shareButton, async (values) => {
      feedback.textContent = "Creating link.";
      try {
        const link = await apiJson<InspectionLink>(`/api/vessels/${vesselId}/inspection-links`, {
          method: "POST",
          body: JSON.stringify({
            from_date: values["from-ship-date"],
            to_date: values["to-ship-date"],
            expires_at_utc: values.expires,
          }),
        });
        feedback.textContent = "Link created.";
        links.unshift(link);
        renderLinks();
        return;
      } catch (error) {
        feedback.textContent = firstFieldError(error);
        return firstFieldError(error);
      }
    });
  });
}

function tableHead(labels: string[]): HTMLTableRowElement {
  const row = document.createElement("tr");
  for (const label of labels) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    row.append(th);
  }
  return row;
}
