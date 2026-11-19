/* Membership page: keyboard-complete Checkout dialog (DP-35, DP-47). */
"use strict";
(() => {
  const basicBtn = document.getElementById("subscribeBasic");
  const maxBtn = document.getElementById("subscribeMax");
  const dialog = document.getElementById("checkoutDialog");
  const card = document.getElementById("cardNumber");
  const payBtn = document.getElementById("payBtn");
  const retryBtn = document.getElementById("tryAgainBtn");
  const status = document.getElementById("paymentStatus");
  const title = document.getElementById("checkoutTitle");
  if (!dialog) return;

  let tier = "basic";
  let tierName = "Basic";
  let running = false;
  let opener = null;
  let idemKey = null;

  function spin(on) {
    if (on) {
      const span = document.createElement("span");
      span.className = "spinner";
      status.textContent = "";
      status.append(span, document.createTextNode("Processing payment"));
    } else {
      status.textContent = status.textContent.replace("Processing payment", "");
    }
  }

  function openDialog(tierId, name, btn) {
    tier = tierId;
    tierName = name;
    opener = btn;
    idemKey = null;
    title.textContent = `${name} — Checkout`;
    card.value = "";
    status.textContent = "";
    payBtn.disabled = false;
    payBtn.hidden = false;
    retryBtn.hidden = true;
    dialog.showModal();
    card.focus();
  }

  function closeDialog() {
    dialog.close();
    if (opener) opener.focus();
  }

  function trapFocus(e) {
    if (!dialog.open) return;
    const focusables = dialog.querySelectorAll("button:not([hidden]), input, [tabindex]:not([tabindex='-1'])");
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.key === "Tab" && !e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.key === "Tab" && e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  }

  async function pay() {
    if (running) return;
    if (!HUB.state.token) {
      location.href = "/login?next=" + encodeURIComponent("/membership");
      return;
    }
    running = true;
    payBtn.disabled = true;
    retryBtn.hidden = true;
    if (!idemKey) idemKey = "chk-" + HUB.randomId();
    spin(true);
    try {
      const resp = await fetch("/api/membership/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + HUB.state.token,
          "Idempotency-Key": idemKey,
        },
        body: JSON.stringify({ tier, card_number: card.value }),
      });
      const data = await resp.json();
      running = false;
      payBtn.disabled = false;
      if (resp.ok) {
        status.textContent = "";
        const mark = document.createElement("span");
        mark.className = "check-mark";
        mark.textContent = "✓";
        status.append(mark, document.createTextNode(`You are now on ${tierName}.`));
        payBtn.hidden = true;
        retryBtn.hidden = false;
        retryBtn.textContent = "Close";
        retryBtn.focus();
      } else if (resp.status === 402) {
        status.textContent = `Your card was declined. You are still on ${tierName === "Basic" ? "Free" : "Free"}.`;
        payBtn.hidden = true;
        retryBtn.hidden = false;
        retryBtn.textContent = "Try again";
        retryBtn.focus();
        idemKey = null;
      } else if (resp.status === 409) {
        status.textContent = "You are already on this tier.";
        payBtn.hidden = true;
        retryBtn.hidden = false;
        retryBtn.textContent = "Close";
        retryBtn.focus();
      } else {
        status.textContent = "Payment could not be completed. Check your connection and try again.";
        payBtn.hidden = true;
        retryBtn.hidden = false;
        retryBtn.textContent = "Try again";
        retryBtn.focus();
        idemKey = null;
      }
    } catch (err) {
      running = false;
      payBtn.disabled = false;
      status.textContent = "Payment could not be completed. Check your connection and try again.";
      payBtn.hidden = true;
      retryBtn.hidden = false;
      retryBtn.textContent = "Try again";
      retryBtn.focus();
      idemKey = null;
    }
  }

  if (basicBtn) basicBtn.addEventListener("click", () => openDialog("basic", "Basic", basicBtn));
  if (maxBtn) maxBtn.addEventListener("click", () => openDialog("max", "Max", maxBtn));
  payBtn.addEventListener("click", pay);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); pay(); }
  });
  retryBtn.addEventListener("click", () => {
    if (retryBtn.textContent === "Try again") {
      idemKey = null;
      payBtn.hidden = false;
      payBtn.disabled = false;
      retryBtn.hidden = true;
      card.focus();
    } else {
      closeDialog();
    }
  });
  dialog.addEventListener("keydown", (e) => {
    trapFocus(e);
    if (e.key === "Escape" && !running) {
      e.preventDefault();
      closeDialog();
    }
  });
  const q = document.getElementById("q1");
  if (q) q.addEventListener("click", () => {
    const open = q.getAttribute("aria-expanded") === "true";
    q.setAttribute("aria-expanded", String(!open));
    document.getElementById("a1").hidden = open;
  });
})();
