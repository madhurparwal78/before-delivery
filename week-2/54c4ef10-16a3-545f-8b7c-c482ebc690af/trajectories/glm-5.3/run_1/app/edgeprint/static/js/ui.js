/* Rendering, routing and the screens. */
"use strict";

(function () {
  const E = window.Edgeprint;
  const { el, $, fmtSigned, fmtPlain, fmtBias, DASH, ROMAN,
          previewText, Api } = E;

  let activityTimer = null;

  function announce(message) {
    const status = $("#activity");
    if (!status) return;
    status.textContent = "";
    window.clearTimeout(activityTimer);
    activityTimer = window.setTimeout(() => { status.textContent = message; }, 30);
  }

  // ---------- shell ----------

  function shell(content, me, storageDown) {
    const bar = el("header", { class: "topbar" }, [
      el("div", {}, [
        el("a", { class: "wordmark", href: "/", text: "Edgeprint" }),
        el("nav", { "aria-label": "Main", role: "navigation" }, [
          el("a", { href: "/archive", text: "Archive" }),
          el("a", { href: "/curves", text: "Curves" }),
          el("a", { href: "/log", text: "Log" }),
        ]),
      ]),
      me ? el("button", { class: "btn", text: "Sign out", onclick: async () => {
        announce("Signing out…");
        await Api.signout();
        sessionStorage.clear();
        localStorage.clear();
        location.href = "/";
      } }) : null,
    ]);
    const nodes = [bar];
    if (storageDown) nodes.push(storageBanner());
    nodes.push(el("div", { id: "activity", class: "status-live", role: "status",
                          "aria-live": "polite", "aria-label": "Activity" }));
    nodes.push(el("main", { class: "wrap", id: "main" }, content));
    return nodes;
  }

  function navWrapper(children) {
    const nav = el("nav", { "aria-label": "Main" });
    for (const child of children) nav.append(child);
    nav.setAttribute("role", "navigation");
    return nav;
  }

  function storageBanner() {
    return el("div", { class: "banner", role: "alert", id: "storage-banner" }, [
      el("span", { text: "Negative storage is unreachable. Uploads and new readings are paused; your notes, alignments and pinned readings are still here." }),
      el("button", { class: "btn", text: "Check again", onclick: async () => {
        const body = await Api.get("/api/storage");
        if (body.storage === "ok") render();
        else announce("Storage is unreachable. Nothing was stored; try again when it is back.");
      } }),
    ]);
  }

  // ---------- view helpers ----------

  const countersLine = (c) => `Detected ${c.detected} · Aligned ${c.aligned} · Unexposed ${c.unexposed} · Unmatched notes ${c.unmatched_notes}`;

  function counterNodes(c) {
    const wrap = el("span", { class: "counters" });
    for (const [label, value] of [["Detected", c.detected], ["Aligned", c.aligned],
                                  ["Unexposed", c.unexposed], ["Unmatched notes", c.unmatched_notes]]) {
      wrap.append(el("span", { class: "tabular", text: `${label} ${value}` }));
    }
    return wrap;
  }

  function signedOffset(value) {
    if (value === 0) return "0";
    return (value > 0 ? "+" : E.MINUS) + Math.abs(value);
  }

  window.Edgeprint.ui = {
    shell, announce, countersLine, counterNodes, signedOffset,
    storageBanner, previewText, navWrapper, render: () => window.Edgeprint.app.render(),
  };
})();
