import { SERVICE_PARAM, serviceByValue } from "../shared/catalog.js";
import { serviceAnnouncement } from "../shared/announcements.js";
import { announce } from "./announce.js";
import { currentParams, pushAddress, replaceAddress } from "./address.js";
import { all } from "./dom.js";
import { type EnquiryForm } from "./enquiry-form.js";
import { headingOf, jumpTo, placeHeading } from "./jumps.js";

/** `Enquire about <service>`: jumps to the form without a reload, sets `Project type`, announces it once, adds one history
 * entry and moves focus to `Your name`. Typed values stay. */

export function initEnquire(form: EnquiryForm): void {
  for (const link of all<HTMLAnchorElement>(document, "[data-enquire]")) {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      const service = serviceByValue(link.dataset["enquire"] ?? null);
      if (service === undefined) return;
      form.setProjectType(service.value);
      pushAddress((params) => params.set(SERVICE_PARAM, service.value), "#contact");
      placeHeading("contact", true);
      form.focusName();
      announce(serviceAnnouncement(service));
    });
  }

  const requested = currentParams().get(SERVICE_PARAM);
  const service = serviceByValue(requested);
  if (requested !== null && service === undefined) replaceAddress((params) => params.delete(SERVICE_PARAM));
  if (service !== undefined) {
    form.setProjectType(service.value);
    if (window.location.hash === "#contact" && headingOf("contact") !== null) {
      jumpTo("contact", false);
      form.focusName();
    }
  }
}
