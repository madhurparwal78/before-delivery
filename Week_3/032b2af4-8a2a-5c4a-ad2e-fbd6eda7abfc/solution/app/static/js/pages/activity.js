import { api, requireMember, token } from "../core/api.js";
import { $, h, icon, notice, s } from "../core/dom.js";
import { dateTime, duration, km, mmss, pace, SPORT_NAMES, thousands, VISIBILITY_NAMES } from "../core/format.js";
import { elevationProfile } from "../components/charts.js";
import { routeMap } from "../components/route-map.js";
import { commentThread, kudosButton } from "../components/social.js";
import { paceFigure } from "../components/cards.js";

const root = $("[data-activity-root]");
const id = location.pathname.split("/").pop();
const FLYOVER_MS = 8000;
const speechAvailable = () => typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";

function notFound() {
  root.replaceChildren(h("div", { class: "empty-state" }, h("strong", { text: "Activity not found" }),
    h("p", { text: "It may have been deleted, or it is not visible to you." }),
    h("a", { class: "btn btn-primary btn-pill", href: "/dashboard", text: "Back to the dashboard" })));
}

function signed(metres) {
  const rounded = Math.round(metres);
  return rounded > 0 ? `+${rounded} m` : rounded < 0 ? `−${-rounded} m` : "0 m";
}

function award(kind, label) {
  const glyph = kind === "crown" ? "crown" : "medal";
  return h("span", { class: `award ${kind}` }, icon(glyph, glyph === "medal" ? "medal" : "", label), h("span", { "aria-hidden": "true", text: label }));
}

function effortRow(effort) {
  const awards = [];
  if (effort.is_crown) awards.push(award("crown", "First place"));
  if (effort.pr_rank === 1) awards.push(award("gold", "Personal record"));
  if (effort.pr_rank === 2) awards.push(award("silver", "2nd fastest"));
  if (effort.pr_rank === 3) awards.push(award("bronze", "3rd fastest"));
  return h("li", { class: "effort" },
    h("a", { href: `/segments/${effort.segment_id}`, text: effort.segment_name }),
    h("span", { class: "effort-time", text: mmss(effort.elapsed_time_s) }),
    awards.length ? h("div", { class: "awards" }, ...awards) : null);
}

function splitsTable(activity) {
  const whole = activity.splits.filter((split) => split.distance_m === 1000);
  const fastest = whole.length ? whole.reduce((best, split) => (split.elapsed_time_s < best.elapsed_time_s ? split : best)) : null;
  const rows = activity.splits.map((split) => h("tr", {},
    h("th", { scope: "row" }, String(split.split), split.distance_m === 1000 ? "" : h("span", { class: "small muted", text: ` (${km(split.distance_m)} km)` })),
    h("td", {}, pace(split.pace_s_per_km), split === fastest ? h("span", { class: "badge fastest", text: "Fastest" }) : null),
    h("td", { class: "num", text: signed(split.elevation_m) })));
  if (!rows.length) return h("p", { class: "muted", text: "This activity is shorter than a kilometre." });
  return h("div", { class: "table-frame", tabindex: "0", role: "region", "aria-label": "Splits" },
    h("table", { class: "data-table" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Km" }), h("th", { scope: "col", text: "Pace" }), h("th", { scope: "col", class: "num", text: "Elev" }))),
      h("tbody", {}, ...rows)));
}

/** Interpolated position along the route at a running distance (metres). */
function positionAt(streams, metres) {
  const { distance, latlng } = streams;
  if (metres <= distance[0]) return latlng[0];
  for (let i = 1; i < distance.length; i++) {
    if (distance[i] >= metres) {
      const span = distance[i] - distance[i - 1] || 1;
      const f = (metres - distance[i - 1]) / span;
      return [latlng[i - 1][0] + f * (latlng[i][0] - latlng[i - 1][0]), latlng[i - 1][1] + f * (latlng[i][1] - latlng[i - 1][1])];
    }
  }
  return latlng[latlng.length - 1];
}

function speakSplits(splits) {
  window.speechSynthesis.cancel();
  for (const split of splits) {
    const minutes = Math.floor(split.elapsed_time_s / 60);
    const seconds = split.elapsed_time_s % 60;
    window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(`Kilometer ${split.split}, ${minutes} minutes ${seconds} seconds`));
  }
}

function dialogFor(title, ...content) {
  const dialog = h("dialog", { "aria-label": title }, h("div", { class: "dialog-body" }, h("h2", { class: "card-title", text: title }), ...content));
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function editDialog(activity, onSaved) {
  const name = h("input", { class: "input", id: "edit-name", type: "text", maxlength: "100", value: activity.name });
  const visibility = h("select", { class: "select", id: "edit-visibility" },
    ...Object.entries(VISIBILITY_NAMES).map(([value, label]) => h("option", { value, text: label, selected: value === activity.visibility })));
  const errors = h("div", {});
  const form = h("form", { class: "stack", method: "dialog", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "edit-name", text: "Name" }), name),
    h("div", { class: "field" }, h("label", { for: "edit-visibility", text: "Visibility" }), visibility), errors,
    h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Cancel", onclick: () => dialog.close() }),
      h("button", { class: "btn btn-primary btn-pill", type: "submit", text: "Save changes" })));
  const dialog = dialogFor("Edit activity", form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api(`/api/activities/${activity.id}`, { method: "PATCH", body: { name: name.value, visibility: visibility.value } });
    if (result.ok) {
      dialog.close();
      onSaved(result.data);
    } else {
      errors.replaceChildren(notice("error", "The changes could not be saved. Check the name and try again."));
    }
  });
}

function deleteDialog(activity) {
  const errors = h("div", {});
  const confirmButton = h("button", { class: "btn btn-danger btn-pill", type: "submit", text: "Delete activity" });
  const form = h("form", { class: "stack", method: "dialog" },
    h("p", { text: "This removes the activity with its segment efforts, kudos and comments. It cannot be undone." }), errors,
    h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Cancel", onclick: () => dialog.close() }), confirmButton));
  const dialog = dialogFor("Delete this activity?", form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api(`/api/activities/${activity.id}`, { method: "DELETE" });
    if (result.ok) location.assign("/dashboard");
    else errors.replaceChildren(notice("error", "The activity could not be deleted."));
  });
}

function segmentDialog(activity, streams) {
  const last = streams.distance.length - 1;
  const point = (i) => `${km(streams.distance[i])} km, ${Math.round(streams.altitude[i])} m`;
  const start = h("input", { class: "range", id: "seg-start", type: "range", min: "0", max: String(last), value: "0" });
  const end = h("input", { class: "range", id: "seg-end", type: "range", min: "0", max: String(last), value: String(last) });
  const name = h("input", { class: "input", id: "seg-name", type: "text", maxlength: "60", autocomplete: "off" });
  const readout = h("p", { class: "small", "aria-live": "polite" });
  const errors = h("div", {});
  const sync = () => {
    readout.textContent = `From ${point(Number(start.value))} to ${point(Number(end.value))}.`;
  };
  sync();
  start.addEventListener("input", sync);
  end.addEventListener("input", sync);
  const form = h("form", { class: "stack", method: "dialog", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "seg-start", text: "Start point" }), start),
    h("div", { class: "field" }, h("label", { for: "seg-end", text: "End point" }), end), readout,
    h("div", { class: "field" }, h("label", { for: "seg-name", text: "Segment name" }), name), errors,
    h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Cancel", onclick: () => dialog.close() }),
      h("button", { class: "btn btn-primary btn-pill", type: "submit", text: "Create segment" })));
  const dialog = dialogFor("Create a segment", form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/segments", { method: "POST", body: { activity_id: activity.id, start_index: Number(start.value), end_index: Number(end.value), name: name.value } });
    if (result.ok) location.assign(`/segments/${result.data.id}`);
    else if (result.status === 400) errors.replaceChildren(notice("error", "Give the segment a name of 3 to 60 characters and put the start before the end."));
    else errors.replaceChildren(notice("error", "The segment could not be created."));
  });
}

async function exportGpx(activity, trigger) {
  const response = await fetch(`/api/activities/${activity.id}/export.gpx`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok) {
    trigger.after(notice("error", "The GPX file could not be exported."));
    return;
  }
  const link = h("a", { href: URL.createObjectURL(await response.blob()), download: `${activity.name}.gpx` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function render(activity, streams, me) {
  const mine = activity.athlete_id === me.id;
  const total = streams.distance[streams.distance.length - 1];
  const route = routeMap(streams.latlng, { label: `Route of ${activity.name}`, seed: String(activity.id), id: "activity" });
  const marker = s("circle", { r: 9, fill: "#D93D00", stroke: "#fff", "stroke-width": 3.5 });
  route.svg.append(marker);
  const profile = elevationProfile(streams.distance, streams.altitude);

  const title = h("h1", { text: activity.name });
  const status = h("p", { class: "flyover-status", role: "status", text: "Flyover at 0.00 km" });
  const playButton = h("button", { class: "btn btn-primary btn-pill", type: "button", "aria-pressed": "false" }, icon("play"), h("span", { text: "Play flyover" }));
  const speeds = [1, 2, 4].map((rate) => h("button", { class: "toggle-btn", type: "button", "aria-pressed": String(rate === 1), text: `${rate}x` }));
  const slider = h("input", { id: "route-position", type: "range", min: "0", max: String(streams.distance.length - 1), value: "0" });

  const setMarker = (metres) => {
    const [x, y] = route.project ? route.project(...positionAt(streams, metres)) : [0, 0];
    marker.setAttribute("cx", x.toFixed(1));
    marker.setAttribute("cy", y.toFixed(1));
  };
  const setSlider = (index) => {
    const text = `${km(streams.distance[index])} km, ${Math.round(streams.altitude[index])} m`;
    slider.value = String(index);
    slider.setAttribute("aria-valuenow", String(index));
    slider.setAttribute("aria-valuetext", text);
    profile.mark(index);
  };
  slider.addEventListener("input", () => {
    const index = Number(slider.value);
    setSlider(index);
    setMarker(streams.distance[index]);
    status.textContent = `Flyover at ${km(streams.distance[index])} km`;
  });
  setSlider(0);
  setMarker(0);

  /* flyover: a requestAnimationFrame loop moves the marker along the route in about eight seconds at 1x */
  let rate = 1, progress = 0, playing = false, frame = null, startedAt = null, startedFrom = 0;
  const show = () => {
    const metres = progress * total;
    setMarker(metres);
    status.textContent = `Flyover at ${km(progress >= 1 ? total : metres)} km`;
    let index = streams.distance.findIndex((d) => d >= metres);
    index = index < 0 ? streams.distance.length - 1 : index;
    setSlider(index);
  };
  const stop = () => {
    playing = false;
    cancelAnimationFrame(frame);
    playButton.setAttribute("aria-pressed", "false");
    playButton.lastChild.textContent = "Play flyover";
    playButton.firstChild.firstChild.setAttribute("href", "#i-play");
  };
  const step = (now) => {
    startedAt ??= now;
    progress = Math.min(1, startedFrom + (now - startedAt) / (FLYOVER_MS / rate));
    show();
    if (progress >= 1) stop();
    else frame = requestAnimationFrame(step);
  };
  playButton.addEventListener("click", () => {
    if (playing) {
      stop();
      return;
    }
    if (progress >= 1) progress = 0;
    playing = true;
    startedAt = null;
    startedFrom = progress;
    playButton.setAttribute("aria-pressed", "true");
    playButton.lastChild.textContent = "Pause flyover";
    playButton.firstChild.firstChild.setAttribute("href", "#i-pause");
    frame = requestAnimationFrame(step);
  });
  speeds.forEach((button, i) => button.addEventListener("click", () => {
    rate = [1, 2, 4][i];
    for (const other of speeds) other.setAttribute("aria-pressed", String(other === button));
    startedAt = null;
    startedFrom = progress;
  }));

  const audio = h("button", { class: "btn btn-outline btn-pill", type: "button" }, icon("volume"), "Play audio splits");
  if (speechAvailable()) audio.addEventListener("click", () => speakSplits(activity.splits));
  else audio.disabled = true;

  const kudosCountText = h("span", { class: "muted", text: "" });
  const givers = h("div", { class: "giver-list" });
  const loadGivers = async () => {
    const result = await api(`/api/activities/${activity.id}/kudos`);
    if (!result.ok) return;
    givers.replaceChildren(...result.data.athletes.map((a) => h("a", { href: `/athletes/${a.id}`, text: a.name })));
    kudosCountText.textContent = result.data.athletes.length ? "gave kudos:" : mine ? "No kudos yet." : "Be the first to give kudos.";
  };
  loadGivers();
  const kudos = mine
    ? h("span", { class: "count-pill" }, icon("thumb"), `${activity.kudos_count} kudos`)
    : kudosButton(activity, { onChange: loadGivers });

  const ownerActions = mine ? [
    h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Edit", onclick: () => editDialog(activity, (fresh) => { activity = fresh; title.textContent = fresh.name; meta.replaceChildren(...metaItems(fresh)); }) }),
    h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Delete", onclick: () => deleteDialog(activity) }),
    h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Export GPX", onclick: (event) => exportGpx(activity, event.currentTarget) }),
    h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Create segment", onclick: () => segmentDialog(activity, streams) }),
  ] : [];

  const metaItems = (a) => [
    h("span", { class: "sport-line" }, icon(a.sport_type), SPORT_NAMES[a.sport_type]),
    h("span", { text: dateTime(a.start_time, me.time_zone) }),
    h("span", {}, "by ", h("a", { href: `/athletes/${a.athlete_id}`, text: a.athlete_name })),
    h("span", { class: "badge", text: VISIBILITY_NAMES[a.visibility] }),
  ];
  const meta = h("div", { class: "meta-line" }, ...metaItems(activity));
  const { label, value } = paceFigure(activity);
  const figure = (name, text, unit) => h("div", {}, h("dt", { text: name }), h("dd", { text }, unit ? h("span", { class: "unit", text: unit }) : null));
  const comments = commentThread(activity, me, { onCount: (n) => { commentTotal.textContent = `${n} ${n === 1 ? "comment" : "comments"}`; } });
  const commentTotal = h("span", { class: "muted", text: `${activity.comment_count} comments` });

  root.replaceChildren(
    h("div", { class: "activity-head" }, title, meta, h("div", { class: "owner-actions" }, ...ownerActions, audio)),
    h("dl", { class: "card figures" },
      figure("Distance", km(activity.distance_m), "km"), figure("Moving Time", duration(activity.moving_time_s)),
      figure(label, value.split(" ")[0], value.split(" ")[1]), figure("Elevation", thousands(activity.elevation_gain_m), "m"),
      figure("Elapsed Time", duration(activity.elapsed_time_s))),
    h("div", { class: "activity-grid" },
      h("div", { class: "side-stack" },
        h("section", { class: "card map-card", "aria-label": "Route" }, route.svg,
          h("div", { class: "map-controls" }, playButton, h("div", { class: "speed-group", role: "group", "aria-label": "Flyover speed" }, ...speeds), status)),
        h("section", { class: "card profile-card", "aria-label": "Elevation profile" }, h("h2", { class: "card-title", text: "Elevation profile" }), profile.svg,
          h("div", { class: "slider-line" }, h("label", { for: "route-position", class: "small muted", text: "Route position" }), slider))),
      h("div", { class: "side-stack" },
        h("section", { class: "card" }, h("h2", { class: "card-title", text: "Splits" }), splitsTable(activity)),
        h("section", { class: "card" }, h("h2", { class: "card-title", text: "Segment efforts" }),
          activity.segment_efforts.length ? h("ul", { class: "effort-list" }, ...activity.segment_efforts.map(effortRow)) : h("p", { class: "muted", text: "No segment efforts on this activity yet." })),
        h("section", { class: "card social-card", id: "comments", "aria-label": "Kudos and comments" },
          h("div", { class: "kudos-row" }, kudos, kudosCountText, commentTotal), givers, comments))));
}

requireMember().then(async (me) => {
  if (!/^\d{1,18}$/.test(id)) return notFound();
  const [activity, streams] = await Promise.all([api(`/api/activities/${id}`), api(`/api/activities/${id}/streams`)]);
  if (!activity.ok || !streams.ok) return notFound();
  render(activity.data, streams.data, me);
  return null;
});
