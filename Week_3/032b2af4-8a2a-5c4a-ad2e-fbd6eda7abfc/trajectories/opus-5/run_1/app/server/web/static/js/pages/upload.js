import { api } from "../api.js";

const EARTH_RADIUS_M = 6371000;

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dPhi = (phi2 - phi1) / 2;
  const dLambda = ((lon2 - lon1) * toRad) / 2;
  const h = Math.sin(dPhi) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function previewDistance(document_text) {
  const parsed = new DOMParser().parseFromString(document_text, "application/xml");
  if (parsed.querySelector("parsererror")) return null;
  const points = [...parsed.getElementsByTagName("trkpt")]
    .filter((node) => node.getElementsByTagName("time").length)
    .map((node) => [Number(node.getAttribute("lat")), Number(node.getAttribute("lon"))]);
  if (points.length < 2) return null;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversine(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1]);
  }
  return Math.floor(total + 0.5);
}

export function init() {
  const form = document.querySelector("[data-upload-form]");
  const file = document.querySelector("#gpx-file");
  const preview = document.querySelector("[data-preview]");
  const previewValue = document.querySelector("[data-preview-distance]");
  const error = document.querySelector("[data-upload-error]");
  const status = document.querySelector("[data-upload-status]");
  const dropzone = document.querySelector("[data-dropzone]");
  let text = "";

  const take = async (chosen) => {
    if (!chosen) return;
    text = await chosen.text();
    const metres = previewDistance(text);
    if (metres === null) {
      preview.hidden = true;
      error.textContent = "That file is not a GPX track with at least two timed points.";
      error.hidden = false;
      return;
    }
    error.hidden = true;
    preview.hidden = false;
    previewValue.textContent = `${(metres / 1000).toFixed(2)} km`;
    if (!form.elements.name.value) {
      form.elements.name.value = chosen.name.replace(/\.gpx$/i, "");
    }
    status.textContent = `${chosen.name} is ready to save.`;
  };

  file.addEventListener("change", () => take(file.files[0]));
  dropzone.addEventListener("dragover", (event) => event.preventDefault());
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (dropped) {
      file.files = event.dataTransfer.files;
      take(dropped);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!text) {
      error.textContent = "Choose a GPX file first.";
      error.hidden = false;
      return;
    }
    const { ok, data } = await api("/api/activities", {
      method: "POST",
      body: {
        name: form.elements.name.value,
        sport_type: form.elements.sport_type.value,
        visibility: form.elements.visibility.value,
        gpx: text,
      },
    });
    if (ok) {
      status.textContent = "Activity saved.";
      window.location.href = `/activities/${data.id}`;
      return;
    }
    const fields = data?.fields ? Object.values(data.fields).join(" ") : "";
    error.textContent = data?.error === "duplicate_activity"
      ? "You have already uploaded this recording."
      : `That upload was refused. ${fields}`.trim();
    error.hidden = false;
  });
}
