import { $, $$ } from "../core/dom.js";
import { reducedMotion, revealOnView } from "../core/motion.js";

const video = $("[data-hero-video]");
const toggle = $("[data-clip-toggle]");

function paint() {
  toggle.textContent = video.paused ? "Play video" : "Pause video";
}

toggle.addEventListener("click", () => (video.paused ? video.play() : video.pause()));
video.addEventListener("play", paint);
video.addEventListener("pause", paint);
paint();

if (!reducedMotion()) video.play().catch(paint);

revealOnView($$(".reveal"));
