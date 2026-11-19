import { $, keepInView, liveScreen } from "./core.js";
import { initDialogs } from "./dialogs.js";
import { initForms } from "./forms.js";
import { afterRefresh, restoreDraft, startRefreshing } from "./refresh.js";
import { initNavigation } from "./nav.js";
import { initPublic } from "./public.js";
import { initAddress } from "./address.js";
import { initJourney, markDeskJourneyForms } from "./journey.js";
import { initScreens } from "./screens.js";
import { initRunSheet } from "./sheet.js";

initDialogs();
initForms();
initAddress();
initNavigation();
initScreens();
initJourney();
markDeskJourneyForms();
afterRefresh(markDeskJourneyForms);
initPublic();
initRunSheet();

// A press must end where it began, so a control focused under a held pointer scrolls into view only once the press ends.
let held = false;
let waiting: Element | null = null;
const pressEnded = (): void => {
  held = false;
  if (waiting === document.activeElement && waiting) keepInView(waiting);
  waiting = null;
};
document.addEventListener("pointerdown", () => { held = true; waiting = null; }, true);
document.addEventListener("pointerup", () => { held = false; }, true);
document.addEventListener("click", pressEnded);
document.addEventListener("pointercancel", pressEnded);
document.addEventListener("focusin", (event) => {
  if (held) waiting = event.target as Element;
  else keepInView(event.target as Element);
});
document.addEventListener("change", (event) => {
  const field = event.target as HTMLSelectElement;
  if (!field.matches?.("[data-language-switch]")) return;
  const url = new URL(location.href);
  if (field.value === "en") url.searchParams.delete("lang");
  else url.searchParams.set("lang", field.value);
  location.assign(url);
});
$<HTMLElement>("[data-focus-on-load]")?.focus();
if (liveScreen()) {
  startRefreshing();
  restoreDraft();
}
document.addEventListener("dragstart", (event) => {
  if ((event.target as Element).closest?.(".seat,.stop-row,.diary-card,.block-break")) event.preventDefault();
});
