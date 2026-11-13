import { api, clearToken } from "../api.js";

export async function init() {
  const form = document.querySelector("[data-privacy-form]");
  const saved = document.querySelector("[data-privacy-status]");
  const failed = document.querySelector("[data-privacy-error]");
  const privateSwitch = document.querySelector("[data-private]");
  const visibility = document.querySelector("[data-default-visibility]");
  const lat = document.querySelector("[data-zone-lat]");
  const lon = document.querySelector("[data-zone-lon]");
  const radius = document.querySelector("[data-zone-radius]");
  const timeZone = document.querySelector("[data-time-zone]");

  const me = await api("/api/me");
  if (!me.ok) {
    window.location.replace("/login");
    return;
  }
  timeZone.value = me.data.athlete.time_zone;

  const settings = await api("/api/me/privacy");
  if (settings.ok) {
    privateSwitch.checked = settings.data.private;
    visibility.value = settings.data.default_visibility;
    if (settings.data.privacy_zone) {
      lat.value = settings.data.privacy_zone.lat;
      lon.value = settings.data.privacy_zone.lon;
      radius.value = String(settings.data.privacy_zone.radius_m);
    }
  }

  document.querySelector("[data-remove-zone]").addEventListener("click", () => {
    lat.value = "";
    lon.value = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saved.hidden = true;
    failed.hidden = true;
    const zone =
      lat.value === "" || lon.value === ""
        ? null
        : { lat: Number(lat.value), lon: Number(lon.value), radius_m: Number(radius.value) };
    const privacy = await api("/api/me/privacy", {
      method: "PUT",
      body: {
        private: privateSwitch.checked,
        default_visibility: visibility.value,
        privacy_zone: zone,
      },
    });
    const account = await api("/api/me", { method: "PATCH", body: { time_zone: timeZone.value } });
    if (privacy.ok && account.ok) {
      saved.hidden = false;
    } else {
      failed.textContent = "Those settings were refused.";
      failed.hidden = false;
    }
  });

  const dialog = document.querySelector("[data-delete-dialog]");
  const deleteForm = document.querySelector("[data-delete-form]");
  const deleteError = document.querySelector("[data-delete-error]");
  const opener = document.querySelector("[data-delete-account]");
  opener.addEventListener("click", () => dialog.showModal());
  document.querySelector("[data-delete-cancel]").addEventListener("click", () => {
    dialog.close();
    opener.focus();
  });
  dialog.addEventListener("close", () => opener.focus());
  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    deleteError.textContent = "";
    const { ok } = await api("/api/me", {
      method: "DELETE",
      body: { password: document.querySelector("#delete-password").value },
    });
    if (!ok) {
      deleteError.textContent = "That password did not match.";
      return;
    }
    clearToken();
    window.location.href = "/";
  });
}
