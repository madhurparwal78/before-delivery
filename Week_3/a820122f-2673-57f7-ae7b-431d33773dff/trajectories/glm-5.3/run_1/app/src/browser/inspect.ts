import { apiJson, el, restText, ApiError } from "./api.js";

interface InspectDay { ship_date: string; cell_count: number; rest_hours: number; signed_at_utc: string | null; countersigned_at_utc: string | null; late_entries: number; notes: { text: string }[] }
interface InspectPayload {
  vessel: { id: string; name: string };
  from_date: string;
  to_date: string;
  expires_at_utc: string;
  server_now_utc: string;
  crew: { id: string; name: string; rank: string; days: InspectDay[]; breaches: { rule: string; window_start_utc: string; window_end_utc: string }[] }[];
  unsealed_dates: string[];
  clock_changes: { changes_at_utc: string; old_offset_minutes: number; new_offset_minutes: number }[];
  fixes: { at_utc: string; latitude: number; longitude: number }[];
  events: { kind: string; start_utc: string; end_utc: string; description: string }[];
}

/** `/inspect/<token>` — the public inspector page. */
export async function renderInspect(token: string): Promise<void> {
  document.title = "Inspection record — Sixbell Rest Log";
  const app = document.getElementById("app")!;
  app.textContent = "";

  let data: InspectPayload;
  try {
    data = await apiJson<InspectPayload>(`/api/inspect/${token}`);
  } catch (error) {
    const heading = el("h1", {}, "");
    if (error instanceof ApiError) {
      if (error.code === "link_revoked") heading.textContent = "This inspection link has been revoked.";
      else if (error.code === "link_expired") heading.textContent = "This inspection link has expired.";
      else heading.textContent = "We couldn't find that inspection link.";
    } else {
      heading.textContent = "We couldn't find that inspection link.";
    }
    app.append(heading);
    return;
  }

  const heading = el("h1", {}, "Inspection record");
  const vesselLine = el("p", {}, `${data.vessel.name}, ship's dates ${data.from_date} to ${data.to_date}. Expires ${data.expires_at_utc}.`);

  const daysTable = el("table", { "aria-label": "Sealed days" });
  const headRow = document.createElement("tr");
  for (const label of ["Crew", "Ship's day", "Cells", "Rest hours", "Signed", "Countersigned", "Late entries"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headRow.append(th);
  }
  const body = el("tbody");
  daysTable.append(headRow, body);
  let anySealed = false;
  for (const member of data.crew) {
    for (const day of member.days) {
      anySealed = true;
      body.append(el("tr", {},
        el("td", {}, member.name),
        el("td", {}, day.ship_date),
        el("td", {}, String(day.cell_count)),
        el("td", {}, restText(day.rest_hours)),
        el("td", {}, day.signed_at_utc ?? "—"),
        el("td", {}, day.countersigned_at_utc ?? "—"),
        el("td", {}, String(day.late_entries))));
    }
  }
  if (!anySealed) {
    body.append(el("tr", {}, el("td", { colspan: "7" }, "Nothing is sealed in this date range.")));
  }

  const eventsPane = el("section", { class: "pane", role: "region", "aria-label": "Voyage events" },
    el("span", { class: "pane-label" }, "Voyage events"));
  const clockList = el("ul", { class: "small" });
  for (const change of data.clock_changes) {
    clockList.append(el("li", {}, `Clock change ${change.changes_at_utc}: ${change.old_offset_minutes} to ${change.new_offset_minutes} minutes`));
  }
  const fixList = el("ul", { class: "small" });
  for (const fix of data.fixes) {
    fixList.append(el("li", {}, `Position fix ${fix.at_utc} at ${fix.latitude.toFixed(2)} ${fix.longitude.toFixed(2)}`));
  }
  const eventList = el("ul", { class: "small" });
  for (const event of data.events) {
    eventList.append(el("li", {}, `${event.kind} ${event.start_utc} to ${event.end_utc} — ${event.description}`));
  }
  eventsPane.append(clockList, fixList, eventList);

  const breachPane = el("section", { class: "pane" }, el("span", { class: "pane-label" }, "Breaches"));
  for (const member of data.crew) {
    for (const breach of member.breaches) {
      breachPane.append(el("p", { class: "breach-line" },
        `${member.name}: ${breach.rule} ${breach.window_start_utc} to ${breach.window_end_utc}`));
    }
  }
  if (data.crew.every((member) => member.breaches.length === 0)) {
    breachPane.append(el("p", { class: "small" }, "No breaches recorded."));
  }

  const download = el("a", { class: "button", href: `/api/inspect/${token}/document` }, "Download inspection document");
  const feedback = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Feedback" });
  download.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await fetch(`/api/inspect/${token}/document`);
      window.location.assign(`/api/inspect/${token}/document`);
    } catch {
      feedback.textContent = "The archive is unreachable, so this document cannot be fetched right now.";
    }
  });

  app.append(heading, vesselLine, daysTable, eventsPane, breachPane, feedback, download);

  const response = await fetch(`/api/inspect/${token}/document`, { method: "HEAD" });
  if (!response.ok) {
    feedback.textContent = "The archive is unreachable, so this document cannot be fetched right now.";
  }
}
