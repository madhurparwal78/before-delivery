import { api, clearToken, requireMember } from "../core/api.js";
import { $, notice } from "../core/dom.js";

const form = $("[data-privacy-form]");
const result = $("[data-privacy-result]");
const lat = $("#zone-lat");
const lon = $("#zone-lon");
const radius = $("#zone-radius");
const dialog = $("[data-delete-dialog]");

function zoneFromFields() {
  if (lat.value === "" && lon.value === "") return { zone: null };
  const zone = { lat: Number(lat.value), lon: Number(lon.value), radius_m: Number(radius.value) };
  const valid = lat.value !== "" && lon.value !== "" && Math.abs(zone.lat) <= 90 && Math.abs(zone.lon) <= 180;
  return valid ? { zone } : { error: "Enter both a latitude from -90 to 90 and a longitude from -180 to 180, or remove the zone." };
}

async function save(event) {
  event?.preventDefault();
  result.replaceChildren();
  const { zone, error } = zoneFromFields();
  if (error) {
    result.replaceChildren(notice("error", error));
    return;
  }
  const button = $("button[type=submit]", form);
  button.disabled = true;
  const [privacy, account] = await Promise.all([
    api("/api/me/privacy", { method: "PUT", body: { private: form.elements.private.checked, default_visibility: form.elements.default_visibility.value, privacy_zone: zone } }),
    api("/api/me", { method: "PATCH", body: { time_zone: form.elements.time_zone.value } }),
  ]);
  button.disabled = false;
  result.replaceChildren(privacy.ok && account.ok ? notice("success", "Privacy settings saved") : notice("error", "The settings could not be saved. Check the zone and try again."));
}

form.addEventListener("submit", save);
$("[data-remove-zone]").addEventListener("click", () => {
  lat.value = "";
  lon.value = "";
  radius.value = "200";
  save();
});

$("[data-open-delete]").addEventListener("click", () => dialog.showModal());
$("[data-delete-cancel]").addEventListener("click", () => dialog.close());
$("[data-delete-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errors = $("[data-delete-error]");
  errors.replaceChildren();
  const response = await api("/api/me", { method: "DELETE", body: { password: $("#delete-password").value } });
  if (response.ok) {
    clearToken();
    location.assign("/");
  } else {
    errors.replaceChildren(notice("error", "That password is not right, so nothing was deleted."));
  }
});

requireMember().then(async (me) => {
  const privacy = await api("/api/me/privacy");
  if (privacy.ok) {
    form.elements.private.checked = privacy.data.private;
    form.elements.default_visibility.value = privacy.data.default_visibility;
    if (privacy.data.privacy_zone) {
      lat.value = privacy.data.privacy_zone.lat;
      lon.value = privacy.data.privacy_zone.lon;
      radius.value = String(privacy.data.privacy_zone.radius_m);
    }
  }
  form.elements.time_zone.value = me.time_zone;
});
