(() => {
  // src/shared/num.ts
  var STORED_DECIMALS = 6;
  var STORED_FACTOR = 10 ** STORED_DECIMALS;
  function round6(value) {
    if (!Number.isFinite(value)) return value;
    const scaled = value * STORED_FACTOR;
    const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
    return rounded / STORED_FACTOR;
  }
  function trimZeros(text) {
    if (!text.includes(".")) return text;
    const trimmed = text.replace(/0+$/, "").replace(/\.$/, "");
    return trimmed === "" || trimmed === "-" ? "0" : trimmed;
  }
  function numberKey(value) {
    return trimZeros(value.toFixed(STORED_DECIMALS));
  }
  function roundTo(value, decimals) {
    const factor = 10 ** decimals;
    const scaled = value * factor;
    const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
    return rounded / factor;
  }
  var TOLERANCE = 1e-3;
  function nearly(a, b) {
    return Math.abs(a - b) <= TOLERANCE;
  }

  // src/shared/geometry.ts
  var LAYER_COLOURS = ["white", "red", "yellow", "green", "cyan", "blue", "magenta", "grey"];
  var COLOUR_HEX = {
    white: "#ece7db",
    red: "#d98a80",
    yellow: "#d9c37f",
    green: "#8fae77",
    cyan: "#84b6bd",
    blue: "#8298b8",
    magenta: "#b28ab5",
    grey: "#7d8579"
  };
  var BIG = Number.MAX_SAFE_INTEGER;
  function entityBounds(entity) {
    switch (entity.type) {
      case "line":
        return { minX: Math.min(entity.x1, entity.x2), minY: Math.min(entity.y1, entity.y2), maxX: Math.max(entity.x1, entity.x2), maxY: Math.max(entity.y1, entity.y2) };
      case "circle":
        return { minX: entity.cx - entity.r, minY: entity.cy - entity.r, maxX: entity.cx + entity.r, maxY: entity.cy + entity.r };
      case "arc":
        return arcBounds(entity.cx, entity.cy, entity.r, entity.start, entity.end);
      case "pline": {
        let minX = BIG, minY = BIG, maxX = -BIG, maxY = -BIG;
        for (const p of entity.points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        return { minX, minY, maxX, maxY };
      }
      case "insert":
        return { minX: entity.x, minY: entity.y, maxX: entity.x, maxY: entity.y };
      case "hatch":
        return { minX: entity.seed_x, minY: entity.seed_y, maxX: entity.seed_x, maxY: entity.seed_y };
      case "dimension":
        return { minX: entity.text_x, minY: entity.text_y, maxX: entity.text_x, maxY: entity.text_y };
    }
  }
  function arcBounds(cx, cy, r, start2, end) {
    let minX = BIG, minY = BIG, maxX = -BIG, maxY = -BIG;
    const step = Math.max(0.5, 360 / Math.max(8, Math.ceil((end - start2) / 4)));
    for (let a = start2; a <= end + 1e-9; a += step) {
      const x = cx + r * Math.cos(a * Math.PI / 180);
      const y = cy + r * Math.sin(a * Math.PI / 180);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
  }
  function lineLength(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }
  function polylineLength(entity) {
    let total = 0;
    const pts = entity.points;
    const last = entity.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      total += lineLength(a.x, a.y, b.x, b.y);
    }
    return total;
  }
  function arcLength(entity) {
    return entity.r * (entity.end - entity.start) * Math.PI / 180;
  }
  function circleArea(r) {
    return Math.PI * r * r;
  }
  function polygonArea(points) {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }
  function lineAngle(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  }

  // src/shared/derived.ts
  function resolveDimensionRefs(model, refs) {
    return refs.map((ref) => {
      const entity = model.entities[ref.handle];
      if (!entity) return { handle: ref.handle, point: null };
      let pt = null;
      if (entity.type === "line") {
        pt = ref.point === "end" ? { x: entity.x2, y: entity.y2 } : { x: entity.x1, y: entity.y1 };
      } else if (entity.type === "circle" || entity.type === "arc") {
        if (ref.point === "centre") pt = { x: entity.cx, y: entity.cy };
      } else if (entity.type === "pline" && entity.points.length) {
        pt = ref.point === "end" ? entity.points[entity.points.length - 1] : entity.points[0];
      }
      return { handle: ref.handle, point: pt };
    });
  }
  function dimensionValue(model, kind, refs) {
    const resolved = resolveDimensionRefs(model, refs);
    const pts = resolved.map((r) => r.point).filter((p) => p !== null);
    if (kind === "radial") {
      const ref = refs[0];
      const entity = model.entities[ref?.handle ?? ""];
      if (entity && (entity.type === "circle" || entity.type === "arc")) return entity.r;
      return null;
    }
    if (kind === "angular") {
      const a = model.entities[refs[0]?.handle ?? ""];
      const b = model.entities[refs[1]?.handle ?? ""];
      if (!a || !b || a.type !== "line" || b.type !== "line") return null;
      let diff = Math.abs(lineAngle(a.x1, a.y1, a.x2, a.y2) - lineAngle(b.x1, b.y1, b.x2, b.y2)) % 360;
      if (diff > 180) diff = 360 - diff;
      return roundTo(diff, 6);
    }
    if (pts.length < 2) return null;
    if (kind === "aligned") {
      return roundTo(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y), 6);
    }
    const dx = Math.abs(pts[1].x - pts[0].x);
    const dy = Math.abs(pts[1].y - pts[0].y);
    return roundTo(dx >= dy ? dx : dy, 6);
  }
  function dimensionScaledValue(model, entity) {
    const style = model.dim_styles[entity.style] ?? model.dim_styles.Standard;
    const raw = dimensionValue(model, entity.kind, entity.refs);
    if (raw === null || !style) return { value: "", raw: null, style };
    const scaled = raw * style.scale;
    return { value: scaled.toFixed(style.precision), raw, style };
  }
  function dimensionText(model, entity) {
    const { value, style } = dimensionScaledValue(model, entity);
    const base = `${style?.prefix ?? ""}${value}${style?.suffix ?? ""}`;
    if (entity.override === null || entity.override === void 0) return base;
    return entity.override.replace("<>", base);
  }

  // src/client/ui.ts
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === void 0 || value === false) continue;
      if (key === "class") node.className = String(value);
      else if (key === "text") node.textContent = String(value);
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, String(value));
    }
    for (const child of children) {
      if (child === null || child === void 0) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }
  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === void 0 || value === false) continue;
      node.setAttribute(key, value === true ? "" : String(value));
    }
    return node;
  }
  function displayText(value) {
    if (Object.is(value, -0)) return "0";
    const fixed = value.toFixed(3);
    const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
    const normalised = trimmed === "" || trimmed === "-" ? "0" : trimmed;
    return normalised === "-0" ? "0" : normalised;
  }
  function pointText(p) {
    return `${displayText(p.x)},${displayText(p.y)}`;
  }
  function entityLabel(entity, model) {
    const layer = entity.layer;
    switch (entity.type) {
      case "line":
        return `Line ${entity.handle}, layer ${layer}, from ${pointText({ x: entity.x1, y: entity.y1 })} to ${pointText({ x: entity.x2, y: entity.y2 })}, length ${displayText(Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1))}`;
      case "circle":
        return `Circle ${entity.handle}, layer ${layer}, centre ${pointText({ x: entity.cx, y: entity.cy })}, radius ${displayText(entity.r)}, area ${displayText(Math.PI * entity.r * entity.r)}`;
      case "arc":
        return `Arc ${entity.handle}, layer ${layer}, centre ${pointText({ x: entity.cx, y: entity.cy })}, radius ${displayText(entity.r)}, from ${displayText(entity.start)} to ${displayText(entity.end)} degrees, length ${displayText(entity.r * (entity.end - entity.start) * Math.PI / 180)}`;
      case "pline": {
        const points = entity.points;
        const count = points.length;
        let length = 0;
        const last = entity.closed ? points.length : points.length - 1;
        for (let i = 0; i < last; i++) {
          const a = points[i];
          const b = points[(i + 1) % points.length];
          length += Math.hypot(b.x - a.x, b.y - a.y);
        }
        return entity.closed ? `Polyline ${entity.handle}, layer ${layer}, ${count} points, closed, length ${displayText(length)}, area ${displayText(polygonArea2(points))}` : `Polyline ${entity.handle}, layer ${layer}, ${count} points, open, length ${displayText(length)}`;
      }
      case "hatch":
        return `Hatch ${entity.handle}, layer ${layer}, area ${displayText(entity.area)}`;
      case "dimension":
        return `Dimension ${entity.handle}, layer ${layer}, ${entity.kind}, value ${entity.value === null ? dimensionText(model, entity) : String(entity.value)}`;
      case "insert":
        return `Block ${entity.handle}, layer ${layer}, ${entity.block} at ${pointText({ x: entity.x, y: entity.y })}, scale ${displayText(entity.scale)}, rotation ${displayText(entity.rotation)}`;
    }
  }
  function polygonArea2(points) {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }
  function toScreen(view, world) {
    return { x: world.x * view.zoom + view.panX, y: -world.y * view.zoom + view.panY };
  }
  function toWorld(view, screen) {
    return { x: (screen.x - view.panX) / view.zoom, y: -(screen.y - view.panY) / view.zoom };
  }
  var LAYER_COLOUR_HEX = Object.fromEntries(LAYER_COLOURS.map((name) => [name, COLOUR_HEX[name] ?? COLOUR_HEX.white]));

  // src/client/strip.ts
  var STRIP_TITLES = [
    "Garden plan, Larch Row",
    "Shelf elevation, Unit 4",
    "Stage layout, Hall B",
    "Title block only",
    "Shed footing, Plot 9",
    "Bench section, Workshop",
    "Seating plan, Quay Room",
    "Raised beds, North Yard",
    "Counter detail, Kiosk 2",
    "Lighting grid, Hall B",
    "Fence run, Larch Row"
  ];
  var CENTRED_FRAME = "Stage layout, Hall B";
  var INK = "#ece7db";
  var MUTED = "#8a9187";
  function frameSvg(title, index) {
    const spec = frameSpec(index);
    const svg = svgEl("svg", {
      viewBox: `0 0 ${spec.width} ${spec.height}`,
      width: spec.width,
      height: spec.height,
      "aria-hidden": "true"
    });
    const frame = svgEl("rect", { x: 0.5, y: 0.5, width: spec.width - 1, height: spec.height - 1, fill: "#1d2023", stroke: MUTED, "stroke-width": 1 });
    svg.append(frame);
    spec.draw(svg);
    const wrap = el("div", { class: "sheet-frame", "data-frame-title": title });
    wrap.append(svg, el("span", { class: "frame-title", text: title }));
    return wrap;
  }
  function frameSpec(index) {
    const specs = [
      // Garden plan: beds and a path
      { width: 120, height: 84, draw: (g) => {
        g.append(rect(14, 16, 28, 22), rect(14, 48, 28, 22), rect(70, 16, 36, 54), line(60, 8, 60, 76), circle(90, 43, 8));
      } },
      // Shelf elevation: uprights and shelves
      { width: 130, height: 70, draw: (g) => {
        g.append(line(16, 8, 16, 62), line(112, 8, 112, 62), line(16, 20, 112, 20), line(16, 34, 112, 34), line(16, 48, 112, 48), rect(30, 10, 10, 10), rect(52, 10, 10, 10));
      } },
      // Stage layout: stage box and arcs
      { width: 150, height: 96, draw: (g) => {
        g.append(rect(30, 30, 90, 30), line(30, 30, 30, 24), line(120, 30, 120, 24), arc(75, 30, 34, 200, 340), circle(46, 12, 5), circle(104, 12, 5));
      } },
      // Title block only
      { width: 100, height: 70, draw: (g) => {
        g.append(rect(10, 46, 80, 18), line(10, 55, 90, 55), line(34, 46, 34, 64), line(62, 46, 62, 64));
      } },
      // Shed footing: rectangle with hatch marks
      { width: 90, height: 66, draw: (g) => {
        g.append(rect(24, 20, 42, 26), line(24, 20, 66, 46), line(24, 28, 58, 46), line(32, 20, 66, 38), rect(30, 26, 30, 14));
      } },
      // Bench section: legs and top
      { width: 110, height: 60, draw: (g) => {
        g.append(rect(20, 18, 70, 8), line(24, 26, 24, 50), line(86, 26, 86, 50), line(24, 38, 86, 38), line(24, 26, 86, 50));
      } },
      // Seating plan: table circles
      { width: 110, height: 88, draw: (g) => {
        g.append(circle(55, 44, 16), circle(30, 24, 6), circle(80, 24, 6), circle(30, 64, 6), circle(80, 64, 6), rect(48, 40, 14, 8));
      } },
      // Raised beds: L shapes
      { width: 96, height: 72, draw: (g) => {
        g.append(polyline("18,14 44,14 44,32 18,32"), polyline("52,14 78,14 78,40 52,40"), polyline("18,40 34,40 34,58 18,58"), polyline("60,48 78,48 78,58 60,58"));
      } },
      // Counter detail: counter line with stools
      { width: 104, height: 60, draw: (g) => {
        g.append(polyline("16,34 88,34"), line(16, 34, 16, 44), line(88, 34, 88, 44), circle(30, 16, 6), circle(52, 16, 6), circle(74, 16, 6));
      } },
      // Lighting grid: dots on a grid
      { width: 130, height: 70, draw: (g) => {
        for (let x = 20; x <= 110; x += 22) {
          g.append(line(x, 12, x, 58));
        }
        for (let y = 16; y <= 56; y += 16) {
          g.append(line(20, y, 110, y));
        }
        g.append(circle(42, 28, 3), circle(86, 28, 3), circle(42, 44, 3), circle(86, 44, 3));
      } },
      // Fence run: posts and rails
      { width: 140, height: 60, draw: (g) => {
        for (let x = 18; x <= 122; x += 26) {
          g.append(line(x, 14, x, 46));
        }
        g.append(line(18, 22, 122, 22), line(18, 38, 122, 38));
      } }
    ];
    return specs[index % specs.length];
  }
  function rect(x, y, w, h) {
    return svgEl("rect", { x, y, width: w, height: h, fill: "none", stroke: INK, "stroke-width": 0.8 });
  }
  function line(x1, y1, x2, y2) {
    return svgEl("line", { x1, y1, x2, y2, stroke: INK, "stroke-width": 0.8 });
  }
  function circle(cx, cy, r) {
    return svgEl("circle", { cx, cy, r, fill: "none", stroke: INK, "stroke-width": 0.8 });
  }
  function arc(cx, cy, r, start2, end) {
    const rad = (d) => d * Math.PI / 180;
    const x1 = cx + r * Math.cos(rad(start2));
    const y1 = cy - r * Math.sin(rad(start2));
    const x2 = cx + r * Math.cos(rad(end));
    const y2 = cy - r * Math.sin(rad(end));
    return svgEl("path", { d: `M ${x1} ${y1} A ${r} ${r} 0 ${end - start2 > 180 ? 1 : 0} 0 ${x2} ${y2}`, fill: "none", stroke: INK, "stroke-width": 0.8 });
  }
  function polyline(points) {
    return svgEl("polyline", { points, fill: "none", stroke: INK, "stroke-width": 0.8 });
  }
  function sheetStrip() {
    const strip = el("div", { class: "sheet-strip", role: "region", "aria-label": "Sheet strip" });
    STRIP_TITLES.forEach((title, index) => {
      const frame = frameSvg(title, index);
      if (title === CENTRED_FRAME) frame.classList.add("lit");
      strip.append(frame);
    });
    requestAnimationFrame(() => {
      const lit = strip.querySelector(".lit");
      if (lit) {
        lit.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
      }
    });
    return strip;
  }

  // src/client/pages.ts
  function landingPage(context2) {
    const page = el("div", { class: "landing" });
    page.append(
      el("div", { class: "corner tl" }, el("span", { class: "product-name", text: "Plotfold" })),
      el("div", { class: "corner tr" }, el("a", { href: "/signin", text: "Sign in" })),
      el("div", { class: "corner bl" }, el("p", { text: "Draw to scale, publish, then review." })),
      el("div", { class: "corner br" }, el("a", { href: "/register", text: "Start drawing" })),
      sheetStrip()
    );
    return page;
  }
  function registerPage(context2) {
    return authFormPage(context2, "Create account", "/register", "/signin", "Sign in");
  }
  function signInPage(context2) {
    return authFormPage(context2, "Sign in", "/signin", "/register", "Start drawing");
  }
  function authFormPage(context2, action, submitPath, altPath, altLabel) {
    const error = el("p", { class: "form-error", role: "status", "aria-live": "polite" });
    const username = el("input", { type: "text", id: "username", autocomplete: "username" });
    const password = el("input", { type: "password", id: "password", autocomplete: "current-password" });
    const form = el(
      "form",
      { class: "surface auth-form" },
      el("h1", { text: action }),
      el("label", { for: "username", text: "Username" }, username),
      el("label", { for: "password", text: "Password" }, password),
      error,
      el("button", { type: "submit", class: "primary", text: action }),
      el("span", {}, el("a", { href: altPath, text: altLabel }))
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      const { status, data } = await context2.api(submitPath === "/register" ? "POST" : "POST", submitPath, {
        username: username.value.trim().toLowerCase(),
        password: password.value
      });
      if (status === 200 || status === 201) {
        context2.navigate("/folders");
        return;
      }
      const fields = data.fields;
      if (fields && Object.keys(fields).length) {
        error.textContent = Object.values(fields)[0];
        return;
      }
      error.textContent = data.message ?? "Try again.";
    });
    return el("div", { class: "landing" }, form);
  }
  async function foldersPage(context2) {
    const [foldersResult, drawingLists] = await Promise.all([
      context2.api("GET", "/api/folders"),
      Promise.resolve([])
    ]);
    const perFolder = [];
    for (const folder of foldersResult.data.folders) {
      const drawings = await context2.api("GET", `/api/folders/${folder.id}/drawings`);
      perFolder.push({ folder, drawings: drawings.data.drawings });
    }
    const page = el("div", { class: "folders-page" });
    page.append(el("h1", { class: "page-name", text: "Folders" }));
    const newFolderButton = el("button", { text: "New folder" });
    newFolderButton.addEventListener("click", async () => {
      const name = window.prompt("Folder name");
      if (!name) return;
      await context2.api("POST", "/api/folders", { name, parent_id: null });
      context2.navigate("/folders");
    });
    page.append(newFolderButton);
    if (!perFolder.length) {
      page.append(el("div", { class: "surface note" }, el("p", { text: "No drawings yet." })));
      return page;
    }
    for (const { folder, drawings } of perFolder) {
      const block = el("div", { class: "folder-block surface" });
      block.append(el("div", { class: "folder-name", text: folder.name }));
      if (!drawings.length) {
        const empty = el(
          "div",
          { class: "drawing-row" },
          el("span", { class: "drawing-name" }),
          el(
            "div",
            { class: "versions-run empty-frame" },
            el("div", { class: "version-frame" }, el("div", { class: "sentence", text: "No drawings yet." }))
          )
        );
        block.append(empty);
      }
      for (const drawing of drawings) {
        const run = el("div", { class: "versions-run" });
        const sheets = drawing.sheets.length ? drawing.sheets : [];
        if (!sheets.length) {
          run.append(emptyFrame());
        }
        for (const sheet of sheets) {
          if (!sheet.versions.length) {
            run.append(emptyFrame());
            continue;
          }
          for (const version of sheet.versions) {
            const frame = el("div", { class: "version-frame" });
            frame.append(
              frameThumbnail(sheet.name, version.number),
              el("span", { class: "frame-state", text: `${sheet.name} v${version.number} ${version.state}` })
            );
            frame.addEventListener("click", () => context2.navigate(`/versions/${version.id}`));
            run.append(frame);
          }
        }
        block.append(el(
          "div",
          { class: "drawing-row" },
          el("a", { class: "drawing-name", href: `/drawings/${drawing.id}`, text: drawing.name }),
          run
        ));
      }
      const newDrawing = el("button", { text: "New drawing" });
      newDrawing.addEventListener("click", async () => {
        const name = window.prompt("Drawing name");
        if (!name) return;
        await context2.api("POST", `/api/folders/${folder.id}/drawings`, { name });
        context2.navigate("/folders");
      });
      block.append(el("div", { class: "folder-tools" }, newDrawing));
      page.append(block);
    }
    return page;
  }
  function emptyFrame() {
    const frame = el("div", { class: "version-frame" });
    const svg = svgEl("svg", { width: 48, height: 34, viewBox: "0 0 48 34", "aria-hidden": "true" });
    svg.append(svgEl("rect", { x: 0.5, y: 0.5, width: 47, height: 33, fill: "#1d2023", stroke: "#8a9187" }));
    frame.append(svg, el("span", { class: "frame-state", text: " " }));
    return frame;
  }
  function frameThumbnail(sheetName, versionNumber) {
    const svg = svgEl("svg", { width: 48, height: 34, viewBox: "0 0 48 34", "aria-hidden": "true" });
    svg.append(svgEl("rect", { x: 0.5, y: 0.5, width: 47, height: 33, fill: "#1d2023", stroke: "#8a9187" }));
    const seed = (sheetName.length + versionNumber) % 5;
    for (let i = 0; i < 3 + seed; i++) {
      const y = 6 + i * 5;
      const line2 = svgEl("line", { x1: 6, y1: y, x2: 40 - i * 3 % 20, y2: y, stroke: "#ece7db", "stroke-width": 0.5, opacity: 0.7 });
      svg.append(line2);
    }
    svg.append(svgEl("rect", { x: 30, y: 24, width: 15, height: 7, fill: "none", stroke: "#ece7db", "stroke-width": 0.5 }));
    return svg;
  }
  function notAvailablePage(message) {
    return el(
      "div",
      { class: "landing" },
      el(
        "main",
        { class: "surface note" },
        el("h1", { class: "title", text: "Not available" }),
        el("p", { text: message })
      )
    );
  }
  function notFoundPage() {
    return el(
      "div",
      { class: "landing" },
      el(
        "main",
        { class: "surface note" },
        el("p", { text: "We couldn\u2019t find that page." })
      )
    );
  }

  // src/client/store.ts
  function drawingFromApi(data) {
    return {
      id: String(data.id),
      name: String(data.name ?? ""),
      folderId: String(data.folder_id ?? ""),
      role: data.role ?? "view",
      revision: Number(data.revision ?? 0),
      nextHandle: Number(data.next_handle ?? 1),
      layers: data.layers ?? {},
      entities: data.entities ?? {},
      order: data.order ?? Object.keys(data.entities ?? {}),
      blocks: data.blocks ?? {},
      dimStyles: data.dim_styles ?? {},
      parameters: data.parameters ?? [],
      constraints: data.constraints ?? [],
      xrefs: data.xrefs ?? [],
      layerStates: data.layer_states ?? [],
      currentLayer: String(data.current_layer ?? "0"),
      underlays: data.underlays ?? [],
      sheets: data.sheets ?? []
    };
  }
  function visibleEntities(state) {
    return state.order.filter((handle) => {
      const entity = state.entities[handle];
      if (!entity) return false;
      const layer = state.layers[entity.layer];
      return Boolean(layer && layer.on && !layer.frozen);
    });
  }
  function entityAtPoint(state, world, aperture, view) {
    let best = null;
    let bestDistance = Infinity;
    for (const handle of state.order) {
      const entity = state.entities[handle];
      if (!entity) continue;
      const layer = state.layers[entity.layer];
      if (!layer || layer.locked || layer.frozen || !layer.on) continue;
      const distance = distanceToEntity(entity, world);
      const screenDistance = distance * view.zoom;
      if (screenDistance <= aperture && screenDistance < bestDistance) {
        bestDistance = screenDistance;
        best = handle;
      }
    }
    return best;
  }
  function distanceToEntity(entity, point) {
    switch (entity.type) {
      case "line":
        return distanceToSegment(point, { x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 });
      case "circle": {
        return Math.abs(Math.hypot(point.x - entity.cx, point.y - entity.cy) - entity.r);
      }
      case "arc": {
        const angle = normalise(Math.atan2(point.y - entity.cy, point.x - entity.cx));
        if (angle < entity.start || angle > entity.end) {
          const toStart = Math.hypot(point.x - (entity.cx + entity.r * Math.cos(entity.start * Math.PI / 180)), point.y - (entity.cy + entity.r * Math.sin(entity.start * Math.PI / 180)));
          const toEnd = Math.hypot(point.x - (entity.cx + entity.r * Math.cos(entity.end * Math.PI / 180)), point.y - (entity.cy + entity.r * Math.sin(entity.end * Math.PI / 180)));
          return Math.min(toStart, toEnd);
        }
        return Math.abs(Math.hypot(point.x - entity.cx, point.y - entity.cy) - entity.r);
      }
      case "pline": {
        let best = Infinity;
        const points = entity.points;
        const last = entity.closed ? points.length : points.length - 1;
        for (let i = 0; i < last; i++) {
          best = Math.min(best, distanceToSegment(point, points[i], points[(i + 1) % points.length]));
        }
        return best;
      }
      case "insert":
        return Math.hypot(point.x - entity.x, point.y - entity.y);
      case "hatch":
        return Math.hypot(point.x - entity.seed_x, point.y - entity.seed_y);
      case "dimension":
        return Math.hypot(point.x - entity.text_x, point.y - entity.text_y);
    }
  }
  function normalise(radians) {
    let degrees = radians * 180 / Math.PI;
    while (degrees < 0) degrees += 360;
    return degrees;
  }
  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }
  function entityHandlesForDom(state, view, paneWidth, paneHeight, marginPx, ceiling, selected) {
    const grown = {
      minX: -view.panX / view.zoom - marginPx / view.zoom,
      maxX: (paneWidth - view.panX) / view.zoom + marginPx / view.zoom,
      minY: -(view.panY + paneHeight) / view.zoom - marginPx / view.zoom,
      maxY: (-view.panY + marginPx) / view.zoom
    };
    const inside = [];
    const centreX = (grown.minX + grown.maxX) / 2;
    const centreY = (grown.minY + grown.maxY) / 2;
    for (const handle of state.order) {
      const entity = state.entities[handle];
      if (!entity) continue;
      const box = entityBounds(entity);
      const meets = box.minX <= grown.maxX && box.maxX >= grown.minX && box.minY <= grown.maxY && box.maxY >= grown.minY;
      if (!meets) continue;
      const boxCentreX = (box.minX + box.maxX) / 2;
      const boxCentreY = (box.minY + box.maxY) / 2;
      inside.push({ handle, distance: Math.hypot(boxCentreX - centreX, boxCentreY - centreY) });
    }
    inside.sort((a, b) => a.distance - b.distance);
    const result = [];
    const picked = /* @__PURE__ */ new Set();
    for (const entry of inside) {
      if (result.length >= ceiling) break;
      result.push(entry.handle);
      picked.add(entry.handle);
    }
    for (const handle of selected) {
      if (!picked.has(handle) && state.entities[handle]) {
        result.push(handle);
        picked.add(handle);
      }
    }
    return result;
  }
  function zoomAll(state, paneWidth, paneHeight) {
    const boundsList = visibleEntities(state).map((handle) => entityBounds(state.entities[handle]));
    if (!boundsList.length) {
      return { zoom: 1, panX: paneWidth / 2, panY: paneHeight / 2 };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const box of boundsList) {
      minX = Math.min(minX, box.minX);
      minY = Math.min(minY, box.minY);
      maxX = Math.max(maxX, box.maxX);
      maxY = Math.max(maxY, box.maxY);
    }
    const width = Math.max(maxX - minX, 1e-6);
    const height = Math.max(maxY - minY, 1e-6);
    const zoom = Math.min((paneWidth - 48) / width, (paneHeight - 48) / height);
    const clamped = Math.max(0.05, Math.min(50, zoom));
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    return {
      zoom: Number(clamped.toFixed(4)),
      panX: Number((paneWidth / 2 - centreX * clamped).toFixed(4)),
      panY: Number((paneHeight / 2 + centreY * clamped).toFixed(4))
    };
  }
  function applyOpToState(state, op) {
    const type = String(op.type);
    switch (type) {
      case "add": {
        const entity = op.entity;
        if (!entity) return;
        const handle = entity.handle ?? `new-${state.nextHandle}`;
        const stored = { ...entity, handle };
        state.entities[handle] = stored;
        if (!state.order.includes(handle)) state.order.push(handle);
        state.nextHandle = Math.max(state.nextHandle, handleNumber(handle) + 1);
        return;
      }
      case "modify": {
        const handle = String(op.handle ?? "");
        const set = op.set ?? {};
        const existing = state.entities[handle];
        if (!existing) return;
        state.entities[handle] = { ...existing, ...set };
        return;
      }
      case "move": {
        const handles = op.handles ?? [];
        const dx = Number(op.dx ?? 0);
        const dy = Number(op.dy ?? 0);
        for (const handle of handles) {
          const existing = state.entities[handle];
          if (!existing) continue;
          state.entities[handle] = moveResolved(existing, dx, dy);
        }
        return;
      }
      case "delete": {
        const handles = op.handles ?? [];
        for (const handle of handles) {
          delete state.entities[handle];
          state.order = state.order.filter((h) => h !== handle);
        }
        return;
      }
      default:
        return;
    }
  }
  function moveResolved(entity, dx, dy) {
    switch (entity.type) {
      case "line":
        return { ...entity, x1: round(entity.x1 + dx), y1: round(entity.y1 + dy), x2: round(entity.x2 + dx), y2: round(entity.y2 + dy) };
      case "circle":
        return { ...entity, cx: round(entity.cx + dx), cy: round(entity.cy + dy) };
      case "arc":
        return { ...entity, cx: round(entity.cx + dx), cy: round(entity.cy + dy) };
      case "pline":
        return { ...entity, points: entity.points.map((p) => ({ x: round(p.x + dx), y: round(p.y + dy) })) };
      case "insert":
        return { ...entity, x: round(entity.x + dx), y: round(entity.y + dy) };
      case "hatch":
        return { ...entity, seed_x: round(entity.seed_x + dx), seed_y: round(entity.seed_y + dy) };
      case "dimension":
        return { ...entity, text_x: round(entity.text_x + dx), text_y: round(entity.text_y + dy) };
    }
  }
  function round(value) {
    const factor = 10 ** 6;
    const scaled = value * factor;
    const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
    return rounded / factor;
  }
  function handleNumber(handle) {
    const match = handle.match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  // src/client/commands.ts
  var COMMANDS = [
    { name: "LINE", aliases: ["L"], stages: ["LINE: from point", "LINE: to point (Enter ends, U steps back)"] },
    { name: "PLINE", aliases: ["PL"], stages: ["PLINE: from point", "PLINE: to point (Enter ends, U steps back, CL closes)"] },
    { name: "RECT", aliases: ["REC"], stages: ["RECT: first corner", "RECT: opposite corner"] },
    { name: "CIRCLE", aliases: ["C"], stages: ["CIRCLE: centre", "CIRCLE: radius"] },
    { name: "ARC", aliases: ["A"], stages: ["ARC: centre", "ARC: start point", "ARC: end point"] },
    { name: "MOVE", aliases: ["M"], stages: ["MOVE: pick entities (Enter ends picking)", "MOVE: from point", "MOVE: to point"] },
    { name: "COPY", aliases: ["CO"], stages: ["COPY: pick entities (Enter ends picking)", "COPY: from point", "COPY: to point (Enter ends)"] },
    { name: "ROTATE", aliases: ["RO"], stages: ["ROTATE: pick entities (Enter ends picking)", "ROTATE: about point", "ROTATE: angle in degrees"] },
    { name: "SCALE", aliases: ["SC"], stages: ["SCALE: pick entities (Enter ends picking)", "SCALE: about point", "SCALE: factor"] },
    { name: "MIRROR", aliases: ["MI"], stages: ["MIRROR: pick entities (Enter ends picking)", "MIRROR: axis first point", "MIRROR: axis second point", "MIRROR: keep originals? Y or N (Enter is Y)"] },
    { name: "OFFSET", aliases: ["O"], stages: ["OFFSET: distance", "OFFSET: pick entity", "OFFSET: pick side"] },
    { name: "TRIM", aliases: ["TR"], stages: ["TRIM: pick cutting edges (Enter for every entity)", "TRIM: pick the part to remove (Enter ends)"] },
    { name: "EXTEND", aliases: ["EX"], stages: ["EXTEND: pick boundaries (Enter for every entity)", "EXTEND: pick the end to extend (Enter ends)"] },
    { name: "FILLET", aliases: ["F"], stages: ["FILLET: radius", "FILLET: first line", "FILLET: second line"] },
    { name: "CHAMFER", aliases: ["CHA"], stages: ["CHAMFER: first distance", "CHAMFER: second distance", "CHAMFER: first line", "CHAMFER: second line"] },
    { name: "ARRAY", aliases: ["AR"], stages: ["ARRAY: pick entities (Enter ends picking)", "ARRAY: R for rows or P for polar"] },
    { name: "HATCH", aliases: ["H"], stages: ["HATCH: pick a point inside"] },
    { name: "DIST", aliases: ["DI"], stages: ["DIST: first point", "DIST: second point"] },
    { name: "AREA", aliases: ["AA"], stages: ["AREA: pick a closed entity or a point inside"] },
    { name: "ERASE", aliases: ["E"], stages: ["ERASE: pick entities (Enter ends picking)"] },
    { name: "EXPLODE", aliases: ["X"], stages: ["EXPLODE: pick block inserts (Enter ends picking)"] },
    { name: "LAYER", aliases: ["LA"], stages: [] },
    { name: "BLOCK", aliases: ["B"], stages: ["BLOCK: name", "BLOCK: base point", "BLOCK: pick entities (Enter ends picking)", "BLOCK: attribute TAG=default (Enter for none)"] },
    { name: "INSERT", aliases: ["I"], stages: ["INSERT: block name", "INSERT: insertion point", "INSERT: scale (Enter is 1)", "INSERT: rotation in degrees (Enter is 0)"] },
    { name: "PURGE", aliases: ["PU"], stages: [] },
    { name: "DIMLINEAR", aliases: ["DL"], stages: ["DIMLINEAR: first point", "DIMLINEAR: second point", "DIMLINEAR: line position"] },
    { name: "DIMALIGNED", aliases: ["DA"], stages: ["DIMALIGNED: first point", "DIMALIGNED: second point", "DIMALIGNED: line position"] },
    { name: "DIMANGLE", aliases: ["DG"], stages: ["DIMANGLE: first line", "DIMANGLE: second line", "DIMANGLE: arc position"] },
    { name: "DIMRADIUS", aliases: ["DR"], stages: ["DIMRADIUS: pick circle or arc", "DIMRADIUS: text position"] },
    { name: "CONSTRAIN", aliases: ["CN"], stages: ["CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, length, radius)"] },
    { name: "PARAM", aliases: ["PM"], stages: ["PARAM: name = expression"] },
    { name: "XATTACH", aliases: ["XA"], stages: ["XATTACH: drawing name", "XATTACH: xref name", "XATTACH: insertion point", "XATTACH: scale (Enter is 1)", "XATTACH: rotation in degrees (Enter is 0)"] },
    { name: "XBIND", aliases: ["XB"], stages: ["XBIND: xref name"] },
    { name: "FIND", aliases: ["FD"], stages: [] },
    { name: "ZOOMALL", aliases: ["ZA"], stages: [] }
  ];
  var READY_PROMPT = "Ready. Type a command.";
  var CANCELLED_PROMPT = "Cancelled.";
  var REFUSALS = {
    notPoint: "That isn\u2019t a point. Try 10,20 or @5,0 or @10<45.",
    notNumber: "That isn\u2019t a number.",
    notPositive: "Enter a number greater than 0.",
    unknownBlock: (name) => `No block named ${name}.`,
    unknownDrawing: (name) => `No drawing named ${name} in this folder.`,
    unknownXref: (name) => `No xref named ${name}.`,
    nothingToPick: "Nothing there to pick."
  };
  var NAME_STAGES = /* @__PURE__ */ new Set([
    "BLOCK: name",
    "INSERT: block name",
    "XATTACH: drawing name",
    "XATTACH: xref name",
    "XBIND: xref name",
    "BLOCK: attribute TAG=default (Enter for none)",
    "PARAM: name = expression",
    "CONSTRAIN: expression",
    "CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, length, radius)"
  ]);
  function stageTakesSpace(stage) {
    return NAME_STAGES.has(stage);
  }
  function resolveCommand(text) {
    const upper = text.trim().toUpperCase();
    if (!upper) return null;
    for (const command of COMMANDS) {
      if (command.name === upper || command.aliases.includes(upper)) return command;
    }
    return null;
  }
  function unknownCommandText(text) {
    return `Unknown command: ${text.trim().toUpperCase()}. Nothing happened.`;
  }
  function parsePoint(text, lastPoint) {
    const trimmed = text.trim();
    if (trimmed.startsWith("@")) {
      const rest = trimmed.slice(1);
      if (rest.includes("<")) {
        const [distanceText, angleText] = rest.split("<");
        const distance = Number(distanceText);
        const angle = Number(angleText);
        if (!Number.isFinite(distance) || !Number.isFinite(angle)) return null;
        const radians = angle * Math.PI / 180;
        return {
          x: round62(lastPoint.x + distance * Math.cos(radians)),
          y: round62(lastPoint.y + distance * Math.sin(radians))
        };
      }
      const parts2 = rest.split(",");
      if (parts2.length !== 2) return null;
      const x2 = Number(parts2[0]);
      const y2 = Number(parts2[1]);
      if (!Number.isFinite(x2) || !Number.isFinite(y2)) return null;
      return { x: round62(lastPoint.x + x2), y: round62(lastPoint.y + y2) };
    }
    const parts = trimmed.split(",");
    if (parts.length !== 2) return null;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: round62(x), y: round62(y) };
  }
  function round62(value) {
    const factor = 10 ** 6;
    const scaled = value * factor;
    const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
    return rounded / factor;
  }
  function parseNumber(text) {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }

  // src/client/constants.ts
  var PRESENCE_COLOURS = [
    "",
    // index 0 unused
    "#9fb98a",
    // sage
    "#d9b06a",
    // amber
    "#84b6bd",
    // sky
    "#d98a80",
    // rose
    "#b28ab5",
    // violet
    "#b5d08a",
    // lime
    "#e0a08f",
    // coral
    "#d9cb9f"
    // sand
  ];
  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  function cssEscape(value) {
    return value.replace(/["\\]/g, "\\$&");
  }
  function nearestMultipleOf45(angle) {
    let a = angle % 360;
    if (a < 0) a += 360;
    for (let k = 0; k < 8; k++) {
      const target = k * 45;
      if (Math.abs(a - target) <= 5 || Math.abs(a - target - 360) <= 5) return target % 360;
    }
    return null;
  }
  function handleOrder(handle) {
    const match = handle.match(/\d+/);
    return match ? Number(match[0]) : 0;
  }
  function normaliseAngle(degrees) {
    let a = degrees % 360;
    if (a < 0) a += 360;
    return a;
  }

  // src/client/canvas.ts
  function gripPoints(entity) {
    switch (entity.type) {
      case "line":
        return [
          { kind: "end", point: { x: entity.x1, y: entity.y1 }, index: 0 },
          { kind: "mid", point: { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2 }, index: 1 },
          { kind: "end", point: { x: entity.x2, y: entity.y2 }, index: 2 }
        ];
      case "circle":
        return [
          { kind: "centre", point: { x: entity.cx, y: entity.cy }, index: 0 },
          { kind: "quadrant", point: { x: entity.cx + entity.r, y: entity.cy }, index: 1 },
          { kind: "quadrant", point: { x: entity.cx, y: entity.cy + entity.r }, index: 2 },
          { kind: "quadrant", point: { x: entity.cx - entity.r, y: entity.cy }, index: 3 },
          { kind: "quadrant", point: { x: entity.cx, y: entity.cy - entity.r }, index: 4 }
        ];
      case "arc":
        return [
          { kind: "centre", point: { x: entity.cx, y: entity.cy }, index: 0 },
          { kind: "end", point: pointOnArc(entity, entity.start), index: 1 },
          { kind: "end", point: pointOnArc(entity, entity.end), index: 2 }
        ];
      case "pline":
        return entity.points.map((point, index) => ({ kind: "vertex", point, index }));
      default:
        return [];
    }
  }
  function pointOnArc(entity, degrees) {
    const radians = degrees * Math.PI / 180;
    return { x: entity.cx + entity.r * Math.cos(radians), y: entity.cy + entity.r * Math.sin(radians) };
  }
  function gripResult(start2, kind, index, world) {
    switch (start2.type) {
      case "line":
        if (kind === "mid") {
          const dx = world.x - (start2.x1 + start2.x2) / 2;
          const dy = world.y - (start2.y1 + start2.y2) / 2;
          return { ...start2, x1: round2(start2.x1 + dx), y1: round2(start2.y1 + dy), x2: round2(start2.x2 + dx), y2: round2(start2.y2 + dy) };
        }
        if (index === 0) return { ...start2, x1: round2(world.x), y1: round2(world.y) };
        return { ...start2, x2: round2(world.x), y2: round2(world.y) };
      case "circle":
        if (kind === "centre") return { ...start2, cx: round2(world.x), cy: round2(world.y) };
        return { ...start2, r: round2(Math.hypot(world.x - start2.cx, world.y - start2.cy)) };
      case "arc":
        if (kind === "centre") return { ...start2, cx: round2(world.x), cy: round2(world.y) };
        {
          const angle = normalise2(Math.atan2(world.y - start2.cy, world.x - start2.cx) * 180 / Math.PI);
          if (index === 1) return { ...start2, start: round2(angle) };
          return { ...start2, end: round2(angle) };
        }
      case "pline": {
        const points = [...start2.points];
        if (points[index]) points[index] = { x: round2(world.x), y: round2(world.y) };
        return { ...start2, points };
      }
      default:
        return start2;
    }
  }
  function fieldChanges(before, after) {
    const set = {};
    switch (before.type) {
      case "line": {
        if (after.type !== "line") return null;
        if (!nearly(before.x1, after.x1)) set.x1 = after.x1;
        if (!nearly(before.y1, after.y1)) set.y1 = after.y1;
        if (!nearly(before.x2, after.x2)) set.x2 = after.x2;
        if (!nearly(before.y2, after.y2)) set.y2 = after.y2;
        break;
      }
      case "circle": {
        if (after.type !== "circle") return null;
        if (!nearly(before.cx, after.cx)) set.cx = after.cx;
        if (!nearly(before.cy, after.cy)) set.cy = after.cy;
        if (!nearly(before.r, after.r)) set.r = after.r;
        break;
      }
      case "arc": {
        if (after.type !== "arc") return null;
        if (!nearly(before.cx, after.cx)) set.cx = after.cx;
        if (!nearly(before.cy, after.cy)) set.cy = after.cy;
        if (!nearly(before.r, after.r)) set.r = after.r;
        if (!nearly(before.start, after.start)) set.start = after.start;
        if (!nearly(before.end, after.end)) set.end = after.end;
        break;
      }
      case "pline": {
        if (after.type !== "pline" || before.points.length !== after.points.length) return null;
        set.points = after.points;
        break;
      }
      default:
        return null;
    }
    return Object.keys(set).length ? set : null;
  }
  function round2(value) {
    const factor = 10 ** 6;
    const scaled = value * factor;
    const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
    return rounded / factor;
  }
  function normalise2(degrees) {
    let a = degrees % 360;
    if (a < 0) a += 360;
    return a;
  }
  function entityMarkup(entity, state, view, selected) {
    const layer = state.layers[entity.layer];
    const colour = COLOUR_HEX[layer?.colour ?? "white"] ?? COLOUR_HEX.white;
    const linetype = layer?.linetype ?? "Continuous";
    const dash = dashFor(linetype);
    const common = {
      stroke: selected ? "#f7f3ea" : colour,
      "stroke-width": selected ? 2 : 1,
      fill: "none",
      "data-entity-id": entity.handle,
      "data-type": entity.type,
      "data-layer": entity.layer
    };
    if (dash) common["stroke-dasharray"] = dash;
    const screen = toScreen(view, firstPoint(entity));
    common["data-screen-x"] = String(screen.x);
    common["data-screen-y"] = String(screen.y);
    let node;
    switch (entity.type) {
      case "line": {
        const a = toScreen(view, { x: entity.x1, y: entity.y1 });
        const b = toScreen(view, { x: entity.x2, y: entity.y2 });
        node = svgNode("line", { ...common, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        node.setAttribute("data-x1", String(entity.x1));
        node.setAttribute("data-y1", String(entity.y1));
        node.setAttribute("data-x2", String(entity.x2));
        node.setAttribute("data-y2", String(entity.y2));
        break;
      }
      case "circle": {
        const c = toScreen(view, { x: entity.cx, y: entity.cy });
        node = svgNode("circle", { ...common, cx: c.x, cy: c.y, r: entity.r * view.zoom });
        node.setAttribute("data-cx", String(entity.cx));
        node.setAttribute("data-cy", String(entity.cy));
        node.setAttribute("data-r", String(entity.r));
        break;
      }
      case "arc": {
        const c = toScreen(view, { x: entity.cx, y: entity.cy });
        const r = entity.r * view.zoom;
        const startRad = entity.start * Math.PI / 180;
        const endRad = entity.end * Math.PI / 180;
        const x1 = c.x + r * Math.cos(startRad);
        const y1 = c.y - r * Math.sin(startRad);
        const x2 = c.x + r * Math.cos(endRad);
        const y2 = c.y - r * Math.sin(endRad);
        const large = entity.end - entity.start > 180 ? 1 : 0;
        node = svgNode("path", { ...common, d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}` });
        node.setAttribute("data-cx", String(entity.cx));
        node.setAttribute("data-cy", String(entity.cy));
        node.setAttribute("data-r", String(entity.r));
        node.setAttribute("data-start", String(entity.start));
        node.setAttribute("data-end", String(entity.end));
        break;
      }
      case "pline": {
        const points = entity.points.map((p) => toScreen(view, p)).map((p) => `${p.x},${p.y}`).join(" ");
        node = svgNode(entity.closed ? "polygon" : "polyline", { ...common, points });
        node.setAttribute("data-points", entity.points.map((p) => `${p.x},${p.y}`).join(" "));
        node.setAttribute("data-closed", String(entity.closed));
        break;
      }
      case "insert": {
        const c = toScreen(view, { x: entity.x, y: entity.y });
        node = svgNode("g", { ...common });
        node.setAttribute("data-block", entity.block);
        node.setAttribute("data-x", String(entity.x));
        node.setAttribute("data-y", String(entity.y));
        node.setAttribute("data-scale", String(entity.scale));
        node.setAttribute("data-rotation", String(entity.rotation));
        node.append(svgNode("rect", { x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill: "none", stroke: common.stroke, "stroke-width": 1 }));
        break;
      }
      case "hatch": {
        const polygon = entity.polygon ?? [];
        if (polygon.length >= 3) {
          const points = polygon.map((p) => toScreen(view, p)).map((p) => `${p.x},${p.y}`).join(" ");
          node = svgNode("polygon", { ...common, points, fill: colour, "fill-opacity": 0.25 });
        } else {
          const c = toScreen(view, { x: entity.seed_x, y: entity.seed_y });
          node = svgNode("rect", { ...common, x: c.x - 2, y: c.y - 2, width: 4, height: 4, fill: colour });
        }
        node.setAttribute("data-area", String(entity.area));
        node.setAttribute("data-associative", String(entity.associative));
        break;
      }
      case "dimension": {
        const c = toScreen(view, { x: entity.text_x, y: entity.text_y });
        const text = dimensionText({ entities: state.entities, dim_styles: state.dimStyles }, entity);
        const group = svgNode("g", { ...common });
        group.append(svgNode("line", { x1: c.x - 24, y1: c.y, x2: c.x + 24, y2: c.y, stroke: common.stroke, "stroke-width": 1 }));
        const label = svgNode("text", { x: c.x, y: c.y - 4, fill: common.stroke, "text-anchor": "middle", "font-size": 11 });
        label.textContent = text;
        group.append(label);
        group.setAttribute("data-kind", entity.kind);
        group.setAttribute("data-value", String(entity.value ?? ""));
        group.setAttribute("data-associative", String(entity.associative));
        node = group;
        break;
      }
    }
    return node;
  }
  function svgNode(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value));
    }
    return node;
  }
  function dashFor(linetype) {
    if (linetype === "Dashed") return "6 4";
    if (linetype === "Dotted") return "1 3";
    if (linetype === "Centre") return "12 4 3 4";
    return null;
  }
  function firstPoint(entity) {
    switch (entity.type) {
      case "line":
        return { x: entity.x1, y: entity.y1 };
      case "circle":
        return { x: entity.cx, y: entity.cy };
      case "arc":
        return { x: entity.cx, y: entity.cy };
      case "pline":
        return entity.points[0] ?? { x: 0, y: 0 };
      case "insert":
        return { x: entity.x, y: entity.y };
      case "hatch":
        return { x: entity.seed_x, y: entity.seed_y };
      case "dimension":
        return { x: entity.text_x, y: entity.text_y };
    }
  }
  function snapCandidates(entity, handle) {
    const out = [];
    switch (entity.type) {
      case "line":
        out.push({ kind: "endpoint", point: { x: entity.x1, y: entity.y1 } }, { kind: "endpoint", point: { x: entity.x2, y: entity.y2 } });
        out.push({ kind: "midpoint", point: { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2 } });
        break;
      case "circle":
        out.push({ kind: "centre", point: { x: entity.cx, y: entity.cy } });
        break;
      case "arc":
        out.push(
          { kind: "endpoint", point: pointOnArc(entity, entity.start) },
          { kind: "endpoint", point: pointOnArc(entity, entity.end) },
          { kind: "midpoint", point: pointOnArc(entity, (entity.start + entity.end) / 2) },
          { kind: "centre", point: { x: entity.cx, y: entity.cy } }
        );
        break;
      case "pline":
        for (const point of entity.points) out.push({ kind: "endpoint", point });
        for (let i = 0; i < entity.points.length - 1; i++) {
          const a = entity.points[i];
          const b = entity.points[i + 1];
          out.push({ kind: "midpoint", point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
        }
        break;
      default:
        break;
    }
    return out;
  }
  function perpendicularFoot(state, world, lastPoint, aperture) {
    let best = null;
    let bestDistance = aperture;
    for (const handle of state.order) {
      const entity = state.entities[handle];
      if (!entity) continue;
      const layer = state.layers[entity.layer];
      if (!layer || !layer.on || layer.frozen) continue;
      const segments = segmentsOf(entity);
      for (const [a, b] of segments) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        let t = ((lastPoint.x - a.x) * dx + (lastPoint.y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const foot = { x: a.x + dx * t, y: a.y + dy * t };
        const distance = Math.hypot(world.x - foot.x, world.y - foot.y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = foot;
        }
      }
    }
    return best;
  }
  function tangentPoint(state, world, lastPoint, aperture) {
    let best = null;
    let bestDistance = aperture;
    for (const handle of state.order) {
      const entity = state.entities[handle];
      if (!entity) continue;
      const layer = state.layers[entity.layer];
      if (!layer || !layer.on || layer.frozen) continue;
      const circles = [];
      if (entity.type === "circle") circles.push({ cx: entity.cx, cy: entity.cy, r: entity.r });
      if (entity.type === "arc") circles.push({ cx: entity.cx, cy: entity.cy, r: entity.r });
      for (const circle2 of circles) {
        const distance = Math.hypot(lastPoint.x - circle2.cx, lastPoint.y - circle2.cy);
        if (distance <= circle2.r) continue;
        const angle = Math.acos(circle2.r / distance);
        const base = Math.atan2(circle2.cy - lastPoint.y, circle2.cx - lastPoint.x);
        for (const offset of [angle, -angle]) {
          const radians = base + offset;
          const point = { x: circle2.cx + circle2.r * Math.cos(radians), y: circle2.cy + circle2.r * Math.sin(radians) };
          const screenDistance = Math.hypot(world.x - point.x, world.y - point.y);
          if (screenDistance <= bestDistance) {
            bestDistance = screenDistance;
            best = point;
          }
        }
      }
    }
    return best;
  }
  function segmentsOf(entity) {
    switch (entity.type) {
      case "line":
        return [[{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]];
      case "pline": {
        const out = [];
        const last = entity.closed ? entity.points.length : entity.points.length - 1;
        for (let i = 0; i < last; i++) {
          out.push([entity.points[i], entity.points[(i + 1) % entity.points.length]]);
        }
        return out;
      }
      default:
        return [];
    }
  }
  function lengthOf(entity) {
    switch (entity.type) {
      case "line":
        return lineLength(entity.x1, entity.y1, entity.x2, entity.y2);
      case "pline":
        return polylineLength(entity);
      case "arc":
        return arcLength(entity);
      default:
        return null;
    }
  }
  function areaOf(entity) {
    switch (entity.type) {
      case "circle":
        return circleArea(entity.r);
      case "pline":
        return entity.closed ? polygonArea(entity.points) : null;
      case "hatch":
        return entity.area;
      default:
        return null;
    }
  }

  // src/client/screen_core.ts
  var PANEL_ORDER = ["Entities", "Layers", "Properties", "Parameters", "Xrefs", "Versions", "Issues", "Markups"];
  var DrawingScreenCore = class {
    root;
    api;
    drawingId;
    me;
    readOnly;
    settings;
    state = null;
    view = { zoom: 1, panX: 0, panY: 0 };
    selection = /* @__PURE__ */ new Set();
    aids = { snap: true, ortho: false, grid: false, polar: false };
    lastPoint = { x: 0, y: 0 };
    snapPoint = null;
    command = null;
    stageIndex = 0;
    stageInputs = [];
    points = [];
    pendingGroups = [];
    offline = false;
    socket = null;
    socketSeq = 0;
    presence = /* @__PURE__ */ new Map();
    following = null;
    paneWidth = 800;
    paneHeight = 600;
    lastCommand = null;
    optimisticCounter = 0;
    issues = [];
    versions = [];
    rfis = {};
    commandInput = null;
    promptStatus = null;
    announcementsStatus = null;
    toastStack = null;
    connectionStatus = null;
    drawingStage = null;
    entityLayer = null;
    overlayLayer = null;
    cursorLayer = null;
    zoomText = null;
    peopleList = null;
    panelBodies = /* @__PURE__ */ new Map();
    isPhone;
    isTablet;
    panelStripBody = null;
    commandCancelled = false;
    topRightChip = null;
    spaceHeld = false;
    constructor(drawingId, api2, me2, settings2, readOnly) {
      this.drawingId = drawingId;
      this.api = api2;
      this.me = me2;
      this.settings = settings2;
      this.readOnly = readOnly;
      this.isPhone = window.innerWidth < 768;
      this.isTablet = window.innerWidth >= 768 && window.innerWidth < 1280;
      this.root = this.build();
    }
    async load() {
      const { status, data } = await this.api("GET", `/api/drawings/${this.drawingId}`);
      if (status === 401) {
        window.location.href = "/signin";
        return;
      }
      if (status !== 200) {
        this.root.replaceChildren(el("div", { class: "surface note" }, el("p", { text: "We couldn\u2019t find that drawing." })));
        return;
      }
      this.state = drawingFromApi(data);
      this.view = zoomAll(this.state, this.paneWidth, this.paneHeight);
      this.renderAll();
      await Promise.all([this.loadVersions(), this.loadIssues()]);
      this.openSocket();
    }
    build() {
      const screen = el("div", { class: "drawing-screen" });
      const left = el("div", { class: "left-column" });
      const centre = el("div", { class: "centre-column" });
      const right = el("div", { class: "right-column" });
      screen.append(left, centre, right);
      for (const name of PANEL_ORDER) {
        const { node, body } = this.panel(name);
        this.panelBodies.set(name, body);
        if (name === "Entities" || name === "Layers") left.append(node);
        else right.append(node);
      }
      const stage = el("div", { class: "drawing-stage", role: "region", "aria-label": "Drawing", tabindex: "0" });
      this.drawingStage = stage;
      const svg = svgEl("svg", { "aria-hidden": "true" });
      this.entityLayer = svgEl("g");
      this.overlayLayer = svgEl("g");
      this.cursorLayer = svgEl("g");
      svg.append(this.entityLayer, this.overlayLayer, this.cursorLayer);
      stage.append(svg);
      stage.append(this.buildTopLeftChip());
      this.topRightChip = this.buildTopRightChip();
      stage.append(this.topRightChip);
      stage.append(this.buildBottomLeftChip());
      stage.append(this.buildBottomRightChip());
      const commandInput = el("input", { type: "text", "aria-label": "Command", autocomplete: "off" });
      this.commandInput = commandInput;
      this.promptStatus = el("span", { role: "status", "aria-live": "polite", text: READY_PROMPT });
      const aids = el("div", { role: "group", "aria-label": "Drafting aids" });
      for (const [key, label] of [["snap", "Snap"], ["ortho", "Ortho"], ["grid", "Grid"], ["polar", "Polar"]]) {
        const button = el("button", { text: label, "aria-pressed": this.aids[key] ? "true" : "false", class: "aid-button", "data-aid": key });
        button.addEventListener("click", () => this.toggleAid(key));
        aids.append(button);
      }
      const commandBar = el("div", { class: "command-bar" }, commandInput, this.promptStatus, aids);
      centre.append(stage, commandBar);
      if (this.isTablet) {
        const strip = el("div", { class: "panel-strip" });
        const tabs = el("div", { role: "tablist", "aria-label": "Panels", class: "panel-tabs" });
        const body = el("div", { class: "panel-strip-body" });
        this.panelStripBody = body;
        for (const name of PANEL_ORDER) {
          const tab = el("button", { role: "tab", text: name, "aria-selected": name === "Entities" ? "true" : "false", "data-panel-tab": name });
          tab.addEventListener("click", () => this.selectStripPanel(name));
          tabs.append(tab);
        }
        strip.append(tabs, body);
        screen.append(strip);
      }
      if (this.isPhone) {
        const panelsButton = el("button", { text: "Panels", "aria-label": "Panels" });
        const sheet = el("div", { class: "panel-sheet", role: "dialog", "aria-label": "Panel", hidden: true });
        const tabs = el("div", { role: "tablist", class: "panel-tabs" });
        const body = el("div", { class: "panel-sheet-body" });
        for (const name of ["Issues", "Markups", "Versions"]) {
          const tab = el("button", { role: "tab", text: name, "aria-selected": name === "Issues" ? "true" : "false", "data-panel-tab": name });
          tab.addEventListener("click", () => this.selectPhonePanel(body, name));
          tabs.append(tab);
        }
        sheet.append(tabs, body);
        panelsButton.addEventListener("click", () => {
          sheet.hidden = false;
          this.selectPhonePanel(body, "Issues");
        });
        this.topRightChip.append(panelsButton);
        screen.append(sheet);
      }
      this.announcementsStatus = el("span", { class: "visually-hidden", role: "status", "aria-live": "polite" });
      this.toastStack = el("div", { class: "toast-stack", role: "status", "aria-live": "polite" });
      screen.append(this.announcementsStatus, this.toastStack);
      this.bindStage(stage);
      this.bindKeyboard();
      new ResizeObserver(() => {
        const rect3 = stage.getBoundingClientRect();
        this.paneWidth = rect3.width || 1;
        this.paneHeight = rect3.height || 1;
        this.renderEntities();
      }).observe(stage);
      const rect2 = stage.getBoundingClientRect();
      this.paneWidth = rect2.width || 1;
      this.paneHeight = rect2.height || 1;
      return screen;
    }
    panel(name) {
      const body = el("div", { class: "panel-body" });
      const header = el("button", { class: "panel-header", text: name, "aria-expanded": "true" });
      const node = el("section", { class: "panel", "data-open": "true", "data-panel": name }, header, body);
      header.addEventListener("click", () => {
        const open = node.dataset.open === "true";
        node.dataset.open = open ? "false" : "true";
        header.setAttribute("aria-expanded", open ? "false" : "true");
      });
      return { node, body };
    }
    selectStripPanel(name) {
      for (const tab of this.root.querySelectorAll("[data-panel-tab]")) {
        tab.setAttribute("aria-selected", tab.getAttribute("data-panel-tab") === name ? "true" : "false");
      }
      if (this.panelStripBody) this.panelStripBody.replaceChildren(this.panelBody(name));
    }
    selectPhonePanel(body, name) {
      for (const tab of this.root.querySelectorAll("[data-panel-tab]")) {
        tab.setAttribute("aria-selected", tab.getAttribute("data-panel-tab") === name ? "true" : "false");
      }
      body.replaceChildren(this.panelBody(name));
    }
    panelBody(name) {
      return this.panelBodies.get(name) ?? el("div");
    }
    buildTopLeftChip() {
      const chip = el("div", { class: "chip tl" });
      chip.append(el("span", { class: "chip-label", "data-drawing-name": "true", text: "" }));
      const layouts = el("div", { role: "tablist", "aria-label": "Layouts" });
      layouts.append(el("button", { role: "tab", text: "Model", "aria-selected": "true" }));
      chip.append(layouts);
      if (!this.readOnly) {
        const newSheet = el("button", { text: "New sheet" });
        newSheet.addEventListener("click", () => void this.newSheet());
        chip.append(newSheet);
      }
      return chip;
    }
    buildTopRightChip() {
      const chip = el("div", { class: "chip tr" });
      this.peopleList = el("ul", { role: "list", "aria-label": "People here" });
      chip.append(this.peopleList);
      if (!this.readOnly) {
        const publish = el("button", { text: "Publish sheet" });
        publish.addEventListener("click", () => void this.publishSheet());
        const compare = el("button", { text: "Compare" });
        compare.addEventListener("click", () => void this.openCompare());
        const exportButton = el("button", { text: "Export" });
        exportButton.addEventListener("click", () => void this.openExportDialog());
        const importButton = el("button", { text: "Import" });
        importButton.addEventListener("click", () => this.openImportDialog());
        const underlayButton = el("button", { text: "Add underlay" });
        underlayButton.addEventListener("click", () => this.openUnderlayDialog());
        chip.append(publish, compare, exportButton, importButton, underlayButton);
      }
      return chip;
    }
    buildBottomLeftChip() {
      const chip = el("div", { class: "chip bl" });
      const offlineSwitch = el("input", { type: "checkbox", role: "switch", "aria-label": "Work offline" });
      offlineSwitch.addEventListener("change", () => this.setOffline(offlineSwitch.checked));
      this.connectionStatus = el("span", { role: "status", "aria-live": "polite", text: "Live" });
      chip.append(offlineSwitch, this.connectionStatus);
      return chip;
    }
    buildBottomRightChip() {
      this.zoomText = el("span", { class: "chip-label", text: "Zoom 1" });
      return el("div", { class: "chip br" }, this.zoomText);
    }
    renderAll() {
      this.renderEntities();
      this.renderPanels();
      this.updateDrawingRoot();
      const nameNode = this.root.querySelector("[data-drawing-name]");
      if (nameNode && this.state) nameNode.textContent = this.state.name;
    }
    updateDrawingRoot() {
      const stage = this.drawingStage;
      if (!stage || !this.state) return;
      stage.dataset.revision = String(this.state.revision);
      stage.dataset.pendingOps = String(this.pendingGroups.length);
      stage.dataset.totalEntities = String(this.state.order.length);
      stage.dataset.zoom = String(this.view.zoom);
      stage.dataset.panX = String(this.view.panX);
      stage.dataset.panY = String(this.view.panY);
      stage.dataset.snapKind = this.snapPoint ? this.snapPoint.kind : "none";
      stage.dataset.snapX = this.snapPoint ? numberKey(this.snapPoint.point.x) : "0";
      stage.dataset.snapY = this.snapPoint ? numberKey(this.snapPoint.point.y) : "0";
      if (this.zoomText) this.zoomText.textContent = `Zoom ${trimZeros(this.view.zoom.toFixed(2))}`;
    }
    renderEntities() {
      if (!this.state || !this.entityLayer) return;
      const visible = new Set(visibleEntities(this.state));
      const domHandles = entityHandlesForDom(this.state, this.view, this.paneWidth, this.paneHeight, this.settings.domMarginPx, this.settings.domCeiling, this.selection);
      const keep = new Set(domHandles);
      for (const child of [...this.entityLayer.children]) {
        const handle = child.getAttribute?.("data-entity-id") ?? "";
        if (handle && !keep.has(handle)) child.remove();
      }
      for (const handle of domHandles) {
        if (!visible.has(handle)) continue;
        const entity = this.state.entities[handle];
        if (!entity) continue;
        const node = entityMarkup(entity, this.state, this.view, this.selection.has(handle));
        const existing = this.entityLayer.querySelector(`[data-entity-id="${cssEscape(handle)}"]`);
        if (existing) existing.replaceWith(node);
        else this.entityLayer.append(node);
      }
      this.renderGrips();
      this.updateDrawingRoot();
    }
    renderGrips() {
      if (!this.overlayLayer || !this.state) return;
      for (const child of [...this.overlayLayer.querySelectorAll("[data-grip]")]) child.remove();
      if (this.isPhone || this.readOnly) return;
      for (const handle of this.selection) {
        const entity = this.state.entities[handle];
        if (!entity) continue;
        for (const grip of gripPoints(entity)) {
          const screen = toScreen(this.view, grip.point);
          const node = svgEl("rect", {
            "data-grip": grip.kind,
            "data-handle": handle,
            "data-index": String(grip.index),
            x: String(screen.x - 3),
            y: String(screen.y - 3),
            width: "6",
            height: "6",
            fill: "#ece7db"
          });
          node.addEventListener("pointerdown", (event) => this.beginGripDrag(event, handle, grip.kind, grip.index));
          this.overlayLayer.append(node);
        }
      }
    }
    beginGripDrag(event, handle, kind, index) {
      if (!this.state || this.readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      const stage = this.drawingStage;
      if (!stage) return;
      const start2 = structuredClone(this.state.entities[handle]);
      if (!start2) return;
      const move = (moveEvent) => {
        const world = this.pointerWorld(moveEvent);
        if (this.state) this.state.entities[handle] = gripResult(start2, kind, index, world);
        this.renderEntities();
      };
      const up = (upEvent) => {
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerup", up);
        const world = this.pointerWorld(upEvent);
        const next = gripResult(start2, kind, index, world);
        if (this.state) this.state.entities[handle] = start2;
        const set = fieldChanges(start2, next);
        if (set) void this.sendGroup("GRIP", [{ op_id: this.newOpId(), type: "modify", handle, set }]);
        else this.renderEntities();
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerup", up);
    }
    pointerWorld(event) {
      const rect2 = this.drawingStage?.getBoundingClientRect();
      if (!rect2) return { x: 0, y: 0 };
      return toWorld(this.view, { x: event.clientX - rect2.left, y: event.clientY - rect2.top });
    }
    pointerScreen(event) {
      const rect2 = this.drawingStage?.getBoundingClientRect();
      if (!rect2) return { x: 0, y: 0 };
      return { x: event.clientX - rect2.left, y: event.clientY - rect2.top };
    }
    // -----------------------------------------------------------------
    // Pointer, wheel and touch
    // -----------------------------------------------------------------
    bindStage(stage) {
      stage.addEventListener("pointermove", (event) => {
        const world = this.pointerWorld(event);
        this.resolveSnap(world);
        this.sendPresence(world);
      });
      stage.addEventListener("pointerdown", (event) => {
        if (this.isPhone) {
          this.handleTouch(event);
          return;
        }
        if (event.button === 1 || event.button === 0 && this.spaceHeld) {
          this.beginPan(event);
          return;
        }
        if (event.button === 0) {
          const world = this.pointerWorld(event);
          const resolved = this.resolveSnap(world);
          this.handleClick(resolved, event.shiftKey);
        }
      });
      stage.addEventListener("wheel", (event) => {
        event.preventDefault();
        const screen = this.pointerScreen(event);
        const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
        const before = toWorld(this.view, screen);
        this.view.zoom = clamp(Number((this.view.zoom * factor).toFixed(4)), 0.05, 50);
        const after = toScreen(this.view, before);
        this.view.panX = Number((this.view.panX + screen.x - after.x).toFixed(4));
        this.view.panY = Number((this.view.panY + screen.y - after.y).toFixed(4));
        this.stopFollowing();
        this.renderEntities();
      });
      stage.addEventListener("keydown", (event) => {
        if (event.target.tagName === "INPUT") return;
        if (this.selection.size && event.key.startsWith("Arrow")) {
          event.preventDefault();
          const distance = event.shiftKey ? 10 : 1;
          const dx = event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0;
          const dy = event.key === "ArrowUp" ? distance : event.key === "ArrowDown" ? -distance : 0;
          void this.sendGroup("NUDGE", [{ op_id: this.newOpId(), type: "move", handles: [...this.selection], dx, dy }]);
          return;
        }
        if (this.selection.size && event.key === "Delete") {
          event.preventDefault();
          const handles = [...this.selection];
          this.selection.clear();
          void this.sendGroup("ERASE", [{ op_id: this.newOpId(), type: "delete", handles }]);
        }
      });
    }
    beginPan(event) {
      const stage = this.drawingStage;
      if (!stage) return;
      let last = { x: event.clientX, y: event.clientY };
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - last.x;
        const dy = moveEvent.clientY - last.y;
        last = { x: moveEvent.clientX, y: moveEvent.clientY };
        this.view.panX = Number((this.view.panX + dx).toFixed(4));
        this.view.panY = Number((this.view.panY + dy).toFixed(4));
        this.stopFollowing();
        this.renderEntities();
      };
      const up = () => {
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerup", up);
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerup", up);
    }
    handleTouch(event) {
      const stage = this.drawingStage;
      if (!stage) return;
      const start2 = this.pointerScreen(event);
      const startTime = Date.now();
      let moved = 0;
      let timer = window.setTimeout(() => {
        timer = 0;
        this.openSheetMenu(start2);
      }, 500);
      const move = (moveEvent) => {
        const screen = this.pointerScreen(moveEvent);
        moved = Math.max(moved, Math.hypot(screen.x - start2.x, screen.y - start2.y));
        if (moved >= 8 && timer) {
          window.clearTimeout(timer);
          timer = 0;
        }
      };
      const up = () => {
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerup", up);
        if (timer) {
          window.clearTimeout(timer);
          timer = 0;
        }
        if (moved < 8 && Date.now() - startTime < 500) {
          this.openNewIssueDialog(start2);
        }
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerup", up);
    }
    openSheetMenu(screen) {
      const menu = el("div", { role: "menu", "aria-label": "Sheet actions", class: "surface", style: `position:absolute;left:${screen.x}px;top:${screen.y}px;z-index:20` });
      const pin = el("button", { role: "menuitem", text: "Pin issue here" });
      pin.addEventListener("click", () => {
        menu.remove();
        this.openNewIssueDialog(screen);
      });
      const measure = el("button", { role: "menuitem", text: "Measure from here" });
      measure.addEventListener("click", () => {
        menu.remove();
        this.startMeasure(screen);
      });
      const versions = el("button", { role: "menuitem", text: "Show versions" });
      versions.addEventListener("click", () => {
        menu.remove();
        const sheet = this.root.querySelector(".panel-sheet");
        if (sheet) sheet.hidden = false;
      });
      menu.append(pin, measure, versions);
      this.root.append(menu);
      const dismiss = (event) => {
        if (!menu.contains(event.target)) {
          menu.remove();
          document.removeEventListener("pointerdown", dismiss);
        }
      };
      document.addEventListener("pointerdown", dismiss);
    }
    startMeasure(screen) {
      const from = toWorld(this.view, screen);
      const stage = this.drawingStage;
      if (!stage) return;
      const click = (event) => {
        const to = toWorld(this.view, this.pointerScreen(event));
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        const angle = normaliseAngle(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI);
        this.setPrompt(`DIST: ${trimZeros(distance.toFixed(3))} units, angle ${trimZeros(angle.toFixed(2))} degrees`);
        stage.removeEventListener("pointerdown", click);
      };
      stage.addEventListener("pointerdown", click);
    }
    openNewIssueDialog(screen) {
      const world = toWorld(this.view, screen);
      const title = el("input", { type: "text", "aria-label": "Issue title" });
      const dialog = el("dialog", { "aria-label": "New issue" });
      const form = el("form", {}, el("label", { text: "Issue title" }, title));
      form.append(el("button", { type: "submit", text: "Pin issue", class: "primary" }));
      dialog.append(form);
      this.root.append(dialog);
      dialog.showModal();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const version = this.versions[this.versions.length - 1];
        if (!version) {
          this.toast("Publish a version first.");
          return;
        }
        const { status, data } = await this.api("POST", `/api/versions/${String(version.id)}/issues`, {
          title: title.value,
          x: round6(world.x),
          y: round6(world.y)
        });
        if (status === 201) {
          const pin = el("div", {
            "data-issue-pin": String(data.id ?? ""),
            "data-x": String(round6(world.x)),
            "data-y": String(round6(world.y)),
            style: `position:absolute;left:${screen.x}px;top:${screen.y}px;width:10px;height:10px;background:#9fb98a;border:1px solid #ece7db;z-index:6`
          });
          this.drawingStage?.append(pin);
          this.animatePin(pin);
          dialog.close();
          dialog.remove();
          void this.loadIssues();
        }
      });
    }
    animatePin(node) {
      if (reducedMotion()) return;
      node.animate([{ transform: "scale(0.8)" }, { transform: "scale(1)" }], { id: "sheet-pin", duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
    }
    // -----------------------------------------------------------------
    // Snaps and drafting aids
    // -----------------------------------------------------------------
    resolveSnap(world) {
      if (!this.state) return world;
      const snapped = this.aids.snap ? this.findSnap(world) : null;
      this.snapPoint = snapped ? { kind: snapped.kind, point: snapped.point } : null;
      let point = snapped ? snapped.point : world;
      if (!snapped) point = this.applyAids(point);
      this.updateDrawingRoot();
      return point;
    }
    applyAids(world) {
      let point = world;
      const dx = point.x - this.lastPoint.x;
      const dy = point.y - this.lastPoint.y;
      if (this.aids.ortho) {
        point = Math.abs(dx) >= Math.abs(dy) ? { x: point.x, y: this.lastPoint.y } : { x: this.lastPoint.x, y: point.y };
      } else if (this.aids.polar) {
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const distance = Math.hypot(dx, dy);
        const snapped = nearestMultipleOf45(angle);
        if (snapped !== null) {
          const radians = snapped * Math.PI / 180;
          point = { x: round6(this.lastPoint.x + distance * Math.cos(radians)), y: round6(this.lastPoint.y + distance * Math.sin(radians)) };
        }
      }
      if (this.aids.grid) point = this.applyGrid(point);
      return point;
    }
    applyGrid(point) {
      const dx = point.x - this.lastPoint.x;
      const dy = point.y - this.lastPoint.y;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const polarAngle = this.aids.polar ? nearestMultipleOf45(angle) : null;
      if (this.aids.ortho || polarAngle !== null && polarAngle % 90 === 0) {
        return Math.abs(dx) >= Math.abs(dy) ? { x: round6(Math.round(point.x)), y: this.lastPoint.y } : { x: this.lastPoint.x, y: round6(Math.round(point.y)) };
      }
      if (this.aids.polar && polarAngle !== null && polarAngle % 90 !== 0) {
        const distance = Math.round(Math.hypot(dx, dy));
        const radians = polarAngle * Math.PI / 180;
        return { x: round6(this.lastPoint.x + distance * Math.cos(radians)), y: round6(this.lastPoint.y + distance * Math.sin(radians)) };
      }
      return { x: round6(Math.round(point.x)), y: round6(Math.round(point.y)) };
    }
    findSnap(world) {
      if (!this.state) return null;
      const aperture = 10 / this.view.zoom;
      const priority = ["endpoint", "midpoint", "centre", "intersection", "perpendicular", "tangent", "nearest"];
      const candidates = [];
      for (const handle of this.state.order) {
        const entity = this.state.entities[handle];
        if (!entity) continue;
        const layer = this.state.layers[entity.layer];
        if (!layer || !layer.on || layer.frozen) continue;
        for (const candidate of snapCandidates(entity, handle)) {
          const screenDistance = Math.hypot(candidate.point.x - world.x, candidate.point.y - world.y) * this.view.zoom;
          if (screenDistance <= 10) candidates.push({ ...candidate, screenDistance, handle });
        }
      }
      const perpendicular = perpendicularFoot(this.state, world, this.lastPoint, aperture);
      if (perpendicular) candidates.push({ kind: "perpendicular", point: perpendicular, screenDistance: Math.hypot(perpendicular.x - world.x, perpendicular.y - world.y) * this.view.zoom, handle: "" });
      const tangent = tangentPoint(this.state, world, this.lastPoint, aperture);
      if (tangent) candidates.push({ kind: "tangent", point: tangent, screenDistance: Math.hypot(tangent.x - world.x, tangent.y - world.y) * this.view.zoom, handle: "" });
      if (!candidates.length) return null;
      candidates.sort((a, b) => {
        const kindA = priority.indexOf(a.kind);
        const kindB = priority.indexOf(b.kind);
        if (kindA !== kindB) return kindA - kindB;
        if (Math.abs(a.screenDistance - b.screenDistance) > 1e-9) return a.screenDistance - b.screenDistance;
        return handleOrder(a.handle) - handleOrder(b.handle);
      });
      return { kind: candidates[0].kind, point: candidates[0].point };
    }
    toggleAid(key) {
      if (key === "ortho" && !this.aids.ortho) this.aids.polar = false;
      if (key === "polar" && !this.aids.polar) this.aids.ortho = false;
      this.aids[key] = !this.aids[key];
      const names = { snap: "Snap", ortho: "Ortho", grid: "Grid", polar: "Polar" };
      this.announce(`${names[key]} ${this.aids[key] ? "on" : "off"}`);
      for (const button of this.root.querySelectorAll("[data-aid]")) {
        const aid = button.dataset.aid;
        button.setAttribute("aria-pressed", this.aids[aid] ? "true" : "false");
      }
    }
    // -----------------------------------------------------------------
    // Clicks, selection and windows
    // -----------------------------------------------------------------
    handleClick(world, shift) {
      if (!this.state || this.readOnly) return;
      if (this.command) {
        this.advanceCommand(world);
        return;
      }
      const handle = entityAtPoint(this.state, world, 10, this.view);
      if (handle) {
        if (shift) this.selection.delete(handle);
        else this.selection.add(handle);
        this.renderEntities();
        this.renderPanels();
        return;
      }
      if (shift) return;
      this.beginWindow(world);
    }
    beginWindow(startWorld) {
      const stage = this.drawingStage;
      if (!stage) return;
      let current = startWorld;
      let active = false;
      const overlay = svgEl("rect", { fill: "none", stroke: "#ece7db", "stroke-dasharray": "4 4" });
      this.overlayLayer?.append(overlay);
      const move = (event) => {
        current = this.pointerWorld(event);
        active = true;
        const a = toScreen(this.view, { x: Math.min(startWorld.x, current.x), y: Math.min(startWorld.y, current.y) });
        const b = toScreen(this.view, { x: Math.max(startWorld.x, current.x), y: Math.max(startWorld.y, current.y) });
        overlay.setAttribute("x", String(a.x));
        overlay.setAttribute("y", String(a.y));
        overlay.setAttribute("width", String(Math.max(0, b.x - a.x)));
        overlay.setAttribute("height", String(Math.max(0, b.y - a.y)));
        overlay.setAttribute("data-window", startWorld.x <= current.x ? "window" : "crossing");
      };
      const up = () => {
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerup", up);
        overlay.remove();
        if (!active || !this.state) return;
        const crossing = startWorld.x > current.x;
        const minX = Math.min(startWorld.x, current.x);
        const maxX = Math.max(startWorld.x, current.x);
        const minY = Math.min(startWorld.y, current.y);
        const maxY = Math.max(startWorld.y, current.y);
        for (const handle of this.state.order) {
          const entity = this.state.entities[handle];
          if (!entity) continue;
          const layer = this.state.layers[entity.layer];
          if (!layer || layer.locked || layer.frozen || !layer.on) continue;
          const box = entityBounds(entity);
          const inside = crossing ? box.minX <= maxX && box.maxX >= minX && box.minY <= maxY && box.maxY >= minY : box.minX >= minX && box.maxX <= maxX && box.minY >= minY && box.maxY <= maxY;
          if (inside) this.selection.add(handle);
        }
        this.renderEntities();
        this.renderPanels();
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerup", up);
    }
    // -----------------------------------------------------------------
    // Keyboard map and command line
    // -----------------------------------------------------------------
    bindKeyboard() {
      const input = this.commandInput;
      if (!input) return;
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const text = input.value;
          input.value = "";
          this.submitCommand(text);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.cancelCommand();
          return;
        }
        const stage = this.currentStage();
        if (event.key === " " && stage && !stageTakesSpace(stage)) {
          event.preventDefault();
          const text = input.value;
          input.value = "";
          this.submitCommand(text);
        }
      });
      document.addEventListener("keydown", (event) => {
        const target = event.target;
        const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
        if (event.key === " ") this.spaceHeld = true;
        if (event.key === "F3") {
          event.preventDefault();
          this.toggleAid("snap");
          return;
        }
        if (event.key === "F8") {
          event.preventDefault();
          this.toggleAid("ortho");
          return;
        }
        if (event.key === "F9") {
          event.preventDefault();
          this.toggleAid("grid");
          return;
        }
        if (event.key === "F10") {
          event.preventDefault();
          this.toggleAid("polar");
          return;
        }
        if (event.key === "F6") {
          event.preventDefault();
          this.cycleFocus(event.shiftKey);
          return;
        }
        if (inField) {
          if (event.key === "Escape" && target !== input) {
            event.preventDefault();
            input.focus();
          }
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          void this.undo(event.shiftKey);
          return;
        }
        if (event.key === "Delete" && this.selection.size) {
          event.preventDefault();
          const handles = [...this.selection];
          this.selection.clear();
          void this.sendGroup("ERASE", [{ op_id: this.newOpId(), type: "delete", handles }]);
          return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (this.isPhone) {
            this.setPrompt("Drawing commands aren\u2019t available on a phone. Open this drawing on a desktop to edit.");
            return;
          }
          input.focus();
        }
      });
      document.addEventListener("keyup", (event) => {
        if (event.key === " ") this.spaceHeld = false;
      });
    }
    currentStage() {
      if (!this.command) return null;
      const stages = this.command.stages;
      const base = stages[Math.min(this.stageIndex, stages.length - 1)] ?? null;
      if (!base) return null;
      if (this.command.name === "ARRAY" && this.stageIndex >= 2) {
        if (String(this.stageInputs[1] ?? "").toUpperCase() === "R") {
          return ["ARRAY: rows", "ARRAY: columns", "ARRAY: row gap", "ARRAY: column gap"][this.stageIndex - 2] ?? base;
        }
        return ["ARRAY: centre", "ARRAY: count", "ARRAY: total angle"][this.stageIndex - 2] ?? base;
      }
      return base;
    }
    setPrompt(text) {
      if (this.promptStatus) this.promptStatus.textContent = text;
    }
    announce(text) {
      if (this.announcementsStatus) this.announcementsStatus.textContent = text;
    }
    toast(text) {
      if (!this.toastStack) return;
      const node = el("div", { class: "toast", text });
      this.toastStack.append(node);
      if (!reducedMotion()) {
        node.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "translateY(0)" }], { id: "toast-enter", duration: 120, easing: "ease-out", fill: "forwards" });
      }
      window.setTimeout(() => node.remove(), this.settings.toastMs);
    }
    cycleFocus(backwards) {
      const stops = [];
      if (this.commandInput) stops.push(this.commandInput);
      if (this.drawingStage) stops.push(this.drawingStage);
      if (!this.isPhone) {
        for (const name of PANEL_ORDER) {
          const body = this.panelBodies.get(name);
          const panelNode = body?.parentElement;
          if (panelNode && panelNode.dataset.open === "true") stops.push(panelNode);
        }
      } else {
        const sheet = this.root.querySelector(".panel-sheet");
        if (sheet && !sheet.hidden) stops.push(sheet);
      }
      if (!stops.length) return;
      const active = document.activeElement;
      const index = active ? stops.indexOf(active) : -1;
      const next = backwards ? (index - 1 + stops.length) % stops.length : (index + 1) % stops.length;
      stops[next].focus();
    }
    submitCommand(text) {
      if (this.readOnly) {
        this.setPrompt("You can view this drawing but not edit it.");
        return;
      }
      if (this.commandCancelled) {
        this.commandCancelled = false;
        if (text.trim() === "") {
          this.setPrompt(READY_PROMPT);
          return;
        }
      }
      if (!this.command) {
        if (text.trim() === "") {
          if (this.lastCommand) {
            this.command = this.lastCommand;
            this.stageIndex = 0;
            this.stageInputs = [];
            this.points = [];
            this.setPrompt(this.currentStage() ?? READY_PROMPT);
          }
          return;
        }
        if (text.trim().toUpperCase() === "U") {
          void this.undo(false);
          return;
        }
        const spec = resolveCommand(text);
        if (!spec) {
          this.setPrompt(unknownCommandText(text));
          return;
        }
        this.lastCommand = spec;
        this.command = spec;
        this.stageIndex = 0;
        this.stageInputs = [];
        this.points = [];
        if (spec.name === "ZOOMALL") {
          this.runZoomAll();
          this.command = null;
          this.setPrompt(READY_PROMPT);
          return;
        }
        if (spec.name === "PURGE") {
          void this.sendGroup("PURGE", [{ op_id: this.newOpId(), type: "purge" }]);
          this.command = null;
          this.setPrompt("Purged 0 blocks, 0 layers.");
          return;
        }
        if (spec.name === "LAYER") {
          this.command = null;
          this.focusPanel("Layers");
          return;
        }
        if (spec.name === "FIND") {
          this.command = null;
          this.openFind();
          return;
        }
        this.setPrompt(this.currentStage() ?? READY_PROMPT);
        return;
      }
      this.enterStage(text);
    }
    focusPanel(name) {
      const body = this.panelBodies.get(name);
      const header = body?.parentElement?.querySelector(".panel-header");
      if (header instanceof HTMLElement) header.focus();
    }
    cancelCommand() {
      this.command = null;
      this.stageIndex = 0;
      this.stageInputs = [];
      this.points = [];
      this.commandCancelled = true;
      this.setPrompt(CANCELLED_PROMPT);
      this.commandInput?.focus();
    }
    advanceCommand(world) {
      const stage = this.currentStage();
      if (!stage) return;
      if (this.command?.name === "LINE" && this.stageIndex >= 1) {
        this.points.push(world);
        this.lastPoint = world;
        if (this.points.length >= 2) {
          const from = this.points[this.points.length - 2];
          void this.sendGroup("LINE", [{ op_id: this.newOpId(), type: "add", entity: { type: "line", layer: this.currentLayerName(), x1: from.x, y1: from.y, x2: world.x, y2: world.y } }]);
        }
        this.setPrompt(this.currentStage() ?? READY_PROMPT);
        return;
      }
      this.enterStagePoint(world);
    }
    enterStagePoint(world) {
      if (!this.command) return;
      this.stageInputs.push(world);
      this.lastPoint = world;
      this.stageIndex += 1;
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      if (this.stageIndex >= this.command.stages.length) this.finishCommand();
    }
    enterStage(text) {
      if (!this.command) return;
      const stage = this.currentStage();
      if (!stage) return;
      if (text.trim() === "") {
        if (this.pickEndsStage()) return;
        this.stageIndex += 1;
        this.setPrompt(this.currentStage() ?? READY_PROMPT);
        if (this.stageIndex >= this.command.stages.length) this.finishCommand();
        return;
      }
      if (text.trim().toUpperCase() === "U" && this.stageIndex > 0) {
        this.stepBack();
        return;
      }
      if (this.command.name === "LINE" && this.stageIndex >= 1) {
        const point = parsePoint(text, this.lastPoint);
        if (!point) {
          this.setPrompt(REFUSALS.notPoint);
          return;
        }
        this.points.push(point);
        this.lastPoint = point;
        if (this.points.length >= 2) {
          const from = this.points[this.points.length - 2];
          void this.sendGroup("LINE", [{ op_id: this.newOpId(), type: "add", entity: { type: "line", layer: this.currentLayerName(), x1: from.x, y1: from.y, x2: point.x, y2: point.y } }]);
        }
        this.setPrompt(this.currentStage() ?? READY_PROMPT);
        return;
      }
      if (stage.includes("point") || stage.includes("corner") || stage.includes("centre") || stage.includes("position") || stage.includes("side") || stage.includes("inside") || stage.includes("line")) {
        const point = parsePoint(text, this.lastPoint);
        if (!point) {
          this.setPrompt(REFUSALS.notPoint);
          return;
        }
        this.stageInputs.push(point);
        this.lastPoint = point;
        this.stageIndex += 1;
        this.setPrompt(this.currentStage() ?? READY_PROMPT);
        if (this.stageIndex >= this.command.stages.length) this.finishCommand();
        return;
      }
      const value = parseNumber(text);
      if (value === null) {
        this.setPrompt(REFUSALS.notNumber);
        return;
      }
      if (value <= 0 && stageRequiresPositive(stage)) {
        this.setPrompt(REFUSALS.notPositive);
        return;
      }
      this.stageInputs.push(value);
      this.stageIndex += 1;
      this.setPrompt(this.currentStage() ?? READY_PROMPT);
      if (this.stageIndex >= this.command.stages.length) this.finishCommand();
    }
    pickEndsStage() {
      const stage = this.currentStage();
      if (!stage) return false;
      if (stage.includes("pick entities") || stage.includes("pick block inserts") || stage.includes("picking")) {
        this.stageIndex += 1;
        this.setPrompt(this.currentStage() ?? READY_PROMPT);
        return true;
      }
      return false;
    }
    stepBack() {
      if (this.points.length) {
        this.points.pop();
        const previous = this.points[this.points.length - 1];
        if (previous) this.lastPoint = previous;
        this.setPrompt(this.currentStage() ?? READY_PROMPT);
        return;
      }
      if (this.stageIndex > 0) {
        this.stageIndex -= 1;
        this.stageInputs.pop();
        this.setPrompt(this.currentStage() ?? READY_PROMPT);
      }
    }
    finishCommand() {
      this.setPrompt(READY_PROMPT);
      this.command = null;
      this.stageIndex = 0;
      this.stageInputs = [];
      this.points = [];
      this.commandInput?.focus();
    }
    currentLayerName() {
      return this.state?.currentLayer ?? "0";
    }
    runZoomAll() {
      if (!this.state) return;
      const before = { ...this.view };
      this.view = zoomAll(this.state, this.paneWidth, this.paneHeight);
      this.updateDrawingRoot();
      if (!reducedMotion() && this.entityLayer?.parentElement) {
        this.entityLayer.parentElement.animate(
          [
            { transform: `translate(${before.panX}px, ${before.panY}px) scale(${before.zoom})` },
            { transform: `translate(${this.view.panX}px, ${this.view.panY}px) scale(${this.view.zoom})` }
          ],
          { id: "zoom-all", duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }
        );
      }
      this.renderEntities();
    }
    // -----------------------------------------------------------------
    // Operations, offline queue, undo
    // -----------------------------------------------------------------
    newOpId() {
      this.optimisticCounter += 1;
      return `op_${Date.now().toString(36)}_${this.optimisticCounter}_${Math.random().toString(36).slice(2, 8)}`;
    }
    async sendGroup(command, ops) {
      if (!this.state) return;
      const group = {
        group_id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        command,
        base_revision: this.state.revision,
        ops
      };
      if (this.offline) {
        this.pendingGroups.push(group);
        for (const op of ops) applyOpToState(this.state, op);
        this.updateConnection();
        this.renderEntities();
        this.renderPanels();
        return;
      }
      const { status, data } = await this.api("POST", `/api/drawings/${this.drawingId}/ops`, group);
      if (status === 200) {
        for (const result of data.results ?? []) {
          if (result.message) this.toast(result.message);
        }
        const revision = data.revision;
        if (typeof revision === "number") this.state.revision = revision;
      } else {
        const message = data.message;
        if (message) this.toast(message);
      }
      await this.refresh();
    }
    async refresh() {
      const { status, data } = await this.api("GET", `/api/drawings/${this.drawingId}`);
      if (status === 200 && this.state) {
        this.state = drawingFromApi(data);
        this.renderEntities();
        this.renderPanels();
      }
    }
    async undo(redo) {
      const { status, data } = await this.api("POST", `/api/drawings/${this.drawingId}/${redo ? "redo" : "undo"}`, {});
      if (status === 409) {
        const message = data.message;
        if (message) {
          this.setPrompt(message);
          this.toast(message);
        }
        this.commandInput?.focus();
        return;
      }
      if (status === 200) {
        const command = data.command ?? "";
        this.setPrompt(`${redo ? "Redo" : "Undo"}: ${command}`);
        this.announce(`${redo ? "Redo" : "Undo"}: ${command}`);
        await this.refresh();
      }
      this.commandInput?.focus();
    }
    setOffline(off) {
      this.offline = off;
      if (off) {
        this.socket?.close();
        this.socket = null;
      } else {
        void this.sendQueue();
        this.openSocket();
      }
      this.updateConnection();
    }
    updateConnection() {
      if (!this.connectionStatus) return;
      if (this.offline) {
        const count = this.pendingGroups.length;
        this.connectionStatus.textContent = count ? `You're working offline. ${count} ${count === 1 ? "change" : "changes"} waiting.` : "You're working offline. 0 changes waiting.";
        return;
      }
      this.connectionStatus.textContent = this.socket && this.socket.readyState === 1 ? "Live" : "Reconnecting\u2026";
    }
    async sendQueue() {
      if (!this.pendingGroups.length) return;
      const groups = [...this.pendingGroups];
      let conflicts = 0;
      let sent = 0;
      for (const group of groups) {
        const { status, data } = await this.api("POST", `/api/drawings/${this.drawingId}/ops`, group);
        if (status === 200) {
          sent += 1;
          const results = data.results ?? [];
          if (results.some((result) => result.status !== "applied")) conflicts += 1;
          this.pendingGroups = this.pendingGroups.filter((pending) => pending.group_id !== group.group_id);
        }
      }
      await this.refresh();
      if (this.connectionStatus) {
        this.connectionStatus.textContent = `Back online: ${sent} ${sent === 1 ? "change" : "changes"} sent, ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}.`;
      }
      window.setTimeout(() => this.updateConnection(), this.settings.toastMs);
    }
    // -----------------------------------------------------------------
    // Live channel and presence
    // -----------------------------------------------------------------
    openSocket() {
      if (this.offline) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/drawings/${this.drawingId}/live`);
      this.socket = socket;
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "hello", since: this.socketSeq }));
        this.updateConnection();
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (typeof message.seq === "number" && message.seq > this.socketSeq) this.socketSeq = message.seq;
        this.applyLiveMessage(message.type, message.data);
      });
      socket.addEventListener("close", () => {
        this.updateConnection();
        if (!this.offline && this.socket === socket) window.setTimeout(() => this.openSocket(), 500);
      });
    }
    sendPresence(world) {
      if (!this.socket || this.socket.readyState !== 1) return;
      this.socket.send(JSON.stringify({ type: "view", x: world.x, y: world.y, zoom: this.view.zoom, pan_x: this.view.panX, pan_y: this.view.panY }));
    }
    applyLiveMessage(type, data) {
      switch (type) {
        case "ops":
          void this.refreshAfterOps(data);
          break;
        case "presence":
          this.applyPresence(data);
          break;
        case "notice":
          this.toast(String(data.message ?? ""));
          break;
        case "version":
        case "xref_version":
        case "review":
          void this.loadVersions();
          break;
        case "markup":
        case "issue":
        case "rfi":
          void this.loadIssues();
          void this.loadVersions();
          break;
        case "role":
          this.applyRoleChange(data);
          break;
        case "link":
        case "export":
          break;
      }
    }
    async refreshAfterOps(data) {
      const author = String(data.author ?? "");
      const command = String(data.command ?? "");
      const results = data.results ?? [];
      const handles = results.flatMap((result) => result.handles ?? []);
      if (author && author !== this.me) {
        if (handles.length === 1 && (command.startsWith("Undo") || command.startsWith("Redo"))) {
          this.announce(`${author} changed 1 entity`);
        } else if (handles.length === 1) {
          this.announce(`${author} moved ${handles[0]}`);
        } else if (handles.length > 1) {
          this.announce(`${author} changed ${handles.length} entities`);
        }
      }
      await this.refresh();
    }
    applyPresence(data) {
      const usernames = data.usernames ?? [];
      const cursor = data.cursor;
      const view = data.view;
      const ordered = [...new Set(usernames)].sort();
      const taken = /* @__PURE__ */ new Set();
      for (const name of ordered) {
        let index = 1;
        while (taken.has(index)) index += 1;
        taken.add(index);
        const existing = this.presence.get(name);
        this.presence.set(name, { colour: index, x: existing?.x ?? 0, y: existing?.y ?? 0 });
      }
      for (const name of [...this.presence.keys()]) {
        if (!ordered.includes(name)) this.presence.delete(name);
      }
      if (cursor) {
        const entry = this.presence.get(cursor.username);
        if (entry) {
          entry.x = cursor.x;
          entry.y = cursor.y;
        }
      }
      if (view && this.following === view.username) {
        this.view.zoom = view.zoom;
        this.view.panX = view.pan_x;
        this.view.panY = view.pan_y;
      }
      this.renderPeople();
      this.renderCursors();
    }
    renderPeople() {
      if (!this.peopleList) return;
      this.peopleList.replaceChildren();
      for (const [name, entry] of this.presence) {
        const item = el("li", {}, el("span", { text: name, style: `color:${PRESENCE_COLOURS[entry.colour]}` }));
        const follow = el("button", { text: `Follow ${name}` });
        follow.addEventListener("click", () => {
          this.following = name;
        });
        item.append(follow);
        this.peopleList.append(item);
      }
    }
    renderCursors() {
      if (!this.cursorLayer) return;
      this.cursorLayer.replaceChildren();
      for (const [name, entry] of this.presence) {
        const screen = toScreen(this.view, { x: entry.x, y: entry.y });
        const colour = PRESENCE_COLOURS[entry.colour];
        const cross = svgEl("path", { d: `M ${screen.x - 8} ${screen.y} L ${screen.x + 8} ${screen.y} M ${screen.x} ${screen.y - 8} L ${screen.x} ${screen.y + 8}`, stroke: colour, "stroke-width": "1", fill: "none", class: "remote-crosshair", "data-username": name, "data-colour": String(entry.colour), "data-x": String(entry.x), "data-y": String(entry.y) });
        const label = svgEl("text", { x: String(screen.x + 10), y: String(screen.y + 4), class: "remote-cursor-label", "data-username": name });
        label.textContent = name;
        this.cursorLayer.append(cross, label);
      }
    }
    applyRoleChange(data) {
      const username = String(data.username ?? "");
      if (username === this.me) {
        const role = data.role;
        if (role === null) {
          this.root.replaceChildren(el("div", { class: "surface note" }, el("p", { text: "You no longer have access to this drawing." })));
          this.socket?.close();
          return;
        }
        this.toast(`Your role is now ${role}.`);
        this.drawingStage?.focus();
      }
      void this.loadVersions();
      void this.loadIssues();
    }
    stopFollowing() {
      if (this.following) this.following = null;
    }
    // -----------------------------------------------------------------
    // Data loading
    // -----------------------------------------------------------------
    async loadVersions() {
      if (!this.state) return;
      const all = [];
      for (const sheet of this.state.sheets) {
        const { status, data } = await this.api("GET", `/api/sheets/${sheet.id}/versions`);
        if (status === 200) {
          for (const version of data.versions) all.push({ ...version, sheet_id: sheet.id, sheet_name: sheet.name });
        }
      }
      this.versions = all;
      this.renderVersions();
    }
    async loadIssues() {
      const { status, data } = await this.api("GET", `/api/drawings/${this.drawingId}/issues`);
      if (status !== 200) return;
      this.issues = data.issues;
      for (const issue of this.issues) {
        for (const rfiId of issue.rfi_ids ?? []) {
          if (!this.rfis[rfiId]) {
            const rfi = await this.api("GET", `/api/rfis/${rfiId}`);
            if (rfi.status === 200) this.rfis[rfiId] = rfi.data;
          }
        }
      }
      this.renderIssues();
    }
    // -----------------------------------------------------------------
    // Panels
    // -----------------------------------------------------------------
    renderPanels() {
      this.renderEntitiesPanel();
      this.renderLayersPanel();
      this.renderProperties();
      this.renderParameters();
      this.renderXrefs();
    }
    renderEntitiesPanel() {
      const body = this.panelBodies.get("Entities");
      if (!body || !this.state) return;
      const grid = el("div", { role: "grid", "aria-label": "Entities", "aria-rowcount": String(this.state.order.length) });
      const table = el("table", { class: "panel-table" });
      for (const row of this.entityRows()) table.append(row);
      grid.append(table);
      body.replaceChildren(grid);
    }
    entityRows() {
      if (!this.state) return [];
      const ordered = [...this.state.order];
      const rows = [];
      ordered.forEach((handle, index) => {
        const entity = this.state?.entities[handle];
        if (!entity) return;
        const label = entityLabel(entity, { dim_styles: this.state?.dimStyles ?? {}, entities: this.state?.entities ?? {} });
        const row = el("tr", { role: "row", "aria-rowindex": String(index + 1), "aria-selected": this.selection.has(handle) ? "true" : "false", tabindex: "0", "data-handle": handle });
        row.append(el("td", { class: "row-label", role: "gridcell", title: label, text: label }));
        row.addEventListener("click", () => {
          this.selection = /* @__PURE__ */ new Set([handle]);
          this.renderEntities();
          this.renderPanels();
        });
        row.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const nextIndex = event.key === "ArrowDown" ? Math.min(index + 1, ordered.length - 1) : Math.max(index - 1, 0);
            const rowsList = row.parentElement ? [...row.parentElement.children] : [];
            rowsList[nextIndex]?.focus();
            const nextHandle = ordered[nextIndex];
            if (nextHandle) {
              this.selection = /* @__PURE__ */ new Set([nextHandle]);
              this.renderEntities();
            }
          } else if (event.key === " ") {
            event.preventDefault();
            if (this.selection.has(handle)) this.selection.delete(handle);
            else this.selection.add(handle);
            row.setAttribute("aria-selected", this.selection.has(handle) ? "true" : "false");
            this.renderEntities();
          } else if (event.key === "Enter") {
            event.preventDefault();
            this.panToEntity(handle);
          }
        });
        rows.push(row);
      });
      return rows;
    }
    panToEntity(handle) {
      const entity = this.state?.entities[handle];
      if (!entity) return;
      const box = entityBounds(entity);
      const margin = 48 / this.view.zoom;
      const width = Math.max(box.maxX - box.minX, 1e-6) + margin * 2;
      const height = Math.max(box.maxY - box.minY, 1e-6) + margin * 2;
      const zoom = clamp(Number(Math.min(this.view.zoom, Math.min(this.paneWidth / width, this.paneHeight / height)).toFixed(4)), 0.05, 50);
      this.view.zoom = zoom;
      const centreX = (box.minX + box.maxX) / 2;
      const centreY = (box.minY + box.maxY) / 2;
      this.view.panX = Number((this.paneWidth / 2 - centreX * zoom).toFixed(4));
      this.view.panY = Number((this.paneHeight / 2 + centreY * zoom).toFixed(4));
      this.renderEntities();
    }
    renderLayersPanel() {
      const body = this.panelBodies.get("Layers");
      if (!body || !this.state) return;
      const grid = el("div", { role: "grid", "aria-label": "Layer list" });
      const rows = el("div", { class: "layer-rows" });
      const names = Object.keys(this.state.layers).filter((name) => !name.includes("|")).sort();
      for (const name of names) rows.append(this.layerRow(name));
      grid.append(rows);
      const current = el("select", { "aria-label": "Current layer" });
      for (const name of names) {
        const option = el("option", { value: name, text: name });
        if (name === this.state.currentLayer) option.setAttribute("selected", "true");
        current.append(option);
      }
      current.addEventListener("change", () => {
        const value = current.value;
        if (this.state?.layers[value]?.frozen) {
          this.toast("Frozen layers can\u2019t be current.");
          return;
        }
        if (this.state) this.state.currentLayer = value;
      });
      const newLayer = el("button", { text: "New layer" });
      newLayer.addEventListener("click", () => {
        const name = window.prompt("Layer name");
        if (name) void this.sendGroup("LAYER", [{ op_id: this.newOpId(), type: "layer_add", name, colour: "white", linetype: "Continuous", lineweight: 0.25, on: true, frozen: false, locked: false }]);
      });
      const saveState = el("button", { text: "Save layer state" });
      saveState.addEventListener("click", () => {
        const name = window.prompt("Layer state name");
        if (name) void this.sendGroup("LAYERSTATE", [{ op_id: this.newOpId(), type: "layer_state_save", name }]);
      });
      const statesList = el("ul", { role: "list", "aria-label": "Layer states" });
      for (const state of this.state.layerStates) {
        const restore = el("button", { text: "Restore" });
        restore.addEventListener("click", () => void this.sendGroup("LAYERSTATE", [{ op_id: this.newOpId(), type: "layer_state_restore", name: state.name }]));
        statesList.append(el("li", {}, el("span", { text: state.name }), restore));
      }
      body.replaceChildren(grid, el("div", { class: "property-row" }, el("span", { class: "property-name", text: "Current layer" }), current), el("div", { class: "review-buttons" }, newLayer, saveState), statesList);
    }
    layerRow(name) {
      if (!this.state) return el("div");
      const layer = this.state.layers[name];
      const row = el("div", { class: "layer-row", "data-layer": name });
      const on = el("button", { text: "On", "aria-pressed": layer.on ? "true" : "false" });
      on.addEventListener("click", () => void this.sendGroup("LAYER", [{ op_id: this.newOpId(), type: "layer_set", name, set: { on: !layer.on } }]));
      const frozen = el("button", { text: "Frozen", "aria-pressed": layer.frozen ? "true" : "false" });
      frozen.addEventListener("click", () => void this.sendGroup("LAYER", [{ op_id: this.newOpId(), type: "layer_set", name, set: { frozen: !layer.frozen } }]));
      const locked = el("button", { text: "Locked", "aria-pressed": layer.locked ? "true" : "false" });
      locked.addEventListener("click", () => void this.sendGroup("LAYER", [{ op_id: this.newOpId(), type: "layer_set", name, set: { locked: !layer.locked } }]));
      const colour = el("select", { "aria-label": "Colour" });
      for (const value of ["white", "red", "yellow", "green", "cyan", "blue", "magenta", "grey"]) {
        const option = el("option", { value, text: value });
        if (value === layer.colour) option.setAttribute("selected", "true");
        colour.append(option);
      }
      colour.addEventListener("change", () => void this.sendGroup("LAYER", [{ op_id: this.newOpId(), type: "layer_set", name, set: { colour: colour.value } }]));
      const linetype = el("select", { "aria-label": "Linetype" });
      for (const value of ["Continuous", "Dashed", "Dotted", "Centre"]) {
        const option = el("option", { value, text: value });
        if (value === layer.linetype) option.setAttribute("selected", "true");
        linetype.append(option);
      }
      linetype.addEventListener("change", () => void this.sendGroup("LAYER", [{ op_id: this.newOpId(), type: "layer_set", name, set: { linetype: linetype.value } }]));
      const lineweight = el("select", { "aria-label": "Lineweight" });
      for (const value of [0.13, 0.18, 0.25, 0.35, 0.5, 0.7]) {
        const option = el("option", { value: String(value), text: `${value} mm` });
        if (value === layer.lineweight) option.setAttribute("selected", "true");
        lineweight.append(option);
      }
      lineweight.addEventListener("change", () => void this.sendGroup("LAYER", [{ op_id: this.newOpId(), type: "layer_set", name, set: { lineweight: Number(lineweight.value) } }]));
      row.append(el("span", { class: "layer-name", text: name }), on, frozen, locked, colour, linetype, lineweight);
      if (name !== "0") {
        const remove = el("button", { text: "Delete" });
        remove.addEventListener("click", () => void this.sendGroup("LAYER", [{ op_id: this.newOpId(), type: "layer_delete", name }]));
        row.append(remove);
      }
      return row;
    }
    renderProperties() {
      const body = this.panelBodies.get("Properties");
      if (!body || !this.state) return;
      const selected = [...this.selection].map((handle) => this.state?.entities[handle]).filter((entity) => Boolean(entity));
      const rows = [];
      const lengths = selected.map((entity) => lengthOf(entity)).filter((value) => value !== null);
      const areas = selected.map((entity) => areaOf(entity)).filter((value) => value !== null);
      const propertyRow = (name, values) => {
        const varies = values.length > 1 && values.some((value) => Math.abs(value - values[0]) > 1e-3);
        return el(
          "div",
          { class: "property-row" },
          el("span", { class: "property-name", text: name }),
          el("span", { class: "property-value", text: varies ? "*VARIES*" : values.length ? trimZeros(values[0].toFixed(3)) : "" })
        );
      };
      if (lengths.length) rows.push(propertyRow("Length", lengths));
      if (areas.length) rows.push(propertyRow("Area", areas));
      for (const entity of selected) {
        if (entity.type === "insert") {
          for (const [tag, value] of Object.entries(entity.attributes)) {
            const input = el("input", { type: "text", value, "aria-label": tag });
            input.addEventListener("change", () => void this.sendGroup("PROPERTIES", [{ op_id: this.newOpId(), type: "modify", handle: entity.handle, set: { attributes: { ...entity.attributes, [tag]: input.value } } }]));
            rows.push(el("div", { class: "property-row" }, el("span", { class: "property-name", text: tag }), input));
          }
        }
      }
      body.replaceChildren(...rows);
    }
    renderParameters() {
      const body = this.panelBodies.get("Parameters");
      if (!body || !this.state) return;
      const grid = el("div", { role: "grid", "aria-label": "Parameter list" });
      const table = el("table", { class: "panel-table" });
      table.append(el("tr", { role: "row" }, el("th", { text: "Name" }), el("th", { text: "Expression" }), el("th", { text: "Value" })));
      for (const parameter of this.state.parameters) {
        table.append(el(
          "tr",
          { role: "row" },
          el("td", { role: "gridcell", text: parameter.name }),
          el("td", { role: "gridcell", text: parameter.expression }),
          el("td", { role: "gridcell", text: "" })
        ));
      }
      grid.append(table);
      body.replaceChildren(grid);
    }
    renderXrefs() {
      const body = this.panelBodies.get("Xrefs");
      if (!body || !this.state) return;
      body.replaceChildren();
      for (const xref of this.state.xrefs) {
        const row = el("div", { class: "xref-row" });
        row.append(el("span", { text: xref.name }));
        const reload = el("button", { text: "Reload" });
        reload.addEventListener("click", () => void this.sendGroup("XRELOAD", [{ op_id: this.newOpId(), type: "xref_reload", name: xref.name }]));
        const clip = el("button", { text: "Clip" });
        clip.addEventListener("click", () => void this.sendGroup("XCLIP", [{ op_id: this.newOpId(), type: "xref_clip", name: xref.name, rect: null }]));
        const removeClip = el("button", { text: "Remove clip" });
        removeClip.addEventListener("click", () => void this.sendGroup("XCLIP", [{ op_id: this.newOpId(), type: "xref_clip", name: xref.name, rect: null }]));
        row.append(reload, clip, removeClip);
        body.append(row);
      }
      if (!this.state.xrefs.length) body.append(el("p", { class: "meta", text: "No xrefs." }));
    }
    async newSheet() {
      const name = window.prompt("Sheet name");
      if (!name || !this.state) return;
      const size = window.prompt("Sheet size: A3 or A4", "A3") ?? "A3";
      const { status, data } = await this.api("POST", `/api/drawings/${this.drawingId}/sheets`, { name, size });
      if (status === 201) {
        this.state.sheets.push(data);
        this.toast(`Sheet ${name} added.`);
      }
    }
    async publishSheet() {
      if (!this.state) return;
      const sheet = this.state.sheets[0];
      if (!sheet) {
        this.toast("Add a sheet first.");
        return;
      }
      this.setStorageNotice("Publishing\u2026");
      const { status, data } = await this.api("POST", `/api/sheets/${sheet.id}/versions`, {});
      if (status === 201) {
        this.setStorageNotice(`Published version ${data.number}.`);
        this.announce(`Published version ${data.number}.`);
        await this.loadVersions();
      } else {
        this.setStorageNotice(String(data.message ?? "Nothing was published."));
      }
    }
    setStorageNotice(text) {
      const node = this.root.querySelector(".storage-notice");
      if (!node) return;
      if (text === null) {
        node.hidden = true;
        node.textContent = "";
        return;
      }
      node.hidden = false;
      node.textContent = text;
      this.announce(text);
    }
    async openCompare() {
      this.compareOpen = true;
      this.renderCompare();
    }
    async openExportDialog() {
      this.openExport();
    }
    openImportDialog() {
      this.openImport();
    }
    openUnderlayDialog() {
      this.openUnderlay();
    }
    openFind() {
      this.openFindBar();
    }
    renderVersions() {
      const body = this.panelBodies.get("Versions");
      if (!body) return;
      body.replaceChildren();
      for (const version of this.versions) {
        const item = el("div", { class: "version-item" });
        item.append(el("span", { text: `v${version.number}` }), el("span", { class: "version-state", text: String(version.state ?? "") }));
        const startReview = el("button", { text: "Start review" });
        startReview.addEventListener("click", () => void this.reviewAct(String(version.id), "markup", "start"));
        const approve = el("button", { text: "Approve" });
        approve.addEventListener("click", () => void this.reviewAct(String(version.id), "markup", "approve"));
        const reject = el("button", { text: "Reject" });
        reject.addEventListener("click", () => void this.reviewAct(String(version.id), "markup", "reject"));
        const restore = el("button", { text: "Restore this version" });
        restore.addEventListener("click", () => void this.restoreVersion(String(version.id)));
        const createLink = el("button", { text: "Create view link" });
        createLink.addEventListener("click", () => void this.createLink(String(version.id)));
        item.append(startReview, approve, reject, restore, createLink);
        const steps = version.steps ?? [];
        for (const step of steps) {
          item.append(el("span", { class: "stamp", text: `${String(step.step)} ${String(step.state)}` }));
        }
        const stamps = version.stamps ?? [];
        for (const stamp of stamps) {
          item.append(el("span", { class: "stamp", text: String(stamp.kind ?? "") }));
        }
        body.append(item);
      }
      if (!this.versions.length) body.append(el("p", { class: "meta", text: "No versions." }));
    }
    renderIssues() {
      const body = this.panelBodies.get("Issues");
      if (!body) return;
      const list = el("ul", { role: "list", "aria-label": "Issue list" });
      for (const issue of this.issues) {
        const item = el("li", { class: "issue-item", role: "listitem" });
        const head = el("div", { class: "row-head" }, el("span", { text: String(issue.title) }), el("span", { class: "meta", text: String(issue.state) }));
        const createRfi = el("button", { text: "Create RFI" });
        createRfi.addEventListener("click", () => this.openNewRfi(String(issue.id)));
        const answer = el("button", { text: "Answer issue" });
        answer.addEventListener("click", () => void this.issueTransition(String(issue.id), "answered"));
        const close = el("button", { text: "Close issue" });
        close.addEventListener("click", () => void this.issueTransition(String(issue.id), "closed"));
        const reopen = el("button", { text: "Reopen issue" });
        reopen.addEventListener("click", () => void this.issueTransition(String(issue.id), "open"));
        item.append(head, el("div", { class: "review-buttons" }, createRfi, answer, close, reopen));
        for (const rfiId of issue.rfi_ids ?? []) {
          const rfi = this.rfis[rfiId];
          if (!rfi) continue;
          const article = el("article", { "aria-label": `RFI: ${String(rfi.question)}` });
          article.append(el("span", { text: String(rfi.question) }), el("span", { class: "rfi-state", text: ` ${String(rfi.state)} with ${String(rfi.ball_in_court)}` }));
          const answerInput = el("input", { type: "text", "aria-label": "RFI answer" });
          const send = el("button", { text: "Send RFI" });
          send.addEventListener("click", () => void this.rfiTransition(rfiId, "sent"));
          const answerRfi = el("button", { text: "Answer RFI" });
          answerRfi.addEventListener("click", () => void this.rfiTransition(rfiId, "answered", answerInput.value));
          const closeRfi = el("button", { text: "Close RFI" });
          closeRfi.addEventListener("click", () => void this.rfiTransition(rfiId, "closed"));
          const reopenRfi = el("button", { text: "Reopen RFI" });
          reopenRfi.addEventListener("click", () => void this.rfiTransition(rfiId, "sent"));
          article.append(el("div", { class: "rfi-form" }, answerInput), el("div", { class: "review-buttons" }, send, answerRfi, closeRfi, reopenRfi));
          item.append(article);
        }
        list.append(item);
      }
      body.replaceChildren(list);
    }
    async issueTransition(issueId, to) {
      const { status, data } = await this.api("POST", `/api/issues/${issueId}/transitions`, { to });
      if (status !== 200) {
        this.toast(String(data.message ?? "That transition is not allowed."));
        return;
      }
      await this.loadIssues();
    }
    async rfiTransition(rfiId, to, answer) {
      const { status, data } = await this.api("POST", `/api/rfis/${rfiId}/transitions`, answer === void 0 ? { to } : { to, answer });
      if (status !== 200) {
        this.toast(String(data.message ?? "That transition is not allowed."));
        return;
      }
      await this.loadIssues();
    }
    openNewRfi(issueId) {
      const question = el("input", { type: "text", "aria-label": "Question" });
      const addressee = el("select", { "aria-label": "Addressee" });
      for (const name of [...this.presence.keys()].sort()) {
        addressee.append(el("option", { value: name, text: name }));
      }
      const dialog = el("dialog", { "aria-label": "New RFI" });
      const form = el("form", {}, el("label", { text: "Question" }, question), el("label", { text: "Addressee" }, addressee));
      form.append(el("button", { type: "submit", text: "Save RFI", class: "primary" }));
      dialog.append(form);
      this.root.append(dialog);
      dialog.showModal();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const { status, data } = await this.api("POST", `/api/issues/${issueId}/rfis`, {
          question: question.value,
          addressee: addressee.value
        });
        if (status === 201) {
          dialog.close();
          dialog.remove();
          await this.loadIssues();
        } else {
          this.toast(String(data.message ?? "That RFI was not saved."));
        }
      });
    }
    async reviewAct(versionId, step, action) {
      if (action === "start") {
        const { status: status2, data: data2 } = await this.api("POST", `/api/versions/${versionId}/review`, {});
        if (status2 !== 201) {
          this.toast(String(data2.message ?? "That review was not started."));
          return;
        }
        await this.loadVersions();
        return;
      }
      const { status, data } = await this.api("POST", `/api/versions/${versionId}/review/${step}/${action}`, {});
      if (status !== 200) {
        this.toast(String(data.message ?? "That review action was refused."));
        return;
      }
      await this.loadVersions();
    }
    async restoreVersion(versionId) {
      const { status, data } = await this.api("POST", `/api/drawings/${this.drawingId}/ops`, {
        base_revision: this.state?.revision ?? 0,
        group_id: `g_restore_${Date.now().toString(36)}`,
        command: "RESTORE",
        ops: [{ op_id: this.newOpId(), type: "version_restore", version: versionId }]
      });
      if (status === 200) {
        await this.refresh();
      } else {
        this.toast(String(data.message ?? "That version was not restored."));
      }
    }
    async createLink(versionId) {
      const { status, data } = await this.api("POST", `/api/versions/${versionId}/links`, {});
      if (status === 201) {
        this.toast(`Link created: ${String(data.url ?? "")}`);
      }
    }
    compareOpen = false;
    renderCompare() {
      if (!this.compareOpen || !this.state) return;
      let controls = this.root.querySelector(".compare-controls");
      if (!controls) {
        controls = el("div", { class: "compare-controls" });
        const from = el("select", { "aria-label": "Earlier version" });
        const to = el("select", { "aria-label": "Later version" });
        const slider = el("input", { type: "range", min: "0", max: "100", value: "50", "aria-label": "Compare swipe" });
        const overlay = el("input", { type: "checkbox", role: "switch", "aria-label": "Overlay" });
        const counts = el("span", { class: "compare-counts", role: "status", "aria-live": "polite", text: "Added 0, removed 0, changed 0" });
        slider.addEventListener("input", () => this.setCompareSwipe(Number(slider.value)));
        slider.addEventListener("keydown", (event) => {
          const current = Number(slider.value);
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            this.setCompareSwipe(Math.max(0, current - 1));
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            this.setCompareSwipe(Math.min(100, current + 1));
          }
          if (event.key === "PageUp") {
            event.preventDefault();
            this.setCompareSwipe(Math.min(100, current + 10));
          }
          if (event.key === "PageDown") {
            event.preventDefault();
            this.setCompareSwipe(Math.max(0, current - 10));
          }
          if (event.key === "Home") {
            event.preventDefault();
            this.setCompareSwipe(0);
          }
          if (event.key === "End") {
            event.preventDefault();
            this.setCompareSwipe(100);
          }
        });
        overlay.addEventListener("change", () => this.setCompareOverlay(overlay.checked));
        from.addEventListener("change", () => void this.refreshCompare(from, to, counts));
        to.addEventListener("change", () => void this.refreshCompare(from, to, counts));
        controls.append(from, to, slider, overlay, counts);
        this.drawingStage?.append(controls);
        void this.refreshCompare(from, to, counts);
      }
    }
    compareSwipeValue = 50;
    setCompareSwipe(value) {
      this.compareSwipeValue = value;
      const slider = this.root.querySelector('[aria-label="Compare swipe"]');
      if (slider) {
        slider.value = String(value);
        slider.setAttribute("aria-valuetext", `${value}% newer version`);
      }
      const divider = this.root.querySelector("[data-swipe-divider]");
      if (divider) {
        const previous = Number(divider.dataset.percent ?? "50");
        divider.dataset.percent = String(value);
        divider.style.left = `${value}%`;
        if (!reducedMotion() && previous !== value) {
          divider.animate([{ left: `${previous}%` }, { left: `${value}%` }], { id: "compare-swipe", duration: 120, easing: "ease-out", fill: "forwards" });
        }
      }
    }
    setCompareOverlay(value) {
      const divider = this.root.querySelector("[data-swipe-divider]");
      if (divider) divider.hidden = value;
    }
    async refreshCompare(from, to, counts) {
      if (!this.state) return;
      const sheetId = this.state.sheets[0]?.id;
      if (!sheetId) return;
      const versions = await this.api("GET", `/api/sheets/${sheetId}/versions`);
      if (versions.status !== 200) return;
      const numbers = versions.data.versions.map((version) => Number(version.number));
      from.replaceChildren();
      to.replaceChildren();
      for (const number of numbers) {
        from.append(el("option", { value: String(number), text: `v${number}` }));
        to.append(el("option", { value: String(number), text: `v${number}` }));
      }
      const latest = numbers[numbers.length - 1] ?? 1;
      const previous = numbers[numbers.length - 2] ?? latest;
      from.value = String(previous);
      to.value = String(latest);
      const compare = await this.api("GET", `/api/sheets/${sheetId}/compare?from=${previous}&to=${latest}`);
      if (compare.status === 200) {
        counts.textContent = `Added ${compare.data.added}, removed ${compare.data.removed}, changed ${compare.data.changed}`;
      }
    }
    openExport() {
      const dialog = el("dialog", { "aria-label": "Export" });
      const form = el(
        "form",
        {},
        el("label", { text: "Plotfold text" }, el("input", { type: "radio", name: "format", value: "plot.txt", checked: true })),
        el("label", { text: "SVG" }, el("input", { type: "radio", name: "format", value: "svg" }))
      );
      const start2 = el("button", { type: "submit", text: "Start export", class: "primary" });
      form.append(start2);
      dialog.append(form);
      const progressArea = el("div", { class: "export-progress" });
      dialog.append(progressArea);
      this.root.append(dialog);
      dialog.showModal();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const chosen = dialog.querySelector('input[name="format"]:checked')?.value ?? "plot.txt";
        const { status, data } = await this.api("POST", `/api/drawings/${this.drawingId}/exports`, { format: chosen });
        if (status !== 202) {
          this.setStorageNotice("Export failed: file storage is unavailable.");
          return;
        }
        this.setStorageNotice("Export started.");
        this.pollExport(String(data.id), progressArea, dialog);
      });
    }
    pollExport(exportId, area, dialog) {
      const progress = el("div", { role: "progressbar", "aria-label": "Export", "aria-valuemin": "0", "aria-valuemax": "100" });
      const bar = el("div", { class: "bar" }, el("div", { class: "fill", style: "width:0%" }));
      progress.append(bar);
      area.replaceChildren(progress);
      const tick = async () => {
        const { status, data } = await this.api("GET", `/api/exports/${exportId}`);
        if (status !== 200) {
          this.setStorageNotice("Export failed: file storage is unavailable.");
          const retry = el("button", { text: "Retry export" });
          retry.addEventListener("click", () => {
            void this.api("POST", `/api/exports/${exportId}/retry`, {}).then(() => this.pollExport(exportId, area, dialog));
          });
          area.replaceChildren(retry);
          return;
        }
        const value = Number(data.progress ?? 0);
        bar.firstElementChild?.setAttribute("style", `width:${value}%`);
        progress.setAttribute("aria-valuenow", String(value));
        if (data.state === "ready") {
          const link = el("a", { text: "Download export", href: `/api/exports/${exportId}/download` });
          area.replaceChildren(progress, el("div", {}, link));
          this.setStorageNotice("Export ready.");
          return;
        }
        if (data.state === "failed") {
          this.setStorageNotice("Export failed: file storage is unavailable.");
          const retry = el("button", { text: "Retry export" });
          retry.addEventListener("click", () => {
            void this.api("POST", `/api/exports/${exportId}/retry`, {}).then(() => this.pollExport(exportId, area, dialog));
          });
          area.replaceChildren(progress, retry);
          return;
        }
        window.setTimeout(() => void tick(), 200);
      };
      void tick();
    }
    openImport() {
      const dialog = el("dialog", { "aria-label": "Import preview" });
      const file = el("input", { type: "file", "aria-label": "Drawing text file" });
      const body = el("div", {});
      dialog.append(el("label", { text: "File" }, file), body);
      this.root.append(dialog);
      dialog.showModal();
      file.addEventListener("change", async () => {
        const input = file;
        const selected = input.files?.[0];
        if (!selected) return;
        const bytes = new Uint8Array(await selected.arrayBuffer());
        this.setStorageNotice("Reading file\u2026");
        const { status, data } = await this.api("POST", `/api/drawings/${this.drawingId}/imports`, bytes);
        if (status === 201) {
          const adds = data.adds;
          const renames = data.renames ?? [];
          const preview = el("p", { text: `Adds ${adds?.entities ?? 0} entities, ${adds?.layers ?? 0} layers, ${adds?.blocks ?? 0} blocks.` });
          body.replaceChildren(preview);
          for (const rename of renames) {
            body.append(el("p", { text: `${rename.from} renamed ${rename.to}` }));
          }
          const merge = el("button", { text: "Merge", class: "primary" });
          const cancel = el("button", { text: "Cancel" });
          merge.addEventListener("click", async () => {
            const result = await this.api("POST", `/api/drawings/${this.drawingId}/merge`, { import_id: data.import_id });
            if (result.status === 200) {
              this.setStorageNotice(`Imported ${adds?.entities ?? 0} entities.`);
              dialog.close();
              dialog.remove();
              await this.refresh();
            }
          });
          cancel.addEventListener("click", () => {
            dialog.close();
            dialog.remove();
          });
          body.append(el("div", { class: "dialog-actions" }, merge, cancel));
          return;
        }
        if (status === 422) {
          const lines = data.lines ?? [];
          const list = el("ul", { class: "import-errors", role: "list", "aria-label": "Import errors" });
          for (const line2 of lines) list.append(el("li", { text: line2 }));
          body.replaceChildren(list);
          return;
        }
        this.setStorageNotice(String(data.message ?? "Nothing was imported."));
      });
    }
    openUnderlay() {
      const dialog = el("dialog", { "aria-label": "Add underlay" });
      const file = el("input", { type: "file", "aria-label": "Image file", accept: "image/png,image/jpeg" });
      const first = el("input", { type: "text", "aria-label": "First corner", placeholder: "0,0" });
      const opposite = el("input", { type: "text", "aria-label": "Opposite corner", placeholder: "100,100" });
      const form = el(
        "form",
        {},
        el("label", { text: "Image file" }, file),
        el("label", { text: "First corner" }, first),
        el("label", { text: "Opposite corner" }, opposite)
      );
      form.append(el("button", { type: "submit", text: "Attach", class: "primary" }));
      dialog.append(form);
      this.root.append(dialog);
      dialog.showModal();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const selected = file.files?.[0];
        if (!selected) return;
        const bytes = new Uint8Array(await selected.arrayBuffer());
        this.setStorageNotice("Uploading\u2026");
        const one = parsePoint(first.value, { x: 0, y: 0 });
        const two = parsePoint(opposite.value, { x: 0, y: 0 });
        const { status, data } = await this.api("POST", `/api/drawings/${this.drawingId}/underlays?x1=${one?.x ?? 0}&y1=${one?.y ?? 0}&x2=${two?.x ?? 0}&y2=${two?.y ?? 0}`, bytes);
        if (status === 201 || status === 200) {
          this.setStorageNotice("Underlay attached.");
          dialog.close();
          dialog.remove();
          await this.refresh();
        } else {
          this.setStorageNotice(String(data.message ?? "Nothing was added."));
        }
      });
    }
    openFindBar() {
      let bar = this.root.querySelector(".find-bar");
      if (bar) {
        bar.querySelector("input")?.focus();
        return;
      }
      bar = el("div", { class: "find-bar", role: "search", "aria-label": "Find" });
      const input = el("input", { type: "search", "aria-label": "Find text", placeholder: "Find" });
      const count = el("span", { role: "status", "aria-live": "polite", text: "No matches." });
      const next = el("button", { text: "Next match" });
      next.addEventListener("click", () => this.findNext());
      bar.append(input, count, next);
      this.drawingStage?.append(bar);
      input.focus();
      input.addEventListener("input", () => {
        const text = input.value;
        this.updateFindMatches(text, count);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.findNext();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          bar?.remove();
          this.commandInput?.focus();
        }
      });
    }
    findMatches = [];
    findIndex = -1;
    updateFindMatches(text, count) {
      if (!this.state) return;
      const needle = text.trim().toLowerCase();
      if (!needle) {
        this.findMatches = [];
        this.findIndex = -1;
        count.textContent = "No matches.";
        return;
      }
      this.findMatches = this.state.order.filter((handle2) => {
        const entity = this.state?.entities[handle2];
        if (!entity) return false;
        if (handle2.toLowerCase() === needle) return true;
        const layer = this.state?.layers[entity.layer];
        if (layer && layer.name.toLowerCase() === needle) return true;
        if (entity.type === "insert" && entity.block.toLowerCase() === needle) return true;
        return false;
      });
      if (!this.findMatches.length) {
        count.textContent = "No matches.";
        return;
      }
      this.findIndex = 0;
      const handle = this.findMatches[0];
      this.selection = /* @__PURE__ */ new Set([handle]);
      this.panToEntity(handle);
      count.textContent = `1 of ${this.findMatches.length}`;
      this.renderEntities();
      this.renderPanels();
    }
    findNext() {
      if (!this.findMatches.length) return;
      this.findIndex = (this.findIndex + 1) % this.findMatches.length;
      const handle = this.findMatches[this.findIndex];
      this.selection = /* @__PURE__ */ new Set([handle]);
      this.panToEntity(handle);
      const count = this.root.querySelector('.find-bar [role="status"]');
      if (count) count.textContent = `${this.findIndex + 1} of ${this.findMatches.length}`;
      this.renderEntities();
      this.renderPanels();
    }
  };
  function stageRequiresPositive(stage) {
    return stage.includes("radius") || stage.includes("factor") || stage.includes("count") || stage.includes("rows") || stage.includes("columns") || stage.includes("distance");
  }

  // src/client/review.ts
  var ReviewScreen = class extends DrawingScreenCore {
    versionId;
    isViewLink;
    constructor(drawingId, versionId, api2, me2, settings2, options = {}) {
      super(drawingId, api2, me2, settings2, true);
      this.versionId = versionId;
      this.isViewLink = options.viewLink ?? false;
    }
    async load() {
      const path = this.isViewLink ? `/api/links/${this.versionId}` : `/api/versions/${this.versionId}`;
      const { status, data } = await this.api("GET", path);
      if (status === 410 || status === 404) {
        const message = String(data.message ?? "This link has expired.");
        this.root.replaceChildren(el("div", { class: "surface note" }, el("p", { text: message })));
        return;
      }
      if (status === 401) {
        window.location.href = "/signin";
        return;
      }
      if (status !== 200) {
        this.root.replaceChildren(el("div", { class: "surface note" }, el("p", { text: "We couldn\u2019t find that version." })));
        return;
      }
      const snapshot = data.snapshot;
      const entities = snapshot?.model?.entities ?? {};
      const order = snapshot?.model?.order ?? Object.keys(entities);
      this.state = {
        id: this.drawingId,
        name: `Version ${data.number ?? ""}`,
        folderId: String(data.sheet_id ?? ""),
        role: "view",
        revision: 0,
        nextHandle: 1,
        layers: snapshot?.model?.layers ?? {},
        entities,
        order,
        blocks: {},
        dimStyles: {},
        parameters: [],
        constraints: [],
        xrefs: [],
        layerStates: [],
        currentLayer: "0",
        underlays: [],
        sheets: []
      };
      this.versions = [{ ...data }];
      this.view = this.fitView(order, entities);
      this.renderAll();
      this.renderVersions();
      this.renderIssues();
      if (!this.isViewLink) {
        this.openSocket();
        await this.loadIssues();
      } else {
        this.openLinkSocket();
      }
    }
    fitView(order, entities) {
      if (!order.length) return { zoom: 1, panX: this.paneWidth / 2, panY: this.paneHeight / 2 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const handle of order) {
        const entity = entities[handle];
        if (!entity) continue;
        const box = boxOf(entity);
        minX = Math.min(minX, box.minX);
        minY = Math.min(minY, box.minY);
        maxX = Math.max(maxX, box.maxX);
        maxY = Math.max(maxY, box.maxY);
      }
      if (!Number.isFinite(minX)) return { zoom: 1, panX: this.paneWidth / 2, panY: this.paneHeight / 2 };
      const width = Math.max(maxX - minX, 1e-6);
      const height = Math.max(maxY - minY, 1e-6);
      const zoom = Math.max(0.05, Math.min(50, Math.min((this.paneWidth - 48) / width, (this.paneHeight - 48) / height)));
      const centreX = (minX + maxX) / 2;
      const centreY = (minY + maxY) / 2;
      return { zoom: Number(zoom.toFixed(4)), panX: Number((this.paneWidth / 2 - centreX * zoom).toFixed(4)), panY: Number((this.paneHeight / 2 + centreY * zoom).toFixed(4)) };
    }
    openLinkSocket() {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/links/${this.versionId}/live`);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "link" && message.data?.expired) {
          this.root.replaceChildren(el("div", { class: "surface note" }, el("p", { text: "This link has expired." })));
          socket.close();
        }
        if (message.type === "link" && message.data?.revoked) {
          this.root.replaceChildren(el("div", { class: "surface note" }, el("p", { text: "This link was turned off." })));
          socket.close();
        }
      });
    }
  };
  function boxOf(entity) {
    switch (entity.type) {
      case "line":
        return { minX: Math.min(entity.x1, entity.x2), minY: Math.min(entity.y1, entity.y2), maxX: Math.max(entity.x1, entity.x2), maxY: Math.max(entity.y1, entity.y2) };
      case "circle":
        return { minX: entity.cx - entity.r, minY: entity.cy - entity.r, maxX: entity.cx + entity.r, maxY: entity.cy + entity.r };
      case "arc":
        return { minX: entity.cx - entity.r, minY: entity.cy - entity.r, maxX: entity.cx + entity.r, maxY: entity.cy + entity.r };
      case "pline": {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const point of entity.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
        return { minX, minY, maxX, maxY };
      }
      case "insert":
        return { minX: entity.x, minY: entity.y, maxX: entity.x, maxY: entity.y };
      case "hatch":
        return { minX: entity.seed_x, minY: entity.seed_y, maxX: entity.seed_x, maxY: entity.seed_y };
      case "dimension":
        return { minX: entity.text_x, minY: entity.text_y, maxX: entity.text_x, maxY: entity.text_y };
    }
  }

  // src/client/main.ts
  var settings = { toastMs: 5e3, domMarginPx: 200, domCeiling: 500 };
  var api = async (method, path, body) => {
    const options = { method, credentials: "same-origin" };
    if (body instanceof Uint8Array) {
      options.body = body;
    } else if (body !== void 0) {
      options.body = JSON.stringify(body);
      options.headers = { "content-type": "application/json" };
    }
    const response = await fetch(path, options);
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("json") ? await response.json() : await response.text();
    return { status: response.status, data };
  };
  async function loadSettings() {
    const { status, data } = await api("GET", "/api/client-settings");
    if (status === 200) {
      const received = data;
      settings.toastMs = Number(received.toast_ms ?? settings.toastMs);
      settings.domMarginPx = Number(received.dom_margin_px ?? settings.domMarginPx);
      settings.domCeiling = Number(received.dom_ceiling ?? settings.domCeiling);
    }
  }
  async function me() {
    const { status, data } = await api("GET", "/api/me");
    return status === 200 ? String(data.username ?? "") : null;
  }
  var context = { navigate, api, me: null };
  function navigate(path) {
    window.history.pushState({}, "", path);
    void render(path);
  }
  async function render(path) {
    const root = document.getElementById("root");
    if (!root) return;
    const pathname = path.split("?")[0];
    if (pathname === "/" || pathname === "") {
      root.replaceChildren(landingPage(context));
      return;
    }
    if (pathname === "/register") {
      root.replaceChildren(registerPage(context));
      return;
    }
    if (pathname === "/signin") {
      root.replaceChildren(signInPage(context));
      return;
    }
    if (pathname === "/folders") {
      context.me = await me();
      if (!context.me) {
        navigate("/signin");
        return;
      }
      root.replaceChildren(await foldersPage(context));
      return;
    }
    if (pathname.startsWith("/v/")) {
      const token = pathname.slice("/v/".length);
      const screen = new ReviewScreen("", token, api, null, settings, { viewLink: true });
      root.replaceChildren(screen.root);
      await screen.load();
      return;
    }
    const versionsMatch = /^\/versions\/([^/]+)$/.exec(pathname);
    if (versionsMatch) {
      context.me = await me();
      if (!context.me) {
        navigate("/signin");
        return;
      }
      const versionId = decodeURIComponent(versionsMatch[1]);
      const version = await api("GET", `/api/versions/${versionId}`);
      if (version.status !== 200) {
        root.replaceChildren(notAvailablePage("We couldn\u2019t find that version."));
        return;
      }
      const drawingId = String(version.data.drawing_id ?? "");
      const screen = new ReviewScreen(drawingId, versionId, api, context.me, settings);
      root.replaceChildren(screen.root);
      await screen.load();
      return;
    }
    const drawingMatch = /^\/drawings\/([^/]+)$/.exec(pathname);
    if (drawingMatch) {
      context.me = await me();
      if (!context.me) {
        navigate("/signin");
        return;
      }
      const drawingId = decodeURIComponent(drawingMatch[1]);
      const screen = new DrawingScreen(drawingId, api, context.me, settings, false);
      root.replaceChildren(screen.root);
      await screen.load();
      return;
    }
    root.replaceChildren(notFoundPage());
  }
  var DrawingScreen = class extends DrawingScreenCore {
    // The concrete screen wires the panel bodies for the phone and tablet strips.
    panelBody(name) {
      return this.panelBodies.get(name) ?? el("div");
    }
  };
  window.addEventListener("popstate", () => {
    void render(window.location.pathname);
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("#")) return;
    event.preventDefault();
    navigate(href);
  });
  async function start() {
    await loadSettings();
    await render(window.location.pathname);
  }
  void start();
})();
