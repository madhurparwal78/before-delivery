import { type PageKind } from "../shared/page-kind.js";
import { initArrival, rememberDepartures } from "./arrival.js";
import { initCallouts } from "./callouts.js";
import { initCounters } from "./counters.js";
import { initCursor } from "./cursor.js";
import { must } from "./dom.js";
import { initEnquire } from "./enquire.js";
import { initEnquiryForm } from "./enquiry-form.js";
import { initFooterWave } from "./footer-wave.js";
import { FramePlayer } from "./frames.js";
import { initGallery } from "./gallery.js";
import { initHeroMotion } from "./hero-motion.js";
import { initIntro } from "./intro.js";
import { initJourney } from "./journey.js";
import { initJumps } from "./jumps.js";
import { initMedia } from "./media.js";
import { initMenu } from "./menu.js";
import { initQuickLook } from "./quick-look.js";
import { initReviews } from "./reviews.js";
import { initRoles } from "./roles.js";
import { initCaseStudySections, initHomeSections } from "./sections.js";
import { initServices } from "./services.js";
import { initSkills } from "./skills.js";
import { applyViewportRules, watchViewport } from "./viewport.js";

/** The home page. Returns the step that must run after the page has been placed by arrival: opening `?service=` focuses `Your name`. */
function startHome(siteRoot: HTMLElement): () => void {
  const roles = initRoles();
  initIntro(must<HTMLElement>(document, "#intro"), roles.start);
  initHeroMotion();
  initHomeSections();
  initJourney();
  initCounters();
  initQuickLook(siteRoot, initGallery());
  initServices();
  initSkills();
  initReviews();
  const form = initEnquiryForm();
  return () => initEnquire(form);
}

function startCaseStudy(): () => void {
  initCaseStudySections();
  initCallouts(new FramePlayer(must<HTMLElement>(document, "[data-preview-frame]")));
  return () => undefined;
}

const page = document.body.dataset["page"] as PageKind;
const siteRoot = must<HTMLElement>(document, "[data-site-root]");

initMenu(siteRoot);
initMedia();
initCursor();
initFooterWave();
initJumps();
rememberDepartures();
const afterArrival = page === "home" ? startHome(siteRoot) : page === "case-study" ? startCaseStudy() : () => undefined;
watchViewport();
initArrival(page);
afterArrival();
applyViewportRules();
