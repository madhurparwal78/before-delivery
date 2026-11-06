/* Edgeprint client: routing, screens, exposure preview, loupe, uploads. */
"use strict";

(function () {
  const GROUND = [19, 54, 33];
  const INK = [244, 217, 108];
  const LOG_H_PER_STOP = 0.30103;
  // Filled from /api/config/apertures so the preview uses the server's one table.
  let APERTURES = [];

  // ---------- utilities ----------

  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, attrs, children) => {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "checked") node.defaultChecked = value;
        else if (key === "selected") node.defaultSelected = value;
        else if (key === "disabled") node.disabled = value;
        else if (key === "value") node.defaultValue = value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    if (children) for (const child of children) if (child) node.append(child);
    return node;
  };

  const roundHalfAway = (value, places) => {
    const scale = Math.pow(10, places);
    const scaled = value * scale;
    const floor = Math.floor(scaled);
    const frac = scaled - floor;
    let rounded;
    if (frac > 0.5) rounded = floor + 1;
    else if (frac < 0.5) rounded = floor;
    else rounded = value < 0 ? floor : floor + 1;
    return rounded / scale;
  };

  const MINUS = "\u2212";
  const fmtSigned = (value, places) => {
    const rounded = roundHalfAway(value, places);
    if (rounded === 0) return Number(0).toFixed(places);
    return (rounded > 0 ? "+" : MINUS) + Math.abs(rounded).toFixed(places);
  };
  const fmtPlain = (value, places) => roundHalfAway(value, places).toFixed(places);
  const fmtBias = (value) => {
    const rounded = roundHalfAway(value, 1);
    if (rounded === 0) return "0.0";
    return (rounded > 0 ? "+" : MINUS) + Math.abs(rounded).toFixed(1);
  };
  const ROMAN = ["0","I","II","III","IV","V","VI","VII","VIII","IX","X"];
  const DASH = "\u2014";

  const api = async (path, options) => {
    const response = await fetch(path, Object.assign({
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" }
    }, options || {}));
    if (response.status === 401) throw { status: 401 };
    return response;
  };

  // ---------- exposure maths (mirrors the server table) ----------

  function parseAperture(text) {
    if (typeof text !== "string") return null;
    let value = text.trim().toLowerCase();
    if (value.startsWith("f/")) value = value.slice(2);
    return APERTURES.indexOf(value) >= 0 ? value : null;
  }

  function parseShutter(text) {
    if (typeof text !== "string") return null;
    const value = text.trim();
    if (value.startsWith("/")) return null;
    if (value.endsWith('"')) {
      const seconds = /^\d+$/.test(value.slice(0, -1)) ? parseInt(value.slice(0, -1), 10) : null;
      return seconds >= 1 && seconds <= 3600 ? seconds : null;
    }
    if (value.indexOf("/") >= 0) {
      const parts = value.split("/");
      if (parts.length === 2 && /^1$/.test(parts[0]) &&
          /^\d+$/.test(parts[1]) && parseInt(parts[1], 10) >= 2 &&
          parseInt(parts[1], 10) <= 8000) return 1 / parseInt(parts[1], 10);
      return null;
    }
    if (/^\d+$/.test(value)) {
      const seconds = parseInt(value, 10);
      return seconds >= 1 && seconds <= 3600 ? seconds : null;
    }
    return null;
  }

  function relativeStops(meteredEv, ei, aperture, tSeconds, reciprocityP) {
    const nSquared = Math.pow(2, APERTURES.indexOf(aperture) / 3);
    const tEff = tSeconds > 1 ? Math.pow(tSeconds, reciprocityP) : tSeconds;
    return (meteredEv + Math.log2(ei / 100)) - Math.log2(nSquared) + Math.log2(tEff);
  }

  function previewText(roll, aperture, shutter, evText) {
    if (!roll) return DASH;
    const ap = parseAperture(aperture);
    const t = parseShutter(shutter);
    const ev = evText === "" || evText === null || evText === undefined ? null : parseFloat(evText);
    if (ap === null || t === null || ev === null || isNaN(ev) || ev < -6 || ev > 21) return DASH;
    const stops = relativeStops(ev, roll.ei, ap, t, Number(roll.reciprocity_p));
    return fmtSigned(stops, 2) + " stops \u00b7 log H " + fmtSigned(stops * LOG_H_PER_STOP, 2);
  }

  // ---------- API exposure ----------

  const Api = {
    async json(path, options) {
      const response = await api(path, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign({ status: response.status }, body);
      return body;
    },
    get(path) { return this.json(path); },
    post(path, body) { return this.json(path, { method: "POST", body: JSON.stringify(body || {}) }); },
    put(path, body) { return this.json(path, { method: "PUT", body: JSON.stringify(body || {}) }); },
    patch(path, body) { return this.json(path, { method: "PATCH", body: JSON.stringify(body || {}) }); },
    del(path) { return this.json(path, { method: "DELETE" }); },
    async signout() {
      await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" });
    },
  };

  window.Edgeprint = {
    $, el, roundHalfAway, fmtSigned, fmtPlain, fmtBias, MINUS, DASH, ROMAN,
    APERTURES, parseAperture, parseShutter, previewText, Api,
    GROUND, INK, LOG_H_PER_STOP,
    async loadApertures() {
      if (APERTURES.length) return APERTURES;
      try {
        const response = await fetch("/api/config/apertures",
                                    { credentials: "same-origin" });
        const body = await response.json();
        APERTURES = body.apertures;
        this.APERTURES = APERTURES;
      } catch (error) {
        APERTURES = [];
      }
      return APERTURES;
    },
  };
})();
