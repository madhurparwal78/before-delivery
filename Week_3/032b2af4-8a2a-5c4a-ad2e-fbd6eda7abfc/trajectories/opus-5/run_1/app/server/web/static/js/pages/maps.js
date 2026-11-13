import { api, token } from "../api.js";

const NS = "http://www.w3.org/2000/svg";

function project(segments) {
  const lats = segments.flatMap((s) => [s.start_lat, s.end_lat]);
  const lons = segments.flatMap((s) => [s.start_lon, s.end_lon]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const spanLat = maxLat - minLat || 0.01;
  const spanLon = maxLon - minLon || 0.01;
  return (lat, lon) => [
    80 + ((lon - minLon) / spanLon) * 440,
    520 - ((lat - minLat) / spanLat) * 440,
  ];
}

const MINIMUM_DRAWN_LENGTH = 48;

function drawSegments(segments) {
  const layer = document.querySelector("[data-segment-layer]");
  if (!layer || !segments.length) return;
  const place = project(segments);
  segments.forEach((segment) => {
    let [x1, y1] = place(segment.start_lat, segment.start_lon);
    let [x2, y2] = place(segment.end_lat, segment.end_lon);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < MINIMUM_DRAWN_LENGTH) {
      const bearing = length ? Math.atan2(y2 - y1, x2 - x1) : -Math.PI / 2;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const reach = MINIMUM_DRAWN_LENGTH / 2;
      x1 = midX - Math.cos(bearing) * reach;
      y1 = midY - Math.sin(bearing) * reach;
      x2 = midX + Math.cos(bearing) * reach;
      y2 = midY + Math.sin(bearing) * reach;
    }
    const line = document.createElementNS(NS, "path");
    line.setAttribute("d", `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`);
    line.dataset.segmentLine = String(segment.id);
    layer.append(line);
  });
}

async function heatmap() {
  const toggle = document.querySelector("[data-map-heat]");
  const layer = document.querySelector("[data-heat-layer]");
  if (!toggle) return;
  toggle.addEventListener("change", async () => {
    if (!toggle.checked) {
      layer.hidden = true;
      return;
    }
    if (!token()) {
      document.querySelector("[data-map-status]").textContent = "Log in to see your own heatmap.";
      toggle.checked = false;
      return;
    }
    layer.textContent = "";
    const status = document.querySelector("[data-map-status]");
    const { data } = await api("/api/feed?limit=10");
    const mine = (data?.activities || []).filter(
      (activity) => String(activity.athlete_id) === document.body.dataset.athleteId
    );
    status.textContent = mine.length
      ? `Showing ${Math.min(mine.length, 5)} of your own activities.`
      : "You have no activities to draw yet.";
    for (const activity of mine.slice(0, 5)) {
      const streams = await api(`/api/activities/${activity.id}/streams`);
      const points = streams.data?.latlng || [];
      if (points.length < 2) continue;
      const place = project([
        {
          start_lat: Math.min(...points.map((p) => p[0])),
          end_lat: Math.max(...points.map((p) => p[0])),
          start_lon: Math.min(...points.map((p) => p[1])),
          end_lon: Math.max(...points.map((p) => p[1])),
        },
      ]);
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", points.map((p, i) => `${i ? "L" : "M"}${place(p[0], p[1]).join(" ")}`).join(" "));
      layer.append(path);
    }
    layer.hidden = false;
  });
}

export function init() {
  const data = document.querySelector("[data-segment-data]");
  const segments = data ? JSON.parse(data.textContent) : [];
  drawSegments(segments);

  const search = document.querySelector("[data-map-search]");
  const empty = document.querySelector("[data-segment-empty]");
  search.addEventListener("input", () => {
    const text = search.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll("[data-segment-row]").forEach((row) => {
      const match = row.dataset.name.includes(text);
      row.hidden = !match;
      if (match) shown += 1;
    });
    empty.hidden = shown > 0;
  });

  const panel = document.querySelector("[data-map-panel]");
  document.querySelectorAll("[data-open-segment]").forEach((button) =>
    button.addEventListener("click", () => {
      const distance = Number(button.dataset.distance);
      const elevation = Number(button.dataset.elevation);
      panel.querySelector("[data-panel-name]").textContent = button.dataset.segmentName;
      panel.querySelector("[data-panel-distance]").textContent = `${(distance / 1000).toFixed(2)} km`;
      panel.querySelector("[data-panel-grade]").textContent = `${((elevation / distance) * 100).toFixed(1)}%`;
      panel.querySelector("[data-panel-link]").href = `/segments/${button.dataset.openSegment}`;
      panel.hidden = false;
    })
  );
  panel.querySelector("[data-panel-close]").addEventListener("click", () => {
    panel.hidden = true;
  });

  document.querySelector("[data-create-route]").addEventListener("click", () => {
    document.querySelector("[data-map-status]").textContent = "Route building is coming soon to Pacely.";
  });

  heatmap();
}
