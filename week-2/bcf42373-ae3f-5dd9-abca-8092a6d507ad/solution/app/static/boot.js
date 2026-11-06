// Runs before first paint: motion choice, reduced-motion request and the once-per-session intro cover.
(() => {
  const root = document.documentElement;
  let motionOff = false;
  let firstPage = false;
  try {
    motionOff = localStorage.getItem("ik-motion") === "off";
    firstPage = sessionStorage.getItem("ik-intro") === null;
    sessionStorage.setItem("ik-intro", "played");
  } catch {
    // Storage is blocked: motion stays on and the intro is skipped.
  }
  root.classList.add("js");
  root.classList.toggle("motion-off", motionOff);
  if (!motionOff && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("motion");
    if (firstPage) root.classList.add("intro");
  }
})();
