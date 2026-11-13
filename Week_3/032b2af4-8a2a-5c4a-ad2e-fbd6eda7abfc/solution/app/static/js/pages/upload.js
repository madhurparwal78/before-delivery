import { api, requireMember } from "../core/api.js";
import { $, h, icon } from "../core/dom.js";
import { km } from "../core/format.js";
import { previewDistance } from "../components/gpx.js";

const form = $("[data-upload-form]");
const input = $("#gpx-file");
const zone = $("[data-dropzone]");
const preview = $("[data-preview]");
const result = $("[data-upload-result]");
let text = "";

function alertWith(lines, extra) {
  result.replaceChildren(h("div", { class: "notice is-error", role: "alert" }, icon("alert"),
    h("div", {}, ...lines.map((line) => h("p", { text: line })), extra)));
}

async function read(file) {
  text = file ? await file.text() : "";
  result.replaceChildren();
  const metres = text ? previewDistance(text) : null;
  preview.replaceChildren(...(metres === null ? [] : [h("dl", { class: "preview-card" },
    h("div", {}, h("dt", { text: "Distance" }), h("dd", { text: `${km(metres)} km` })))]));
  if (file && !$("#activity-name").value) $("#activity-name").value = file.name.replace(/\.gpx$/i, "").slice(0, 100);
}

input.addEventListener("change", () => read(input.files[0]));
for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add("is-over"); });
for (const type of ["dragleave", "drop"]) zone.addEventListener(type, () => zone.classList.remove("is-over"));
zone.addEventListener("drop", (event) => {
  event.preventDefault();
  if (event.dataTransfer.files.length) {
    input.files = event.dataTransfer.files;
    read(input.files[0]);
  }
});

const FIELD_TEXT = {
  name: "Enter a name of 1 to 100 characters.",
  sport_type: "Choose Run, Ride, Walk or Hike.",
  visibility: "Choose Everyone, Followers or Only You.",
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.replaceChildren();
  if (!text) {
    alertWith(["Choose a GPX file to upload."]);
    return;
  }
  const button = $("button[type=submit]", form);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const body = { name: form.elements.name.value, sport_type: form.elements.sport_type.value, visibility: form.elements.visibility.value, gpx: text };
  const response = await api("/api/activities", { method: "POST", body });
  button.disabled = false;
  button.removeAttribute("aria-busy");
  if (response.ok) {
    location.assign(`/activities/${response.data.id}`);
  } else if (response.status === 401) {
    await requireMember();
  } else if (response.status === 409) {
    alertWith(["You already uploaded this recording."], h("a", { href: `/activities/${response.data.activity_id}`, text: "Open the existing activity" }));
  } else if (response.status === 413) {
    alertWith(["That file is too large. Uploads can be up to 5 MB."]);
  } else if (response.status === 400 && response.data?.fields) {
    alertWith(Object.entries(response.data.fields).map(([field, reason]) => (field === "gpx" ? reason : FIELD_TEXT[field] || reason)));
  } else {
    alertWith(["The activity could not be saved. Please try again."]);
  }
});

requireMember();
