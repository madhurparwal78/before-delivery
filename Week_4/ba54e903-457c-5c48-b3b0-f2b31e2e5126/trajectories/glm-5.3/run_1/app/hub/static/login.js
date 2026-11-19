/* Login: next path, landing history, session-ended alert (DP-46, DP-92). */
"use strict";
(() => {
  const form = document.getElementById("loginForm");
  const alert = document.getElementById("loginAlert");
  const email = document.getElementById("loginEmail");
  const password = document.getElementById("loginPassword");
  const submit = document.getElementById("loginSubmit");
  const registerLink = document.getElementById("loginRegisterLink");
  if (!form) return;

  // Return paths: encode next exactly as encodeURIComponent does.
  function currentNext() {
    const raw = new URLSearchParams(location.search).get("next") || "";
    if (!raw) return "";
    if (!raw.startsWith("/") || raw[1] === "/" || raw[1] === "\\" || raw.includes("\\")) return "";
    for (const ch of raw) {
      const code = ch.charCodeAt(0);
      if (code <= 0x1F || code === 0x7F) return "";
    }
    return raw;
  }

  const next = currentNext();
  if (next) {
    if (registerLink) registerLink.href = "/register?next=" + encodeURIComponent(next);
  }
  if (new URLSearchParams(location.search).get("ended") === "1") {
    alert.textContent = "Your session has ended. Log in again.";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = "Logging in…";
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
      const data = await resp.json();
      if (resp.ok) {
        HUB.setToken(data.access_token, data.user.id);
        sessionStorage.removeItem("hub_drafts_other_member");
        const target = next || "/servers";
        // A successful login replaces the form's history entry.
        history.replaceState({}, "", target);
        location.href = target;
      } else if (resp.status === 429) {
        alert.textContent = "Too many sign-in attempts. Try again later.";
        password.value = "";
      } else {
        alert.textContent = "That email and password do not match.";
        password.value = "";
      }
    } catch (err) {
      alert.textContent = "Something went wrong. Try again.";
      password.value = "";
    }
    submit.disabled = false;
    submit.textContent = "Log in";
  });
})();
