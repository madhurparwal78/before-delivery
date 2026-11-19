/**
 * Client entry. Wires every interaction in the published order. Nothing here
 * contacts another origin; fonts, script, style and images are all same-origin.
 */
import { initMedia } from "./media.js";
import { initHero } from "./hero.js";
import { initScroll, initCursor } from "./scroll.js";
import { initNavigation } from "./navigation.js";
import { initGallery } from "./gallery.js";
import { initCaseStudy } from "./case-study.js";
import { initCallouts } from "./callouts.js";
import { initEnquiry, initReviews, initServices, initSkills } from "./sections.js";
import { initMilestones } from "./milestones.js";

function ready(): void {
  initMedia();
  initHero();
  initScroll();
  initNavigation();
  initGallery();
  initCaseStudy();
  initCallouts();
  initServices();
  initSkills();
  initReviews();
  initEnquiry();
  initMilestones();
  initCursor();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ready);
} else {
  ready();
}
