/* Shared chrome behaviour: unlock state, navigation, lock button. */

import { api, clearKey } from "./app.js";

const PUBLIC_PATHS = ["/unlock", "/s/"];

function isPublicPath() {
  return PUBLIC_PATHS.some((p) => location.pathname.startsWith(p));
}

/* Every private page sends an unlocked browser back to /unlock. */
export async function guard() {
  if (isPublicPath()) return null;
  try {
    const imager = await api("GET", "/api/me");
    return imager;
  } catch (err) {
    if (err.status === 401) {
      location.href = "/unlock";
      return null;
    }
    return null;
  }
}

export function wireLockButton() {
  const btn = document.getElementById("lock-workspace");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      await api("POST", "/api/lock-workspace");
    } catch (err) {
      /* the cookie clears locally regardless */
    }
    clearKey();
    location.href = "/unlock";
  });
}

export function unlockForm() {
  const form = document.getElementById("unlock-form");
  if (!form) return;
  const input = document.getElementById("unlock-key");
  const summary = document.getElementById("error-summary");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    summary.hidden = true;
    try {
      await api("POST", "/api/unlock", { key: input.value.trim() });
      localStorage.setItem("darkframe_key", input.value.trim());
      location.href = "/plan";
    } catch (err) {
      summary.hidden = false;
      summary.textContent = "";
      const p = document.createElement("p");
      p.textContent = err.status === 401 || err.status === 422 ? "That workspace key is not recognised." : err.message;
      summary.appendChild(p);
      input.focus();
    }
  });
}
