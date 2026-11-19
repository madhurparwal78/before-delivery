// Break the Month: the score panel, the four-detent slider and the sequence that moves between grains
// (split, fall, count), with the server's values only.
import { h, commas, pct, share } from "./dom.js";
import { get, ApiError, SessionCancelled } from "./api.js";

export const GRAINS = ["month", "week", "day", "hour"];
const LABELS = ["MONTH", "WEEK", "DAY", "HOUR"];
const NAMES = ["Month", "Week", "Day", "Hour"];
const AREA_HEIGHT = 320;
const MS = { split: 180, fall: 320, count: 480 };
const EASE = "cubic-bezier(.2,.8,.2,1)";
const reduced = () => document.documentElement.dataset.motion === "reduced";

export const grainIndex = (value) => Math.max(0, GRAINS.indexOf(value));

export function createScorePanel({ windowId, seen, wall, initial, onSettled }) {
  let settled = initial;
  let scoreReply = null;
  let seq = 0;
  let animations = [];
  let counting = 0;
  let loading = false;
  let running = null;
  let stale = false;
  const openLists = new Set();

  // --- score panel -----------------------------------------------------------------------------------------
  const numeral = h("p", { class: "numeral", "data-score-numeral": "" });
  const countPart = h("div", { class: "part-count", "data-phase-part": "count", "data-motion-ms": "480" }, numeral);
  const area = h("div", { class: "blocks", "data-block-area": "" });
  const splitPart = h("div", { class: "part-split", "data-phase-part": "split", "data-motion-ms": "180" }, area);
  const fallLayer = h("div", { class: "part-fall", "data-phase-part": "fall", "data-motion-ms": "320" });
  const failure = h("p", { class: "grain-failure", hidden: true, text: "THAT GRAIN DID NOT LOAD. MOVE AGAIN." });
  const frame = h("div", { class: "blocks-frame" }, splitPart, fallLayer);
  const panel = h("section", { role: "region", "aria-label": "Score panel", class: "score-panel field-yellow", "data-phase": "settled" },
    countPart, frame, failure);

  const applyMotion = () => {
    const off = reduced();
    countPart.dataset.motionMs = off ? "0" : String(MS.count);
    splitPart.dataset.motionMs = off ? "0" : String(MS.split);
    fallLayer.dataset.motionMs = off ? "0" : String(MS.fall);
  };
  applyMotion();
  const motionObserver = new MutationObserver(() => {
    applyMotion();
    if (!running) return;
    const { target, reply } = running;
    running = null;
    ++seq;
    finish(target, reply);
    onSettled(target, reply);
  });
  motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });

  // --- slider ----------------------------------------------------------------------------------------------
  const thumb = h("span", { class: "thumb", "aria-hidden": "true" });
  const slider = h("div", { class: "slider", role: "slider", tabindex: "0", "aria-label": "Break the Month",
    "aria-valuemin": "0", "aria-valuemax": "3", "aria-valuenow": String(initial), "aria-valuetext": LABELS[initial] },
  h("span", { class: "slider-rail", "aria-hidden": "true" }),
  LABELS.map((text, i) => h("span", { class: "detent", "aria-hidden": "true", style: `left:${(i / 3) * 100}%`, text })),
  thumb);
  const placeThumb = (index) => { thumb.style.left = `${(index / 3) * 100}%`; };
  const setSlider = (index) => {
    slider.setAttribute("aria-valuenow", String(index));
    slider.setAttribute("aria-valuetext", LABELS[index]);
    placeThumb(index);
  };
  setSlider(initial);
  let dragging = false;
  const nearest = (event) => {
    const rect = slider.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 3);
  };
  slider.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging = true;
    slider.setPointerCapture(event.pointerId);
    placeThumb(nearest(event));
  });
  slider.addEventListener("pointermove", (event) => { if (dragging) placeThumb(nearest(event)); });
  slider.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    moveTo(nearest(event));
  });
  slider.addEventListener("pointercancel", () => { dragging = false; placeThumb(Number(slider.getAttribute("aria-valuenow"))); });
  slider.addEventListener("keydown", (event) => {
    const now = Number(slider.getAttribute("aria-valuenow"));
    const next = { ArrowRight: now + 1, ArrowUp: now + 1, ArrowLeft: now - 1, ArrowDown: now - 1, Home: 0, End: 3 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    moveTo(Math.min(3, Math.max(0, next)));
  });

  // --- the grain's drawing ---------------------------------------------------------------------------------
  const bucketList = h("ul", { role: "list", "aria-label": "Buckets", class: "buckets" });
  const view = h("div", { class: "grain-view" }, bucketList, wall.el);

  const setNumeral = (text) => {
    if (numeral.textContent === text) return;
    numeral.replaceChildren(...[...text].map((char) => h("span", { class: /\d/.test(char) ? "digit" : "mark", text: char })));
  };
  const scoreText = (bp) => `${pct(bp)}%`;
  const setPhase = (phase) => { panel.dataset.phase = phase; };

  function renderBlocks(buckets) {
    const tallest = Math.max(1, ...buckets.map((b) => b.consumed_wh + b.surplus_wh));
    const px = (wh) => `${share(wh, tallest, AREA_HEIGHT)}px`;
    area.replaceChildren(...buckets.map((b) => h("div", {
      class: "block", "data-bucket-key": b.key, "data-matched-wh": b.matched_wh, "data-consumed-wh": b.consumed_wh,
      "data-surplus-wh": b.surplus_wh,
    },
    h("div", { class: "block-surplus", "data-block-part": "surplus", style: `height:${px(b.surplus_wh)}` }),
    h("div", { class: "block-consumed", style: `height:${px(b.consumed_wh)}` },
      h("div", { class: "block-matched", "data-block-part": "matched", style: `height:${px(b.matched_wh)}` })))));
  }

  function renderBuckets(buckets) {
    const existing = new Map([...bucketList.children].map((li) => [li.dataset.key, li]));
    const wanted = [];
    for (const b of buckets) {
      let li = existing.get(b.key);
      if (!li) {
        const button = h("button", { type: "button", "aria-expanded": "false", text: "Where it went" });
        const list = h("ul", { role: "list", "aria-label": `Worst of ${b.key}`, hidden: true });
        const text = h("span", { class: "bucket-text" });
        li = h("li", { "data-key": b.key }, text, button, list);
        button.addEventListener("click", () => {
          const open = list.hidden;
          list.hidden = !open;
          button.setAttribute("aria-expanded", String(open));
          if (open) openLists.add(b.key); else openLists.delete(b.key);
        });
      }
      const [text, , list] = li.children;
      text.textContent = `${b.key} matched ${commas(b.matched_wh)} of ${commas(b.consumed_wh)} Wh`;
      list.replaceChildren(...(b.worst || []).map((w) => h("li", { text: `${w.key} ${commas(w.unmatched_wh)} Wh unmatched` })));
      const open = openLists.has(b.key);
      list.hidden = !open;
      li.children[1].setAttribute("aria-expanded", String(open));
      wanted.push(li);
    }
    bucketList.replaceChildren(...wanted);
  }

  function renderGrain(index, reply) {
    const hourly = index === 3;
    frame.hidden = hourly;
    bucketList.hidden = hourly;
    wall.el.hidden = !hourly;
    if (hourly) {
      area.replaceChildren();
      bucketList.replaceChildren();
      wall.update(reply.buckets);
    } else {
      renderBlocks(reply.buckets);
      renderBuckets(reply.buckets);
    }
  }

  function showFalls(falls, buckets, reverse) {
    const parents = falls.filter((f) => f.detached_wh > 0);
    const tallest = Math.max(1, ...buckets.map((b) => b.consumed_wh + b.surplus_wh));
    const count = Math.max(1, falls.length);
    fallLayer.replaceChildren(...parents.map((f) => {
      const index = falls.indexOf(f);
      const piece = h("div", { class: "fall-piece", "data-fall-parent": f.parent_key, "data-detached-wh": f.detached_wh,
        style: `left:${(index / count) * 100}%;width:${100 / count}%;height:${share(f.detached_wh, tallest, AREA_HEIGHT)}px` });
      const frames = [{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${AREA_HEIGHT}px)`, opacity: 0 }];
      animations.push(piece.animate(reverse ? [...frames].reverse() : frames, { duration: MS.fall, easing: EASE, fill: "both" }));
      return piece;
    }));
  }

  function animateIn(node) {
    animations.push(node.animate([{ transform: "scaleX(.6)", opacity: 0.2 }, { transform: "none", opacity: 1 }],
      { duration: MS.split, easing: EASE }));
  }

  function cancelRunning() {
    for (const animation of animations) animation.cancel();
    animations = [];
    cancelAnimationFrame(counting);
    fallLayer.replaceChildren();
  }

  function countTo(from, to) {
    const start = performance.now();
    const step = () => {
      // Progress in thousandths of the count's duration; the eased score stays whole basis points (BigInt).
      const progress = BigInt(Math.min(1000, Math.floor(((performance.now() - start) * 1000) / MS.count)));
      const eased = 1000n ** 3n - (1000n - progress) ** 3n;
      setNumeral(scoreText(BigInt(from) + (BigInt(to - from) * eased) / 1000000000n));
      if (progress < 1000n) counting = requestAnimationFrame(step);
    };
    counting = requestAnimationFrame(step);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function finish(index, reply) {
    cancelRunning();
    renderGrain(index, reply);
    setNumeral(scoreText(reply.score_bp));
    failure.hidden = true;
    settled = index;
    scoreReply = reply;
    setSlider(index);
    setPhase("settled");
  }

  async function fetchGrain(index) {
    let reply = await get(`/api/windows/${windowId}/grains/${GRAINS[index]}`);
    if (reply.revision < seen.revision) reply = await get(`/api/windows/${windowId}/grains/${GRAINS[index]}`);
    seen.bump(reply.revision);
    return reply;
  }

  async function moveTo(target) {
    if (target === settled && panel.dataset.phase === "settled") { setSlider(settled); return; }
    const mine = ++seq;
    running = null;
    stale = false;
    cancelRunning();
    setSlider(target);
    let reply;
    try {
      reply = await fetchGrain(target);
    } catch (error) {
      if (mine !== seq) return;
      if (!(error instanceof ApiError) && !(error instanceof SessionCancelled)) throw error;
      setSlider(settled);
      setPhase("settled");
      failure.hidden = false;
      return;
    }
    if (mine !== seq) return;
    const from = settled;
    const previous = scoreReply;
    if (reduced()) { finish(target, reply); onSettled(target, reply); return; }
    openLists.clear();
    running = { target, reply };
    const forward = target > from;
    const phases = forward ? ["split", "fall", "count"] : ["count", "fall", "split"];
    for (const phase of phases) {
      if (mine !== seq) return;
      if (phase === "split") {
        setPhase("split");
        renderGrain(target, reply);
        animateIn(target === 3 ? wall.el : area);
      } else if (phase === "fall") {
        setPhase("fall");
        const source = forward ? reply : previous;
        showFalls(source.falls, source.buckets, !forward);
      } else {
        fallLayer.replaceChildren();
        setPhase("count");
        countTo(previous ? previous.score_bp : reply.score_bp, reply.score_bp);
      }
      await wait(MS[phase]);
    }
    if (mine !== seq) return;
    if (stale || reply.revision < seen.revision) {
      try { reply = await fetchGrain(target); } catch (error) { if (!(error instanceof ApiError)) throw error; }
      if (mine !== seq) return;
    }
    running = null;
    finish(target, reply);
    onSettled(target, reply);
  }

  async function refresh() {
    if (panel.dataset.phase !== "settled") { stale = true; return; }
    const mine = seq;
    const reply = await fetchGrain(settled);
    if (mine !== seq || panel.dataset.phase !== "settled") return;
    finish(settled, reply);
  }

  async function load() {
    setLoading(true);
    try {
      const reply = await fetchGrain(settled);
      finish(settled, reply);
    } finally {
      setLoading(false);
    }
    return scoreReply;
  }

  function setLoading(on) {
    loading = on;
    if (on) setNumeral("COUNTING");
    else if (scoreReply) setNumeral(scoreText(scoreReply.score_bp));
  }

  return {
    panel, slider, view,
    get settled() { return settled; },
    get scoreReply() { return scoreReply; },
    get loading() { return loading; },
    load, refresh, setLoading, moveTo,
    destroy() { motionObserver.disconnect(); cancelRunning(); },
  };
}

export const grainName = (index) => NAMES[index];
