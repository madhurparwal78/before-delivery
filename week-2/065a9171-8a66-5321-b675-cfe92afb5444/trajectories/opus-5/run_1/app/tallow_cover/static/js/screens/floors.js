// "Floors and policy": the versions in force and the forms that add new ones.

import { OFFLINE, api } from "../api.js";
import { clear, el, errorSlot, say, select, showFieldErrors, statusRegion } from "../dom.js";
import { SHIFT_LABELS, formatDate } from "../format.js";
import { homesFor, unitName } from "../homes.js";

function failureText(error) {
  return error.status === 0 ? OFFLINE : error.message;
}

export async function render({ me, query, navigate }) {
  const homes = homesFor(me);
  const homeId = query.get("home") || me.home_id || homes[0]?.id;
  const home = homes.find((candidate) => candidate.id === homeId) || homes[0];
  const status = statusRegion("Admin status");
  const floorBody = el("tbody", {});
  const policyBody = el("tbody", {});
  const isAdmin = me.role === "hr_admin";

  async function load() {
    const [floors, policy] = await Promise.all([
      api.get(`/api/homes/${homeId}/floors`),
      api.get(`/api/homes/${homeId}/leave-policy`),
    ]);
    clear(floorBody);
    for (const version of floors.versions) {
      floorBody.append(
        el(
          "tr",
          {},
          el("td", { dataset: { label: "Unit" }, text: unitName(version.unit_id) }),
          el("td", { dataset: { label: "Shift" }, text: SHIFT_LABELS[version.shift] }),
          el("td", { dataset: { label: "Minimum staff" }, text: String(version.min_staff) }),
          el("td", { dataset: { label: "Minimum seniors" }, text: String(version.min_seniors) }),
          el("td", {
            dataset: { label: "Effective from" },
            text: formatDate(version.effective_from),
          })
        )
      );
    }
    clear(policyBody);
    for (const version of policy.versions) {
      policyBody.append(
        el(
          "tr",
          {},
          el("td", {
            dataset: { label: "Notice multiplier" },
            text: String(version.notice_multiplier),
          }),
          el("td", {
            dataset: { label: "Effective from" },
            text: formatDate(version.effective_from),
          })
        )
      );
    }
  }

  const unitPicker = select(
    "Unit",
    home.units.map((unit) => ({ value: unit.id, label: unit.name })),
    home.units[0]?.id
  );
  const shiftPicker = select(
    "Shift",
    [
      { value: "early", label: "Early" },
      { value: "late", label: "Late" },
      { value: "night", label: "Night" },
    ],
    "early"
  );
  const minStaff = el("input", { type: "number", "aria-label": "Minimum staff", min: "0", max: "30" });
  const minSeniors = el("input", { type: "number", "aria-label": "Minimum seniors", min: "0" });
  const floorFrom = el("input", {
    type: "text",
    "aria-label": "Effective from",
    placeholder: "YYYY-MM-DD",
  });
  const floorForm = el(
    "form",
    { "aria-label": "New floor version" },
    el("label", {}, "Unit", unitPicker),
    el("label", {}, "Shift", shiftPicker),
    el("label", {}, "Minimum staff", minStaff),
    errorSlot("min_staff"),
    el("label", {}, "Minimum seniors", minSeniors),
    errorSlot("min_seniors"),
    el("label", {}, "Effective from", floorFrom),
    errorSlot("effective_from"),
    el("button", { type: "submit", text: "Save floor version" })
  );
  floorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFieldErrors(floorForm, {});
    say(status, "Saving…");
    try {
      const created = await api.post(`/api/homes/${homeId}/floors`, {
        unit_id: unitPicker.value,
        shift: shiftPicker.value,
        min_staff: Number(minStaff.value),
        min_seniors: Number(minSeniors.value),
        effective_from: floorFrom.value,
      });
      say(status, `Floor version saved. It applies from ${formatDate(created.effective_from)}.`);
      await load();
    } catch (error) {
      showFieldErrors(floorForm, error.errors || {});
      say(status, failureText(error));
    }
  });

  const multiplier = el("input", {
    type: "number",
    "aria-label": "Notice multiplier",
    min: "0",
    max: "6",
  });
  const policyFrom = el("input", {
    type: "text",
    "aria-label": "Effective from",
    placeholder: "YYYY-MM-DD",
  });
  const policyForm = el(
    "form",
    { "aria-label": "New leave policy" },
    el("label", {}, "Notice multiplier", multiplier),
    errorSlot("notice_multiplier"),
    el("label", {}, "Effective from", policyFrom),
    errorSlot("effective_from"),
    el("button", { type: "submit", text: "Save leave policy" })
  );
  policyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFieldErrors(policyForm, {});
    say(status, "Saving…");
    try {
      const created = await api.post(`/api/homes/${homeId}/leave-policy`, {
        notice_multiplier: Number(multiplier.value),
        effective_from: policyFrom.value,
      });
      say(status, `Leave policy saved. It applies from ${formatDate(created.effective_from)}.`);
      await load();
    } catch (error) {
      showFieldErrors(policyForm, error.errors || {});
      say(status, failureText(error));
    }
  });

  const homePicker =
    homes.length > 1
      ? select("Home", homes.map((candidate) => ({ value: candidate.id, label: candidate.name })), homeId)
      : null;
  if (homePicker) {
    homePicker.addEventListener("change", () => navigate(`/floors?home=${homePicker.value}`));
  }

  await load();
  return el(
    "div",
    {},
    el("h1", { text: "Floors and policy" }),
    homePicker ? el("div", { class: "row" }, el("label", {}, "Home", homePicker)) : null,
    status,
    el(
      "section",
      { class: "panel" },
      el("h2", { text: "Floor versions" }),
      el(
        "table",
        { class: "cards", "aria-label": "Floor versions" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ["Unit", "Shift", "Minimum staff", "Minimum seniors", "Effective from"].map((name) =>
              el("th", { text: name })
            )
          )
        ),
        floorBody
      ),
      isAdmin ? floorForm : null
    ),
    el(
      "section",
      { class: "panel" },
      el("h2", { text: "Leave policy versions" }),
      el(
        "table",
        { class: "cards", "aria-label": "Leave policy versions" },
        el(
          "thead",
          {},
          el("tr", {}, ["Notice multiplier", "Effective from"].map((name) => el("th", { text: name })))
        ),
        policyBody
      ),
      isAdmin ? policyForm : null
    )
  );
}
