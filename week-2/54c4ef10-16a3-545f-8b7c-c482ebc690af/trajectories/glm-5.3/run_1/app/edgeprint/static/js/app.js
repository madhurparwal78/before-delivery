/* The router and the working screens. */
"use strict";

(function () {
  const E = window.Edgeprint;
  const S = E.screens;
  const { el, $, fmtSigned, fmtPlain, fmtBias, DASH, MINUS, ROMAN,
          previewText, Api, roundHalfAway } = Object.assign({}, E, E.ui || {});
  const UI = E.ui;
  const announce = UI.announce;

  let me = null;
  let storageDown = false;

  async function render() {
    const root = $("#root");
    root.textContent = "";
    const path = location.pathname;
    try {
      const response = await fetch("/api/me", { credentials: "same-origin" });
      me = response.ok ? await response.json() : null;
    } catch (error) { me = null; }
    try {
      const body = await Api.get("/api/storage");
      storageDown = body.storage !== "ok";
    } catch (error) { storageDown = false; }

    if (path === "/" || (!me && (path === "/signin" || path === "/signup"))) {
      if (path === "/") { root.append(S.renderLanding(me)); return; }
      root.append(...UI.shell(S.authScreen(path === "/signin" ? "signin" : "signup"),
                              me, storageDown));
      return;
    }
    if (!me) {
      const target = path + (location.search || "");
      location.href = `/signin?next=${encodeURIComponent(target)}`;
      return;
    }
    if (path === "/signin" || path === "/signup") { location.href = "/archive"; return; }
    if (path === "/archive") return archiveScreen(root);
    if (path === "/log") return window.Edgeprint.logscreen.logScreen(root);
    if (path === "/curves") return curvesScreen(root);
    if (path === "/rolls/new") return rollForm(root, null);
    const rollMatch = path.match(/^\/rolls\/([0-9a-f-]+)$/);
    if (rollMatch) return window.Edgeprint.rollscreen.rollScreen(root, rollMatch[1]);
    const editMatch = path.match(/^\/rolls\/([0-9a-f-]+)\/edit$/);
    if (editMatch) return rollForm(root, editMatch[1]);
    const scanMatch = path.match(/^\/rolls\/([0-9a-f-]+)\/scans\/([0-9a-f-]+)$/);
    if (scanMatch) return window.Edgeprint.workspace.workspaceScreen(root, scanMatch[1], scanMatch[2]);
    notFound(root);
  }

  function notFound(root) {
    root.append(...UI.shell([
      el("section", { style: "padding:2rem 0" }, [
        S.blankPrint(),
        el("p", { text: "Not in your archive." }),
        el("a", { class: "btn", href: "/archive", text: "Archive" }),
      ]),
    ], me, storageDown));
  }

  // ---------- archive ----------

  const ARRANGEMENTS = [
    { start: 1, span: 5, drop: 0 }, { start: 7, span: 4, drop: 200 },
    { start: 2, span: 3, drop: 120 }, { start: 6, span: 5, drop: 0 },
    { start: 1, span: 4, drop: 200 }, { start: 8, span: 3, drop: 120 },
    { start: 3, span: 5, drop: 0 }, { start: 1, span: 3, drop: 200 },
    { start: 5, span: 4, drop: 120 }, { start: 9, span: 4, drop: 0 },
  ];

  async function archiveScreen(root) {
    const { rolls } = await Api.get("/api/rolls");
    const list = el("ul", { class: "rolls", "aria-label": "Rolls" });
    if (!rolls.length) {
      root.append(...UI.shell([
        el("h1", { text: "Archive" }),
        el("p", { text: "Your archive is empty. Start a roll before you shoot." }),
        el("a", { class: "btn", href: "/rolls/new", text: "New roll" }),
      ], me, storageDown));
      return;
    }
    rolls.forEach((roll, index) => {
      const arrangement = ARRANGEMENTS[index % ARRANGEMENTS.length];
      const item = el("li", { class: "roll" });
      item.style.gridColumn = `${arrangement.start} / span ${arrangement.span}`;
      item.style.setProperty("--drop", arrangement.drop + "px");
      const print = el("div", { class: "print" });
      const meta = el("div", { class: "meta" }, [
        el("a", { href: `/rolls/${roll.id}`, text: roll.name }),
        el("span", { text: `${roll.stock} · EI ${roll.ei}` }),
        el("span", { text: roll.state }),
        el("span", { class: "tabular", text: UI.countersLine(roll.counters) }),
      ]);
      if (roll.strongest_frame_id) {
        strongestCanvas(roll).then((canvas) => print.append(canvas));
      } else {
        print.append(S.blankPrint(roll.format === "35mm" ? 3 / 2 : 1));
        const scansResponse = (roll.state === "logging" && !roll.counters.detected);
        if (scansResponse) {
          item.append(el("span", { class: "meta", text: "No strips yet." }));
        }
      }
      item.append(print, meta);
      list.append(item);
    });
    root.append(...UI.shell([
      el("div", { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem" }, [
        el("h1", { text: "Archive" }),
        el("a", { class: "btn", href: "/rolls/new", text: "New roll" }),
      ]),
      list,
    ], me, storageDown));
  }

  async function strongestCanvas(roll) {
    const frameId = roll.strongest_frame_id;
    const response = await Api.get(`/api/frames/${frameId}`);
    const scanId = response.frame.scan_id;
    return S.negativeCanvas(`/api/scans/${scanId}/preview/0`,
                            response.frame.x0, response.frame.x1, 0, 4 / 5);
  }

  // ---------- roll form ----------

  async function rollForm(root, rollId) {
    let roll = null;
    let testRolls = [];
    const rollsBody = await Api.get("/api/rolls");
    testRolls = rollsBody.rolls.filter((r) => r.kind === "test");
    if (rollId) roll = await Api.get(`/api/rolls/${rollId}`);
    const name = el("input", { id: "name", required: true, value: roll ? roll.name : "" });
    const stock = el("input", { id: "stock", required: true, value: roll ? roll.stock : "" });
    const format = el("select", { id: "format", disabled: !!roll },
      ["35mm", "120 6×6", "120 6×7"].map((label, i) =>
        el("option", { value: ["35mm", "120-6x6", "120-6x7"][i],
                       selected: roll ? roll.format === ["35mm", "120-6x6", "120-6x7"][i] : i === 0,
                       text: label })));
    const ei = el("input", { id: "ei", type: "number", value: roll ? roll.ei : 400,
                             min: 6, max: 12800, step: 1 });
    const push = el("input", { id: "push_pull", type: "number", value: roll ? roll.push_pull : 0,
                               min: -3, max: 3, step: 1 });
    const reciprocity = el("input", { id: "reciprocity_p", type: "number",
                                     value: roll ? roll.reciprocity_p.toFixed(2) : "1.00",
                                     min: 0.5, max: 1, step: 0.01 });
    const devNote = el("textarea", { id: "development_note", rows: 3,
                                     text: roll ? roll.development_note : "" });
    const kindNormal = el("input", { type: "radio", name: "kind", id: "kind_normal",
                                     checked: !roll || roll.kind === "normal" });
    const kindTest = el("input", { type: "radio", name: "kind", id: "kind_test",
                                   checked: roll && roll.kind === "test",
                                   disabled: !!roll });
    kindNormal.disabled = !!roll;
    const curveSelect = el("select", { id: "curve_roll_id" });
    curveSelect.append(el("option", { value: "", text: "None" }));
    for (const test of testRolls) {
      curveSelect.append(el("option", { value: test.id, text: test.name,
        selected: roll && roll.curve_roll_id === test.id }));
    }
    const isNormal = () => kindNormal.checked;
    const syncCurve = () => { curveSelect.disabled = !isNormal() || !!roll; };
    kindNormal.addEventListener("change", syncCurve);
    kindTest.addEventListener("change", syncCurve);
    syncCurve();

    const errors = {};
    const errorFor = (key) => el("div", { class: "field-error hidden", "data-error": key });

    const form = el("form", { class: "form", onsubmit: async (event) => {
      event.preventDefault();
      announce("Saving roll…");
      const payload = {
        name: name.value, stock: stock.value, ei: parseInt(ei.value, 10),
        push_pull: parseInt(push.value, 10) || 0,
        reciprocity_p: parseFloat(reciprocity.value),
        development_note: devNote.value,
      };
      if (!roll) {
        payload.format = format.value;
        payload.kind = kindTest.checked ? "test" : "normal";
        if (kindNormal.checked && curveSelect.value) payload.curve_roll_id = curveSelect.value;
      } else {
        if (kindNormal.checked) payload.curve_roll_id = curveSelect.value || null;
      }
      try {
        const saved = roll ? await Api.patch(`/api/rolls/${roll.id}`, payload)
                           : await Api.post("/api/rolls", payload);
        announce("Roll saved.");
        history.pushState({}, "", `/rolls/${saved.id}`);
        render();
      } catch (error) {
        handleValidation(error, form);
      }
    } }, [
      el("label", { for: "name", text: "Roll name" }), name, errorFor("name"),
      el("label", { for: "stock", text: "Stock" }), stock, errorFor("stock"),
      el("label", { for: "format", text: "Format" }), format,
      el("div", { class: "row" }, [
        el("div", {}, [el("label", { for: "ei", text: "EI" }), ei, errorFor("ei")]),
        el("div", {}, [el("label", { for: "push_pull", text: "Push or pull" }), push,
                       errorFor("push_pull")]),
      ]),
      el("label", { for: "reciprocity_p", text: "Reciprocity exponent" }), reciprocity,
      errorFor("reciprocity_p"),
      el("label", { for: "development_note", text: "Development note" }), devNote,
      errorFor("development_note"),
      el("fieldset", { class: "row" }, [
        el("label", {}, [kindNormal, el("span", { text: " Normal roll" })]),
        el("label", {}, [kindTest, el("span", { text: " Test roll" })]),
      ]),
      errorFor("kind"),
      el("label", { for: "curve_roll_id", text: "Curve from test roll" }),
      curveSelect, errorFor("curve_roll_id"),
      el("button", { class: "btn", type: "submit",
                     text: roll ? "Save roll" : "Create roll" }),
    ]);
    root.append(...UI.shell([
      el("h1", { text: roll ? `Edit ${roll.name}` : "New roll" }),
      el("a", { href: `/rolls/${roll.id}`, text: "Back to roll" }),
      form,
    ], me, storageDown));
  }

  function handleValidation(error, form) {
    if (error && error.fields) {
      for (const key of Object.keys(error.fields)) {
        const slot = form.querySelector(`[data-error="${key}"]`);
        const field = form.querySelector(`#${key}`);
        if (slot) { slot.textContent = error.fields[key]; slot.classList.remove("hidden"); }
        if (field) field.setAttribute("aria-invalid", "true");
      }
      announce(Object.values(error.fields)[0]);
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
    } else if (error && error.message) {
      announce(error.message);
    }
  }

  async function curvesScreen(root) {
    const rolls = (await Api.get("/api/rolls")).rolls;
    const tests = rolls.filter((roll) => roll.kind === "test");
    const nodes = [el("h1", { text: "Curves" })];
    if (!tests.length) nodes.push(el("p", { text: "No test rolls yet." }));
    for (const test of tests) {
      const body = await Api.get(`/api/rolls/${test.id}/curve`);
      const section = el("section", { class: "panel", role: "region",
                                      "aria-label": `Curve for ${test.name}` }, [
        el("h2", { text: test.name }),
      ]);
      if (!body.ready) {
        section.append(el("p", {
          text: `Needs at least 7 aligned bracket frames spanning 6 stops ` +
                 `(now ${body.frames_used} frames, ${fmtPlain(body.stops_span, 1)} stops).` }));
      } else {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 400 220");
        svg.setAttribute("width", "100%");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        path.setAttribute("points", body.points.map((p) =>
          `${((p.log_h || 0) + 3) * 40},${200 - (p.net || 0) * 120}`).join(" "));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "rgb(244,217,108)");
        path.setAttribute("stroke-width", "2");
        svg.append(path);
        section.append(el("figure", { class: "curve" }, [svg]), el("div", { class: "tabular" }, [
          el("p", { text: body.base_fog === null ? `Base + fog ${DASH}`
                    : `Base + fog ${fmtPlain(body.base_fog, 2)}` }),
          el("p", { text: body.speed_point_log_h === null ? `Speed point log H ${DASH}`
                    : `Speed point log H ${fmtSigned(body.speed_point_log_h, 2)}` }),
          el("p", { text: body.contrast_index === null ? `Contrast index ${DASH}`
                    : `Contrast index ${fmtPlain(body.contrast_index, 2)}` }),
          el("p", { text: `Frames used ${body.frames_used}` }),
          el("p", { text: `Span ${fmtPlain(body.stops_span, 1)} stops` }),
        ]));
      }
      nodes.push(section);
    }
    root.append(...UI.shell(nodes, me, storageDown));
  }

  window.onpopstate = render;
  window.Edgeprint.app = { render, notFound, archiveScreen, rollForm, handleValidation,
                           me: null, storageDown: false, getMe: () => me,
                           isStorageDown: () => storageDown };
  window.Edgeprint.app.render = render;
  document.addEventListener("DOMContentLoaded", async () => {
    await E.loadApertures();
    render();
  });
})();
