// Kit: telescopes, eyepieces, Barlows, sites and the device name (DP-03, DP-94).
import { app, persist, broadcast } from "../app.js";
import { el } from "../dom.js";
import { apiGet, apiPost, ApiError } from "../api.js";
import { shell } from "./shell.js";
import { kitSentences } from "../../shared/sentences.js";
import type { Kit } from "../../shared/api.js";
import { siteTimeZones } from "../../shared/time.js";
import { apertureToMm } from "../../shared/optics.js";

export async function renderKit(root: HTMLElement): Promise<void> {
  const parts = shell("Kit", []);
  const column = parts.column;
  const statusRegion = el("div", { class: "status", role: "status", "aria-label": "Kit status" });
  const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null);
  const store = accountId ? app.state.stores[accountId] : null;

  // Telescope form with the millimetre line (DP-03).
  const telescopeName = el("input", { class: "input", type: "text", id: "t-name" }) as HTMLInputElement;
  const aperture = el("input", { class: "input", type: "number", id: "t-aperture", step: "any" }) as HTMLInputElement;
  const apertureUnit = el("select", { class: "input", id: "t-unit", "aria-label": "Aperture unit" }) as HTMLSelectElement;
  apertureUnit.append(el("option", { value: "mm", text: "mm" }), el("option", { value: "in", text: "in" }));
  const focalLength = el("input", { class: "input", type: "number", id: "t-focal", step: "any" }) as HTMLInputElement;
  const apertureLine = el("div", { class: "status", role: "status", "aria-label": "Aperture in millimetres" });
  const updateApertureLine = (): void => {
    const value = Number(aperture.value);
    if (aperture.value === "" || !Number.isFinite(value)) {
      apertureLine.textContent = "";
      return;
    }
    const mm = apertureToMm(value, apertureUnit.value === "in" ? "in" : "mm");
    apertureLine.textContent = `${mm} mm`;
  };
  aperture.addEventListener("input", updateApertureLine);
  apertureUnit.addEventListener("change", updateApertureLine);

  let telescopeInFlight = false;
  const addTelescope = el("button", {
    class: "button primary",
    text: "Add telescope",
    onclick: async () => {
      if (telescopeInFlight) return;
      telescopeInFlight = true;
      try {
        await apiPost.telescope({
          name: telescopeName.value,
          aperture: aperture.value,
          aperture_unit: apertureUnit.value,
          focal_length_mm: focalLength.value,
        });
        statusRegion.textContent = kitSentences.added(telescopeName.value);
        telescopeName.value = aperture.value = focalLength.value = "";
        apertureLine.textContent = "";
        telescopeName.focus();
        await refreshKit();
      } catch (error) {
        reportKitError(statusRegion, error, () => telescopeName.focus());
      } finally {
        telescopeInFlight = false;
      }
    },
  });
  const telescopeForm = el("div", { class: "form" },
    el("h2", { class: "subheading", text: "Telescope" }),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "t-name", text: "Telescope name" }), telescopeName),
    el("div", { class: "field-row" },
      el("div", { class: "field" }, el("label", { class: "field-label", for: "t-aperture", text: "Aperture" }), aperture),
      el("div", { class: "field" }, el("label", { class: "field-label", for: "t-unit", text: "Aperture unit" }), apertureUnit),
    ),
    apertureLine,
    el("div", { class: "field" }, el("label", { class: "field-label", for: "t-focal", text: "Focal length (mm)" }), focalLength),
    addTelescope,
  );

  // Eyepiece form.
  const eyepieceName = el("input", { class: "input", type: "text", id: "e-name" }) as HTMLInputElement;
  const eyepieceFocal = el("input", { class: "input", type: "number", id: "e-focal", step: "any" }) as HTMLInputElement;
  const apparentField = el("input", { class: "input", type: "number", id: "e-afov", step: "any" }) as HTMLInputElement;
  let eyepieceInFlight = false;
  const addEyepiece = el("button", {
    class: "button",
    text: "Add eyepiece",
    onclick: async () => {
      if (eyepieceInFlight) return;
      eyepieceInFlight = true;
      try {
        await apiPost.eyepiece({
          name: eyepieceName.value,
          focal_length_mm: eyepieceFocal.value,
          apparent_field_deg: apparentField.value,
        });
        statusRegion.textContent = kitSentences.added(eyepieceName.value);
        eyepieceName.value = eyepieceFocal.value = apparentField.value = "";
        eyepieceName.focus();
        await refreshKit();
      } catch (error) {
        reportKitError(statusRegion, error, () => eyepieceName.focus());
      } finally {
        eyepieceInFlight = false;
      }
    },
  });
  const eyepieceForm = el("div", { class: "form" },
    el("h2", { class: "subheading", text: "Eyepiece" }),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "e-name", text: "Eyepiece name" }), eyepieceName),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "e-focal", text: "Eyepiece focal length (mm)" }), eyepieceFocal),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "e-afov", text: "Apparent field (°)" }), apparentField),
    addEyepiece,
  );

  // Barlow form.
  const barlowName = el("input", { class: "input", type: "text", id: "b-name" }) as HTMLInputElement;
  const barlowFactor = el("input", { class: "input", type: "number", id: "b-factor", step: "any" }) as HTMLInputElement;
  let barlowInFlight = false;
  const addBarlow = el("button", {
    class: "button",
    text: "Add Barlow",
    onclick: async () => {
      if (barlowInFlight) return;
      barlowInFlight = true;
      try {
        await apiPost.barlow({ name: barlowName.value, factor: barlowFactor.value });
        statusRegion.textContent = kitSentences.added(barlowName.value);
        barlowName.value = barlowFactor.value = "";
        barlowName.focus();
        await refreshKit();
      } catch (error) {
        reportKitError(statusRegion, error, () => barlowName.focus());
      } finally {
        barlowInFlight = false;
      }
    },
  });
  const barlowForm = el("div", { class: "form" },
    el("h2", { class: "subheading", text: "Barlow" }),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "b-name", text: "Barlow name" }), barlowName),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "b-factor", text: "Barlow factor" }), barlowFactor),
    addBarlow,
  );

  // Kit list.
  const kitList = el("ul", { class: "rows" });
  renderKitList(kitList, store?.kit ?? null);

  // Site form.
  const siteName = el("input", { class: "input", type: "text", id: "s-name" }) as HTMLInputElement;
  const siteLatitude = el("input", { class: "input", type: "number", id: "s-lat", step: "any" }) as HTMLInputElement;
  const siteLongitude = el("input", { class: "input", type: "number", id: "s-lon", step: "any" }) as HTMLInputElement;
  const siteZone = el("select", { class: "input", id: "s-zone", "aria-label": "Time zone" }) as HTMLSelectElement;
  for (const zone of siteTimeZones) {
    siteZone.append(el("option", { value: zone, text: zone }));
  }
  let siteInFlight = false;
  const addSite = el("button", {
    class: "button",
    text: "Add site",
    onclick: async () => {
      if (siteInFlight) return;
      siteInFlight = true;
      try {
        await apiPost.site({
          name: siteName.value,
          latitude: siteLatitude.value,
          longitude: siteLongitude.value,
          time_zone: siteZone.value,
        });
        statusRegion.textContent = kitSentences.added(siteName.value);
        siteName.value = siteLatitude.value = siteLongitude.value = "";
        siteName.focus();
        await refreshKit();
      } catch (error) {
        reportKitError(statusRegion, error, () => siteName.focus());
      } finally {
        siteInFlight = false;
      }
    },
  });
  const siteForm = el("div", { class: "form" },
    el("h2", { class: "subheading", text: "Sites" }),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "s-name", text: "Site name" }), siteName),
    el("div", { class: "field-row" },
      el("div", { class: "field" }, el("label", { class: "field-label", for: "s-lat", text: "Latitude" }), siteLatitude),
      el("div", { class: "field" }, el("label", { class: "field-label", for: "s-lon", text: "Longitude" }), siteLongitude),
    ),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "s-zone", text: "Time zone" }), siteZone),
    addSite,
  );
  const siteList = el("ul", { class: "rows" });
  for (const site of store?.sites ?? []) {
    siteList.append(el("li", { class: "row" },
      el("span", { class: "row-ink", text: site.name }),
      el("span", { class: "row-muted", text: `${site.latitude}, ${site.longitude} · ${site.time_zone}` }),
    ));
  }

  // This device name.
  const deviceName = el("input", { class: "input", type: "text", id: "device-name", value: app.state.deviceName }) as HTMLInputElement;
  deviceName.addEventListener("input", () => {
    app.state.deviceName = deviceName.value;
    persist();
    broadcast({ type: "device-name", name: deviceName.value });
  });
  const deviceField = el("div", { class: "form" },
    el("h2", { class: "subheading", text: "This device" }),
    el("div", { class: "field" }, el("label", { class: "field-label", for: "device-name", text: "This device" }), deviceName),
  );

  column.append(telescopeForm, eyepieceForm, barlowForm, el("h2", { class: "subheading", text: "Your kit" }), kitList, statusRegion, siteForm, siteList, deviceField);
  root.append(column);
  if (app.account && navigator.onLine) await refreshKit();

  async function refreshKit(): Promise<void> {
    if (!app.state.signedInAccountId) return;
    try {
      const [kit, sites] = await Promise.all([apiGet.kit(), apiGet.sites()]);
      const store = app.state.stores[app.state.signedInAccountId] ??= {
        kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
        histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
      };
      store.kit = kit;
      store.sites = sites.sites;
      persist();
      renderKitList(kitList, kit);
      siteList.textContent = "";
      for (const site of sites.sites) {
        siteList.append(el("li", { class: "row" },
          el("span", { class: "row-ink", text: site.name }),
          el("span", { class: "row-muted", text: `${site.latitude}, ${site.longitude} · ${site.time_zone}` }),
        ));
      }
    } catch {
      // Offline: keep the device copy.
    }
  }
}

function renderKitList(list: HTMLElement, kit: Kit | null): void {
  list.textContent = "";
  if (!kit) return;
  for (const telescope of kit.telescopes) {
    list.append(el("li", { class: "row" },
      el("span", { class: "row-ink", text: telescope.name }),
      el("span", { class: "row-muted", text: `${telescope.aperture_mm} mm aperture · ${telescope.focal_length_mm} mm focal length` }),
    ));
  }
  for (const eyepiece of kit.eyepieces) {
    list.append(el("li", { class: "row" },
      el("span", { class: "row-ink", text: eyepiece.name }),
      el("span", { class: "row-muted", text: `${eyepiece.focal_length_mm} mm · ${eyepiece.apparent_field_deg}°` }),
    ));
  }
  for (const barlow of kit.barlows) {
    list.append(el("li", { class: "row" },
      el("span", { class: "row-ink", text: barlow.name }),
      el("span", { class: "row-muted", text: `${barlow.factor}×` }),
    ));
  }
}

function reportKitError(statusRegion: HTMLElement, error: unknown, focusInvalid: () => void): void {
  const apiError = error as ApiError;
  if (apiError?.status === 0) {
    statusRegion.textContent = "That needs signal. Nothing was changed.";
    return;
  }
  if (apiError?.status === 422 && apiError.fields) {
    statusRegion.textContent = Object.values(apiError.fields)[0] ?? "";
  } else if (apiError?.status === 500) {
    statusRegion.textContent = "Something went wrong on our side. Nothing was lost; try again.";
  }
  focusInvalid();
}
