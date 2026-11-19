// The scenario trail: a winding path through the orbs that draws with scroll and lights each orb it reaches.
// The drawing and the prop drift are native scroll-driven animations on the document's scroll timeline, so the
// browser runs them and lists them among the document's animations; an orb lights through its CSS transition.
import { $, $$, reducedMotion } from "./common.js";

const REACH = 0.6;      // the trail is drawn down to this fraction of the viewport height
const DRIFT = -0.06;    // props drift against the scroll…
const DRIFT_MAX = 28;   // …by at most this many pixels
const SAMPLES = 240;

export function wireTrail() {
  const trail = $("[data-trail]");
  const orbs = $$(".orb", trail);
  const track = $("[data-trail-track]", trail);
  const drawn = $("[data-trail-drawn]", trail);
  const props = $$("[data-prop]", trail);
  const straight = window.matchMedia("(max-width: 409.98px)");
  const timeline = "ScrollTimeline" in window ? new ScrollTimeline({ source: document.documentElement, axis: "block" }) : null;
  let centres = [];
  let samples = [];
  let length = 0;
  let bound = [];

  function layout() {
    const box = trail.getBoundingClientRect();
    centres = orbs.map((orb) => {
      const r = orb.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    });
    let d = `M ${centres[0].x} ${centres[0].y}`;
    for (let i = 1; i < centres.length; i++) {
      const a = centres[i - 1];
      const b = centres[i];
      const bend = (b.y - a.y) * 0.55;
      d += straight.matches ? ` L ${b.x} ${b.y}` : ` C ${a.x} ${a.y + bend} ${b.x} ${b.y - bend} ${b.x} ${b.y}`;
    }
    track.setAttribute("d", d);
    drawn.setAttribute("d", d);
    length = drawn.getTotalLength();
    samples = Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const at = (length * i) / SAMPLES;
      return { at, y: drawn.getPointAtLength(at).y };
    });
    drawn.style.strokeDasharray = `${length} ${length}`;
    bind();
    light();
  }

  function lengthAt(y) {
    const next = samples.findIndex((s) => s.y >= y);
    if (next <= 0) return next === 0 ? 0 : length;
    const a = samples[next - 1];
    const b = samples[next];
    return a.at + ((b.at - a.at) * (y - a.y)) / Math.max(1e-6, b.y - a.y);
  }

  // The trail reach grows one pixel per pixel scrolled, so each keyframe sits at the scroll offset where it is reached.
  function bind() {
    bound.forEach((animation) => animation.cancel());
    bound = [];
    if (reducedMotion.matches || !timeline) {
      drawn.style.strokeDashoffset = "0";
      props.forEach((prop) => { prop.style.transform = ""; });
      return;
    }
    const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const lead = window.innerHeight * REACH - (trail.getBoundingClientRect().top + window.scrollY);
    const frames = [{ offset: 0, strokeDashoffset: `${length - lengthAt(lead)}px` }];
    for (const s of samples) {
      const offset = (s.y - lead) / range;
      if (offset > frames[frames.length - 1].offset && offset < 1) frames.push({ offset, strokeDashoffset: `${length - s.at}px` });
    }
    frames.push({ offset: 1, strokeDashoffset: `${length - lengthAt(range + lead)}px` });
    drawn.style.strokeDashoffset = "";
    bound.push(drawn.animate(frames, { timeline, fill: "both" }));
    for (const prop of props) {
      const r = prop.parentElement.getBoundingClientRect();
      const centre = r.top + window.scrollY + r.height / 2 - window.innerHeight / 2;
      const shift = (scroll) => Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, (centre - scroll) * DRIFT));
      const stops = [0, centre + DRIFT_MAX / DRIFT, centre - DRIFT_MAX / DRIFT, range]
        .filter((scroll) => scroll >= 0 && scroll <= range).sort((a, b) => a - b);
      prop.style.transform = "";
      bound.push(prop.animate(stops.map((scroll) => ({ offset: scroll / range, transform: `translateY(${shift(scroll).toFixed(1)}px)` })),
        { timeline, fill: "both" }));
    }
  }

  function light() {
    const reach = reducedMotion.matches || !timeline ? Infinity : window.innerHeight * REACH - trail.getBoundingClientRect().top;
    orbs.forEach((orb, i) => orb.classList.toggle("is-lit", centres[i].y <= reach));
  }

  const resize = new ResizeObserver(layout);
  resize.observe(trail);
  resize.observe(document.body);
  document.fonts.ready.then(layout);
  layout();
  if (reducedMotion.matches || !timeline) return;
  // The lit state is checked once per frame (scroll events arrive a frame late); the lighting itself is a CSS transition.
  let seen = window.scrollY;
  const follow = () => {
    if (window.scrollY !== seen) {
      seen = window.scrollY;
      light();
    }
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
}
