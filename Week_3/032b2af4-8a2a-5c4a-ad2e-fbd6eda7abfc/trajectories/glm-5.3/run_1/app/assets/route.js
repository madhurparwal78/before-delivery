/* Route map, elevation profile, flyover player and audio splits: shared product widgets. */
"use strict";

/* A drawn map panel with an orange route line, start dot and finish chequer. */
function routeMapSvg(points, opts = {}) {
  const w = opts.width || 640, h = opts.height || 320;
  if (!points || points.length < 2) {
    return `<div class="map-panel" style="height:${h}px"></div>`;
  }
  const lats = points.map(p => p[0]), lngs = points.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 0.0001, spanLng = maxLng - minLng || 0.0001;
  const pad = 24;
  const coords = points.map(p => [
    pad + (p[1] - minLng) / spanLng * (w - 2 * pad),
    h - pad - (p[0] - minLat) / spanLat * (h - 2 * pad),
  ]);
  const d = "M" + coords.map(c => c[0].toFixed(1) + " " + c[1].toFixed(1)).join(" L");
  const first = coords[0], last = coords[coords.length - 1];
  const markerId = opts.markerId || "flyMarker";
  return `
  <div class="map-panel">
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Route map from start to finish">
      <rect class="ground" width="${w}" height="${h}"></rect>
      <g stroke="#dfe6d3" stroke-width="1" aria-hidden="true">
        ${Array.from({ length: 7 }, (_, i) => `<line x1="${i * w / 6}" y1="0" x2="${i * w / 6}" y2="${h}"/>`).join("")}
        ${Array.from({ length: 4 }, (_, i) => `<line x1="0" y1="${i * h / 3}" x2="${w}" y2="${i * h / 3}"/>`).join("")}
      </g>
      <path class="route-line" d="${d}"></path>
      <circle class="start-dot" cx="${first[0]}" cy="${first[1]}" r="7" aria-hidden="true"></circle>
      <g class="finish-check" aria-hidden="true">
        <rect x="${last[0] - 7}" y="${last[1] - 7}" width="14" height="14" fill="#fff"/>
        <rect x="${last[0] - 7}" y="${last[1] - 7}" width="7" height="7"/>
        <rect x="${last[0]}" y="${last[1]}" width="7" height="7"/>
      </g>
      <circle id="${markerId}" class="flyover-marker" r="6" cx="${first[0]}" cy="${first[1]}"
              opacity="0" aria-hidden="true"></circle>
    </svg>
  </div>`;
}

/* Elevation profile with an accessible Route position slider. */
function elevationPanel(streams) {
  const alt = streams.altitude || [];
  const dist = streams.distance || [];
  const n = alt.length;
  if (!n) return "";
  const w = 640, h = 120, pad = 8;
  const minA = Math.min(...alt), maxA = Math.max(...alt);
  const spanA = maxA - minA || 1;
  const x = i => pad + (i / Math.max(1, n - 1)) * (w - 2 * pad);
  const y = a => h - pad - ((a - minA) / spanA) * (h - 2 * pad);
  const line = "M" + alt.map((a, i) => `${x(i).toFixed(1)} ${y(a).toFixed(1)}`).join(" L");
  const area = line + ` L${x(n - 1).toFixed(1)} ${h} L${x(0).toFixed(1)} ${h} Z`;
  return `
  <div class="elevation-panel">
    <div class="spread"><span class="caps-label">Elevation profile</span>
      <span id="elevationReadout" class="small tnum"></span></div>
    <svg id="elevationSvg" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">
      <path class="area" d="${area}"></path>
      <path class="line" d="${line}"></path>
      <line id="elevationCursor" class="cursor-line" x1="${x(0)}" y1="0" x2="${x(0)}" y2="${h}"></line>
    </svg>
    <label class="caps-label" for="routePosition">Route position</label>
    <input type="range" id="routePosition" role="slider" min="0" max="${n - 1}" step="1" value="0"
           aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="0">
  </div>`;
}

function mountElevationProfile(streams, onIndex) {
  const slider = document.getElementById("routePosition");
  if (!slider) return;
  const alt = streams.altitude || [];
  const dist = streams.distance || [];
  const cursor = document.getElementById("elevationCursor");
  const readout = document.getElementById("elevationReadout");
  const svg = document.getElementById("elevationSvg");
  const w = svg ? 640 : 640, h = 120, pad = 8;
  const n = alt.length;
  const update = (i) => {
    const idx = Math.max(0, Math.min(n - 1, i));
    const distKm = (dist[idx] / 1000).toFixed(2);
    const elev = Math.round(alt[idx]);
    slider.setAttribute("aria-valuenow", String(idx));
    slider.setAttribute("aria-valuetext", `${distKm} km, ${elev} m`);
    if (readout) readout.textContent = `${distKm} km · ${elev} m`;
    if (cursor) {
      const x = pad + (idx / Math.max(1, n - 1)) * (w - 2 * pad);
      cursor.setAttribute("x1", x); cursor.setAttribute("x2", x);
    }
    if (onIndex) onIndex(idx);
  };
  slider.addEventListener("input", () => update(Number(slider.value)));
  slider.addEventListener("keydown", (e) => {
    if (e.key === "Home") { slider.value = 0; update(0); e.preventDefault(); }
    if (e.key === "End") { slider.value = n - 1; update(n - 1); e.preventDefault(); }
  });
  update(0);
  return { set: update, slider };
}

/* Flyover: marker glides the route in about eight seconds at 1x. */
function mountFlyover(streams, opts = {}) {
  const latlng = streams.latlng || [];
  const distance = streams.distance || [];
  const btn = document.getElementById(opts.playButton || "flyoverButton");
  const status = document.getElementById(opts.statusEl || "flyoverStatus");
  const speedSel = document.getElementById(opts.speedSelect || "flyoverSpeed");
  const marker = document.getElementById(opts.markerId || "flyoverMarker");
  if (!btn || !marker || latlng.length < 2) return { stop() {} };
  let raf = null, playing = false;
  const total = distance[distance.length - 1] || 1;
  const lats = latlng.map(p => p[0]), lngs = latlng.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 0.0001, spanLng = maxLng - minLng || 0.0001;
  const mapPanel = marker.closest(".map-panel");
  const viewBox = marker.closest("svg").getAttribute("viewBox").split(" ");
  const mw = Number(viewBox[2]), mh = Number(viewBox[3]);
  const pad = 24;
  const toXY = (p) => [
    pad + (p[1] - minLng) / spanLng * (mw - 2 * pad),
    mh - pad - (p[0] - minLat) / spanLat * (mh - 2 * pad),
  ];
  const position = (t) => {
    // t in [0, 1] of the route; find surrounding points
    let i = 0;
    while (i < distance.length - 2 && distance[i + 1] / total < t) i++;
    const d0 = distance[i], d1 = distance[i + 1] || total;
    const frac = d1 === d0 ? 0 : Math.min(1, (t * total - d0) / (d1 - d0));
    const p0 = latlng[i], p1 = latlng[i + 1] || latlng[i];
    const point = [p0[0] + (p1[0] - p0[0]) * frac, p0[1] + (p1[1] - p0[1]) * frac];
    const [x, y] = toXY(point);
    marker.setAttribute("cx", x); marker.setAttribute("cy", y);
    marker.setAttribute("opacity", "1");
    if (status) status.textContent = `Flyover at ${(t * total / 1000).toFixed(2)} km`;
  };
  const stop = () => {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    btn.textContent = "Play flyover";
    btn.setAttribute("aria-pressed", "false");
  };
  btn.addEventListener("click", () => {
    if (playing) { stop(); return; }
    playing = true;
    btn.textContent = "Pause flyover";
    btn.setAttribute("aria-pressed", "true");
    const speed = speedSel ? Number(speedSel.value || 1) : 1;
    const durationMs = 8000 / speed;
    const start = performance.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (now) => {
      if (!playing) return;
      const t = Math.min(1, (now - start) / durationMs);
      position(t);
      if (t < 1) raf = requestAnimationFrame(tick);
      else stop();
    };
    if (reduced) {
      // under reduced motion the marker jumps to the finish without animating
      position(1);
      stop();
    } else {
      raf = requestAnimationFrame(tick);
    }
  });
  return { stop, position };
}

/* Audio splits: one utterance per split through speech synthesis. */
function mountAudioSplits(splits, buttonId = "audioSplitsButton") {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  const synth = window.speechSynthesis;
  if (!synth) { btn.disabled = true; return; }
  btn.addEventListener("click", () => {
    if (synth.speaking) synth.cancel();
    splits.forEach((split, i) => {
      const u = new SpeechSynthesisUtterance();
      const mins = Math.floor(split.elapsed_time_s / 60);
      const secs = split.elapsed_time_s % 60;
      u.text = `Kilometer ${i + 1}, ${mins} minutes ${secs} seconds`;
      u.lang = "en";
      synth.speak(u);
    });
  });
}
