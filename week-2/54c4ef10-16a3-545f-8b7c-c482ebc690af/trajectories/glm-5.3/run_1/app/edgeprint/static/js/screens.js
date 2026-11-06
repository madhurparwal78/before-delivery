/* Screens: landing, auth, archive, roll, workspace, curves, log. */
"use strict";

(function () {
  const E = window.Edgeprint;
  const { el, $, fmtSigned, fmtPlain, fmtBias, DASH, MINUS, ROMAN,
          previewText, Api, announce, counterNodes, signedOffset } =
    Object.assign({}, window.Edgeprint, window.Edgeprint.ui || {});
  const UI = window.Edgeprint.ui;

  // ---------- procedural prints ----------

  function blankPrint(ratio) {
    const canvas = el("canvas", { class: "dimmed", role: "img",
                                  "aria-label": "Negative print" });
    const width = 480;
    const height = Math.round(width / (ratio || 4 / 5));
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    const tint = (code) => `rgb(${Math.round(19 + (244 - 19) * code / 255)},` +
      `${Math.round(54 + (217 - 54) * code / 255)},` +
      `${Math.round(33 + (108 - 33) * code / 255)})`;
    for (let y = 0; y < height; y += 6) {
      for (let x = 0; x < width; x += 6) {
        const code = 18 + ((x * 7 + y * 13) % 17);
        ctx.fillStyle = tint(code);
        ctx.fillRect(x, y, 6, 6);
      }
    }
    ctx.fillStyle = tint(230);
    ctx.font = "16px Host Grotesk";
    ctx.fillText("24", 24, height - 24);
    for (let y = 26; y < height - 20; y += 30) {
      ctx.fillStyle = tint(120);
      ctx.beginPath();
      ctx.arc(12, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.arc(width - 12, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    return canvas;
  }

  function wedgePrint() {
    const canvas = el("canvas", { class: "dimmed", role: "img",
                                  "aria-label": "Step wedge print" });
    canvas.width = 480; canvas.height = 480;
    const ctx = canvas.getContext("2d");
    const tint = (code) => `rgb(${Math.round(19 + (244 - 19) * code / 255)},` +
      `${Math.round(54 + (217 - 54) * code / 255)},` +
      `${Math.round(33 + (108 - 33) * code / 255)})`;
    for (let k = 0; k < 21; k++) {
      ctx.fillStyle = tint(12 + k * 11);
      ctx.fillRect(10 + k * 22, 60, 22, 360);
    }
    return canvas;
  }

  function negativeCanvas(url, x0, x1, height, ratio) {
    /* The frame crop, tinted gold-on-green; previews are never linearised. */
    const canvas = el("canvas", { role: "img", "aria-label": "Negative print" });
    const targetWidth = 480;
    const targetHeight = Math.round(targetWidth / (ratio || 4 / 5));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    const image = new Image();
    image.onload = () => {
      const sourceX = Math.max(0, x0 || 0);
      const sourceWidth = Math.max(1, (x1 || image.width) - sourceX);
      const scale = image.width / Math.max(1, x1 || image.width);
      ctx.drawImage(image, sourceX * scale, 0, sourceWidth * scale, image.height,
                     0, 0, targetWidth, targetHeight);
      const pixels = ctx.getImageData(0, 0, targetWidth, targetHeight);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const v = pixels.data[i];
        pixels.data[i] = Math.round(19 + (244 - 19) * v / 255);
        pixels.data[i + 1] = Math.round(54 + (217 - 54) * v / 255);
        pixels.data[i + 2] = Math.round(33 + (108 - 33) * v / 255);
      }
      ctx.putImageData(pixels, 0, 0);
    };
    image.src = url;
    return canvas;
  }

  // ---------- landing ----------

  async function renderLanding(root, me) {
    const signedIn = !!me;
    const printArea = el("div", { class: "print print-large" });
    if (signedIn && me.latest_aligned_frame) {
      printArea.append(negativeCanvas(
        `/api/scans/${me.latest_aligned_frame.scan_id}/preview/0`,
        me.latest_aligned_frame.x0, me.latest_aligned_frame.x1, 0, 4 / 5));
    } else {
      printArea.append(blankPrint(4 / 5));
    }
    const hero = el("div", { class: "hero" }, [
      el("div", { class: "hero-bar" }, [
        el("a", { class: "wordmark", href: "/", text: "Edgeprint" }),
        el("nav", { "aria-label": "Main" }, [
          el("a", { href: "/archive", text: "Archive" }),
          el("a", { href: "/curves", text: "Curves" }),
          el("a", { href: "/log", text: "Log" }),
        ]),
        el("a", { class: "btn", href: signedIn ? "/archive" : "/signin",
                  text: "Open archive" }),
      ]),
      printArea,
      el("div", { class: "print print-small" }, [wedgePrint()]),
      el("h1", { class: "headline", text: "Every frame, back with its notes." }),
      el("p", { class: "sentence",
                text: "Density read from the negative, not guessed from the print." }),
    ]);
    root.append(hero);
  }

  // ---------- auth ----------

  function authScreen(mode) {
    const params = new URLSearchParams(location.search);
    const next = params.get("next") || "";
    const error = el("div", { class: "field-error hidden" });
    const email = el("input", { type: "email", id: "email", name: "email",
                                "aria-label": "Email", autocomplete: "email" });
    const password = el("input", { type: "password", id: "password", name: "password",
                                   "aria-label": "Password", autocomplete: "current-password" });
    const form = el("form", { class: "form", onsubmit: async (event) => {
      event.preventDefault();
      const path = mode === "signin" ? "/api/auth/signin" : "/api/auth/signup";
      announce(mode === "signin" ? "Signing in…" : "Creating account…");
      const response = await fetch(path, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        announce(body.message || "Email or password is wrong.");
        error.textContent = body.message || "Email or password is wrong.";
        error.classList.remove("hidden");
        return;
      }
      const draft = sessionStorage.getItem("edgeprint_draft");
      const target = draft || safeTarget(next);
      sessionStorage.removeItem("edgeprint_draft");
      location.href = target;
    } }, [
      el("label", { for: "email", text: "Email" }), email, el("div"),
      el("label", { for: "password", text: "Password" }), password, el("div"),
      error,
      el("button", { class: "btn", type: "submit",
                     text: mode === "signin" ? "Sign in" : "Create account" }),
      el("p", {}, [
        el("a", { href: linkTo(mode, next), text: mode === "signin"
          ? "Create an account" : "Sign in instead" }),
      ]),
    ]);
    return el("section", { class: "wrap", style: "max-width:32rem" }, [
      el("h1", { text: mode === "signin" ? "Sign in" : "Create account" }), form,
    ]);
  }

  function linkTo(mode, next) {
    const other = mode === "signin" ? "signup" : "signin";
    return next ? `/${other}?next=${encodeURIComponent(next)}` : `/${other}`;
  }

  function safeTarget(next) {
    if (!next) return "/archive";
    let value = decodeURIComponent(next);
    try { value = decodeURIComponent(value); } catch (e) { return "/archive"; }
    if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
      return "/archive";
    for (const ch of value) if (ch.charCodeAt(0) <= 31 || ch.charCodeAt(0) === 127)
      return "/archive";
    return value;
  }

  window.Edgeprint.screens = { renderLanding, authScreen, blankPrint, wedgePrint,
                               negativeCanvas, safeTarget };
})();
