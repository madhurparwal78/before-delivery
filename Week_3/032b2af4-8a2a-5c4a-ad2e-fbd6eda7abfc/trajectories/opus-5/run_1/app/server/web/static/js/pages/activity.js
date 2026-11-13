import { api } from "../api.js";
import { award } from "../medals.js";
import {
  duration,
  element,
  kilometres,
  paceText,
  pathFrom,
  projector,
  reducedMotion,
  speedText,
  startedAt,
} from "../format.js";

const NS = "http://www.w3.org/2000/svg";
const MEDALS = { 1: "Personal record", 2: "2nd fastest", 3: "3rd fastest" };
const FLYOVER_SECONDS = 8;

let activity = null;
let streams = null;
let viewerId = null;
let shape = null;

function fail(message) {
  const error = document.querySelector("[data-activity-error]");
  error.textContent = message;
  error.hidden = false;
}

function showFigures() {
  document.querySelector("[data-activity-athlete]").textContent = activity.athlete_name;
  document.querySelector("[data-activity-name]").textContent = activity.name;
  const sport = activity.sport_type[0].toUpperCase() + activity.sport_type.slice(1);
  document.querySelector("[data-activity-meta]").textContent = `${sport} · ${startedAt(activity.start_time)}`;
  document.title = `${activity.name} — Pacely`;
  document.querySelector("[data-stat-distance]").textContent = `${kilometres(activity.distance_m)} km`;
  document.querySelector("[data-stat-moving]").textContent = duration(activity.moving_time_s);
  document.querySelector("[data-stat-elapsed]").textContent = duration(activity.elapsed_time_s);
  document.querySelector("[data-stat-elevation]").textContent = `${activity.elevation_gain_m} m`;
  const paceLabel = document.querySelector("[data-pace-label]");
  const paceValue = document.querySelector("[data-stat-pace]");
  if (activity.sport_type === "ride") {
    paceLabel.textContent = "Speed";
    paceValue.textContent = speedText(activity.avg_speed_kmh);
  } else {
    paceLabel.textContent = "Pace";
    paceValue.textContent = paceText(activity.avg_pace_s_per_km || 0);
  }
}

function drawRoute() {
  if (!streams.latlng.length) return;
  const place = projector(streams.latlng, 600, 360, 40);
  shape = streams.latlng.map((point) => place(point[0], point[1]));
  document.querySelector("[data-route-line]").setAttribute("d", pathFrom(streams.latlng, place));
  const start = document.querySelector("[data-route-start]");
  start.setAttribute("cx", shape[0][0]);
  start.setAttribute("cy", shape[0][1]);
  const finish = document.querySelector("[data-route-finish]");
  const [fx, fy] = shape[shape.length - 1];
  finish.innerHTML = "";
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const square = document.createElementNS(NS, "rect");
      square.setAttribute("x", fx - 8 + column * 8);
      square.setAttribute("y", fy - 8 + row * 8);
      square.setAttribute("width", "8");
      square.setAttribute("height", "8");
      square.setAttribute("fill", (row + column) % 2 ? "#ffffff" : "#1a1715");
      finish.append(square);
    }
  }
}

function drawElevation() {
  const altitude = streams.altitude;
  if (!altitude.length) return;
  const lowest = Math.min(...altitude);
  const highest = Math.max(...altitude);
  const span = highest - lowest || 1;
  const points = altitude.map((value, index) => [
    (index / Math.max(1, altitude.length - 1)) * 400,
    150 - ((value - lowest) / span) * 130,
  ]);
  const line = points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  document.querySelector("[data-elevation-line]").setAttribute("d", line);
  document.querySelector("[data-elevation-area]").setAttribute("d", `${line} L400 160 L0 160 Z`);

  const slider = document.querySelector("[data-route-position]");
  const cursor = document.querySelector("[data-elevation-cursor]");
  slider.max = String(altitude.length - 1);
  const place = (index) => {
    slider.value = String(index);
    slider.setAttribute("aria-valuetext",
      `${kilometres(streams.distance[index])} km, ${Math.round(streams.altitude[index])} m`);
    cursor.setAttribute("x1", points[index][0]);
    cursor.setAttribute("x2", points[index][0]);
  };
  slider.addEventListener("input", () => place(Number(slider.value)));
  place(0);
}

function flyover() {
  const button = document.querySelector("[data-flyover]");
  const status = document.querySelector("[data-flyover-status]");
  const marker = document.querySelector("[data-route-marker]");
  let speed = 1;
  let frame = null;
  let began = 0;

  document.querySelectorAll("[data-speed]").forEach((control) =>
    control.addEventListener("click", () => {
      speed = Number(control.dataset.speed);
      document
        .querySelectorAll("[data-speed]")
        .forEach((other) => other.setAttribute("aria-pressed", String(other === control)));
    })
  );

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    button.textContent = "Play flyover";
    button.setAttribute("aria-pressed", "false");
  };

  const step = (now) => {
    const fraction = Math.min(1, ((now - began) / 1000) * (speed / FLYOVER_SECONDS));
    const total = streams.distance[streams.distance.length - 1];
    const travelled = total * fraction;
    let index = streams.distance.findIndex((value) => value >= travelled);
    if (index < 0) index = streams.distance.length - 1;
    marker.hidden = false;
    marker.setAttribute("cx", shape[index][0]);
    marker.setAttribute("cy", shape[index][1]);
    status.textContent = `Flyover at ${kilometres(travelled)} km`;
    if (fraction < 1) frame = requestAnimationFrame(step);
    else stop();
  };

  button.addEventListener("click", () => {
    if (frame) {
      stop();
      return;
    }
    began = performance.now();
    button.textContent = "Pause flyover";
    button.setAttribute("aria-pressed", "true");
    frame = requestAnimationFrame(step);
  });
}

function splitElevationGain(from, to) {
  let gain = 0;
  for (let i = 1; i < streams.distance.length; i += 1) {
    if (streams.distance[i] <= from || streams.distance[i - 1] >= to) continue;
    const rise = streams.altitude[i] - streams.altitude[i - 1];
    if (rise > 0) gain += rise;
  }
  return Math.round(gain);
}

function showSplits() {
  const body = document.querySelector("[data-splits-body]");
  body.textContent = "";
  const whole = activity.splits.filter((split) => split.distance_m === 1000);
  const fastest = whole.length ? Math.min(...whole.map((split) => split.pace_s_per_km)) : null;
  let running = 0;
  activity.splits.forEach((split) => {
    const startDistance = running;
    running += split.distance_m;
    const row = element("tr", {}, [
      element("th", { scope: "row", class: "tnum", text: String(split.split) }),
      element("td", { class: "tnum", text: paceText(split.pace_s_per_km) }),
      element("td", { class: "tnum", text: `${splitElevationGain(startDistance, running)} m` }),
    ]);
    if (split.distance_m === 1000 && split.pace_s_per_km === fastest) {
      row.querySelector("td").append(element("strong", { text: " Fastest" }));
    }
    body.append(row);
  });
}

function showBestEfforts() {
  const list = document.querySelector("[data-best-efforts]");
  list.textContent = "";
  activity.best_efforts.forEach((effort) =>
    list.append(element("li", { text: `${effort.name}: ${duration(effort.elapsed_time_s)}` }))
  );
  document.querySelector("[data-best-efforts-empty]").hidden = activity.best_efforts.length > 0;
}

function showSegmentEfforts() {
  const list = document.querySelector("[data-segment-efforts]");
  list.textContent = "";
  activity.segment_efforts.forEach((effort) => {
    const item = element("li", { class: "chips", style: "align-items:center" }, [
      element("a", { href: `/segments/${effort.segment_id}`, text: effort.segment_name }),
      element("span", { class: "tnum", text: duration(effort.elapsed_time_s) }),
    ]);
    if (effort.is_crown) item.append(award("crown", "First place", "crown"));
    if (effort.pr_rank in MEDALS) {
      item.append(award("medal", MEDALS[effort.pr_rank], `medal-${effort.pr_rank}`));
    }
    list.append(item);
  });
  document.querySelector("[data-segment-efforts-empty]").hidden = activity.segment_efforts.length > 0;
}

function audioSplits() {
  const button = document.querySelector("[data-audio-splits]");
  if (!("speechSynthesis" in window)) {
    button.disabled = true;
    return;
  }
  button.addEventListener("click", () => {
    window.speechSynthesis.cancel();
    activity.splits.forEach((split) => {
      const minutes = Math.floor(split.elapsed_time_s / 60);
      const seconds = split.elapsed_time_s % 60;
      window.speechSynthesis.speak(
        new SpeechSynthesisUtterance(`Kilometer ${split.split}, ${minutes} minutes ${seconds} seconds`)
      );
    });
  });
}

async function kudos() {
  const button = document.querySelector("[data-kudos]");
  const label = document.querySelector("[data-kudos-label]");
  const list = document.querySelector("[data-kudos-list]");
  const alert = document.querySelector("[data-kudos-error]");
  let count = activity.kudos_count;
  let given = false;
  button.disabled = activity.athlete_id === viewerId;

  const refresh = async () => {
    const { ok, data } = await api(`/api/activities/${activity.id}/kudos`);
    if (!ok) return;
    list.textContent = "";
    data.athletes.forEach((athlete) =>
      list.append(element("li", {}, [element("a", { href: `/athletes/${athlete.id}`, text: athlete.name })]))
    );
    count = data.athletes.length;
    given = data.athletes.some((athlete) => athlete.id === viewerId);
    label.textContent = `Give kudos, ${count}`;
    button.setAttribute("aria-pressed", String(given));
  };

  button.addEventListener("click", async () => {
    const before = { count, given };
    given = !given;
    count += given ? 1 : -1;
    label.textContent = `Give kudos, ${count}`;
    button.setAttribute("aria-pressed", String(given));
    alert.hidden = true;
    if (!reducedMotion()) {
      button.classList.remove("pop");
      void button.offsetWidth;
      button.classList.add("pop");
    }
    const { ok } = await api(`/api/activities/${activity.id}/kudos`, {
      method: before.given ? "DELETE" : "POST",
    });
    if (!ok) {
      count = before.count;
      given = before.given;
      label.textContent = `Give kudos, ${count}`;
      button.setAttribute("aria-pressed", String(given));
      alert.hidden = false;
      return;
    }
    refresh();
  });

  await refresh();
}

async function comments() {
  const list = document.querySelector("[data-comment-list]");
  const form = document.querySelector("[data-comment-form]");
  const alert = document.querySelector("[data-comment-error]");

  const refresh = async () => {
    const { ok, data } = await api(`/api/activities/${activity.id}/comments`);
    if (!ok) return;
    list.textContent = "";
    data.comments.forEach((comment) => {
      const item = element("li", { class: "card", style: "margin-bottom:12px" }, [
        element("p", { class: "small muted", text: `${comment.athlete_name} · ${startedAt(comment.created_at)}` }),
        element("p", { text: comment.text }),
      ]);
      if (comment.athlete_id === viewerId || activity.athlete_id === viewerId) {
        const remove = element("button", { class: "btn btn-outline btn-pill", type: "button", text: "Delete comment" });
        remove.addEventListener("click", async () => {
          await api(`/api/comments/${comment.id}`, { method: "DELETE" });
          refresh();
        });
        item.append(remove);
      }
      list.append(item);
    });
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    alert.hidden = true;
    const text = form.elements.text.value;
    const { ok } = await api(`/api/activities/${activity.id}/comments`, { method: "POST", body: { text } });
    if (!ok) {
      alert.hidden = false;
      return;
    }
    form.elements.text.value = "";
    refresh();
  });

  await refresh();
}

function ownerControls() {
  const panel = document.querySelector("[data-owner-controls]");
  if (activity.athlete_id !== viewerId) return;
  panel.hidden = false;
  const status = document.querySelector("[data-owner-status]");
  const editForm = document.querySelector("[data-edit-form]");
  const segmentForm = document.querySelector("[data-segment-form]");
  document.querySelector("[data-export-activity]").href = `/api/activities/${activity.id}/export.gpx`;

  document.querySelector("[data-edit-activity]").addEventListener("click", () => {
    editForm.hidden = !editForm.hidden;
    editForm.elements.name.value = activity.name;
    editForm.elements.visibility.value = activity.visibility;
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { ok, data } = await api(`/api/activities/${activity.id}`, {
      method: "PATCH",
      body: { name: editForm.elements.name.value, visibility: editForm.elements.visibility.value },
    });
    if (ok) {
      activity = data;
      showFigures();
      status.textContent = "Activity updated.";
      editForm.hidden = true;
    } else {
      status.textContent = "Those changes were refused.";
    }
  });

  document.querySelector("[data-delete-activity]").addEventListener("click", async () => {
    if (!window.confirm(`Delete ${activity.name}? This cannot be undone.`)) return;
    const { ok } = await api(`/api/activities/${activity.id}`, { method: "DELETE" });
    if (ok) window.location.href = "/dashboard";
  });

  document.querySelector("[data-create-segment]").addEventListener("click", () => {
    segmentForm.hidden = !segmentForm.hidden;
    segmentForm.elements.end_index.value = String(streams.latlng.length - 1);
    segmentForm.elements.start_index.max = String(streams.latlng.length - 1);
    segmentForm.elements.end_index.max = String(streams.latlng.length - 1);
  });

  segmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { ok, data } = await api("/api/segments", {
      method: "POST",
      body: {
        activity_id: activity.id,
        start_index: Number(segmentForm.elements.start_index.value),
        end_index: Number(segmentForm.elements.end_index.value),
        name: segmentForm.elements.name.value,
      },
    });
    status.textContent = ok ? `Segment ${data.name} created.` : "That segment was refused.";
    if (ok) window.location.reload();
  });
}

export async function init() {
  const page = document.querySelector("[data-activity-page]");
  const id = page.dataset.activityId;
  const me = await api("/api/me");
  if (!me.ok) {
    window.location.replace("/login");
    return;
  }
  viewerId = me.data.athlete.id;

  const loaded = await api(`/api/activities/${id}`);
  if (!loaded.ok) {
    fail("This activity is not available to you.");
    return;
  }
  activity = loaded.data;
  const streamed = await api(`/api/activities/${id}/streams`);
  streams = streamed.ok ? streamed.data : { latlng: [], altitude: [], distance: [], time: [] };

  showFigures();
  drawRoute();
  drawElevation();
  flyover();
  showSplits();
  showBestEfforts();
  showSegmentEfforts();
  audioSplits();
  await kudos();
  await comments();
  ownerControls();
}
