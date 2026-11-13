import { initChrome } from "./chrome.js";
import { requireSession } from "./api.js";

const PAGE_MODULES = {
  features: "./pages/features.js",
  subscribe: "./pages/plans.js",
  family: "./pages/plans.js",
  student: "./pages/plans.js",
  bulk: "./pages/bulk.js",
  whats_new: "./pages/stories.js",
  challenges: "./pages/challenges.js",
  maps: "./pages/maps.js",
  login: "./pages/login.js",
  signup: "./pages/signup.js",
  dashboard: "./pages/dashboard.js",
  upload: "./pages/upload.js",
  activity: "./pages/activity.js",
  segment: "./pages/segment.js",
  athlete: "./pages/athlete.js",
  recap: "./pages/recap.js",
  privacy: "./pages/privacy.js",
};

const SIGNED_IN_PAGES = new Set([
  "dashboard",
  "upload",
  "activity",
  "segment",
  "athlete",
  "recap",
  "privacy",
]);

initChrome();

const page = document.body.dataset.page;
if (!SIGNED_IN_PAGES.has(page) || requireSession()) {
  const module = PAGE_MODULES[page];
  if (module) {
    import(module).then((loaded) => loaded.init());
  }
}
