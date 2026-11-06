/* The strip workspace: strip canvas, loupe, calibration, handles, notes. */
"use strict";

(function () {
  const E = window.Edgeprint;
  const A = E.app;
  const S = E.screens;
  const { el, $, fmtSigned, fmtPlain, DASH, MINUS, ROMAN, Api, previewText } =
    Object.assign({}, E, E.ui || {});
  const UI = E.ui;
  const announce = UI.announce;

  let loupeState = { open: false, cell: null, reading: null, token: 0 };

  async function workspaceScreen(root, rollId, scanId) {
    let scan;
    try { scan = await Api.get(`/api/scans/${scanId}`); }
    catch (error) { return A.notFound(root); }
    const roll = await Api.get(`/api/rolls/${rollId}`);
    const frames = scan.frames;
    const frameParam = new URLSearchParams(location.search).get("frame");

    const strip = await stripRegion(roll, scan, frames);
    const readingPanel = el("section", { class: "panel readout-panel",
                                         id: "loupe-panel",
                                         "aria-label": "Loupe reading",
                                         role: "region",
                                         text: "Net — · Gross — · log H — · x 0 · y 0" });
    const curvePanel = await curveRegion(roll);
    const notes = await notesRegion(roll, scan, frames);

    const grid = el("div", { class: "workspace grid" }, [
      el("div", { style: "grid-column: 1 / -1" }, [strip]),
      el("div", { class: "w-phone", style: "grid-column: 1 / -1" }, [readingPanel]),
      el("div", { class: "w-curve", style: "grid-column: 1 / 8" }, [curvePanel]),
      el("div", { class: "w-notes", style: "grid-column: 8 / 13" }, [notes]),
    ]);
    root.append(...UI.shell([el("div", { class: "wrap" }, [grid])],
                            A.getMe(), A.isStorageDown()));
    if (frameParam) {
      const target = $(`[data-frame-region="${frameParam}"]`);
      if (target) target.scrollIntoView({ block: "center" });
    }
  }

  async function stripRegion(roll, scan, frames) {
    const canvas = el("canvas", { class: "strip-canvas", tabindex: "0",
                                  role: "img", "aria-label": "Densitometer strip" });
    canvas.width = scan.width; canvas.height = scan.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const sliceCount = scan.preview_slices;
    const images = [];
    for (let n = 0; n < sliceCount; n += 1) {
      images.push(await loadImage(`/api/scans/${scan.id}/preview/${n}`));
    }
    const tinted = tintCanvas(ctx, canvas.width, canvas.height, images);
    ctx.putImageData(tinted, 0, 0);
    const frameParam = new URLSearchParams(location.search).get("frame");
    for (const frame of frames) {
      ctx.strokeStyle = "rgba(244,217,108,0.9)";
      ctx.lineWidth = Math.max(1, scan.width / 1000);
      ctx.strokeRect(frame.x0, 0, frame.x1 - frame.x0, scan.height);
      if (frameParam && String(frame.number) === frameParam) {
        /* The ?frame=<n> query outlines that frame on the strip. */
        ctx.lineWidth = Math.max(2, scan.width / 500);
        ctx.strokeStyle = "rgba(244,217,108,1)";
        ctx.strokeRect(frame.x0 + ctx.lineWidth, ctx.lineWidth,
                       frame.x1 - frame.x0 - 2 * ctx.lineWidth,
                       scan.height - 2 * ctx.lineWidth);
      }
    }

    const handles = el("div", { class: "handles" });
    for (const frame of frames) {
      handles.append(frameHandle(scan, frame, "left"));
      handles.append(frameHandle(scan, frame, "right"));
      if (frame.flag === "flagged") {
        handles.append(el("button", { class: "linkish",
          text: `Accept frame ${frame.number} width`,
          onclick: async () => {
            announce(`Saving frame ${frame.number}…`);
            try {
              await Api.post(`/api/frames/${frame.id}/accept-width`);
              announce(`Frame ${frame.number} width accepted.`);
              UI.render();
            } catch (error) { announce(error.message || "Storage is unreachable."); }
          } }));
      }
    }

    attachLoupe(canvas, scan, frames);
    const region = el("section", { class: "panel", role: "region",
                                   "aria-label": "Strip" }, [
      canvas, handles, calibrationControls(roll, scan),
    ]);
    return region;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

  function tintCanvas(ctx, width, height, images) {
    const off = document.createElement("canvas");
    off.width = width; off.height = height;
    const offCtx = off.getContext("2d");
    for (const image of images) {
      offCtx.drawImage(image, 0, 0);
    }
    const data = offCtx.getImageData(0, 0, width, height);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = data.data[i];
      data.data[i] = Math.round(19 + (244 - 19) * v / 255);
      data.data[i + 1] = Math.round(54 + (217 - 54) * v / 255);
      data.data[i + 2] = Math.round(33 + (108 - 33) * v / 255);
    }
    return data;
  }

  function frameHandle(scan, frame, side) {
    const slider = el("input", { type: "range", min: 0, max: scan.width,
                                 step: 1, value: side === "left" ? frame.x0 : frame.x1,
                                 "aria-label": `Frame ${frame.number} ${side} edge`,
                                 role: "slider" });
    let saved = Number(slider.value);
    slider.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 8 : 1;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -step : step;
        slider.value = Number(slider.value) + delta;
      } else if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
    });
    slider.addEventListener("change", save);
    async function save() {
      const value = Number(slider.value);
      const payload = side === "left" ? { x0: value } : { x1: value };
      announce(`Saving frame ${frame.number}…`);
      try {
        await Api.patch(`/api/frames/${frame.id}`, payload);
        announce(`Frame ${frame.number} saved.`);
        saved = value;
        UI.render();
      } catch (error) {
        slider.value = saved;
        announce(error.fields ? Object.values(error.fields)[0]
                 : (error.message || "Storage is unreachable."));
      }
    }
    return slider;
  }

  function calibrationControls(roll, scan) {
    const clear = el("input", { type: "radio", name: "method", id: "clear_light",
                                value: "clear_light", checked: true });
    const wedge = el("input", { type: "radio", name: "method", id: "step_wedge",
                                value: "step_wedge" });
    const x = el("input", { type: "number", id: "area_x", min: 0, step: 1, value: 0 });
    const y = el("input", { type: "number", id: "area_y", min: 0, step: 1, value: 0 });
    const w = el("input", { type: "number", id: "area_w", min: 8, step: 1, value: 64 });
    const h = el("input", { type: "number", id: "area_h", min: 8, step: 1, value: 64 });
    const calibrate = el("button", { class: "btn", text: "Calibrate", onclick: async () => {
      announce("Calibrating…");
      try {
        await Api.post(`/api/scans/${scan.id}/calibration`, {
          method: clear.checked ? "clear_light" : "step_wedge",
          area: { x: Number(x.value), y: Number(y.value),
                  w: Number(w.value), h: Number(h.value) },
        });
        announce(clear.checked ? "Calibrated from clear light."
                               : "Calibrated from the step wedge.");
        UI.render();
      } catch (error) {
        announce(error.fields ? Object.values(error.fields)[0]
               : (error.message || "Storage is unreachable."));
      }
    } });
    const find = el("button", { class: "btn", text: "Find frames", onclick: async () => {
      announce("Finding frames…");
      try {
        const body = await Api.post(`/api/scans/${scan.id}/frames/detect`);
        const flagged = body.frames.filter((f) => f.flag === "flagged").length;
        announce(`Found ${body.frames.length} frames, ${flagged} flagged.`);
        UI.render();
      } catch (error) {
        announce(error.fields ? Object.values(error.fields)[0]
               : (error.message || "Calibrate this scan first."));
      }
    } });
    return el("div", { class: "row", style: "display:flex;flex-wrap:wrap;gap:0.6rem 1.1rem;align-items:center;margin-top:0.8rem" }, [
      el("label", { style: "display:inline" }, [clear, el("span", { text: " Clear light" })]),
      el("label", { style: "display:inline" }, [wedge, el("span", { text: " Step wedge" })]),
      el("label", { style: "display:inline" }, [el("span", { text: "Area x" }), x]),
      el("label", { style: "display:inline" }, [el("span", { text: "Area y" }), y]),
      el("label", { style: "display:inline" }, [el("span", { text: "Area width" }), w]),
      el("label", { style: "display:inline" }, [el("span", { text: "Area height" }), h]),
      calibrate, find,
    ]);
  }

  function attachLoupe(canvas, scan, frames) {
    const open = () => { if (!loupeState.open) { loupeState.open = true; showLoupe(); } };

    const cellFor = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left) / rect.width * scan.width);
      const y = Math.floor((event.clientY - rect.top) / rect.height * scan.height);
      return { x, y };
    };

    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;  /* swipes scroll the page */
      if (!loupeState.open) return;
      open();
      const cell = cellFor(event);
      moveLoupe(scan, cell.x, cell.y);
    });
    canvas.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      open();
      const cell = cellFor(event);
      moveLoupe(scan, cell.x, cell.y);
    });
    canvas.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      closeLoupe();
    });

    /* Touch: a first tap opens the loupe, a tap elsewhere moves it, a second
       tap on the resting cell pins it. A swipe scrolls the page untouched. */
    let touchStart = null;
    canvas.addEventListener("touchstart", (event) => {
      const touch = event.changedTouches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }, { passive: true });
    canvas.addEventListener("touchend", (event) => {
      if (!touchStart) return;
      const touch = event.changedTouches[0];
      const moved = Math.hypot(touch.clientX - touchStart.x,
                               touch.clientY - touchStart.y);
      const elapsed = Date.now() - touchStart.time;
      touchStart = null;
      if (moved > 12 || elapsed > 500) return;
      const cell = cellFor({ clientX: touch.clientX, clientY: touch.clientY });
      if (!loupeState.open) {
        loupeState.open = true;
        showLoupe();
        moveLoupe(scan, cell.x, cell.y);
        return;
      }
      const resting = loupeState.cell
        && Math.floor(cell.x / 8) * 8 === loupeState.cell.x
        && Math.floor(cell.y / 8) * 8 === loupeState.cell.y;
      if (resting) {
        pin(scan);
      } else {
        moveLoupe(scan, cell.x, cell.y);
      }
    });

    canvas.addEventListener("click", (event) => {
      if (event.detail === 0 || !loupeState.open) return;  /* keyboard Enter */
      pin(scan);
    });
    canvas.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 8 : 1;
      if (!loupeState.cell) {
        const first = frames[0];
        const cx = first ? Math.floor((first.x0 + first.x1) / 2 / 8) * 8
                        : Math.floor(scan.width / 2 / 8) * 8;
        loupeState.cell = { x: cx, y: Math.floor(scan.height / 2 / 8) * 8 };
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = (event.key === "ArrowLeft" ? -step : step) * 8;
        loupeState.cell.x = Math.max(0, Math.min(scan.width - 1,
                                                 loupeState.cell.x + delta));
        open(); positionLoupe(scan);
        fetchReading(scan);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const delta = (event.key === "ArrowUp" ? -step : step) * 8;
        loupeState.cell.y = Math.max(0, Math.min(scan.height - 1,
                                                 loupeState.cell.y + delta));
        open(); positionLoupe(scan);
        fetchReading(scan);
      } else if (event.key === "Enter") {
        event.preventDefault();
        pin(scan);
      } else if (event.key === "Escape") {
        closeLoupe();
      }
    });
    canvas.addEventListener("blur", () => closeLoupe());
  }

  const reduceMotion = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showLoupe() {
    const loupe = $("#loupe");
    if (!loupe) return;
    if (!reduceMotion) {
      loupe.style.transition = "none";
      loupe.style.transformOrigin = "50% 50%";
      loupe.style.transform = "scale(0.1)";
    }
    loupe.classList.remove("hidden");
    if (!reduceMotion) {
      /* The square shutter: opens quickly and settles softly. */
      loupe.style.transition = "transform 0.17s cubic-bezier(0.2, 0.8, 0.3, 1)";
      requestAnimationFrame(() => { loupe.style.transform = "scale(1)"; });
    }
  }

  function closeLoupe() {
    const loupe = $("#loupe");
    if (!loupe) return;
    if (reduceMotion) {
      loupe.classList.add("hidden");
    } else {
      loupe.style.transition = "transform 0.1s ease-in";
      loupe.style.transform = "scale(0.1)";
      window.setTimeout(() => loupe.classList.add("hidden"), 100);
    }
    loupeState.open = false;
  }

  function drawLoupe(scan) {
    /* Four times magnification, each scan pixel a hard-edged 4x4 block. */
    const loupe = $("#loupe");
    const canvas = loupe && loupe.querySelector("canvas");
    const strip = $(".strip-canvas");
    if (!loupe || !canvas || !strip || !loupeState.cell) return;
    const view = 30;  // scan pixels across the 120px loupe at 4x
    const sourceX = Math.max(0, loupeState.cell.x - view / 2);
    const sourceY = Math.max(0, loupeState.cell.y - view / 2);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const scaleX = strip.width / scan.width;
    const scaleY = strip.height / scan.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(strip,
                  sourceX * scaleX, sourceY * scaleY, view * scaleX, view * scaleY,
                  0, 0, canvas.width, canvas.height);
    // The 8x8 sample cell, outlined in gold one pixel thick at the centre.
    ctx.strokeStyle = "rgba(244, 217, 108, 1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(canvas.width / 2 - 16, canvas.height / 2 - 16, 32, 32);
  }

  function moveLoupe(scan, x, y) {
    loupeState.cell = { x: Math.floor(x / 8) * 8, y: Math.floor(y / 8) * 8 };
    positionLoupe(scan);
    fetchReading(scan);
  }

  function positionLoupe(scan) {
    const canvas = $(".strip-canvas");
    const loupe = $("#loupe");
    if (!canvas || !loupe || !loupeState.cell) return;
    const rect = canvas.getBoundingClientRect();
    const cellX = loupeState.cell.x / scan.width * rect.width;
    const cellY = loupeState.cell.y / scan.height * rect.height;
    loupe.style.left = (rect.left + cellX - 60) + "px";
    loupe.style.top = (rect.top + cellY - 60) + "px";
    drawLoupe(scan);
    updateCellLine(scan);
  }

  function updateCellLine(scan) {
    if (!loupeState.cell) return;
    const line = `x ${loupeState.cell.x} · y ${loupeState.cell.y}`;
    const status = $("#loupe-reading");
    if (status) status.textContent = line;
    const panel = $("#loupe-panel");
    if (panel && !loupeState.reading) panel.textContent = line;
  }

  function readingText(body, cell) {
    return `Net ${body.net === null || body.net === undefined ? DASH : fmtPlain(body.net, 2)} · ` +
      `Gross ${fmtPlain(body.gross, 2)} · ` +
      `log H ${body.log_h === null || body.log_h === undefined ? DASH : fmtSigned(body.log_h, 2)} · ` +
      `x ${cell.x} · y ${cell.y}`;
  }

  async function fetchReading(scan) {
    const token = ++loupeState.token;
    const cell = Object.assign({}, loupeState.cell);
    const status = $("#loupe-reading");
    if (status) status.setAttribute("aria-busy", "true");
    try {
      const body = await Api.get(`/api/scans/${scan.id}/reading?x=${cell.x}&y=${cell.y}`);
      if (token !== loupeState.token) return;
      loupeState.reading = body;
      if (status) {
        status.setAttribute("aria-busy", "false");
        status.textContent = readingText(body, cell);
      }
      const panel = $("#loupe-panel");
      if (panel) panel.textContent = readingText(body, cell);
      updateCurveDot(body);
    } catch (error) {
      if (token !== loupeState.token) return;
      loupeState.reading = null;
      if (status) {
        status.setAttribute("aria-busy", "false");
        status.textContent = `Net ${DASH} · Gross ${DASH} · log H ${DASH} · ` +
          `x ${cell.x} · y ${cell.y}`;
      }
      const panel = $("#loupe-panel");
      if (panel) panel.textContent = `Net ${DASH} · Gross ${DASH} · log H ${DASH} · ` +
        `x ${cell.x} · y ${cell.y}`;
      updateCurveDot(null);
    }
  }

  function updateCurveDot(body) {
    const dot = $("#curve-dot");
    const zone = $("#curve-zone");
    if (!dot) return;
    const targetX = body && body.log_h !== null && body.log_h !== undefined
      ? ((body.log_h + 3) * 40) : parseFloat(dot.getAttribute("cx") || 0);
    const targetY = body && body.net !== null && body.net !== undefined
      ? (200 - body.net * 120) : parseFloat(dot.getAttribute("cy") || 200);
    if (!body || reduceMotion) {
      dot.setAttribute("cx", targetX);
      dot.setAttribute("cy", targetY);
    } else {
      /* The dot glides to its new place over about a quarter second. */
      dot.style.transition = reduceMotion ? "none"
        : "cx 0.25s cubic-bezier(0.2, 0.8, 0.3, 1), cy 0.25s cubic-bezier(0.2, 0.8, 0.3, 1)";
      dot.setAttribute("cx", targetX);
      dot.setAttribute("cy", targetY);
    }
    if (zone) {
      const label = (!body || body.zone === null || body.zone === undefined)
        ? DASH : body.zone;
      zone.textContent = `Zone ${label}`;
    }
  }

  async function pin(scan) {
    if (!loupeState.cell) return;
    announce("Pinning…");
    try {
      const reading = await Api.post(`/api/scans/${scan.id}/readings`, {
        x: loupeState.cell.x, y: loupeState.cell.y });
      announce(`Pinned net ${fmtPlain(reading.net, 2)} on frame ${reading.frame ? reading.frame.number || "" : ""}.`);
      UI.render();
    } catch (error) {
      announce(error.fields ? Object.values(error.fields)[0]
             : (error.message || "Storage is unreachable."));
    }
  }

  async function curveRegion(roll) {
    const body = await Api.get(`/api/rolls/${roll.id}/curve`);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 400 220");
    svg.setAttribute("width", "100%");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    const points = body.points.map((p) =>
      `${((p.log_h || 0) + 3) * 40},${200 - (p.net || 0) * 120}`).join(" ");
    path.setAttribute("points", points);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "rgb(244,217,108)");
    path.setAttribute("stroke-width", "2");
    svg.append(path);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("id", "curve-dot");
    dot.setAttribute("r", "4");
    dot.setAttribute("fill", "rgb(244,217,108)");
    dot.setAttribute("cx", "0"); dot.setAttribute("cy", "200");
    svg.append(dot);
    const zone = el("span", { id: "curve-zone", role: "status", text: `Zone ${DASH}` });
    const figures = el("div", { class: "tabular" }, [
      el("p", { text: body.base_fog === null ? `Base + fog ${DASH}` : `Base + fog ${fmtPlain(body.base_fog, 2)}` }),
      el("p", { text: body.speed_point_log_h === null ? `Speed point log H ${DASH}` : `Speed point log H ${fmtSigned(body.speed_point_log_h, 2)}` }),
      el("p", { text: body.contrast_index === null ? `Contrast index ${DASH}` : `Contrast index ${fmtPlain(body.contrast_index, 2)}` }),
      el("p", { text: `Frames used ${body.frames_used}` }),
      el("p", { text: `Span ${fmtPlain(body.stops_span, 1)} stops` }),
    ]);
    if (roll.kind === "normal") {
      figures.append(el("p", { text: body.meter_bias_stops === null
        ? `Meter bias ${DASH} stops` : `Meter bias ${fmtBias(body.meter_bias_stops)} stops` }));
      if (!body.ready) figures.prepend(el("p", { text: "No curve yet. Link a curve-ready test roll." }));
    } else if (!body.ready) {
      figures.prepend(el("p", {
        text: `Needs at least 7 aligned bracket frames spanning 6 stops (now ${body.frames_used} frames, ${fmtPlain(body.stops_span, 1)} stops).` }));
    }
    return el("section", { class: "panel", role: "region",
                          "aria-label": "Characteristic curve" }, [
      el("h2", { text: "Characteristic curve" }),
      el("figure", { class: "curve" }, [svg, zone]),
      figures,
      el("div", { id: "loupe", class: "loupe hidden", role: "img",
                  "aria-label": "Loupe" }, [
        el("canvas", { width: "120", height: "120", class: "loupe-canvas" }),
        el("div", { class: "readout", id: "loupe-reading", role: "status",
                    "aria-label": "Loupe reading", text: "" }),
      ]),
    ]);
  }

  async function notesRegion(roll, scan, frames) {
    const region = el("section", { class: "panel", role: "region",
                                  "aria-label": "Shooting notes" });
    region.append(el("h2", { text: "Shooting notes" }));
    const entries = (await Api.get(`/api/rolls/${roll.id}/entries`)).entries;
    const entryByFrame = {};
    for (const entry of entries) if (entry.frame_id) entryByFrame[entry.frame_id] = entry;
    for (const frame of frames) {
      const frameRegion = el("section", { "aria-label": `Frame ${frame.number}`,
        "data-frame-region": frame.number, role: "region" });
      const title = el("input", { value: frame.title || "",
                                  "aria-label": "Frame title" });
      const save = el("button", { class: "linkish", text: "Save title",
        onclick: async () => {
          announce("Saving title…");
          try {
            await Api.patch(`/api/frames/${frame.id}`, { title: title.value });
            announce("Title saved.");
          } catch (error) { announce(error.message || "Storage is unreachable."); }
        } });
      const entry = entryByFrame[frame.id];
      const readingsList = el("ul", { class: "readings",
        "aria-label": `Readings for frame ${frame.number}` });
      const detail = await Api.get(`/api/frames/${frame.id}`);
      for (const reading of detail.readings) {
        readingsList.append(el("li", { text:
          `Net ${fmtPlain(reading.net, 2)} · Gross ${fmtPlain(reading.gross, 2)} · ` +
          `log H ${reading.log_h === null ? DASH : fmtSigned(reading.log_h, 2)} · ` +
          `Zone ${reading.zone === null ? DASH : reading.zone}` }));
      }
      if (!detail.readings.length) readingsList.append(el("li", { text: "No pinned readings." }));
      frameRegion.append(
        el("h3", { text: `Frame ${frame.number} · Edge ${frame.edge_number}` }),
        title, save,
        entry ? el("p", { class: "tabular", text:
          `Note ${entry.counter} · f/${entry.aperture} · ${entry.shutter} · ` +
          `EV ${entry.metered_ev} · ${fmtSigned(entry.relative_stops, 2)} stops · ${entry.note}` })
              : el("p", { text: "No note" }),
        readingsList);
      region.append(frameRegion);
    }
    if (!frames.length) region.append(el("p", { text: "No strips yet." }));
    return region;
  }

  window.Edgeprint.workspace = { workspaceScreen };
})();
